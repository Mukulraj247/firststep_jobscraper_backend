/**
 * Run drift detection: compare list-extraction row counts to a baseline so
 * silent zero-row / volume-drop failures are not reported as success.
 *
 * `evaluateRunDrift` is pure (no DB / env / logger). I/O helpers live below.
 */

import Run from '../models/Run';

export enum RunDriftOutcome {
  Healthy = 'Healthy',
  SoftDrop = 'SoftDrop',
  ZeroRows = 'ZeroRows',
  Escalated = 'Escalated',
  Disabled = 'Disabled',
}

export type RunDriftAnomaly = 'zero_rows' | 'row_drop';

export type BaselineSource = 'last_good_run' | 'previewRows' | 'none';

export type DriftConfig = {
  enabled: boolean;
  dropRatio: number;
  minBaseline: number;
  escalationStreak: number;
};

export type RunDriftAnomalyMeta = {
  current: number;
  baseline: number | null;
  ratio: number | null;
  baselineSource: BaselineSource;
  escalated: boolean;
  threshold: number | null;
};

export type RecentFinishedRun = {
  anomaly: string | null;
  escalated?: boolean;
};

export type EvaluateRunDriftInput = {
  current: number;
  baseline: number | null;
  baselineSource: BaselineSource;
  /** Prior finished runs newest-first (exclude the current run). Length should be streak-1. */
  recentFinishedRuns: RecentFinishedRun[];
  config: DriftConfig;
};

export type EvaluateRunDriftResult = {
  outcome: RunDriftOutcome;
  anomaly: RunDriftAnomaly | null;
  anomalyMeta: RunDriftAnomalyMeta;
  errorMessage: string | null;
  shouldWebhook: boolean;
  skipRetry: boolean;
  runStatus: 'completed' | 'failed';
};

export class RunDriftError extends Error {
  readonly runId: string;
  readonly outcome: RunDriftOutcome;
  readonly anomaly: RunDriftAnomaly | null;
  readonly anomalyMeta: RunDriftAnomalyMeta;

  constructor(opts: {
    runId: string;
    outcome: RunDriftOutcome;
    anomaly: RunDriftAnomaly | null;
    anomalyMeta: RunDriftAnomalyMeta;
    message: string;
  }) {
    super(opts.message);
    this.name = 'RunDriftError';
    this.runId = opts.runId;
    this.outcome = opts.outcome;
    this.anomaly = opts.anomaly;
    this.anomalyMeta = opts.anomalyMeta;
  }
}

const DEFAULT_CONFIG: DriftConfig = {
  enabled: true,
  dropRatio: 0.2,
  minBaseline: 5,
  escalationStreak: 2,
};

function isSoftRowDrop(run: RecentFinishedRun | null | undefined): boolean {
  if (!run) return false;
  return run.anomaly === 'row_drop' && !run.escalated;
}

function buildMeta(
  current: number,
  baseline: number | null,
  baselineSource: BaselineSource,
  escalated: boolean,
  threshold: number | null
): RunDriftAnomalyMeta {
  const ratio =
    baseline != null && baseline > 0 ? current / baseline : null;
  return {
    current,
    baseline,
    ratio,
    baselineSource,
    escalated,
    threshold,
  };
}

/**
 * Pure drift policy. Inject config/baseline/history — do not read env here.
 */
export function evaluateRunDrift(input: EvaluateRunDriftInput): EvaluateRunDriftResult {
  const { current, baseline, baselineSource, recentFinishedRuns, config } = input;
  const safeCurrent = Math.max(0, Number(current) || 0);

  if (!config.enabled) {
    return {
      outcome: RunDriftOutcome.Disabled,
      anomaly: null,
      anomalyMeta: buildMeta(safeCurrent, baseline, baselineSource, false, null),
      errorMessage: null,
      shouldWebhook: false,
      skipRetry: false,
      runStatus: 'completed',
    };
  }

  if (safeCurrent === 0) {
    const meta = buildMeta(0, baseline, baselineSource, false, null);
    const msg =
      baseline != null && baseline > 0
        ? `Zero rows extracted (baseline ${baseline}). Selectors likely broke or the list did not render.`
        : 'Zero rows extracted. Selectors likely broke or the list did not render.';
    return {
      outcome: RunDriftOutcome.ZeroRows,
      anomaly: 'zero_rows',
      anomalyMeta: meta,
      errorMessage: msg,
      shouldWebhook: true,
      skipRetry: true,
      runStatus: 'failed',
    };
  }

  const hasUsableBaseline =
    baseline != null &&
    Number.isFinite(baseline) &&
    baseline >= config.minBaseline;

  if (!hasUsableBaseline) {
    return {
      outcome: RunDriftOutcome.Healthy,
      anomaly: null,
      anomalyMeta: buildMeta(safeCurrent, baseline, baselineSource, false, null),
      errorMessage: null,
      shouldWebhook: false,
      skipRetry: false,
      runStatus: 'completed',
    };
  }

  const threshold = Math.floor(baseline! * config.dropRatio);
  if (safeCurrent >= threshold) {
    return {
      outcome: RunDriftOutcome.Healthy,
      anomaly: null,
      anomalyMeta: buildMeta(safeCurrent, baseline, baselineSource, false, threshold),
      errorMessage: null,
      shouldWebhook: false,
      skipRetry: false,
      runStatus: 'completed',
    };
  }

  // Soft drop — check consecutive prior soft row_drops for escalation.
  // Streak includes current: need (escalationStreak - 1) prior consecutive soft drops.
  const priorsNeeded = Math.max(0, config.escalationStreak - 1);
  let consecutivePriors = 0;
  for (let i = 0; i < priorsNeeded; i += 1) {
    if (isSoftRowDrop(recentFinishedRuns[i])) {
      consecutivePriors += 1;
    } else {
      break;
    }
  }
  const escalate = priorsNeeded > 0 && consecutivePriors >= priorsNeeded;

  const meta = buildMeta(safeCurrent, baseline, baselineSource, escalate, threshold);
  const msg = `Row count drop: ${baseline} → ${safeCurrent} (threshold ${threshold}).`;

  if (escalate) {
    return {
      outcome: RunDriftOutcome.Escalated,
      anomaly: 'row_drop',
      anomalyMeta: meta,
      errorMessage: `${msg} Escalated after ${config.escalationStreak} consecutive soft drops.`,
      shouldWebhook: true,
      skipRetry: true,
      runStatus: 'failed',
    };
  }

  return {
    outcome: RunDriftOutcome.SoftDrop,
    anomaly: 'row_drop',
    anomalyMeta: meta,
    errorMessage: msg,
    shouldWebhook: true,
    skipRetry: false,
    runStatus: 'completed',
  };
}

/** Load drift knobs from env. Defaults match production plan. */
export function loadDriftConfig(env: NodeJS.ProcessEnv = process.env): DriftConfig {
  const flag = String(env.DRIFT_DETECTION_ENABLED ?? 'true').trim().toLowerCase();
  const enabled = !(flag === 'false' || flag === '0' || flag === 'no' || flag === 'off');
  const dropRatio = Number.parseFloat(String(env.DRIFT_DROP_RATIO ?? DEFAULT_CONFIG.dropRatio));
  const minBaseline = Number.parseInt(String(env.DRIFT_MIN_BASELINE ?? DEFAULT_CONFIG.minBaseline), 10);
  const escalationStreak = Number.parseInt(
    String(env.DRIFT_ESCALATION_STREAK ?? DEFAULT_CONFIG.escalationStreak),
    10
  );
  return {
    enabled,
    dropRatio: Number.isFinite(dropRatio) && dropRatio > 0 && dropRatio <= 1 ? dropRatio : DEFAULT_CONFIG.dropRatio,
    minBaseline: Number.isFinite(minBaseline) && minBaseline >= 0 ? minBaseline : DEFAULT_CONFIG.minBaseline,
    escalationStreak:
      Number.isFinite(escalationStreak) && escalationStreak >= 1
        ? escalationStreak
        : DEFAULT_CONFIG.escalationStreak,
  };
}

export type BaselineLookup = {
  baseline: number | null;
  baselineSource: BaselineSource;
};

/**
 * Last good run: completed/success, anomaly == null, rowsExtracted > 0.
 * Else previewRows.length. Else none.
 */
export async function getBaselineForRobot(
  robotMetaId: string,
  previewRows?: unknown[] | null,
  excludeRunId?: string | null
): Promise<BaselineLookup> {
  const query: Record<string, any> = {
    robotMetaId,
    status: { $in: ['completed', 'success'] },
    $or: [{ anomaly: null }, { anomaly: { $exists: false } }, { anomaly: '' }],
    rowsExtracted: { $gt: 0 },
  };
  if (excludeRunId) {
    query.runId = { $ne: excludeRunId };
  }

  const lastGood = await Run.findOne(query)
    .sort({ _id: -1 })
    .select('rowsExtracted')
    .lean();

  if (lastGood && typeof (lastGood as any).rowsExtracted === 'number' && (lastGood as any).rowsExtracted > 0) {
    return {
      baseline: Number((lastGood as any).rowsExtracted),
      baselineSource: 'last_good_run',
    };
  }

  if (Array.isArray(previewRows) && previewRows.length > 0) {
    return {
      baseline: previewRows.length,
      baselineSource: 'previewRows',
    };
  }

  return { baseline: null, baselineSource: 'none' };
}

/** Last N finished runs for streak (newest first). Finished = completed/success/failed. */
export async function fetchRecentFinishedRuns(
  robotMetaId: string,
  limit: number,
  excludeRunId?: string | null
): Promise<RecentFinishedRun[]> {
  if (limit <= 0) return [];
  const query: Record<string, any> = {
    robotMetaId,
    status: { $in: ['completed', 'success', 'failed'] },
  };
  if (excludeRunId) {
    query.runId = { $ne: excludeRunId };
  }

  const rows = await Run.find(query)
    .sort({ _id: -1 })
    .limit(limit)
    .select('anomaly anomalyMeta')
    .lean();

  return rows.map((row: any) => ({
    anomaly: row.anomaly || null,
    escalated: Boolean(row.anomalyMeta?.escalated),
  }));
}

export { DEFAULT_CONFIG as DEFAULT_DRIFT_CONFIG };
