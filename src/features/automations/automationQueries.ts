import { queryOptions } from '@tanstack/react-query';
import {
  getDashboardAutomations,
  getDashboardAggregators,
  type DashboardAutomationsResponse,
  type DashboardAutomationsSummary,
  type AutomationSummary,
} from '../../api/automation';

export type AutomationQuery = {
  page: number;
  pageSize: number;
  q: string;
  id: string;
  tags: string[];
  schedule: string;
};

export const automationQueryKeys = {
  all: ['automations'] as const,
};

export const aggregatorQueryKeys = {
  all: ['aggregators'] as const,
};

export const automationQueryKey = (query: AutomationQuery) => [
  ...automationQueryKeys.all,
  query.page,
  query.pageSize,
  query.q,
  query.id,
  query.tags,
  query.schedule,
] as const;

export const aggregatorQueryKey = (query: AutomationQuery & { provider?: string }) => [
  ...aggregatorQueryKeys.all,
  query.provider || 'hiring_cafe',
  query.page,
  query.pageSize,
  query.q,
  query.id,
  query.tags,
  query.schedule,
] as const;

export type AutomationFetcher = (
  query: AutomationQuery,
  signal: AbortSignal,
) => Promise<DashboardAutomationsResponse>;

export type AggregatorDashboardResponse = {
  provider: string;
  searches: AutomationSummary[];
  pagination: DashboardAutomationsResponse['pagination'];
  summary: DashboardAutomationsSummary & { jobsAddedToBoardTotal?: number };
};

export type AggregatorFetcher = (
  query: AutomationQuery & { provider?: string },
  signal: AbortSignal,
) => Promise<AggregatorDashboardResponse>;

const fetchAutomations: AutomationFetcher = (query, signal) =>
  getDashboardAutomations({
    page: query.page,
    limit: query.pageSize,
    ...(query.tags.length ? { tags: query.tags } : {}),
    ...(query.q ? { q: query.q } : {}),
    ...(query.id ? { id: query.id } : {}),
    ...(query.schedule ? { scheduleCron: query.schedule } : {}),
  }, signal);

const fetchAggregators: AggregatorFetcher = (query, signal) =>
  getDashboardAggregators({
    page: query.page,
    limit: query.pageSize,
    provider: query.provider || 'hiring_cafe',
    ...(query.tags.length ? { tags: query.tags } : {}),
    ...(query.q ? { q: query.q } : {}),
    ...(query.id ? { id: query.id } : {}),
    ...(query.schedule ? { scheduleCron: query.schedule } : {}),
  }, signal);

export const automationQueryOptions = (
  query: AutomationQuery,
  fetcher: AutomationFetcher = fetchAutomations,
) => queryOptions({
  queryKey: automationQueryKey(query),
  queryFn: ({ signal }) => fetcher(query, signal),
  placeholderData: (previousData) => previousData,
});

export const aggregatorQueryOptions = (
  query: AutomationQuery & { provider?: string },
  fetcher: AggregatorFetcher = fetchAggregators,
) => queryOptions({
  queryKey: aggregatorQueryKey(query),
  queryFn: ({ signal }) => fetcher(query, signal),
  placeholderData: (previousData) => previousData,
});
