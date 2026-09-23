import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  getBootstrap,
  getCluster,
  getClusterCompanies,
  getClusterSampleJobs,
  getEntitlements,
  getHomeAnalytics,
  listClusters,
  listFeed,
  listRequests,
  listSaved,
  listSubscriptions,
  type PortalBootstrap,
} from '../api/portalApi';
import type { FeedFilters, HomeAnalyticsRange } from '../types';

export const portalKeys = {
  all: ['portal'] as const,
  bootstrap: () => [...portalKeys.all, 'bootstrap'] as const,
  homeAnalytics: (range: HomeAnalyticsRange) =>
    [...portalKeys.all, 'home-analytics', range] as const,
  entitlements: () => [...portalKeys.all, 'entitlements'] as const,
  subscriptions: () => [...portalKeys.all, 'subscriptions'] as const,
  clusters: () => [...portalKeys.all, 'clusters'] as const,
  cluster: (slug: string) => [...portalKeys.all, 'cluster', slug] as const,
  sampleJobs: (slug: string) => [...portalKeys.all, 'sample-jobs', slug] as const,
  companies: (slug: string) => [...portalKeys.all, 'companies', slug] as const,
  saved: () => [...portalKeys.all, 'saved'] as const,
  requests: () => [...portalKeys.all, 'requests'] as const,
  feed: (subscriptionId: string, filters: FeedFilters) =>
    [...portalKeys.all, 'feed', subscriptionId, filters] as const,
};

const STALE_MS = 30_000;

export function seedPortalCache(qc: QueryClient, data: PortalBootstrap) {
  qc.setQueryData(portalKeys.bootstrap(), data);
  qc.setQueryData(portalKeys.entitlements(), data.entitlements);
  qc.setQueryData(portalKeys.subscriptions(), data.subscriptions);
  qc.setQueryData(portalKeys.clusters(), data.clusters);
  qc.setQueryData(portalKeys.requests(), data.requests);
}

export async function invalidatePortalShell(qc: QueryClient) {
  await Promise.all([
    qc.invalidateQueries({ queryKey: portalKeys.bootstrap() }),
    qc.invalidateQueries({ queryKey: [...portalKeys.all, 'home-analytics'] }),
    qc.invalidateQueries({ queryKey: portalKeys.entitlements() }),
    qc.invalidateQueries({ queryKey: portalKeys.subscriptions() }),
    qc.invalidateQueries({ queryKey: portalKeys.clusters() }),
    qc.invalidateQueries({ queryKey: portalKeys.saved() }),
    qc.invalidateQueries({ queryKey: portalKeys.requests() }),
    qc.invalidateQueries({ queryKey: [...portalKeys.all, 'feed'] }),
  ]);
}

export function usePortalBootstrap(enabled: boolean) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: portalKeys.bootstrap(),
    queryFn: async () => {
      const data = await getBootstrap();
      seedPortalCache(qc, data);
      return data;
    },
    enabled,
    staleTime: STALE_MS,
  });
}

export function usePortalHomeAnalytics(enabled: boolean, range: HomeAnalyticsRange) {
  return useQuery({
    queryKey: portalKeys.homeAnalytics(range),
    queryFn: () => getHomeAnalytics(range),
    enabled,
    staleTime: 60_000,
  });
}

export function usePortalEntitlements(enabled: boolean, opts?: { refresh?: boolean }) {
  return useQuery({
    queryKey: portalKeys.entitlements(),
    queryFn: () => getEntitlements(opts?.refresh ? { refresh: true } : undefined),
    enabled,
    staleTime: STALE_MS,
  });
}

export function usePortalSubscriptions(enabled: boolean) {
  return useQuery({
    queryKey: portalKeys.subscriptions(),
    queryFn: listSubscriptions,
    enabled,
    staleTime: STALE_MS,
  });
}

export function usePortalClusters(enabled: boolean) {
  return useQuery({
    queryKey: portalKeys.clusters(),
    queryFn: listClusters,
    enabled,
    staleTime: STALE_MS,
  });
}

export function usePortalSaved(enabled: boolean) {
  return useQuery({
    queryKey: portalKeys.saved(),
    queryFn: listSaved,
    enabled,
    staleTime: STALE_MS,
  });
}

export function usePortalRequests(enabled: boolean) {
  return useQuery({
    queryKey: portalKeys.requests(),
    queryFn: listRequests,
    enabled,
    staleTime: STALE_MS,
  });
}

export function usePortalCluster(slug: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: portalKeys.cluster(slug || ''),
    queryFn: () => getCluster(slug!),
    enabled: enabled && Boolean(slug),
    staleTime: STALE_MS,
  });
}

export function usePortalSampleJobs(slug: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: portalKeys.sampleJobs(slug || ''),
    queryFn: () => getClusterSampleJobs(slug!, 12),
    enabled: enabled && Boolean(slug),
    staleTime: STALE_MS,
  });
}

export function usePortalClusterCompanies(slug: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: portalKeys.companies(slug || ''),
    queryFn: () => getClusterCompanies(slug!, 2000),
    enabled: enabled && Boolean(slug),
    staleTime: STALE_MS,
  });
}

export function usePortalFeed(
  subscriptionId: string,
  filters: FeedFilters,
  enabled: boolean,
  page = 1,
  limit = 20
) {
  return useQuery({
    queryKey: [...portalKeys.feed(subscriptionId, filters), page, limit],
    queryFn: () => listFeed(subscriptionId as string | 'all', filters, { page, limit }),
    enabled,
    staleTime: 15_000,
  });
}
