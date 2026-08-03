import axios from 'axios';
import { apiUrl } from '../apiConfig';

const withCreds = { withCredentials: true as const };

export type AdminSession = {
  authenticated: boolean;
  configured: boolean;
};

export type AdminOverview = {
  generatedAt: string;
  totals: {
    runs: number;
    robots: number;
    users: number;
    activeRunsNow: number;
    runsLast24h: number;
  };
  byStatus: Record<string, number>;
  compute: {
    scraperWorkerConcurrency: number;
    scraperJobTimeoutMs: number;
    scraperMaxAttempts: number;
    runEmbeddedWorkers: boolean;
    nodeEnv: string;
    defaultBrowserType: string;
    activeBrowsers: number;
    activeBrowserIds: string[];
    avgDurationMsLast24h: number | null;
    p95DurationMsLast24h: number | null;
    memoryUsage: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
      arrayBuffers?: number;
    };
    uptimeSeconds: number;
  };
};

export type AdminRunSummary = {
  runId: string;
  name: string;
  status: string;
  robotMetaId: string;
  robotId?: string | null;
  targetUrl?: string | null;
  ownerUserId?: string | null;
  ownerEmail?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  durationSeconds?: number | null;
  browserId?: string | null;
  retryCount?: number;
  errorMessage?: string | null;
  queueJobId?: string | null;
  trigger?: string;
  rowsExtracted?: number;
  hasSerializableOutput?: boolean;
  hasBinaryOutput?: boolean;
  screenshotCount?: number;
  logBytes?: number;
  automationConfigSummary?: Record<string, unknown>;
};

export type MetricSeriesSummary = {
  latest: number | null;
  avg: number | null;
  max: number | null;
  points: Array<{ t: number; v: number }>;
};

export type DropletComputeSnapshot = {
  id: number;
  name: string;
  status: string;
  region: string | null;
  sizeSlug: string | null;
  vcpus: number | null;
  memoryMb: number | null;
  diskGb: number | null;
  priceMonthlyUsd: number | null;
  publicIpv4?: string | null;
  createdAt: string | null;
  metrics: {
    window: '1h' | '6h' | '24h';
    start: number;
    end: number;
    cpuPercent: MetricSeriesSummary;
    memoryUsedPercent: MetricSeriesSummary;
    memoryUsedBytes?: number | null;
    memoryTotalBytes: number | null;
    memoryAvailableBytes: number | null;
    diskUsedPercent?: MetricSeriesSummary;
    diskUsedBytes?: number | null;
    diskTotalBytes?: number | null;
    bandwidthInboundMbps: MetricSeriesSummary;
    bandwidthOutboundMbps: MetricSeriesSummary;
    diskReadMbps?: MetricSeriesSummary;
    diskWriteMbps?: MetricSeriesSummary;
    load1?: MetricSeriesSummary;
    empty: boolean;
    note: string | null;
  };
};

export type DigitalOceanDashboard = {
  configured: boolean;
  generatedAt: string;
  error?: string;
  hint?: string;
  resolvedIds?: number[];
  availableDroplets?: Array<{ id: number; name: string; status: string; publicIpv4: string | null }>;
  droplets: DropletComputeSnapshot[];
};

export type OpsDigestStatus = {
  enabled: boolean;
  zeptoConfigured: boolean;
  recipients: string[];
  canSend: boolean;
  reason?: string;
  interval?: string;
};

export async function getAdminSession(): Promise<AdminSession> {
  const response = await axios.get(`${apiUrl}/api/admin/session`, withCreds);
  return response.data;
}

export async function adminLogin(password: string): Promise<{ success: boolean }> {
  const response = await axios.post(`${apiUrl}/api/admin/login`, { password }, withCreds);
  return response.data;
}

export async function adminLogout(): Promise<void> {
  await axios.post(`${apiUrl}/api/admin/logout`, {}, withCreds);
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const response = await axios.get(`${apiUrl}/api/admin/overview`, withCreds);
  return response.data;
}

export async function listAdminRuns(params: {
  page?: number;
  limit?: number;
  status?: string;
  ownerEmail?: string;
  q?: string;
}): Promise<{
  runs: AdminRunSummary[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const response = await axios.get(`${apiUrl}/api/admin/runs`, {
    ...withCreds,
    params,
  });
  return response.data;
}

export async function getAdminRun(runId: string): Promise<any> {
  const response = await axios.get(`${apiUrl}/api/admin/runs/${encodeURIComponent(runId)}`, withCreds);
  return response.data;
}

export async function getAdminDigitalOcean(
  window: '1h' | '6h' | '24h' = '6h'
): Promise<DigitalOceanDashboard> {
  const response = await axios.get(`${apiUrl}/api/admin/digitalocean`, {
    ...withCreds,
    params: { window },
  });
  return response.data;
}

export async function getAdminDigestStatus(): Promise<OpsDigestStatus> {
  const response = await axios.get(`${apiUrl}/api/admin/digest/status`, withCreds);
  return response.data;
}

export async function sendAdminDigestTest(): Promise<{
  success: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
  requestId?: string | null;
  summary?: { generatedAt: string; last6h: { total: number; passed: number; failed: number } } | null;
}> {
  const response = await axios.post(`${apiUrl}/api/admin/digest/test`, {}, withCreds);
  return response.data;
}
