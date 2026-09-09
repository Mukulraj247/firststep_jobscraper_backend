import {
  FREQUENCY_MS,
  PORTAL_STORAGE_KEY,
  type ClusterRequest,
  type ClusterSubscription,
  type DeliveryFrequency,
  type FeedFilters,
  type FeedJob,
  type PortalState,
  type PortalUser,
} from '../types';
import { MOCK_CLUSTERS, getClusterById, getClusterBySlug } from './mockClusters';
import { MOCK_JOBS, getJobById } from './mockJobs';
import { getPersonaDefaults, type PersonaKey } from './mockPersonas';

const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

function readState(): PortalState {
  try {
    const raw = localStorage.getItem(PORTAL_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as PortalState;
  } catch {
    /* ignore */
  }
  return { user: null, subscriptions: [], savedJobIds: [], requests: [] };
}

function writeState(state: PortalState): void {
  localStorage.setItem(PORTAL_STORAGE_KEY, JSON.stringify(state));
}

export function resetPortalState(): void {
  localStorage.removeItem(PORTAL_STORAGE_KEY);
}

function withSavedFlags(jobs: FeedJob[], savedIds: string[]): FeedJob[] {
  const set = new Set(savedIds);
  return jobs.map((j) => ({ ...j, saved: set.has(j.id) }));
}

function jobMatchesFilters(job: FeedJob, filters: FeedFilters): boolean {
  const q = (filters.q || '').toLowerCase().trim();
  if (q) {
    const hay = `${job.title} ${job.company} ${job.location} ${job.description}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (filters.company && !job.company.toLowerCase().includes(filters.company.toLowerCase())) return false;
  if (filters.location && !job.location.toLowerCase().includes(filters.location.toLowerCase())) return false;
  if (filters.role && !job.title.toLowerCase().includes(filters.role.toLowerCase())) return false;
  if (filters.workMode && job.workMode !== filters.workMode) return false;
  if (filters.experience && job.experience && !job.experience.includes(filters.experience)) return false;
  if (filters.h1bSponsorFriendly && !job.h1bEligible) return false;
  if (filters.h1bFy2026Match && !job.h1bFy2026Match) return false;
  return true;
}

function withinWindow(job: FeedJob, frequency: DeliveryFrequency, nowMs: number): boolean {
  const cutoff = nowMs - FREQUENCY_MS[frequency];
  const instant = Date.parse(job.lastSeenAt || job.postedAt);
  return instant >= cutoff;
}

function resolveFrequencies(
  subscriptionId: string | 'all',
  subscriptions: ClusterSubscription[],
): DeliveryFrequency[] {
  if (subscriptionId === 'all') {
    const active = subscriptions.filter((s) => s.status === 'active');
    if (active.length === 0) return ['2h'];
    return active.map((s) => s.frequency);
  }
  const sub = subscriptions.find((s) => s.id === subscriptionId);
  return sub ? [sub.frequency] : ['2h'];
}

function resolveClusterIds(
  subscriptionId: string | 'all',
  subscriptions: ClusterSubscription[],
): string[] | null {
  if (subscriptionId === 'all') {
    const ids = subscriptions.filter((s) => s.status === 'active').map((s) => s.clusterId);
    return ids.length ? ids : null;
  }
  const sub = subscriptions.find((s) => s.id === subscriptionId);
  return sub ? [sub.clusterId] : null;
}

export function filterFeedJobs(
  jobs: FeedJob[],
  subscriptionId: string | 'all',
  subscriptions: ClusterSubscription[],
  filters: FeedFilters = {},
  nowMs = Date.now(),
): FeedJob[] {
  const clusterIds = resolveClusterIds(subscriptionId, subscriptions);
  const frequencies = resolveFrequencies(subscriptionId, subscriptions);
  const maxWindow = Math.max(...frequencies.map((f) => FREQUENCY_MS[f]));

  let result = jobs.filter((job) => {
    if (clusterIds && !clusterIds.includes(job.clusterId)) return false;
    const inAnyWindow = frequencies.some((freq) => withinWindow(job, freq, nowMs));
    if (!inAnyWindow) {
      const cutoff = nowMs - maxWindow;
      const instant = Date.parse(job.lastSeenAt || job.postedAt);
      if (instant < cutoff) return false;
    }
    return jobMatchesFilters(job, filters);
  });

  result = result.sort(
    (a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt),
  );

  return result;
}

export async function listClusters() {
  await delay();
  return MOCK_CLUSTERS;
}

export async function getCluster(slug: string) {
  await delay();
  const cluster = getClusterBySlug(slug);
  if (!cluster) throw new Error('Cluster not found');
  return cluster;
}

export async function listFeed(
  subscriptionId: string | 'all',
  filters: FeedFilters = {},
) {
  await delay();
  const state = readState();
  const jobs = withSavedFlags(MOCK_JOBS, state.savedJobIds);
  const filtered = filterFeedJobs(jobs, subscriptionId, state.subscriptions, filters);
  const frequency =
    subscriptionId === 'all'
      ? state.subscriptions.find((s) => s.status === 'active')?.frequency ?? '2h'
      : state.subscriptions.find((s) => s.id === subscriptionId)?.frequency ?? '2h';
  return { jobs: filtered, frequency, total: filtered.length };
}

export async function getJob(id: string) {
  await delay();
  const state = readState();
  const job = getJobById(id);
  if (!job) throw new Error('Job not found');
  return { ...job, saved: state.savedJobIds.includes(id) };
}

export async function saveJob(id: string) {
  await delay();
  const state = readState();
  if (!state.savedJobIds.includes(id)) {
    state.savedJobIds = [...state.savedJobIds, id];
    writeState(state);
  }
  return getJob(id);
}

export async function unsaveJob(id: string) {
  await delay();
  const state = readState();
  state.savedJobIds = state.savedJobIds.filter((x) => x !== id);
  writeState(state);
  return getJob(id);
}

export async function listSaved() {
  await delay();
  const state = readState();
  const jobs = state.savedJobIds
    .map((id) => getJobById(id))
    .filter(Boolean)
    .map((j) => ({ ...j!, saved: true }));
  return jobs;
}

export async function subscribe(clusterId: string, planId: string, frequency: DeliveryFrequency) {
  await delay();
  const cluster = getClusterById(clusterId);
  if (!cluster) throw new Error('Cluster not found');
  const state = readState();
  const sub: ClusterSubscription = {
    id: `sub-${Date.now()}`,
    clusterId,
    clusterName: cluster.name,
    planId,
    frequency,
    status: 'active',
    subscribedAt: new Date().toISOString(),
    nextRefreshAt: new Date(Date.now() + FREQUENCY_MS[frequency]).toISOString(),
  };
  state.subscriptions = [...state.subscriptions, sub];
  writeState(state);
  return sub;
}

export async function listSubscriptions() {
  await delay();
  return readState().subscriptions;
}

export async function pauseSubscription(id: string) {
  await delay();
  const state = readState();
  state.subscriptions = state.subscriptions.map((s) =>
    s.id === id ? { ...s, status: 'paused' as const } : s,
  );
  writeState(state);
  return state.subscriptions.find((s) => s.id === id);
}

export async function resumeSubscription(id: string) {
  await delay();
  const state = readState();
  state.subscriptions = state.subscriptions.map((s) =>
    s.id === id ? { ...s, status: 'active' as const } : s,
  );
  writeState(state);
  return state.subscriptions.find((s) => s.id === id);
}

export async function cancelSubscription(id: string) {
  await delay();
  const state = readState();
  state.subscriptions = state.subscriptions.filter((s) => s.id !== id);
  writeState(state);
}

export async function changeFrequency(id: string, frequency: DeliveryFrequency) {
  await delay();
  const state = readState();
  state.subscriptions = state.subscriptions.map((s) =>
    s.id === id
      ? {
          ...s,
          frequency,
          nextRefreshAt: new Date(Date.now() + FREQUENCY_MS[frequency]).toISOString(),
        }
      : s,
  );
  writeState(state);
  return state.subscriptions.find((s) => s.id === id);
}

export async function submitClusterRequest(
  payload: Omit<ClusterRequest, 'id' | 'status' | 'submittedAt'>,
) {
  await delay();
  const state = readState();
  const req: ClusterRequest = {
    ...payload,
    id: `req-${Date.now()}`,
    status: 'submitted',
    submittedAt: new Date().toISOString(),
  };
  state.requests = [req, ...state.requests];
  writeState(state);
  return req;
}

export async function listRequests() {
  await delay();
  return readState().requests;
}

export async function getCurrentUser() {
  await delay();
  return readState().user;
}

export async function loginMock(persona: PersonaKey = 'priya') {
  await delay();
  const defaults = getPersonaDefaults(persona);
  const state: PortalState = {
    user: defaults.user,
    subscriptions: defaults.subscriptions,
    savedJobIds: defaults.savedJobIds,
    requests: defaults.requests,
  };
  writeState(state);
  return state.user;
}

export async function logoutMock() {
  await delay();
  resetPortalState();
}

export async function switchPersona(persona: PersonaKey) {
  await delay();
  return loginMock(persona);
}

export async function getPortalState() {
  await delay();
  return readState();
}

export { readState, writeState };
