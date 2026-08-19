import { queryOptions } from '@tanstack/react-query';
import {
  listSaasRuns,
  type OpsMetricsWindow,
  type SaasRunsListResponse,
} from '../../api/automation';
import type { FailureTimeWindow } from './failuresPageBehavior';

const WINDOW_MS: Record<OpsMetricsWindow, number> = {
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '3h': 3 * 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

export type FailureQuery = {
  page: number;
  pageSize: number;
  q: string;
  id: string;
  status: string;
  anomaly: string;
  reason: string;
  timeWindow: FailureTimeWindow;
  from?: string;
  to?: string;
};

export const failureQueryKeys = {
  all: ['failures'] as const,
};

export const failureQueryKey = (query: FailureQuery) => [
  ...failureQueryKeys.all,
  query.page,
  query.pageSize,
  query.q,
  query.id,
  query.status,
  query.anomaly,
  query.reason,
  query.timeWindow,
  query.from || '',
  query.to || '',
] as const;

export type FailureFetcher = (
  query: FailureQuery,
  signal: AbortSignal,
) => Promise<SaasRunsListResponse>;

const fetchFailures: FailureFetcher = (query, signal) =>
  listSaasRuns({
    page: query.page,
    limit: query.pageSize,
    ...(query.id ? { robotMetaId: query.id } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.anomaly ? { anomaly: query.anomaly } : {}),
    ...(query.reason ? { failureReason: query.reason } : {}),
    ...(query.q ? { q: query.q } : {}),
    ...(query.from && query.to
      ? { from: query.from, to: query.to }
      : query.timeWindow === 'all'
        ? {}
        : { from: new Date(Date.now() - WINDOW_MS[query.timeWindow]).toISOString() }),
  }, signal);

export const failureQueryOptions = (
  query: FailureQuery,
  fetcher: FailureFetcher = fetchFailures,
) => queryOptions({
  queryKey: failureQueryKey(query),
  queryFn: ({ signal }) => fetcher(query, signal),
  placeholderData: (previousData) => previousData,
});
