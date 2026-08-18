/**
 * Pure helpers for dashboard / run-list Mongo queries (Task 11).
 * Keeps index definitions, match shapes, projections, and short-lived summary cache
 * in one testable module so automations + opsMetrics stay aligned.
 */
import { normalizeOwnerIdForWrite, ownerIdVariants } from '../utils/ownerId';

export type RunListIndexSpec = {
  keys: Record<string, 1 | -1>;
  name: string;
};

/** Post-backfill compound indexes — ownerId must be populated before these help. */
export const RUN_LIST_INDEX_SPECS: RunListIndexSpec[] = [
  { keys: { ownerId: 1, sortAt: -1, _id: -1 }, name: 'run_owner_sort_at_desc_idx' },
  { keys: { ownerId: 1, status: 1, sortAt: -1 }, name: 'run_owner_status_sort_at_idx' },
  {
    keys: { ownerId: 1, normalizedFailureReason: 1, sortAt: -1 },
    name: 'run_owner_failure_reason_sort_at_idx',
  },
  { keys: { ownerId: 1, robotMetaId: 1, sortAt: -1 }, name: 'run_owner_robot_meta_sort_at_idx' },
];

export const SECRET_RUN_FIELD_DENYLIST = [
  'serializableOutput',
  'binaryOutput',
  'log',
  'interpreterSettings',
] as const;

/** Safe run fields for list / failures pages — never includes secrets or heavy blobs. */
export const RUN_LIST_PROJECTION: Record<string, 1> = {
  runId: 1,
  status: 1,
  robotMetaId: 1,
  robotId: 1,
  name: 1,
  startedAt: 1,
  finishedAt: 1,
  sortAt: 1,
  duration: 1,
  browserId: 1,
  rowsExtracted: 1,
  jobsAddedToBoard: 1,
  jobsBoardConsidered: 1,
  jobsBoardDeduped: 1,
  anomaly: 1,
  failureReason: 1,
  failureReasonSource: 1,
  normalizedFailureReason: 1,
  errorMessage: 1,
  retryOfRunId: 1,
  originalRunId: 1,
  retrySequence: 1,
  scoutId: 1,
};

/** Latest-run chip projection for automations dashboard (minimal). */
export const RUN_DASHBOARD_LATEST_PROJECTION: Record<string, 1> = {
  robotMetaId: 1,
  runId: 1,
  status: 1,
  startedAt: 1,
  finishedAt: 1,
  sortAt: 1,
  name: 1,
  anomaly: 1,
  failureReason: 1,
  failureReasonSource: 1,
  normalizedFailureReason: 1,
  rowsExtracted: 1,
};

/** Robot fields for dashboard list cards — no recording workflow or OAuth secrets. */
export const ROBOT_DASHBOARD_LIST_SELECT = [
  'schedule',
  'recording_meta.id',
  'recording_meta.scoutId',
  'recording_meta.name',
  'recording_meta.companyName',
  'recording_meta.tags',
  'recording_meta.url',
  'recording_meta.createdAt',
  'recording_meta.updatedAt',
  'recording_meta.saasConfig',
] as const;

export const DASHBOARD_SUMMARY_CACHE_TTL_MS_MIN = 5_000;
export const DASHBOARD_SUMMARY_CACHE_TTL_MS_MAX = 60_000;
export const DASHBOARD_SUMMARY_CACHE_TTL_MS = 15_000;

export function clampDashboardSummaryCacheTtlMs(raw: number): number {
  if (!Number.isFinite(raw)) return DASHBOARD_SUMMARY_CACHE_TTL_MS;
  return Math.min(
    DASHBOARD_SUMMARY_CACHE_TTL_MS_MAX,
    Math.max(DASHBOARD_SUMMARY_CACHE_TTL_MS_MIN, Math.round(raw))
  );
}

type SummaryCacheEntry<T> = { expiresAt: number; value: T };

export function createDashboardSummaryCache<T>(ttlMs?: number) {
  const ttl = clampDashboardSummaryCacheTtlMs(ttlMs ?? DASHBOARD_SUMMARY_CACHE_TTL_MS);
  const store = new Map<string, SummaryCacheEntry<T>>();

  return {
    get(key: string): T | undefined {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key: string, value: T): void {
      store.set(key, { value, expiresAt: Date.now() + ttl });
    },
    delete(key: string): void {
      store.delete(key);
    },
    clear(): void {
      store.clear();
    },
  };
}

/** Direct owner-scoped Run filter; includes legacy rows keyed by runByUserId. */
export function buildOwnerRunFilter(userId: unknown): Record<string, unknown> {
  const ownerId = normalizeOwnerIdForWrite(userId);
  if (!ownerId) return { ownerId: '__none__' };
  const variants = ownerIdVariants(userId);
  return {
    $or: [
      { ownerId },
      { runByUserId: { $in: variants } },
    ],
  };
}

/** Expands owner scope with owned automation ids for rows missing owner fields. */
export function buildOwnerRunScope(
  userId: unknown,
  ownedRobotMetaIds?: readonly string[],
): Record<string, unknown> {
  const base = buildOwnerRunFilter(userId);
  const metaIds = (ownedRobotMetaIds || []).map(String).filter(Boolean);
  if (!metaIds.length || !('$or' in base) || !Array.isArray(base.$or)) {
    return base;
  }
  return {
    $or: [...base.$or, { robotMetaId: { $in: metaIds } }],
  };
}

export const RUN_LIST_SORT_FIELD = 'listSortAt';
export const RUN_RESOLVED_DURATION_FIELD = 'resolvedDurationMs';
/** Matches `MAX_SANE_RUN_DURATION_MS` in automation.ts — keep in sync. */
export const MAX_SANE_LIST_DURATION_MS = 48 * 60 * 60 * 1000;

export function buildRunListSort(
  sortField: string = RUN_LIST_SORT_FIELD,
): Record<string, -1> {
  return { [sortField]: -1, _id: -1 };
}

/** Legacy runs may lack sortAt; derive a stable timestamp for ordering and windows. */
export function buildRunListSortAtStage(): Record<string, unknown> {
  return {
    $addFields: {
      [RUN_LIST_SORT_FIELD]: {
        $ifNull: [
          '$sortAt',
          {
            $convert: {
              input: { $ifNull: ['$finishedAt', '$startedAt'] },
              to: 'date',
              onError: null,
              onNull: null,
            },
          },
        ],
      },
    },
  };
}

export function buildRunListMatch(
  userId: unknown,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return { ...buildOwnerRunFilter(userId), ...extra };
}

export function buildRunSortAtRangeMatch(
  fromDate?: Date | null,
  toDate?: Date | null,
  sortField: string = RUN_LIST_SORT_FIELD,
): Record<string, unknown> | null {
  if (!fromDate && !toDate) return null;
  const range: Record<string, Date> = {};
  if (fromDate) range.$gte = fromDate;
  if (toDate) range.$lt = toDate;
  return { [sortField]: range };
}

/**
 * Resolve duration the same way the UI does: timestamps first, then stored
 * `duration`, dropping in-flight statuses and absurd multi-day values.
 */
export function buildResolvedDurationStage(): Record<string, unknown> {
  return {
    $addFields: {
      [RUN_RESOLVED_DURATION_FIELD]: {
        $let: {
          vars: {
            status: { $toLower: { $ifNull: ['$status', ''] } },
            started: {
              $convert: { input: '$startedAt', to: 'date', onError: null, onNull: null },
            },
            finished: {
              $convert: { input: '$finishedAt', to: 'date', onError: null, onNull: null },
            },
          },
          in: {
            $cond: [
              { $in: ['$$status', ['running', 'pending', 'queued']] },
              null,
              {
                $let: {
                  vars: {
                    fromTs: {
                      $cond: [
                        { $and: [{ $ne: ['$$started', null] }, { $ne: ['$$finished', null] }] },
                        { $subtract: ['$$finished', '$$started'] },
                        null,
                      ],
                    },
                    stored: {
                      $cond: [
                        { $and: [{ $ne: ['$duration', null] }, { $gt: ['$duration', 0] }] },
                        '$duration',
                        null,
                      ],
                    },
                  },
                  in: {
                    $let: {
                      vars: { raw: { $ifNull: ['$$fromTs', '$$stored'] } },
                      in: {
                        $cond: [
                          {
                            $and: [
                              { $ne: ['$$raw', null] },
                              { $gte: ['$$raw', 0] },
                              { $lte: ['$$raw', MAX_SANE_LIST_DURATION_MS] },
                            ],
                          },
                          '$$raw',
                          null,
                        ],
                      },
                    },
                  },
                },
              },
            ],
          },
        },
      },
    },
  };
}

export function buildDurationRangeMatch(
  minDurationMs?: number | null,
  maxDurationMs?: number | null,
  field: string = RUN_RESOLVED_DURATION_FIELD,
): Record<string, unknown> | null {
  if (minDurationMs == null && maxDurationMs == null) return null;
  const range: Record<string, number> = {};
  if (minDurationMs != null) range.$gte = minDurationMs;
  if (maxDurationMs != null) range.$lte = maxDurationMs;
  return { [field]: range };
}

function appendComputedWindowStages(
  pipeline: Record<string, unknown>[],
  options: {
    fromDate?: Date | null;
    toDate?: Date | null;
    minDurationMs?: number | null;
    maxDurationMs?: number | null;
  },
): void {
  pipeline.push(buildRunListSortAtStage());
  const sortRange = buildRunSortAtRangeMatch(options.fromDate, options.toDate);
  if (sortRange) {
    pipeline.push({ $match: sortRange });
  }
  if (options.minDurationMs != null || options.maxDurationMs != null) {
    pipeline.push(buildResolvedDurationStage());
    const durationMatch = buildDurationRangeMatch(options.minDurationMs, options.maxDurationMs);
    if (durationMatch) {
      pipeline.push({ $match: durationMatch });
    }
  }
}

export function resolveRunListIndexHint(match: Record<string, unknown>): string | null {
  if ('$or' in match) return null;
  return expectedRunListIndex(match);
}

export function expectedRunListIndex(match: Record<string, unknown>): string {
  if (match.robotMetaId != null) return 'run_owner_robot_meta_sort_at_idx';
  if (match.normalizedFailureReason != null) return 'run_owner_failure_reason_sort_at_idx';
  if (match.status != null) return 'run_owner_status_sort_at_idx';
  return 'run_owner_sort_at_desc_idx';
}

export function buildLatestRunPerRobotPipeline(
  userId: unknown,
  robotMetaIds: string[]
): any[] {
  if (!robotMetaIds.length) return [];
  const ownerScope = buildOwnerRunScope(userId, robotMetaIds);
  return [
    {
      $match: {
        ...ownerScope,
        robotMetaId: { $in: robotMetaIds },
      },
    },
    { $project: RUN_DASHBOARD_LATEST_PROJECTION },
    buildRunListSortAtStage(),
    { $sort: buildRunListSort() },
    {
      $group: {
        _id: '$robotMetaId',
        run: { $first: '$$ROOT' },
      },
    },
  ];
}

export function buildLatestRunPerRobotMatch(
  userId: unknown,
  robotMetaIds: string[],
): Record<string, unknown> {
  return {
    ...buildOwnerRunScope(userId, robotMetaIds),
    robotMetaId: { $in: robotMetaIds },
  };
}

export type RunListPaginationOptions = {
  match: Record<string, unknown>;
  skip: number;
  limit: number;
  fromDate?: Date | null;
  toDate?: Date | null;
  minDurationMs?: number | null;
  maxDurationMs?: number | null;
  failureReasonPageStages?: Record<string, unknown>[];
};

export function buildRunListPaginationPipeline(
  options: RunListPaginationOptions
): any[] {
  const pipeline: Record<string, unknown>[] = [
    { $match: options.match },
    { $project: RUN_LIST_PROJECTION },
    ...(options.failureReasonPageStages || []),
  ];

  appendComputedWindowStages(pipeline, options);

  pipeline.push(
    { $sort: buildRunListSort() },
    {
      $facet: {
        pageRuns: [{ $skip: options.skip }, { $limit: options.limit }],
        totals: [{ $count: 'total' }],
      },
    }
  );

  return pipeline;
}

export type RunGroupsPaginationOptions = RunListPaginationOptions;

/** Group matching runs by automation, keep latest run + count, then paginate groups. */
export function buildRunGroupsPipeline(
  options: RunGroupsPaginationOptions
): any[] {
  const pipeline: Record<string, unknown>[] = [
    { $match: options.match },
    { $project: RUN_LIST_PROJECTION },
    ...(options.failureReasonPageStages || []),
  ];

  appendComputedWindowStages(pipeline, options);

  pipeline.push(
    { $sort: buildRunListSort() },
    {
      $group: {
        _id: '$robotMetaId',
        runCount: { $sum: 1 },
        latestRun: { $first: '$$ROOT' },
      },
    },
    { $sort: { 'latestRun.listSortAt': -1, _id: -1 } },
    {
      $facet: {
        pageGroups: [{ $skip: options.skip }, { $limit: options.limit }],
        totals: [{ $count: 'total' }],
      },
    }
  );

  return pipeline;
}

export type RunFailureCountsOptions = {
  match: Record<string, unknown>;
  fromDate?: Date | null;
  toDate?: Date | null;
  minDurationMs?: number | null;
  maxDurationMs?: number | null;
  failureReasonCountStages: Record<string, unknown>[];
};

/** Counts-by-reason pipeline shares filters but ignores active reason chip filter. */
export function buildRunFailureCountsPipeline(
  options: RunFailureCountsOptions
): any[] {
  const pipeline: Record<string, unknown>[] = [{ $match: options.match }];
  if (options.failureReasonCountStages.length) {
    pipeline.push(options.failureReasonCountStages[0]);
  }

  appendComputedWindowStages(pipeline, options);

  if (options.failureReasonCountStages.length > 1) {
    pipeline.push(options.failureReasonCountStages[1]);
  }

  return pipeline;
}

/** Apply RUN_LIST_INDEX_SPECS to a connected Mongoose Run model (e.g. after backfill). */
export async function ensureRunListIndexes(runModel: {
  collection: { createIndex: (keys: Record<string, 1 | -1>, opts: { name: string }) => Promise<string> };
}): Promise<string[]> {
  const created: string[] = [];
  for (const spec of RUN_LIST_INDEX_SPECS) {
    created.push(await runModel.collection.createIndex(spec.keys, { name: spec.name }));
  }
  return created;
}

/** In-process caches for account + filtered dashboard summaries (no secret config). */
export const accountRobotSummaryCache = createDashboardSummaryCache<{
  activeScheduledCount: number;
  pausedScheduleCount: number;
}>();

export const filteredDashboardRunTotalsCache = createDashboardSummaryCache<{
  rowsExtractedTotal: number;
  successfulCount: number;
  failedCount: number;
  latestRuns: Array<[string, Record<string, unknown>]>;
}>();

export function filteredDashboardCacheKey(
  userId: unknown,
  robotMetaIds: string[]
): string {
  const ownerId = normalizeOwnerIdForWrite(userId);
  const sorted = [...robotMetaIds].sort().join(',');
  return `runs:v2:${ownerId}:${sorted}`;
}
