import { queryOptions } from '@tanstack/react-query';
import {
  getDashboardDigitalOcean,
  getDashboardMetrics,
  type OpsMetricsResponse,
  type OpsMetricsWindow,
} from '../../api/automation';

export type DashboardMetricsQuery = {
  window: OpsMetricsWindow;
  date: string | null;
};

export const dashboardQueryKeys = {
  all: ['dashboard'] as const,
};

export const dashboardMetricsQueryKey = (query: DashboardMetricsQuery) =>
  [...dashboardQueryKeys.all, 'metrics', query.window, query.date || ''] as const;

export const dashboardDigitalOceanQueryKey = (query: DashboardMetricsQuery) =>
  [...dashboardQueryKeys.all, 'digital-ocean', query.window, query.date || ''] as const;

export type DashboardMetricsFetcher = (
  query: DashboardMetricsQuery,
  signal: AbortSignal,
) => Promise<OpsMetricsResponse>;

export type DashboardDigitalOceanFetcher = (
  query: DashboardMetricsQuery,
  signal: AbortSignal,
) => Promise<OpsMetricsResponse['digitalOcean']>;

const fetchDashboardMetrics: DashboardMetricsFetcher = (query, signal) =>
  getDashboardMetrics({ window: query.window, date: query.date }, signal);

const fetchDashboardDigitalOcean: DashboardDigitalOceanFetcher = (query, signal) =>
  getDashboardDigitalOcean({ window: query.window, date: query.date }, signal);

export const dashboardMetricsQueryOptions = (
  query: DashboardMetricsQuery,
  fetcher: DashboardMetricsFetcher = fetchDashboardMetrics,
) => queryOptions({
  queryKey: dashboardMetricsQueryKey(query),
  queryFn: ({ signal }) => fetcher(query, signal),
  placeholderData: (previousData) => previousData,
});

export const dashboardDigitalOceanQueryOptions = (
  query: DashboardMetricsQuery,
  fetcher: DashboardDigitalOceanFetcher = fetchDashboardDigitalOcean,
) => queryOptions({
  queryKey: dashboardDigitalOceanQueryKey(query),
  queryFn: ({ signal }) => fetcher(query, signal),
  placeholderData: (previousData) => previousData,
});
