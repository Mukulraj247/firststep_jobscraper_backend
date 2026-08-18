import { describe, expect, it } from 'vitest';
import {
  evaluateRunDrift,
  loadDriftConfig,
  RunDriftOutcome,
  selectStableRowBaseline,
  type DriftConfig,
} from './runDrift';

const baseConfig: DriftConfig = {
  enabled: true,
  dropRatio: 0.2,
  minBaseline: 5,
  escalationStreak: 2,
};

describe('evaluateRunDrift', () => {
  it('returns Disabled when kill switch is off', () => {
    const r = evaluateRunDrift({
      current: 0,
      baseline: 100,
      baselineSource: 'last_good_run',
      recentFinishedRuns: [],
      config: { ...baseConfig, enabled: false },
    });
    expect(r.outcome).toBe(RunDriftOutcome.Disabled);
    expect(r.runStatus).toBe('completed');
    expect(r.anomaly).toBeNull();
    expect(r.shouldWebhook).toBe(false);
    expect(r.skipRetry).toBe(false);
  });

  it('fails with ZeroRows when current is 0 (no baseline)', () => {
    const r = evaluateRunDrift({
      current: 0,
      baseline: null,
      baselineSource: 'none',
      recentFinishedRuns: [],
      config: baseConfig,
    });
    expect(r.outcome).toBe(RunDriftOutcome.ZeroRows);
    expect(r.anomaly).toBe('zero_rows');
    expect(r.runStatus).toBe('failed');
    expect(r.shouldWebhook).toBe(true);
    expect(r.skipRetry).toBe(true);
  });

  it('fails with ZeroRows when current is 0 with baseline', () => {
    const r = evaluateRunDrift({
      current: 0,
      baseline: 100,
      baselineSource: 'last_good_run',
      recentFinishedRuns: [],
      config: baseConfig,
    });
    expect(r.outcome).toBe(RunDriftOutcome.ZeroRows);
    expect(r.anomalyMeta.baseline).toBe(100);
  });

  it('is Healthy when no usable baseline and current > 0', () => {
    const r = evaluateRunDrift({
      current: 12,
      baseline: null,
      baselineSource: 'none',
      recentFinishedRuns: [],
      config: baseConfig,
    });
    expect(r.outcome).toBe(RunDriftOutcome.Healthy);
    expect(r.anomaly).toBeNull();
  });

  it('is Healthy when baseline below minBaseline even if drop is large', () => {
    const r = evaluateRunDrift({
      current: 1,
      baseline: 4,
      baselineSource: 'previewRows',
      recentFinishedRuns: [],
      config: baseConfig,
    });
    expect(r.outcome).toBe(RunDriftOutcome.Healthy);
  });

  it('marks SoftDrop for 100 → 19 (threshold floor 20)', () => {
    const r = evaluateRunDrift({
      current: 19,
      baseline: 100,
      baselineSource: 'last_good_run',
      recentFinishedRuns: [],
      config: baseConfig,
    });
    expect(r.outcome).toBe(RunDriftOutcome.SoftDrop);
    expect(r.anomaly).toBe('row_drop');
    expect(r.anomalyMeta.escalated).toBe(false);
    expect(r.anomalyMeta.threshold).toBe(20);
    expect(r.runStatus).toBe('completed');
    expect(r.shouldWebhook).toBe(true);
  });

  it('is Healthy at boundary 100 → 20', () => {
    const r = evaluateRunDrift({
      current: 20,
      baseline: 100,
      baselineSource: 'last_good_run',
      recentFinishedRuns: [],
      config: baseConfig,
    });
    expect(r.outcome).toBe(RunDriftOutcome.Healthy);
    expect(r.anomaly).toBeNull();
  });

  it('does not escalate soft → healthy → soft', () => {
    const r = evaluateRunDrift({
      current: 19,
      baseline: 100,
      baselineSource: 'last_good_run',
      recentFinishedRuns: [{ anomaly: null }],
      config: baseConfig,
    });
    expect(r.outcome).toBe(RunDriftOutcome.SoftDrop);
    expect(r.anomalyMeta.escalated).toBe(false);
  });

  it('escalates when prior consecutive soft row_drop matches streak', () => {
    const r = evaluateRunDrift({
      current: 19,
      baseline: 100,
      baselineSource: 'last_good_run',
      recentFinishedRuns: [{ anomaly: 'row_drop', escalated: false }],
      config: baseConfig,
    });
    expect(r.outcome).toBe(RunDriftOutcome.Escalated);
    expect(r.anomaly).toBe('row_drop');
    expect(r.anomalyMeta.escalated).toBe(true);
    expect(r.runStatus).toBe('failed');
    expect(r.shouldWebhook).toBe(true);
    expect(r.skipRetry).toBe(true);
  });

  it('does not treat escalated prior as soft for streak', () => {
    const r = evaluateRunDrift({
      current: 19,
      baseline: 100,
      baselineSource: 'last_good_run',
      recentFinishedRuns: [{ anomaly: 'row_drop', escalated: true }],
      config: baseConfig,
    });
    expect(r.outcome).toBe(RunDriftOutcome.SoftDrop);
  });

  it('preserves previewRows baselineSource in meta', () => {
    const r = evaluateRunDrift({
      current: 1,
      baseline: 10,
      baselineSource: 'previewRows',
      recentFinishedRuns: [],
      config: baseConfig,
    });
    expect(r.outcome).toBe(RunDriftOutcome.SoftDrop);
    expect(r.anomalyMeta.baselineSource).toBe('previewRows');
  });
});

describe('loadDriftConfig', () => {
  it('defaults to enabled with plan defaults', () => {
    const c = loadDriftConfig({});
    expect(c.enabled).toBe(true);
    expect(c.dropRatio).toBe(0.2);
    expect(c.minBaseline).toBe(5);
    expect(c.escalationStreak).toBe(2);
  });

  it('respects kill switch', () => {
    expect(loadDriftConfig({ DRIFT_DETECTION_ENABLED: 'false' }).enabled).toBe(false);
  });
});

describe('selectStableRowBaseline', () => {
  it('uses the median so a single inflated extraction cannot poison drift detection', () => {
    expect(selectStableRowBaseline([29, 4, 4, 4, 4])).toBe(4);
  });

  it('uses the lower median when two runs include an inflated outlier', () => {
    expect(selectStableRowBaseline([29, 4])).toBe(4);
  });

  it('uses the newest run when there is no history to stabilize', () => {
    expect(selectStableRowBaseline([30])).toBe(30);
  });
});
