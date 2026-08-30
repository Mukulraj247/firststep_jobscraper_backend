/**
 * Audit all robots vs latest run health, and classify which failed
 * automations are already covered by current ATS/code fixes.
 *
 *   npx ts-node --project server/tsconfig.json server/src/scripts/auditAutomationHealth.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import mongoose from 'mongoose';
import { detectAtsBoard } from '../services/atsAdapters';
import { resolveAtsBoardStartUrl } from '../services/careerSiteAtsConfig';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

type HealthBucket =
  | 'ok'
  | 'never_run'
  | 'active'
  | 'failed'
  | 'dead'
  | 'aborted'
  | 'zero_rows'
  | 'unknown';

type FixClass =
  | 'already_fixed_code'
  | 'ats_board_available'
  | 'url_rewrite_helps'
  | 'proxy_tunnel'
  | 'captcha_cloudflare'
  | 'layout_zero_rows'
  | 'timeout'
  | 'navigation'
  | 'browser_closed'
  | 'circuit_open'
  | 'needs_manual'
  | 'n/a';

interface AuditRow {
  robotMetaId: string;
  scoutId: string;
  name: string;
  companyName: string;
  url: string;
  scheduled: boolean;
  health: HealthBucket;
  latestStatus: string | null;
  latestRunId: string | null;
  latestFinishedAt: string | null;
  rowsExtracted: number | null;
  anomaly: string | null;
  failureReason: string | null;
  errorSnippet: string | null;
  atsDetectedNow: string | null;
  atsListApi: string | null;
  urlRewrite: { adjusted: boolean; url: string; reason?: string } | null;
  fixClass: FixClass;
  fixNote: string;
}

const SUCCESS = new Set(['completed', 'success']);
const ACTIVE = new Set(['pending', 'queued', 'scheduled', 'running', 'aborting']);
const FAIL = new Set(['failed', 'dead', 'aborted']);

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function snippet(msg: string | null | undefined, n = 180): string | null {
  const s = String(msg || '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function classifyFix(opts: {
  health: HealthBucket;
  url: string;
  error: string;
  failureReason: string | null;
  ats: string | null;
  rewrite: { adjusted: boolean; reason?: string } | null;
}): { fixClass: FixClass; fixNote: string } {
  if (opts.health === 'ok' || opts.health === 'active' || opts.health === 'never_run') {
    return { fixClass: 'n/a', fixNote: '' };
  }

  const err = opts.error.toLowerCase();
  const host = hostOf(opts.url);
  const rewriteReason = String(opts.rewrite?.reason || '');

  // Code already shipped that reclassifies / rewrites this host or URL shape
  if (
    host === 'wellsfargojobs.com' ||
    /HappyDance host with Phenom-shaped/i.test(rewriteReason) ||
    (/happydance/i.test(String(opts.ats || '')) &&
      /search-results|phenom/i.test(err + ' ' + opts.url))
  ) {
    return {
      fixClass: 'already_fixed_code',
      fixNote: 'Host/URL now HappyDance (RSS) — redeploy + re-run',
    };
  }
  if (/Workday host with Phenom-shaped|Talent Brew marketing|Jibe career homepage|Zwayam career homepage|SmartRecruiters connected/i.test(rewriteReason)) {
    return {
      fixClass: 'already_fixed_code',
      fixNote: rewriteReason || 'Start URL rewrite already in code',
    };
  }

  if (opts.ats && ['happydance', 'workday', 'greenhouse', 'lever', 'ashby', 'smartrecruiters', 'findly', 'phenom', 'jibe', 'talentbrew', 'bankofamerica', 'googlecareers'].includes(opts.ats)) {
    // Failed despite board path existing — still may skip browser after redeploy if they never got ATS path
    if (/cloudflare|captcha|tunnel|proxy|phenom|ats board fetch returned no rows/i.test(err)) {
      return {
        fixClass: 'ats_board_available',
        fixNote: `Current detectAtsBoard=${opts.ats}; free-board path should avoid Chromium if fetch succeeds`,
      };
    }
  }

  if (opts.rewrite?.adjusted) {
    return {
      fixClass: 'url_rewrite_helps',
      fixNote: rewriteReason || 'resolveAtsBoardStartUrl adjusts start URL',
    };
  }

  if (/err_tunnel|proxy.*fail|tunnel_connection/i.test(err)) {
    return { fixClass: 'proxy_tunnel', fixNote: 'Proxy CONNECT failure — drop/rotate proxy' };
  }
  if (
    opts.failureReason === 'captcha' ||
    /cloudflare|captcha|just a moment|cf-challenge/i.test(err)
  ) {
    return { fixClass: 'captcha_cloudflare', fixNote: 'Anti-bot challenge — needs proxy/unblocker or ATS RSS/API' };
  }
  if (
    opts.failureReason === 'layout_change' ||
    opts.health === 'zero_rows' ||
    /zero rows|layout|selector/i.test(err)
  ) {
    return { fixClass: 'layout_zero_rows', fixNote: 'Selectors/layout or empty extract' };
  }
  if (opts.failureReason === 'timeout' || /timeout|timed out/i.test(err)) {
    return { fixClass: 'timeout', fixNote: 'Navigation/extract timeout' };
  }
  if (opts.failureReason === 'navigation_error' || /net::err|page\.goto|navigation/i.test(err)) {
    return { fixClass: 'navigation', fixNote: 'Navigation / DNS / connection error' };
  }
  if (opts.failureReason === 'browser_closed' || /browser has been closed|target closed/i.test(err)) {
    return { fixClass: 'browser_closed', fixNote: 'Browser/context closed mid-run' };
  }
  if (opts.failureReason === 'circuit_open' || /circuit open/i.test(err)) {
    return { fixClass: 'circuit_open', fixNote: 'Host circuit breaker open' };
  }

  return { fixClass: 'needs_manual', fixNote: 'No automatic fix classified' };
}

function healthFromLatest(run: any | null): HealthBucket {
  if (!run) return 'never_run';
  const status = String(run.status || '').toLowerCase();
  if (SUCCESS.has(status)) {
    if (run.anomaly === 'zero_rows' || (typeof run.rowsExtracted === 'number' && run.rowsExtracted === 0)) {
      return 'zero_rows';
    }
    return 'ok';
  }
  if (ACTIVE.has(status)) return 'active';
  if (status === 'dead') return 'dead';
  if (status === 'aborted') return 'aborted';
  if (status === 'failed') return 'failed';
  return 'unknown';
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URL;
  if (!uri) {
    console.error('MONGODB_URI missing');
    process.exit(1);
  }
  const dbName = process.env.MONGODB_DATABASE || undefined;
  await mongoose.connect(uri, dbName ? { dbName } : undefined);
  const db = mongoose.connection.db!;

  const robots = await db
    .collection('maxun_robots')
    .find({})
    .project({
      'recording_meta.id': 1,
      'recording_meta.name': 1,
      'recording_meta.url': 1,
      'recording_meta.scoutId': 1,
      'recording_meta.companyName': 1,
      'schedule.enabled': 1,
      'recording_meta.saasConfig.schedule.enabled': 1,
    })
    .toArray();

  const robotMetaIds = robots
    .map((r) => String(r.recording_meta?.id || '').trim())
    .filter(Boolean);

  // Latest run per robotMetaId — per-id find avoids a huge $sort (Atlas 32MB limit).
  const latestByRobot = new Map<string, any>();
  await Promise.all(
    robotMetaIds.map(async (robotMetaId) => {
      const latest = await db
        .collection('maxun_runs')
        .find({ robotMetaId })
        .project({
          status: 1,
          rowsExtracted: 1,
          failureReason: 1,
          normalizedFailureReason: 1,
          error: 1,
          log: 1,
          startedAt: 1,
          finishedAt: 1,
          runId: 1,
          robotMetaId: 1,
        })
        .sort({ startedAt: -1, _id: -1 })
        .limit(1)
        .next();
      if (latest) latestByRobot.set(robotMetaId, latest);
    })
  );

  // Also count runs by status overall
  const runStatusCounts = await db
    .collection('maxun_runs')
    .aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }])
    .toArray();

  const deadFailureReasons = await db
    .collection('maxun_runs')
    .aggregate([
      { $match: { status: { $in: ['dead', 'failed'] } } },
      {
        $group: {
          _id: { $ifNull: ['$normalizedFailureReason', '$failureReason'] },
          n: { $sum: 1 },
        },
      },
      { $sort: { n: -1 } },
    ])
    .toArray();

  const rows: AuditRow[] = [];
  for (const robot of robots) {
    const meta = robot.recording_meta || {};
    const robotMetaId = String(meta.id || '');
    const url = String(meta.url || '').trim();
    const run = latestByRobot.get(robotMetaId) || null;
    const health = healthFromLatest(run);
    const error = String(run?.errorMessage || '');
    const failureReason =
      (run?.normalizedFailureReason || run?.failureReason || null) as string | null;

    let atsDetectedNow: string | null = null;
    let atsListApi: string | null = null;
    let urlRewrite: AuditRow['urlRewrite'] = null;
    if (url) {
      try {
        const detected = detectAtsBoard(url);
        atsDetectedNow = detected?.provider || null;
        atsListApi = detected?.listApiUrl || null;
      } catch {
        /* ignore bad urls */
      }
      try {
        const resolved = resolveAtsBoardStartUrl(url);
        urlRewrite = {
          adjusted: !!resolved.adjusted,
          url: resolved.url,
          reason: resolved.reason,
        };
        // Prefer ATS on rewritten URL when homepage alone doesn't detect
        if (!atsDetectedNow && resolved.adjusted) {
          try {
            const d2 = detectAtsBoard(resolved.url);
            atsDetectedNow = d2?.provider || null;
            atsListApi = d2?.listApiUrl || null;
          } catch {
            /* */
          }
        }
      } catch {
        /* */
      }
    }

    const { fixClass, fixNote } = classifyFix({
      health,
      url,
      error,
      failureReason,
      ats: atsDetectedNow,
      rewrite: urlRewrite,
    });

    const finished =
      run?.finishedAt || run?.completedAt || run?.updatedAt || run?.startedAt || null;

    rows.push({
      robotMetaId,
      scoutId: String(meta.scoutId || ''),
      name: String(meta.name || ''),
      companyName: String(meta.companyName || ''),
      url,
      scheduled: !!(
        robot.schedule?.enabled || meta.saasConfig?.schedule?.enabled
      ),
      health,
      latestStatus: run ? String(run.status) : null,
      latestRunId: run ? String(run.runId || run._id || '') : null,
      latestFinishedAt: finished ? new Date(finished).toISOString() : null,
      rowsExtracted:
        typeof run?.rowsExtracted === 'number' ? run.rowsExtracted : null,
      anomaly: run?.anomaly || null,
      failureReason,
      errorSnippet: snippet(error),
      atsDetectedNow,
      atsListApi,
      urlRewrite,
      fixClass,
      fixNote,
    });
  }

  const healthCounts: Record<string, number> = {};
  const fixCounts: Record<string, number> = {};
  const atsOnFailed: Record<string, number> = {};
  for (const r of rows) {
    healthCounts[r.health] = (healthCounts[r.health] || 0) + 1;
    if (FAIL.has(r.health) || r.health === 'zero_rows' || r.health === 'failed' || r.health === 'dead' || r.health === 'aborted') {
      fixCounts[r.fixClass] = (fixCounts[r.fixClass] || 0) + 1;
      const k = r.atsDetectedNow || '(none)';
      atsOnFailed[k] = (atsOnFailed[k] || 0) + 1;
    }
  }

  const failedRows = rows.filter(
    (r) =>
      r.health === 'failed' ||
      r.health === 'dead' ||
      r.health === 'aborted' ||
      r.health === 'zero_rows'
  );
  const alreadyFixed = failedRows.filter((r) => r.fixClass === 'already_fixed_code');
  const atsAvailable = failedRows.filter((r) => r.fixClass === 'ats_board_available');
  const rewriteHelps = failedRows.filter((r) => r.fixClass === 'url_rewrite_helps');

  const out = {
    generatedAt: new Date().toISOString(),
    totals: {
      automations: rows.length,
      scheduled: rows.filter((r) => r.scheduled).length,
      health: healthCounts,
      failedLike: failedRows.length,
      alreadyFixedCode: alreadyFixed.length,
      atsBoardAvailable: atsAvailable.length,
      urlRewriteHelps: rewriteHelps.length,
      recoverableNow: alreadyFixed.length + atsAvailable.length + rewriteHelps.length,
    },
    fixClassOnFailed: fixCounts,
    atsProviderOnFailed: atsOnFailed,
    runStatusCounts: Object.fromEntries(runStatusCounts.map((x) => [x._id, x.n])),
    deadFailureReasons: deadFailureReasons.map((x) => ({
      reason: x._id || '(null)',
      n: x.n,
    })),
    alreadyFixedDetails: alreadyFixed.map((r) => ({
      name: r.name,
      companyName: r.companyName,
      scoutId: r.scoutId,
      url: r.url,
      health: r.health,
      failureReason: r.failureReason,
      errorSnippet: r.errorSnippet,
      atsDetectedNow: r.atsDetectedNow,
      rewrite: r.urlRewrite,
      fixNote: r.fixNote,
    })),
    failedDetails: failedRows
      .sort((a, b) => {
        const order: Record<string, number> = {
          already_fixed_code: 0,
          ats_board_available: 1,
          url_rewrite_helps: 2,
          proxy_tunnel: 3,
          captcha_cloudflare: 4,
          layout_zero_rows: 5,
          timeout: 6,
          navigation: 7,
          browser_closed: 8,
          circuit_open: 9,
          needs_manual: 10,
          'n/a': 11,
        };
        return (order[a.fixClass] ?? 99) - (order[b.fixClass] ?? 99);
      })
      .map((r) => ({
        name: r.name,
        companyName: r.companyName,
        scoutId: r.scoutId,
        url: r.url,
        health: r.health,
        latestStatus: r.latestStatus,
        failureReason: r.failureReason,
        errorSnippet: r.errorSnippet,
        atsDetectedNow: r.atsDetectedNow,
        rewriteAdjusted: !!r.urlRewrite?.adjusted,
        rewriteReason: r.urlRewrite?.reason || null,
        rewrittenUrl: r.urlRewrite?.adjusted ? r.urlRewrite.url : null,
        fixClass: r.fixClass,
        fixNote: r.fixNote,
        latestFinishedAt: r.latestFinishedAt,
        rowsExtracted: r.rowsExtracted,
      })),
    all: rows,
  };

  const outPath = path.resolve(process.cwd(), 'tmp-automation-health-audit.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ...out, all: undefined, failedDetailsPreview: out.failedDetails.slice(0, 40) }, null, 2));
  console.error(`\nWrote full audit → ${outPath} (${rows.length} automations, ${failedRows.length} failed-like)`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
