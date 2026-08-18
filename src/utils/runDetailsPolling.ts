const ACTIVE_RUN_STATUSES = new Set(['running', 'pending', 'queued']);

export const nextTrackedRunStatus = (previousStatus: unknown, nextStatus: unknown): unknown =>
  nextStatus == null ? previousStatus : nextStatus;

export const shouldRefreshRunDetails = (previousStatus: unknown, nextStatus: unknown): boolean =>
  ACTIVE_RUN_STATUSES.has(String(previousStatus || '')) &&
  !ACTIVE_RUN_STATUSES.has(String(nextStatus || ''));
