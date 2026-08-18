import axios from 'axios';
import { apiUrl } from '../apiConfig';

export type AutomationDestinationType = 'webhook' | 'airtable' | 'database' | 'none';

/** Browser-safe read model. Secret fields are accepted only by write payloads. */
export interface PublicAutomationConfig {
  schedule?: Record<string, unknown>;
  performance?: Record<string, unknown>;
  destinations?: {
    webhook?: { enabled?: boolean; retryAttempts?: number; retryDelaySeconds?: number; timeoutSeconds?: number };
    googleSheets?: { enabled?: boolean; spreadsheetId?: string; sheetName?: string };
    airtable?: { enabled?: boolean; baseId?: string; tableName?: string };
    database?: { enabled?: boolean; type?: 'postgres' | 'mysql'; tableName?: string };
  };
  userAgent?: string;
  dataCleanup?: Record<string, unknown>;
  pagination?: Record<string, unknown>;
  popups?: Record<string, unknown>;
  captcha?: Record<string, unknown>;
  listExtraction?: Record<string, unknown>;
  screenshots?: Record<string, unknown>;
  columnOverrides?: ColumnOverridesMap;
  databaseTargetColumns?: string[];
  rowContext?: RowContextFields;
  webhookConfigured: boolean;
  proxyConfigured: boolean;
  destinationType?: AutomationDestinationType;
}

export interface AutomationSummary {
  id: string;
  /** Parallel Scout-X scrape ID (SX12AB34). */
  scoutId?: string | null;
  name: string;
  companyName?: string;
  tags?: string[];
  targetUrl: string;
  /** Robot meta updated-at string from the server (used for stale snapshots). */
  updatedAt?: string;
  lastRunTime: string | null;
  rowsExtracted: number;
  status: string;
  latestRunId?: string | null;
  latestFailureReason?: string | null;
  latestFailureReasonSource?: string | null;
  webhookConfigured: boolean;
  proxyConfigured: boolean;
  destinationType?: AutomationDestinationType;
  config?: PublicAutomationConfig;
  schedule?: {
    enabled?: boolean;
    cron?: string;
    every?: number;
    timezone?: string;
    updatedAt?: string;
    /** Server-set: cron stored but triggers off (paused). */
    paused?: boolean;
    nextRunAt?: string | null;
    lastRunAt?: string | null;
  } | null;
}

export interface ColumnOverride {
  /** Display + storage name to use in place of the original column. */
  rename?: string;
  /** When true the column is kept but its value is written as an empty string on each new run. */
  clear?: boolean;
  /** When true the field is dropped from storage, exports, and destinations (not combinable with clear). */
  omit?: boolean;
}

export type ColumnOverridesMap = Record<string, ColumnOverride>;

/** Stored per automation; merged into every extracted row as `sectorIndustry` and `f500`. */
export interface RowContextFields {
  sectorIndustry?: string;
  f500?: '' | 'yes' | 'no';
}

export const AUTOMATION_ROW_CONTEXT_KEYS = ['sectorIndustry', 'f500'] as const;

export interface AutomationDataResponse {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  columns: string[];
  rows: Array<{
    id: string;
    runId: string;
    source: string;
    createdAt: string;
    data: Record<string, any>;
  }>;
  /** Server returns the active overrides so the UI can decorate headers. */
  overrides?: ColumnOverridesMap;
  /** Sector/industry + F500 labels applied to every row (empty strings when unset). */
  rowContext?: RowContextFields;
  /** Names from automation config used as dropdown options when mapping scraped columns. */
  databaseTargetColumns?: string[];
}

export interface AutomationColumnsResponse {
  columns: string[];
  overrides: ColumnOverridesMap;
}

export interface DashboardAutomationsSummary {
  totalAutomations: number;
  activeScheduledCount: number;
  pausedScheduleCount: number;
  /** Sum of latest-run extracted rows across all matching automations (all pages). */
  rowsExtractedTotal: number;
  /** Automations whose latest run is completed/success (all pages). */
  successfulCount: number;
  /** Automations whose latest run is failed (all pages). */
  failedCount: number;
}

export interface DashboardAutomationsResponse {
  automations: AutomationSummary[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  summary: DashboardAutomationsSummary;
}

export const getDashboardAutomations = async (params?: {
  page?: number;
  limit?: number;
  tags?: string[];
  q?: string;
  id?: string;
  scheduleCron?: string;
}, signal?: AbortSignal): Promise<DashboardAutomationsResponse> => {
  const page = params?.page ?? 1;
  const limit = params?.limit ?? 10;
  const response = await axios.get(`${apiUrl}/api/dashboard/automations`, {
    params: {
      page,
      limit,
      ...(params?.tags?.length ? { tags: params.tags.join(',') } : {}),
      ...(params?.q ? { q: params.q } : {}),
      ...(params?.id ? { id: params.id } : {}),
      ...(params?.scheduleCron ? { scheduleCron: params.scheduleCron } : {}),
    },
    withCredentials: true,
    signal,
  });
  const data = response.data || {};
  return {
    automations: data.automations || [],
    pagination: data.pagination || { page: 1, limit, total: 0, totalPages: 1 },
    summary: data.summary || {
      totalAutomations: 0,
      activeScheduledCount: 0,
      pausedScheduleCount: 0,
      rowsExtractedTotal: 0,
      successfulCount: 0,
      failedCount: 0,
    },
  };
};

export type OpsMetricsWindow = '15m' | '30m' | '1h' | '3h' | '6h' | '24h';

export type OpsMetricsResponse = {
  generatedAt: string;
  window: OpsMetricsWindow;
  windowMs: number;
  since: string;
  totals: {
    runs: number;
    passed: number;
    failed: number;
    running: number;
    rowsExtracted: number;
    jobsAddedToBoard: number;
    activeRunsNow: number;
    automations: number;
  };
  series: {
    runs: Array<{ t: number; label: string; total: number; passed: number; failed: number }>;
    jobsAdded: Array<{ t: number; label: string; jobsAdded: number }>;
  };
  tags: Array<{
    tag: string;
    label: string;
    namespace: string;
    namespaceLabel: string;
    jobsAdded: number;
    runs: number;
  }>;
  upcomingSchedules: {
    automationsWithRuns: number;
    totalScheduledRuns: number;
    activeScheduledAutomations: number;
    forecastFrom: string;
    forecastUntil: string;
  };
  compute: {
    scraperWorkerConcurrency: number;
    scraperJobTimeoutMs: number;
    runEmbeddedWorkers: boolean;
    activeBrowsers: number;
    activeBrowserIds: string[];
    memoryUsage: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
      arrayBuffers?: number;
    };
    uptimeSeconds: number;
  };
  digitalOcean: any;
};

export const getDashboardMetrics = async (
  window: OpsMetricsWindow = '1h'
): Promise<OpsMetricsResponse> => {
  const response = await axios.get(`${apiUrl}/api/dashboard/metrics`, {
    params: { window },
    withCredentials: true,
  });
  return response.data;
};

export interface SaasRunsListResponse {
  runs: any[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  countsByReason?: Record<string, number>;
}

/** Paginated SaaS runs list (`GET /api/runs`). Optional `robotMetaId` scopes to one automation you own. */
export const listSaasRuns = async (params?: {
  page?: number;
  limit?: number;
  robotMetaId?: string;
  status?: string;
  anomaly?: string;
  failureReason?: string;
  q?: string;
  date?: string;
  from?: string;
  to?: string;
  minJobsAdded?: number;
  maxJobsAdded?: number;
  jobsAddedExact?: number;
  minDurationMs?: number;
  maxDurationMs?: number;
}, signal?: AbortSignal): Promise<SaasRunsListResponse> => {
  const page = params?.page ?? 1;
  const limit = params?.limit ?? 10;
  const response = await axios.get(`${apiUrl}/api/runs`, {
    params: {
      page,
      limit,
      ...(params?.robotMetaId ? { robotMetaId: params.robotMetaId } : {}),
      ...(params?.status ? { status: params.status } : {}),
      ...(params?.anomaly ? { anomaly: params.anomaly } : {}),
      ...(params?.failureReason ? { failureReason: params.failureReason } : {}),
      ...(params?.q ? { q: params.q } : {}),
      ...(params?.date ? { date: params.date } : {}),
      ...(params?.from ? { from: params.from } : {}),
      ...(params?.to ? { to: params.to } : {}),
      ...(params?.minJobsAdded != null ? { minJobsAdded: params.minJobsAdded } : {}),
      ...(params?.maxJobsAdded != null ? { maxJobsAdded: params.maxJobsAdded } : {}),
      ...(params?.jobsAddedExact != null ? { jobsAddedExact: params.jobsAddedExact } : {}),
      ...(params?.minDurationMs != null ? { minDurationMs: params.minDurationMs } : {}),
      ...(params?.maxDurationMs != null ? { maxDurationMs: params.maxDurationMs } : {}),
    },
    withCredentials: true,
    signal,
  });
  const data = response.data || {};
  return {
    runs: data.runs || [],
    pagination: data.pagination || { page: 1, limit, total: 0, totalPages: 1 },
    countsByReason: data.countsByReason || {},
  };
};

export type SaasRunsListParams = {
  page?: number;
  limit?: number;
  robotMetaId?: string;
  status?: string;
  anomaly?: string;
  failureReason?: string;
  q?: string;
  date?: string;
  from?: string;
  to?: string;
  minJobsAdded?: number;
  maxJobsAdded?: number;
  jobsAddedExact?: number;
  minDurationMs?: number;
  maxDurationMs?: number;
};

export interface SaasRunGroup {
  robotMetaId: string;
  name: string;
  companyName?: string;
  runCount: number;
  latestRun: any;
}

export interface SaasRunGroupsResponse {
  groups: SaasRunGroup[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/** Paginated automation groups for the All Runs list (`GET /api/runs/groups`). */
export const listSaasRunGroups = async (
  params?: SaasRunsListParams,
  signal?: AbortSignal
): Promise<SaasRunGroupsResponse> => {
  const page = params?.page ?? 1;
  const limit = params?.limit ?? 10;
  const response = await axios.get(`${apiUrl}/api/runs/groups`, {
    params: {
      page,
      limit,
      ...(params?.robotMetaId ? { robotMetaId: params.robotMetaId } : {}),
      ...(params?.status ? { status: params.status } : {}),
      ...(params?.anomaly ? { anomaly: params.anomaly } : {}),
      ...(params?.failureReason ? { failureReason: params.failureReason } : {}),
      ...(params?.q ? { q: params.q } : {}),
      ...(params?.date ? { date: params.date } : {}),
      ...(params?.from ? { from: params.from } : {}),
      ...(params?.to ? { to: params.to } : {}),
      ...(params?.minJobsAdded != null ? { minJobsAdded: params.minJobsAdded } : {}),
      ...(params?.maxJobsAdded != null ? { maxJobsAdded: params.maxJobsAdded } : {}),
      ...(params?.jobsAddedExact != null ? { jobsAddedExact: params.jobsAddedExact } : {}),
      ...(params?.minDurationMs != null ? { minDurationMs: params.minDurationMs } : {}),
      ...(params?.maxDurationMs != null ? { maxDurationMs: params.maxDurationMs } : {}),
    },
    withCredentials: true,
    signal,
  });
  const data = response.data || {};
  return {
    groups: data.groups || [],
    pagination: data.pagination || { page, limit, total: 0, totalPages: 1 },
  };
};

export const deleteSaasRun = async (runId: string): Promise<boolean> => {
  const response = await axios.delete(`${apiUrl}/api/runs/${encodeURIComponent(runId)}`, {
    withCredentials: true,
  });
  return response.data?.success === true || response.status === 200;
};

export const createAutomation = async (payload: {
  name: string;
  startUrl: string;
  companyName: string;
  webhookUrl?: string;
  tags?: string[];
  config?: Record<string, any>;
}) => {
  const response = await axios.post(`${apiUrl}/api/automations`, payload, { withCredentials: true });
  return response.data.automation;
};

export const getAutomation = async (id: string) => {
  const response = await axios.get(`${apiUrl}/api/automations/${id}`, { withCredentials: true });
  return response.data;
};

export const updateAutomationConfig = async (
  id: string,
  payload: {
    name?: string;
    startUrl?: string;
    webhookUrl?: string;
    companyName?: string;
    tags?: string[];
    config?: Record<string, any>;
    preferredNextRunAt?: string | null;
  }
) => {
  const response = await axios.put(`${apiUrl}/api/automations/${id}/config`, payload, { withCredentials: true });
  return response.data;
};

export const runAutomation = async (id: string) => {
  const response = await axios.post(`${apiUrl}/api/automations/${id}/run`, {}, { withCredentials: true });
  return response.data;
};

export const retryRun = async (runId: string, idempotencyKey: string) => {
  const response = await axios.post(
    `${apiUrl}/api/runs/${runId}/retry`,
    {},
    {
      withCredentials: true,
      headers: { 'Idempotency-Key': idempotencyKey },
    }
  );
  return response.data;
};

export const getAutomationData = async (id: string, page: number, limit: number): Promise<AutomationDataResponse> => {
  const response = await axios.get(`${apiUrl}/api/automations/${id}/data?page=${page}&limit=${limit}`, {
    withCredentials: true,
  });
  return response.data;
};

export const getSaasRun = async (id: string) => {
  const response = await axios.get(`${apiUrl}/api/runs/${id}`, { withCredentials: true });
  return response.data;
};

export type RunDetailRowsResponse = {
  rows: Array<{ id: string; source: string; createdAt: string | null; data: Record<string, any> }>;
  nextCursor: string | null;
};

export const getSaasRunRows = async (
  id: string,
  cursor?: string | null,
  limit: number = 100
): Promise<RunDetailRowsResponse> => {
  const response = await axios.get(`${apiUrl}/api/runs/${id}/rows`, {
    params: { limit, ...(cursor ? { cursor } : {}) },
    withCredentials: true,
  });
  return { rows: response.data?.rows || [], nextCursor: response.data?.nextCursor || null };
};

export type RunDetailLogsResponse = {
  logs: string[];
  nextCursor: string | null;
  hasMore: boolean;
};

export const getSaasRunLogs = async (
  id: string,
  cursor?: string | null,
  limit: number = 100
): Promise<RunDetailLogsResponse> => {
  const response = await axios.get(`${apiUrl}/api/runs/${id}/logs`, {
    params: { limit, ...(cursor ? { cursor } : {}) },
    withCredentials: true,
  });
  return {
    logs: response.data?.logs || [],
    nextCursor: response.data?.nextCursor || null,
    hasMore: response.data?.hasMore === true,
  };
};

export const updateRunFailureReason = async (
  runId: string,
  payload: { failureReason: string | null; confirmed?: boolean }
) => {
  const response = await axios.patch(
    `${apiUrl}/api/runs/${runId}/failure-reason`,
    payload,
    { withCredentials: true }
  );
  return response.data;
};

export const updateAutomationSchedule = async (
  id: string,
  schedule: {
    enabled: boolean;
    cron: string | null;
    timezone: string;
    preferredNextRunAt?: string | null;
  }
): Promise<{ success: boolean; schedule: any }> => {
  const response = await axios.put(
    `${apiUrl}/api/automations/${id}/schedule`,
    {
      enabled: schedule.enabled,
      cron: schedule.cron,
      timezone: schedule.timezone,
      ...(schedule.preferredNextRunAt ? { preferredNextRunAt: schedule.preferredNextRunAt } : {}),
    },
    { withCredentials: true }
  );
  return response.data;
};

/** Pauses all recurring schedules (cron kept in DB; Agenda triggers cancelled). */
export const stopAllAutomationSchedules = async (): Promise<{ success: boolean; stoppedCount: number }> => {
  const response = await axios.post(`${apiUrl}/api/automations/schedules/stop-all`, {}, { withCredentials: true });
  return response.data;
};

/** Resumes every paused schedule for your account (same cron/timezone as before pause). */
export const resumeAllAutomationSchedules = async (): Promise<{ success: boolean; resumedCount: number }> => {
  const response = await axios.post(`${apiUrl}/api/automations/schedules/resume-all`, {}, { withCredentials: true });
  return response.data;
};

/** Re-spread all enabled schedules with random packed first-fire times. */
export const repackAllAutomationSchedules = async (): Promise<{
  success: boolean;
  repackedCount: number;
  skippedCount: number;
}> => {
  const response = await axios.post(`${apiUrl}/api/automations/schedules/repack-all`, {}, { withCredentials: true });
  return response.data;
};

export const deleteAutomation = async (id: string): Promise<void> => {
  await axios.delete(`${apiUrl}/api/automations/${id}`, { withCredentials: true });
};

/**
 * List the union of every column persisted in `extracted_data` for this
 * automation, plus any overrides currently saved on the robot. Used by the
 * "Edit columns" dialog so the user sees columns beyond the visible page.
 */
export const getAutomationColumns = async (id: string): Promise<AutomationColumnsResponse> => {
  const response = await axios.get(`${apiUrl}/api/automations/${id}/columns`, { withCredentials: true });
  const data = response.data || {};
  return {
    columns: data.columns || [],
    overrides: data.overrides || {},
  };
};

/** Persist column overrides and optional row context (sector/industry, F500) for an automation. */
export const updateAutomationColumns = async (
  id: string,
  payload: { overrides: ColumnOverridesMap; rowContext: RowContextFields }
): Promise<{ overrides: ColumnOverridesMap; rowContext: RowContextFields }> => {
  const response = await axios.put(`${apiUrl}/api/automations/${id}/columns`, payload, {
    withCredentials: true,
  });
  const data = response.data || {};
  return {
    overrides: data.overrides || {},
    rowContext: data.rowContext || { sectorIndustry: '', f500: '' },
  };
};

