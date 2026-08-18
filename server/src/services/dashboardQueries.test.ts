/**
 * Task 11 — dashboard query helpers (pure; no Mongo required in CI).
 *
 * Baseline / explain mindset (run manually against staging when Mongo is available):
 * - Representative accounts: ~100, ~10k, ~100k runs.
 * - Gate: compound indexes on ownerId + sortAt are chosen; documentsExamined ≪ total runs.
 * - Record p50/p95 for GET /runs and GET /dashboard/automations before/after.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  RUN_LIST_INDEX_SPECS,
  RUN_LIST_PROJECTION,
  RUN_DASHBOARD_LATEST_PROJECTION,
  ROBOT_DASHBOARD_LIST_SELECT,
  DASHBOARD_SUMMARY_CACHE_TTL_MS,
  DASHBOARD_SUMMARY_CACHE_TTL_MS_MIN,
  DASHBOARD_SUMMARY_CACHE_TTL_MS_MAX,
  buildOwnerRunFilter,
  buildOwnerRunScope,
  buildRunListSort,
  buildRunListSortAtStage,
  buildRunListMatch,
  buildRunSortAtRangeMatch,
  buildLatestRunPerRobotPipeline,
  buildRunListPaginationPipeline,
  buildRunGroupsPipeline,
  buildRunFailureCountsPipeline,
  buildResolvedDurationStage,
  buildDurationRangeMatch,
  expectedRunListIndex,
  resolveRunListIndexHint,
  clampDashboardSummaryCacheTtlMs,
  createDashboardSummaryCache,
  RUN_LIST_SORT_FIELD,
  RUN_RESOLVED_DURATION_FIELD,
  MAX_SANE_LIST_DURATION_MS,
  SECRET_RUN_FIELD_DENYLIST,
} from './dashboardQueries';

describe('RUN_LIST_INDEX_SPECS', () => {
  it('defines four post-backfill compound indexes led by ownerId and sortAt', () => {
    expect(RUN_LIST_INDEX_SPECS).toHaveLength(4);
    const keys = RUN_LIST_INDEX_SPECS.map((spec) => spec.keys);
    expect(keys).toEqual([
      { ownerId: 1, sortAt: -1, _id: -1 },
      { ownerId: 1, status: 1, sortAt: -1 },
      { ownerId: 1, normalizedFailureReason: 1, sortAt: -1 },
      { ownerId: 1, robotMetaId: 1, sortAt: -1 },
    ]);
  });

  it('assigns stable index names without overlapping admission partial indexes', () => {
    const names = RUN_LIST_INDEX_SPECS.map((spec) => spec.name);
    expect(new Set(names).size).toBe(4);
    for (const name of names) {
      expect(name).toMatch(/^run_owner_/);
      expect(name).not.toMatch(/retry_request_key|active_automation|active_slot/);
    }
  });
});

describe('buildOwnerRunFilter', () => {
  it('matches ownerId and legacy runByUserId variants', () => {
    expect(buildOwnerRunFilter(42)).toEqual({
      $or: [{ ownerId: '42' }, { runByUserId: { $in: [42, '42'] } }],
    });
    expect(buildOwnerRunFilter('abc')).toEqual({
      $or: [{ ownerId: 'abc' }, { runByUserId: { $in: ['abc'] } }],
    });
  });

  it('returns an impossible match when userId is missing', () => {
    expect(buildOwnerRunFilter(null)).toEqual({ ownerId: '__none__' });
  });
});

describe('buildRunListSort', () => {
  it('sorts by listSortAt then _id descending after effective sort is computed', () => {
    expect(buildRunListSort()).toEqual({ listSortAt: -1, _id: -1 });
  });
});

describe('buildOwnerRunScope', () => {
  it('adds owned robotMetaId fallback for rows missing owner fields', () => {
    expect(buildOwnerRunScope('user-1', ['meta-1', 'meta-2'])).toEqual({
      $or: [
        { ownerId: 'user-1' },
        { runByUserId: { $in: ['user-1'] } },
        { robotMetaId: { $in: ['meta-1', 'meta-2'] } },
      ],
    });
  });
});

describe('buildRunListMatch', () => {
  it('merges owner filter with optional status and robotMetaId constraints', () => {
    expect(
      buildRunListMatch('user-1', {
        status: { $in: ['failed', 'dead'] },
        robotMetaId: 'meta-9',
      })
    ).toEqual({
      $or: [{ ownerId: 'user-1' }, { runByUserId: { $in: ['user-1'] } }],
      status: { $in: ['failed', 'dead'] },
      robotMetaId: 'meta-9',
    });
  });

  it('supports normalizedFailureReason filter for failures page chips', () => {
    expect(
      buildRunListMatch('user-1', {
        normalizedFailureReason: { $in: ['captcha', 'timeout'] },
      })
    ).toEqual({
      $or: [{ ownerId: 'user-1' }, { runByUserId: { $in: ['user-1'] } }],
      normalizedFailureReason: { $in: ['captcha', 'timeout'] },
    });
  });
});

describe('buildRunSortAtRangeMatch', () => {
  it('filters effective listSortAt dates after sort timestamp is derived', () => {
    const from = new Date('2026-08-17T00:00:00.000Z');
    const to = new Date('2026-08-18T00:00:00.000Z');
    expect(buildRunSortAtRangeMatch(from, to)).toEqual({
      listSortAt: { $gte: from, $lt: to },
    });
  });
});

describe('RUN_LIST_PROJECTION', () => {
  it('excludes secret-bearing and heavy run fields', () => {
    for (const denied of SECRET_RUN_FIELD_DENYLIST) {
      expect(RUN_LIST_PROJECTION).not.toHaveProperty(denied);
    }
    expect(RUN_LIST_PROJECTION.serializableOutput).toBeUndefined();
    expect(RUN_LIST_PROJECTION.binaryOutput).toBeUndefined();
    expect(RUN_LIST_PROJECTION.log).toBeUndefined();
    expect(RUN_LIST_PROJECTION.interpreterSettings).toBeUndefined();
  });

  it('includes rowsExtracted so summaries avoid ExtractedData joins', () => {
    expect(RUN_LIST_PROJECTION.rowsExtracted).toBe(1);
  });

  it('includes browserId so the runs page can attach live sockets', () => {
    expect(RUN_LIST_PROJECTION.browserId).toBe(1);
  });
});

describe('ROBOT_DASHBOARD_LIST_SELECT', () => {
  it('projects dashboard robot fields without OAuth tokens or recordings', () => {
    const joined = ROBOT_DASHBOARD_LIST_SELECT.join(' ');
    expect(joined).not.toContain('google_access_token');
    expect(joined).not.toContain('google_refresh_token');
    expect(joined).not.toContain('airtable_access_token');
    expect(joined).not.toContain('recording ');
    expect(joined).toContain('recording_meta.id');
  });
});

describe('buildLatestRunPerRobotPipeline', () => {
  it('matches legacy owners and derives listSortAt before picking the latest run', () => {
    const pipeline = buildLatestRunPerRobotPipeline('owner-1', ['a', 'b']);
    expect(pipeline[0]).toEqual({
      $match: {
        $or: [
          { ownerId: 'owner-1' },
          { runByUserId: { $in: ['owner-1'] } },
          { robotMetaId: { $in: ['a', 'b'] } },
        ],
        robotMetaId: { $in: ['a', 'b'] },
      },
    });
    expect(pipeline.find((stage) => '$addFields' in stage)).toEqual(buildRunListSortAtStage());
    expect(pipeline.find((stage) => '$sort' in stage)).toEqual({
      $sort: { listSortAt: -1, _id: -1 },
    });
    const project = pipeline.find((stage) => '$project' in stage) as { $project: Record<string, number> };
    expect(project.$project).toEqual(RUN_DASHBOARD_LATEST_PROJECTION);
  });
});

describe('buildRunListPaginationPipeline', () => {
  it('derives listSortAt from finishedAt or startedAt for legacy rows', () => {
    const pipeline = buildRunListPaginationPipeline({
      match: { ownerId: 'u1' },
      skip: 0,
      limit: 10,
    });
    expect(pipeline.find((stage) => '$addFields' in stage)).toEqual(buildRunListSortAtStage());
    const stageJson = JSON.stringify(pipeline);
    expect(stageJson).not.toContain('_sortTs');
    expect(stageJson).not.toContain('_sa');
  });

  it('applies listSortAt range on the match stage before sort', () => {
    const from = new Date('2026-08-17T00:00:00.000Z');
    const pipeline = buildRunListPaginationPipeline({
      match: { ownerId: 'u1' },
      skip: 0,
      limit: 5,
      fromDate: from,
    });
    const rangeMatch = pipeline.find(
      (stage) => '$match' in stage && (stage as any).$match?.[RUN_LIST_SORT_FIELD]
    );
    expect(rangeMatch).toEqual({ $match: { listSortAt: { $gte: from } } });
  });

  it('computes resolved duration before applying duration bounds', () => {
    const pipeline = buildRunListPaginationPipeline({
      match: { ownerId: 'u1' },
      skip: 0,
      limit: 10,
      minDurationMs: 5_000,
      maxDurationMs: 30_000,
    });
    const json = JSON.stringify(pipeline);
    expect(json).toContain(RUN_RESOLVED_DURATION_FIELD);
    const durationMatch = pipeline.find(
      (stage) => '$match' in stage && (stage as any).$match?.[RUN_RESOLVED_DURATION_FIELD]
    );
    expect(durationMatch).toEqual({
      $match: { [RUN_RESOLVED_DURATION_FIELD]: { $gte: 5_000, $lte: 30_000 } },
    });
    expect(json).not.toContain('"duration":{');
  });
});

describe('buildResolvedDurationStage', () => {
  it('caps resolved duration at the same 48h sanity bound as the UI', () => {
    const stage = buildResolvedDurationStage() as { $addFields: Record<string, unknown> };
    expect(JSON.stringify(stage)).toContain(String(MAX_SANE_LIST_DURATION_MS));
    expect(stage.$addFields).toHaveProperty(RUN_RESOLVED_DURATION_FIELD);
  });
});

describe('buildDurationRangeMatch', () => {
  it('returns null when no bounds are set', () => {
    expect(buildDurationRangeMatch(null, null)).toBeNull();
  });

  it('builds an inclusive range on the resolved duration field', () => {
    expect(buildDurationRangeMatch(1000, null)).toEqual({
      [RUN_RESOLVED_DURATION_FIELD]: { $gte: 1000 },
    });
  });
});

describe('buildRunGroupsPipeline', () => {
  it('groups by robotMetaId after sorting, then paginates groups', () => {
    const pipeline = buildRunGroupsPipeline({
      match: { ownerId: 'u1' },
      skip: 20,
      limit: 10,
    });
    const group = pipeline.find((stage) => '$group' in stage) as {
      $group: { _id: string; runCount: unknown; latestRun: unknown };
    };
    expect(group.$group._id).toBe('$robotMetaId');
    expect(group.$group.runCount).toEqual({ $sum: 1 });
    expect(group.$group.latestRun).toEqual({ $first: '$$ROOT' });

    const facet = pipeline.find((stage) => '$facet' in stage) as {
      $facet: { pageGroups: unknown[]; totals: unknown[] };
    };
    expect(facet.$facet.pageGroups).toEqual([{ $skip: 20 }, { $limit: 10 }]);
    expect(facet.$facet.totals).toEqual([{ $count: 'total' }]);
  });

  it('applies date and duration windows before grouping', () => {
    const from = new Date('2026-08-17T00:00:00.000Z');
    const pipeline = buildRunGroupsPipeline({
      match: { ownerId: 'u1' },
      skip: 0,
      limit: 20,
      fromDate: from,
      minDurationMs: 60_000,
    });
    const json = JSON.stringify(pipeline);
    expect(json).toContain(RUN_LIST_SORT_FIELD);
    expect(json).toContain(RUN_RESOLVED_DURATION_FIELD);
    const groupIndex = pipeline.findIndex((stage) => '$group' in stage);
    const durationIndex = pipeline.findIndex(
      (stage) => '$match' in stage && (stage as any).$match?.[RUN_RESOLVED_DURATION_FIELD]
    );
    expect(durationIndex).toBeGreaterThan(-1);
    expect(durationIndex).toBeLessThan(groupIndex);
  });
});

describe('expectedRunListIndex', () => {
  it('selects specialized compound indexes based on filter shape', () => {
    expect(expectedRunListIndex({ ownerId: '1', status: 'failed' })).toBe(
      'run_owner_status_sort_at_idx'
    );
    expect(
      expectedRunListIndex({ ownerId: '1', normalizedFailureReason: 'captcha' })
    ).toBe('run_owner_failure_reason_sort_at_idx');
    expect(expectedRunListIndex({ ownerId: '1', robotMetaId: 'm1' })).toBe(
      'run_owner_robot_meta_sort_at_idx'
    );
    expect(expectedRunListIndex({ ownerId: '1' })).toBe('run_owner_sort_at_desc_idx');
  });

  it('skips index hints when owner scope uses $or', () => {
    expect(resolveRunListIndexHint({ $or: [{ ownerId: '1' }] })).toBeNull();
    expect(resolveRunListIndexHint({ ownerId: '1', status: 'failed' })).toBe(
      'run_owner_status_sort_at_idx'
    );
  });
});

describe('dashboard summary cache TTL', () => {
  it('keeps default TTL within documented bounds', () => {
    expect(DASHBOARD_SUMMARY_CACHE_TTL_MS).toBeGreaterThanOrEqual(
      DASHBOARD_SUMMARY_CACHE_TTL_MS_MIN
    );
    expect(DASHBOARD_SUMMARY_CACHE_TTL_MS).toBeLessThanOrEqual(
      DASHBOARD_SUMMARY_CACHE_TTL_MS_MAX
    );
  });

  it('clamps arbitrary TTL values into bounds', () => {
    expect(clampDashboardSummaryCacheTtlMs(1)).toBe(DASHBOARD_SUMMARY_CACHE_TTL_MS_MIN);
    expect(clampDashboardSummaryCacheTtlMs(999_999)).toBe(DASHBOARD_SUMMARY_CACHE_TTL_MS_MAX);
    expect(clampDashboardSummaryCacheTtlMs(20_000)).toBe(20_000);
  });

  it('expires cached summaries after TTL without storing secret config', () => {
    vi.useFakeTimers();
    const cache = createDashboardSummaryCache(5_000);
    cache.set('account:1', { activeScheduledCount: 2, pausedScheduleCount: 1 });
    expect(cache.get('account:1')).toEqual({
      activeScheduledCount: 2,
      pausedScheduleCount: 1,
    });
    vi.advanceTimersByTime(5_001);
    expect(cache.get('account:1')).toBeUndefined();
    vi.useRealTimers();
  });
});
