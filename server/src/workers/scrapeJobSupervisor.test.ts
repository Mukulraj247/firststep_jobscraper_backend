import { describe, expect, it } from 'vitest';
import { fork } from 'child_process';
import path from 'path';
import {
  killChildTree,
  killScrapeChildForRun,
  isChildProcessIsolationEnabled,
  ScraperJobCancelledError,
} from './scrapeJobSupervisor';

describe('scrapeJobSupervisor', () => {
  it('defaults child isolation to enabled', () => {
    const prev = process.env.SCRAPE_JOB_CHILD_PROCESS;
    const prevChild = process.env.SCRAPE_JOB_CHILD;
    delete process.env.SCRAPE_JOB_CHILD_PROCESS;
    delete process.env.SCRAPE_JOB_CHILD;
    expect(isChildProcessIsolationEnabled()).toBe(true);
    process.env.SCRAPE_JOB_CHILD_PROCESS = 'false';
    expect(isChildProcessIsolationEnabled()).toBe(false);
    process.env.SCRAPE_JOB_CHILD = '1';
    delete process.env.SCRAPE_JOB_CHILD_PROCESS;
    expect(isChildProcessIsolationEnabled()).toBe(false);
    if (prev === undefined) delete process.env.SCRAPE_JOB_CHILD_PROCESS;
    else process.env.SCRAPE_JOB_CHILD_PROCESS = prev;
    if (prevChild === undefined) delete process.env.SCRAPE_JOB_CHILD;
    else process.env.SCRAPE_JOB_CHILD = prevChild;
  });

  it('killScrapeChildForRun is a no-op for unknown runIds', async () => {
    expect(await killScrapeChildForRun('no-such-run')).toBe(false);
  });

  it('ScraperJobCancelledError carries runId', () => {
    const err = new ScraperJobCancelledError('r1', 'Automation deleted');
    expect(err.name).toBe('ScraperJobCancelledError');
    expect(err.runId).toBe('r1');
    expect(err.message).toMatch(/Automation deleted/);
  });

  it('killChildTree stops a hung child within timeout', async () => {
    const script = path.join(__dirname, 'fixtures', 'hangChild.js');
    const child = fork(script, [], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      detached: process.platform !== 'win32',
    });
    const pid = child.pid;
    expect(pid).toBeTruthy();

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('child did not signal ready')), 5000);
      child.once('message', () => {
        clearTimeout(t);
        resolve();
      });
      child.once('error', reject);
    });

    const started = Date.now();
    await killChildTree(pid!);
    // Wait until exit
    await new Promise<void>((resolve) => {
      if (child.killed || child.exitCode != null) {
        resolve();
        return;
      }
      child.once('exit', () => resolve());
      setTimeout(() => resolve(), 5000);
    });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(8000);
    // Process should be dead
    let alive = true;
    try {
      process.kill(pid!, 0);
    } catch {
      alive = false;
    }
    expect(alive).toBe(false);
  }, 15000);
});
