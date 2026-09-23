import axios from 'axios';
import { apiUrl } from '../apiConfig';

const withCreds = { withCredentials: true as const };

export type AdminClusterFilter = {
  frozenIndustries: string[];
  frozenCategories: string[];
  frozenExperienceLevels: string[];
  frozenExperienceYears: string[];
  frozenStates: string[];
  locationIsRemote?: boolean | null;
  excludeStudentEscape?: boolean;
  companyNames?: string[];
  h1bSponsorFriendly?: boolean;
};

export type AdminClusterSourceBinding = {
  mode: 'filter' | 'source';
  sources: string[];
  companyNames: string[];
  robotMetaIds: string[];
};

export type AdminClusterRequest = {
  id: string;
  auth0Sub: string;
  type: 'predefined' | 'custom_urls';
  title: string;
  industries: string[];
  locations: string[];
  roles: string[];
  experienceLevels?: string[];
  experienceMin?: number | null;
  experienceMax?: number | null;
  companies: string[];
  urls: string[];
  notes?: string | null;
  status: string;
  submittedAt: string;
  resultClusterId?: string | null;
  adminNotes?: string | null;
  urlRobotOverrides?: Array<{ url: string; robotMetaId: string }>;
};

export type RequestCoverageUrlRow = {
  url: string;
  normalizedUrl: string;
  requestedHadSiteFilters?: boolean;
  matchKind?: 'exact' | 'root' | 'host' | 'manual' | null;
  reuseNote?: string | null;
  robot: {
    metaId: string;
    name: string;
    url: string;
    reused: boolean;
    matchKind?: 'exact' | 'root' | 'host' | 'manual';
  } | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  jobsTotal: number;
  jobsMatching: number;
  status: 'missing_automation' | 'never_run' | 'no_matching_jobs' | 'ready';
};

export type RequestCoverageResponse = {
  request: AdminClusterRequest;
  filter: AdminClusterFilter;
  urls: RequestCoverageUrlRow[];
  summary: {
    totalUrls: number;
    readyCount: number;
    missingAutomation: number;
    neverRun: number;
    noMatchingJobs: number;
    allReady: boolean;
    jobsMatchingTotal: number;
    hostReuseCount?: number;
  };
};

export type AdminCluster = {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind: 'curated' | 'custom';
  status: 'draft' | 'published' | 'archived' | string;
  filtersSummary: string[];
  jobCountPreview: number;
  filter?: AdminClusterFilter;
  sourceBinding?: AdminClusterSourceBinding;
  coverImage?: string | null;
  companyLogos?: string[];
  requestId?: string | null;
  createdBy?: string | null;
  publishedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type AdminClusterDetail = {
  cluster: AdminCluster;
  request: AdminClusterRequest | null;
  robots: Array<{ metaId: string; name: string; url: string }>;
  activeSubscriptions: number;
};

export type AdminClusterActivity = {
  id: string;
  clusterId: string;
  at: string;
  actor: string;
  action: string;
  detail?: string | null;
};

export type AdminSampleJob = {
  id: string;
  title: string;
  company: string;
  location?: string;
  level?: string;
  workMode?: string;
  url?: string;
  lastSeenAt?: string;
};

export type ClusterStudioOverview = {
  generatedAt: string;
  totals: {
    portalUsers: number;
    publishedClusters: number;
    draftClusters: number;
    openRequests: number;
    publishedRequests: number;
    rejectedRequests: number;
    activeSubscriptions: number;
    pausedSubscriptions: number;
    savedJobs: number;
  };
  recentRequests: Array<{
    id: string;
    title: string;
    status: string;
    type: string;
    submittedAt: string;
    auth0Sub: string;
  }>;
};

export async function getClusterStudioOverview() {
  const { data } = await axios.get(`${apiUrl}/api/cluster-studio/overview`, withCreds);
  return data as ClusterStudioOverview;
}

export async function adminListClusterRequests(params?: { status?: string; page?: number }) {
  const { data } = await axios.get(`${apiUrl}/api/cluster-studio/requests`, {
    ...withCreds,
    params,
  });
  return data as { requests: AdminClusterRequest[]; total: number };
}

export async function adminPatchClusterRequest(
  id: string,
  body: { status?: string; adminNotes?: string; resultClusterId?: string }
) {
  const { data } = await axios.patch(
    `${apiUrl}/api/cluster-studio/requests/${id}`,
    body,
    withCreds
  );
  return data;
}

export async function adminCreateDraftFromRequest(requestId: string) {
  const { data } = await axios.post(
    `${apiUrl}/api/cluster-studio/requests/${requestId}/create-draft`,
    {},
    withCreds
  );
  return data as { cluster: AdminCluster; request: AdminClusterRequest; reused: boolean };
}

export async function adminGetRequestCoverage(requestId: string) {
  const { data } = await axios.get(
    `${apiUrl}/api/cluster-studio/requests/${requestId}/coverage`,
    withCreds
  );
  return data as RequestCoverageResponse;
}

export type AdminRobotSearchHit = {
  metaId: string;
  name: string;
  url: string;
};

export async function adminSearchRobots(q: string, limit = 15, signal?: AbortSignal) {
  const { data } = await axios.get(`${apiUrl}/api/cluster-studio/robots/search`, {
    ...withCreds,
    params: { q, limit },
    signal,
  });
  return data as { robots: AdminRobotSearchHit[]; q: string; limit: number };
}

export async function adminLinkRequestRobot(
  requestId: string,
  body: { url: string; robotMetaId: string }
) {
  const { data } = await axios.post(
    `${apiUrl}/api/cluster-studio/requests/${requestId}/link-robot`,
    body,
    withCreds
  );
  return data as {
    request: AdminClusterRequest;
    cluster: AdminCluster;
    linked: { url: string; robotMetaId: string; name: string; robotUrl: string };
  };
}

export async function adminMakeClusterFromRequest(
  requestId: string,
  body?: { allowEmpty?: boolean; requireAllReady?: boolean }
) {
  const { data } = await axios.post(
    `${apiUrl}/api/cluster-studio/requests/${requestId}/make-cluster`,
    body || {},
    withCreds
  );
  return data as {
    cluster: AdminCluster;
    request: AdminClusterRequest;
    createdRobots: Array<{ metaId: string; url: string; name: string; reused?: boolean }>;
    jobCountPreview: number;
  };
}

export async function adminListClusters(params?: { status?: string }) {
  const { data } = await axios.get(`${apiUrl}/api/cluster-studio/clusters`, {
    ...withCreds,
    params,
  });
  return data as { clusters: AdminCluster[] };
}

export async function adminGetCluster(id: string) {
  const { data } = await axios.get(`${apiUrl}/api/cluster-studio/clusters/${id}`, withCreds);
  return data as AdminClusterDetail;
}

export async function adminCreateCluster(body: Record<string, unknown>) {
  const { data } = await axios.post(`${apiUrl}/api/cluster-studio/clusters`, body, withCreds);
  return data as AdminCluster;
}

export async function adminPatchCluster(id: string, body: Record<string, unknown>) {
  const { data } = await axios.patch(
    `${apiUrl}/api/cluster-studio/clusters/${id}`,
    body,
    withCreds
  );
  return data as AdminCluster;
}

export async function adminPublishCluster(id: string, body?: { requestId?: string }) {
  const { data } = await axios.post(
    `${apiUrl}/api/cluster-studio/clusters/${id}/publish`,
    body || {},
    withCreds
  );
  return data as AdminCluster;
}

export async function adminUnpublishCluster(id: string) {
  const { data } = await axios.post(
    `${apiUrl}/api/cluster-studio/clusters/${id}/unpublish`,
    {},
    withCreds
  );
  return data as AdminCluster;
}

export async function adminArchiveCluster(id: string) {
  const { data } = await axios.post(
    `${apiUrl}/api/cluster-studio/clusters/${id}/archive`,
    {},
    withCreds
  );
  return data as AdminCluster;
}

export async function adminRestoreCluster(id: string) {
  const { data } = await axios.post(
    `${apiUrl}/api/cluster-studio/clusters/${id}/restore`,
    {},
    withCreds
  );
  return data as AdminCluster;
}

export async function adminDuplicateCluster(id: string) {
  const { data } = await axios.post(
    `${apiUrl}/api/cluster-studio/clusters/${id}/duplicate`,
    {},
    withCreds
  );
  return data as AdminCluster;
}

export async function adminDeleteCluster(id: string) {
  await axios.delete(`${apiUrl}/api/cluster-studio/clusters/${id}`, withCreds);
}

export async function adminPreviewCount(id: string, opts?: { includeSamples?: boolean; limit?: number }) {
  const { data } = await axios.post(
    `${apiUrl}/api/cluster-studio/clusters/${id}/preview-count`,
    opts || {},
    withCreds
  );
  return data as { jobCountPreview: number; jobs: AdminSampleJob[]; cluster: AdminCluster };
}

export async function adminSampleJobs(id: string, limit = 8) {
  const { data } = await axios.get(`${apiUrl}/api/cluster-studio/clusters/${id}/sample-jobs`, {
    ...withCreds,
    params: { limit },
  });
  return data as { jobs: AdminSampleJob[]; limit: number };
}

export async function adminGetActivity(id: string, limit = 40) {
  const { data } = await axios.get(`${apiUrl}/api/cluster-studio/clusters/${id}/activity`, {
    ...withCreds,
    params: { limit },
  });
  return data as { activity: AdminClusterActivity[] };
}

export async function adminBindClusterSources(
  id: string,
  body: {
    urls?: string[];
    robotMetaIds?: string[];
    companyNames?: string[];
    createRobots?: boolean;
    sources?: string[];
  }
) {
  const { data } = await axios.post(
    `${apiUrl}/api/cluster-studio/clusters/${id}/bind-sources`,
    body,
    withCreds
  );
  return data as { cluster: AdminCluster; createdRobots: unknown[] };
}

export type PortalUserSubscriptionRow = {
  id: string;
  clusterId: string;
  clusterName: string;
  clusterSlug?: string;
  window: string;
  status: string;
  source?: 'self_serve' | 'request_fulfillment' | 'admin_assigned';
};

export type PortalUserRow = {
  id: string;
  auth0Sub: string;
  email: string;
  name: string | null;
  /** First Step Auth0/Mongo role (Application Incharge, Job Collector, Super Admin, User). */
  firstStepRole?: string | null;
  firstStepPlan: {
    subscriptionType: string | null;
    subscriptionTypeDisplay: string | null;
    isActive: boolean | null;
    status: string | null;
    fetchedAt: string | null;
  } | null;
  clusterServiceStarted: boolean;
  clusterServiceStartedAt: string | null;
  clusterServiceOptOut?: boolean;
  entitlements: {
    maxActiveClusters: number;
    allowedWindows: string[];
    source: string;
    isActive: boolean;
  };
  activeClusterCount: number;
  /** Plan-included slots (Premium Plus = 2). */
  planIncludedSlots?: number;
  /** Ops allotment or plan default — UI denominator (never hard-cap 50). */
  subscribedSlots?: number;
  /** @deprecated Prefer subscribedSlots. */
  adminMaxAssignableClusters?: number;
  adminClusterLimit?: number | null;
  subscriptions: PortalUserSubscriptionRow[];
};

export async function adminListPortalUsers() {
  const { data } = await axios.get(`${apiUrl}/api/cluster-studio/portal-users`, withCreds);
  return data as { users: PortalUserRow[] };
}

export async function adminGetPortalUser(auth0Sub: string) {
  const { data } = await axios.get(
    `${apiUrl}/api/cluster-studio/portal-users/${encodeURIComponent(auth0Sub)}`,
    withCreds
  );
  return data as PortalUserRow;
}

export async function adminUpdatePortalUser(
  auth0Sub: string,
  body: { clusterServiceStarted?: boolean; adminClusterLimit?: number | null }
) {
  const { data } = await axios.patch(
    `${apiUrl}/api/cluster-studio/portal-users/${encodeURIComponent(auth0Sub)}`,
    body,
    withCreds
  );
  return data as PortalUserRow;
}

export async function adminAssignPortalUserCluster(
  auth0Sub: string,
  body: { clusterId: string; window?: string }
) {
  const { data } = await axios.post(
    `${apiUrl}/api/cluster-studio/portal-users/${encodeURIComponent(auth0Sub)}/subscriptions`,
    body,
    withCreds
  );
  return data as PortalUserRow;
}

export async function adminRemovePortalUserSubscription(
  auth0Sub: string,
  subscriptionId: string,
  opts?: { soft?: boolean }
) {
  await axios.delete(
    `${apiUrl}/api/cluster-studio/portal-users/${encodeURIComponent(auth0Sub)}/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      ...withCreds,
      params: opts?.soft ? { soft: '1' } : undefined,
    }
  );
}

export type JobReportRow = {
  id: string;
  auth0Sub: string;
  reporterEmail: string | null;
  reporterName: string | null;
  jobId: string | null;
  jobUrlKey: string;
  jobUrl: string | null;
  title: string;
  company: string;
  reason: 'incorrect_company' | 'incorrect_category' | 'old_job' | 'other';
  note: string | null;
  status: 'open' | 'reviewed';
  reviewedAt: string | null;
  reviewedBy: string | null;
  createdAt: string | null;
};

export async function adminListJobReports(status: 'open' | 'reviewed' | 'all' = 'open') {
  const { data } = await axios.get(`${apiUrl}/api/cluster-studio/job-reports`, {
    ...withCreds,
    params: { status },
  });
  return data as { reports: JobReportRow[] };
}

export async function adminUpdateJobReport(id: string, status: 'open' | 'reviewed') {
  const { data } = await axios.patch(
    `${apiUrl}/api/cluster-studio/job-reports/${encodeURIComponent(id)}`,
    { status },
    withCreds
  );
  return data as JobReportRow;
}
