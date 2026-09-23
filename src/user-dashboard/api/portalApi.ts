import axios, { type AxiosInstance } from 'axios';
import { apiUrl } from '../../apiConfig';
import type {
  Cluster,
  ClusterRequest,
  ClusterSubscription,
  DeliveryFrequency,
  FeedFilters,
  FeedInsights,
  FeedJob,
  HomeAnalytics,
  HomeAnalyticsRange,
  PortalEntitlements,
} from '../types';

type TokenGetter = () => Promise<string | null>;

let tokenGetter: TokenGetter | null = null;

/** Short-lived token memo so Promise.all does not stampede Auth0 silent auth. */
let cachedToken: string | null = null;
let cachedTokenAt = 0;
let inflightToken: Promise<string | null> | null = null;
const TOKEN_MEMO_MS = 45_000;

/** Register Auth0 access-token getter (called from usePortalAuth). */
export function setPortalAccessTokenGetter(getter: TokenGetter | null) {
  tokenGetter = getter;
  cachedToken = null;
  cachedTokenAt = 0;
  inflightToken = null;
}

async function resolveAccessToken(): Promise<string | null> {
  if (!tokenGetter) return null;
  const now = Date.now();
  if (cachedToken && now - cachedTokenAt < TOKEN_MEMO_MS) {
    return cachedToken;
  }
  if (!inflightToken) {
    inflightToken = tokenGetter()
      .then((token) => {
        cachedToken = token;
        cachedTokenAt = Date.now();
        return token;
      })
      .finally(() => {
        inflightToken = null;
      });
  }
  return inflightToken;
}

let client: AxiosInstance | null = null;

function getClient(): AxiosInstance {
  if (client) return client;
  client = axios.create({
    baseURL: `${apiUrl}/api/portal`,
    withCredentials: true,
  });
  client.interceptors.request.use(async (config) => {
    if (!tokenGetter) {
      throw new Error('Portal auth is not ready. Sign in again.');
    }
    const token = await resolveAccessToken();
    if (!token) {
      throw new Error('Missing Auth0 access token for portal API.');
    }
    const value = `Bearer ${token}`;
    if (config.headers && typeof (config.headers as any).set === 'function') {
      (config.headers as any).set('Authorization', value);
    } else {
      config.headers = config.headers || {};
      (config.headers as any).Authorization = value;
    }
    return config;
  });
  return client;
}

async function portalGet<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  const { data } = await getClient().get(path, { params });
  return data as T;
}

async function portalPost<T>(path: string, body?: unknown): Promise<T> {
  const { data } = await getClient().post(path, body);
  return data as T;
}

async function portalPatch<T>(path: string, body?: unknown): Promise<T> {
  const { data } = await getClient().patch(path, body);
  return data as T;
}

async function portalDelete<T>(path: string): Promise<T | void> {
  const res = await getClient().delete(path);
  if (res.status === 204) return;
  return res.data as T;
}

// ─── Public API (same signatures as former mockApi) ─────────────────────────

export type PortalBootstrap = {
  entitlements: PortalEntitlements;
  subscriptions: ClusterSubscription[];
  clusters: Cluster[];
  savedCount: number;
  openRequestCount: number;
  requests: ClusterRequest[];
  feedPreview: {
    jobs: FeedJob[];
    total: number;
    frequency: DeliveryFrequency;
  };
  feedInsights?: FeedInsights;
};

export async function getBootstrap(): Promise<PortalBootstrap> {
  return portalGet<PortalBootstrap>('/bootstrap');
}

export async function getHomeAnalytics(range: HomeAnalyticsRange = '7d'): Promise<HomeAnalytics> {
  return portalGet<HomeAnalytics>('/home-analytics', { range });
}

export async function listClusters(): Promise<Cluster[]> {
  const data = await portalGet<{ clusters: Cluster[] }>('/clusters');
  return data.clusters || [];
}

export async function getCluster(slug: string): Promise<Cluster> {
  return portalGet<Cluster>(`/clusters/${encodeURIComponent(slug)}`);
}

export async function getClusterSampleJobs(slug: string, limit = 8): Promise<FeedJob[]> {
  const data = await portalGet<{ jobs: FeedJob[] }>(
    `/clusters/${encodeURIComponent(slug)}/sample-jobs`,
    { limit }
  );
  return data.jobs || [];
}

export async function getClusterCompanies(slug: string, limit = 2000): Promise<string[]> {
  const data = await portalGet<{ companies: string[]; count?: number }>(
    `/clusters/${encodeURIComponent(slug)}/companies`,
    { limit }
  );
  return data.companies || [];
}

export async function getEntitlements(opts?: { refresh?: boolean }): Promise<PortalEntitlements> {
  return portalGet<PortalEntitlements>('/entitlements', opts?.refresh ? { refresh: '1' } : undefined);
}

export async function startClusterService(): Promise<PortalEntitlements> {
  return portalPost<PortalEntitlements>('/cluster-service/start');
}

export async function listFeed(
  subscriptionId: string | 'all',
  filters: FeedFilters = {},
  opts?: { limit?: number; page?: number }
): Promise<{ jobs: FeedJob[]; frequency: DeliveryFrequency; total: number; page: number; limit: number }> {
  const params: Record<string, unknown> = {
    subscriptionId,
    q: filters.q || undefined,
    company: filters.company || undefined,
    location: filters.location || undefined,
    workMode: filters.workMode || undefined,
    experience: filters.experience || undefined,
    h1bSponsorFriendly: filters.h1bSponsorFriendly || undefined,
    h1bFy2026Match: filters.h1bFy2026Match || undefined,
    limit: opts?.limit ?? 20,
    page: opts?.page ?? 1,
  };
  const data = await portalGet<{
    jobs: FeedJob[];
    frequency: DeliveryFrequency;
    total: number;
    page?: number;
    limit?: number;
  }>('/feed', params);
  return {
    jobs: data.jobs || [],
    frequency: data.frequency || '24h',
    total: data.total ?? (data.jobs || []).length,
    page: data.page ?? opts?.page ?? 1,
    limit: data.limit ?? opts?.limit ?? 20,
  };
}

export async function getJob(id: string): Promise<FeedJob> {
  return portalGet<FeedJob>(`/jobs/${encodeURIComponent(id)}`);
}

export type AssignJobResult = {
  status: 'assigned' | 'already_assigned';
  message: string;
  jobId: string;
  jobUrl?: string;
  newJobs?: number;
  urlDuplicates?: number;
  assigned?: boolean;
  jobCategory?: string;
};

export async function assignJob(id: string): Promise<AssignJobResult> {
  return portalPost<AssignJobResult>(`/jobs/${encodeURIComponent(id)}/assign`, {});
}

export type JobReportReason = 'incorrect_company' | 'incorrect_category' | 'old_job' | 'other';

export async function reportJob(
  id: string,
  payload: { reason: JobReportReason; note?: string }
): Promise<{ id: string; message: string }> {
  return portalPost(`/jobs/${encodeURIComponent(id)}/report`, payload);
}

export async function saveJob(id: string): Promise<FeedJob> {
  return portalPost<FeedJob>('/saved', { jobId: id });
}

export async function unsaveJob(id: string): Promise<FeedJob> {
  return (await portalDelete<FeedJob>(`/saved/${encodeURIComponent(id)}`)) as FeedJob;
}

export type SavedJobsPage = {
  jobs: FeedJob[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  companies: string[];
};

export async function listSaved(opts?: {
  page?: number;
  limit?: number;
  q?: string;
  company?: string;
}): Promise<SavedJobsPage> {
  const params = new URLSearchParams();
  params.set('page', String(opts?.page ?? 1));
  params.set('limit', String(opts?.limit ?? 24));
  if (opts?.q?.trim()) params.set('q', opts.q.trim());
  if (opts?.company?.trim()) params.set('company', opts.company.trim());
  const data = await portalGet<Partial<SavedJobsPage> & { jobs?: FeedJob[] }>(
    `/saved?${params.toString()}`
  );
  const jobs = data.jobs || [];
  const limit = data.limit ?? opts?.limit ?? 24;
  const total = data.total ?? jobs.length;
  const page = data.page ?? opts?.page ?? 1;
  const totalPages = data.totalPages ?? Math.max(1, Math.ceil(total / limit));
  return {
    jobs,
    total,
    page,
    limit,
    totalPages,
    companies: data.companies || [],
  };
}

export async function subscribe(
  clusterId: string,
  _planId: string,
  frequency: DeliveryFrequency
): Promise<ClusterSubscription> {
  return portalPost<ClusterSubscription>('/subscriptions', {
    clusterId,
    window: frequency,
    frequency,
  });
}

export async function listSubscriptions(): Promise<ClusterSubscription[]> {
  const data = await portalGet<{ subscriptions: ClusterSubscription[] }>('/subscriptions');
  return data.subscriptions || [];
}

export async function pauseSubscription(id: string): Promise<ClusterSubscription | undefined> {
  return portalPatch<ClusterSubscription>(`/subscriptions/${encodeURIComponent(id)}`, {
    status: 'paused',
  });
}

export async function resumeSubscription(id: string): Promise<ClusterSubscription | undefined> {
  return portalPatch<ClusterSubscription>(`/subscriptions/${encodeURIComponent(id)}`, {
    status: 'active',
  });
}

export async function cancelSubscription(id: string): Promise<void> {
  await portalDelete(`/subscriptions/${encodeURIComponent(id)}`);
}

export async function changeFrequency(
  id: string,
  frequency: DeliveryFrequency
): Promise<ClusterSubscription | undefined> {
  return portalPatch<ClusterSubscription>(`/subscriptions/${encodeURIComponent(id)}`, {
    window: frequency,
    frequency,
  });
}

export async function submitClusterRequest(
  payload: Omit<ClusterRequest, 'id' | 'status' | 'submittedAt'>
): Promise<ClusterRequest> {
  return portalPost<ClusterRequest>('/requests', payload);
}

export async function listRequests(): Promise<ClusterRequest[]> {
  const data = await portalGet<{ requests: ClusterRequest[] }>('/requests');
  return data.requests || [];
}
