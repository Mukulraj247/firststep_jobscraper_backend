import { queryOptions } from '@tanstack/react-query';
import {
  getDashboardAutomations,
  type DashboardAutomationsResponse,
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

export const automationQueryKey = (query: AutomationQuery) => [
  ...automationQueryKeys.all,
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

const fetchAutomations: AutomationFetcher = (query, signal) =>
  getDashboardAutomations({
    page: query.page,
    limit: query.pageSize,
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
