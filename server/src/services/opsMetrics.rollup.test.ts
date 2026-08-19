import { describe, expect, it } from 'vitest';
import {
  opsMetricsCacheKey,
  resolveDigitalOceanForOpsMetrics,
  resolveOpsMetricsBounds,
  rollupOpsMetricsFromRuns,
} from './opsMetrics';

describe('opsMetricsCacheKey', () => {
  it('scopes cache by owner, window, and optional calendar date', () => {
    expect(opsMetricsCacheKey(42, '6h', null)).toBe('ops:42:6h:');
    expect(opsMetricsCacheKey('42', '6h', '2026-08-18')).toBe('ops:42:6h:2026-08-18');
  });
});

describe('resolveDigitalOceanForOpsMetrics', () => {
  it('returns cached DigitalOcean data without marking it pending', () => {
    const cached = {
      configured: true,
      generatedAt: '2026-08-18T10:00:00.000Z',
      droplets: [{ id: 1, name: 'scout' }],
    };
    expect(resolveDigitalOceanForOpsMetrics(cached, true)).toEqual(cached);
  });

  it('returns a pending placeholder so KPI payloads never wait on DigitalOcean', () => {
    const pending = resolveDigitalOceanForOpsMetrics(undefined, true);
    expect(pending.pending).toBe(true);
    expect(pending.configured).toBe(true);
    expect(pending.droplets).toEqual([]);
  });
});

describe('rollupOpsMetricsFromRuns', () => {
  it('aggregates totals, series buckets, and tag counts in a single pass', () => {
    const bounds = resolveOpsMetricsBounds({
      window: '6h',
      nowMs: Date.parse('2026-08-17T22:23:00.000Z'),
    });
    const t0 = bounds.bucketStarts[0];
    const t1 = bounds.bucketStarts[1];

    const result = rollupOpsMetricsFromRuns({
      runs: [
        {
          status: 'success',
          sortAt: new Date(t0 + 1000),
          robotMetaId: 'a',
          rowsExtracted: 10,
          jobsAddedToBoard: 3,
        },
        {
          status: 'failed',
          sortAt: new Date(t1 + 1000),
          robotMetaId: 'b',
          rowsExtracted: 2,
          jobsAddedToBoard: 1,
        },
        {
          status: 'running',
          sortAt: new Date(t1 + 2000),
          robotMetaId: 'a',
          rowsExtracted: 0,
          jobsAddedToBoard: 0,
        },
      ],
      bounds,
      tagsByMeta: new Map([
        ['a', ['role:Data Analyst', 'function:Engineering']],
        ['b', ['role:Data Analyst']],
      ]),
      catalog: [
        {
          tag: 'role:Data Analyst',
          label: 'Data Analyst',
          namespace: 'role',
          namespaceLabel: 'Role',
        },
        {
          tag: 'function:Engineering',
          label: 'Engineering',
          namespace: 'function',
          namespaceLabel: 'Function',
        },
        {
          tag: 'role:Unused',
          label: 'Unused',
          namespace: 'role',
          namespaceLabel: 'Role',
        },
      ],
    });

    expect(result.totals).toEqual({
      runs: 3,
      passed: 1,
      failed: 1,
      running: 1,
      rowsExtracted: 12,
      jobsAddedToBoard: 4,
    });
    expect(result.series[0]).toMatchObject({ total: 1, passed: 1, failed: 0, jobsAdded: 3 });
    expect(result.series[1]).toMatchObject({ total: 2, passed: 0, failed: 1, jobsAdded: 1 });
    expect(result.tags).toEqual([
      {
        tag: 'role:Data Analyst',
        label: 'Data Analyst',
        namespace: 'role',
        namespaceLabel: 'Role',
        jobsAdded: 4,
        runs: 3,
      },
      {
        tag: 'function:Engineering',
        label: 'Engineering',
        namespace: 'function',
        namespaceLabel: 'Function',
        jobsAdded: 3,
        runs: 2,
      },
      {
        tag: 'role:Unused',
        label: 'Unused',
        namespace: 'role',
        namespaceLabel: 'Role',
        jobsAdded: 0,
        runs: 0,
      },
    ]);
  });
});
