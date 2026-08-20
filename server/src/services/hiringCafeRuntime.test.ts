import { describe, expect, it } from 'vitest';
import {
  computeAggregatorExecutionTimeoutMs,
  resolveExecutionTimeoutMs,
} from './hiringCafeRuntime';

describe('hiringCafeRuntime', () => {
  it('computeAggregatorExecutionTimeoutMs scales with job count', () => {
    const t10 = computeAggregatorExecutionTimeoutMs(10);
    const t40 = computeAggregatorExecutionTimeoutMs(40);
    expect(t40).toBeGreaterThan(t10);
    expect(t40).toBeGreaterThan(120_000);
  });

  it('resolveExecutionTimeoutMs uses longer budget for aggregators', () => {
    const career = resolveExecutionTimeoutMs(false, 40);
    const aggregator = resolveExecutionTimeoutMs(true, 40);
    expect(aggregator).toBeGreaterThan(career);
  });
});
