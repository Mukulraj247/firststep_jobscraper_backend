/**
 * Forks a disposable Node process per scraper job and SIGKILLs the process tree on timeout.
 */

import { fork, ChildProcess, execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import logger from '../logger';
import Run from '../models/Run';
import { killUntrackedPlaywrightChromium } from '../services/browserProcess';
import type { ScraperJobData } from '../queue/scraperQueue';
import type { QueuedRunSocketIpcMessage } from './scrapeSocket';

const execFileAsync = promisify(execFile);

/** Active scrape child PIDs — killed on parent drain/shutdown. */
const activeScrapeChildPids = new Set<number>();

export class ScraperJobTimeoutError extends Error {
  readonly runId: string;
  constructor(runId: string, timeoutMs: number) {
    super(`Scraper job timed out after ${timeoutMs}ms (child killed)`);
    this.name = 'ScraperJobTimeoutError';
    this.runId = runId;
  }
}

export type ChildResultMessage =
  | { type: 'result'; ok: true }
  | { type: 'result'; ok: false; message: string }
  | QueuedRunSocketIpcMessage;

const GRACE_MS = parseInt(process.env.SCRAPE_JOB_CHILD_GRACE_MS || '5000', 10);

function resolveChildScript(): { script: string; execArgv: string[] } {
  // Production: compiled next to this file under server/dist/...
  const compiled = path.join(__dirname, 'scrapeJobChild.js');
  const isTsRuntime = __filename.endsWith('.ts') || process.env.SCRAPE_JOB_CHILD_TS === '1';
  if (isTsRuntime) {
    // Node 22+/24 type-stripping treats forked .ts as ESM and breaks
    // extensionless imports. Boot via .cjs + ts-node, and disable strip-types.
    const cjsBootstrap = path.join(__dirname, 'scrapeJobChild.cjs');
    return {
      script: cjsBootstrap,
      execArgv: [
        '--no-strip-types',
        // Keep legacy alias for older Node 22 builds that still use it.
        '--no-experimental-strip-types',
      ],
    };
  }
  return { script: compiled, execArgv: [] };
}

export async function killChildTree(pid: number): Promise<void> {
  if (!pid || !Number.isFinite(pid)) return;

  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true });
    } catch (error: any) {
      logger.log('warn', `taskkill failed for pid ${pid}: ${error?.message || error}`);
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already dead */
      }
    }
  } else {
    try {
      // Negative PID = process group (child started detached as group leader).
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already dead */
      }
    }
  }

  await killUntrackedPlaywrightChromium().catch(() => {});
}

/** SIGKILL every tracked scrape child (and Chromium trees). Safe to call repeatedly. */
export async function killAllActiveScrapeChildren(): Promise<number> {
  const pids = [...activeScrapeChildPids];
  if (pids.length === 0) return 0;
  logger.log('warn', `Killing ${pids.length} active scrape child process(es) on shutdown`);
  await Promise.all(pids.map((pid) => killChildTree(pid).catch(() => {})));
  activeScrapeChildPids.clear();
  return pids.length;
}

export function getActiveScrapeChildCount(): number {
  return activeScrapeChildPids.size;
}

async function forwardSocketMessage(msg: QueuedRunSocketIpcMessage): Promise<void> {
  try {
    const { io } = await import('../server');
    io.of(msg.namespace).to(msg.room).emit(msg.event, msg.payload);
  } catch (error: any) {
    logger.log('warn', `Parent failed to forward socket ${msg.event}: ${error?.message || error}`);
  }
}

async function markRunTimedOut(runId: string, timeoutMs: number): Promise<void> {
  try {
    const run = await Run.findOne({ runId });
    if (!run) return;
    if (run.status === 'completed' || run.status === 'success' || run.status === 'failed') {
      return;
    }
    const message = `Scraper job timed out after ${timeoutMs}ms (child process killed)`;
    run.status = 'failed';
    run.errorMessage = message;
    run.finishedAt = new Date().toLocaleString();
    const started = new Date(run.startedAt).getTime();
    run.duration = Number.isNaN(started) ? null : Math.max(0, Date.now() - started);
    await run.save();

    const userId = run.runByUserId != null ? String(run.runByUserId) : null;
    if (userId) {
      try {
        const { io } = await import('../server');
        io.of('/queued-run').to(`user-${userId}`).emit('run-completed', {
          runId,
          robotMetaId: run.robotMetaId,
          status: 'failed',
          finishedAt: run.finishedAt,
          reason: 'timeout',
        });
      } catch {
        /* ignore */
      }
    }
  } catch (error: any) {
    logger.log('warn', `Failed to mark run ${runId} timed out: ${error?.message || error}`);
  }
}

/**
 * Run one scraper job in a child process. Throws ScraperJobTimeoutError on hard kill.
 * Throws Error if the child exits with a failure result.
 */
export async function runScraperJobInChild(
  data: ScraperJobData,
  options: { timeoutMs: number }
): Promise<void> {
  const timeoutMs = options.timeoutMs;
  const { script, execArgv } = resolveChildScript();

  const child: ChildProcess = fork(script, [], {
    execArgv,
    env: {
      ...process.env,
      SCRAPE_JOB_CHILD: '1',
      TS_NODE_TRANSPILE_ONLY: '1',
      TS_NODE_PROJECT:
        process.env.TS_NODE_PROJECT || path.join(__dirname, '..', '..', 'tsconfig.json'),
    },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    // Own process group on Unix so kill(-pid) reaps Chromium descendants.
    detached: process.platform !== 'win32',
  });

  const pid = child.pid;
  if (!pid) {
    throw new Error('Failed to fork scrape job child (no pid)');
  }

  activeScrapeChildPids.add(pid);
  logger.log('info', `Forked scrape child pid=${pid} runId=${data.runId}`);

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let resultError: string | null = null;

    const cleanup = () => {
      activeScrapeChildPids.delete(pid);
      child.removeAllListeners();
    };

    const finishOk = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve();
    };

    const finishErr = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(err);
    };

    const timer = setTimeout(async () => {
      timedOut = true;
      logger.log('warn', `Scrape child pid=${pid} timed out after ${timeoutMs}ms — killing tree`);
      await killChildTree(pid);
      // Brief grace for OS to reap, then mark run failed.
      await new Promise((r) => setTimeout(r, Math.min(GRACE_MS, 2000)));
      await markRunTimedOut(data.runId, timeoutMs);
      finishErr(new ScraperJobTimeoutError(data.runId, timeoutMs));
    }, timeoutMs);

    child.on('message', (raw: ChildResultMessage) => {
      if (!raw || typeof raw !== 'object') return;
      if ((raw as QueuedRunSocketIpcMessage).type === 'socket') {
        void forwardSocketMessage(raw as QueuedRunSocketIpcMessage);
        return;
      }
      if (raw.type === 'result') {
        if (raw.ok) {
          finishOk();
        } else {
          resultError = raw.message || 'Child scrape failed';
          // Wait for exit to ensure process is gone before rejecting.
        }
      }
    });

    child.on('error', (error) => {
      finishErr(error instanceof Error ? error : new Error(String(error)));
    });

    child.on('exit', (code, signal) => {
      if (settled) return;
      if (timedOut) {
        finishErr(new ScraperJobTimeoutError(data.runId, timeoutMs));
        return;
      }
      if (resultError) {
        finishErr(new Error(resultError));
        return;
      }
      if (code === 0) {
        finishOk();
        return;
      }
      finishErr(
        new Error(
          `Scrape child exited code=${code} signal=${signal || 'none'} for runId=${data.runId}`
        )
      );
    });

    try {
      child.send({ type: 'start', data });
    } catch (error: any) {
      finishErr(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function isChildProcessIsolationEnabled(): boolean {
  if (process.env.SCRAPE_JOB_CHILD === '1') return false; // already inside child
  const flag = String(process.env.SCRAPE_JOB_CHILD_PROCESS ?? 'true').trim().toLowerCase();
  return !(flag === 'false' || flag === '0' || flag === 'no' || flag === 'off');
}
