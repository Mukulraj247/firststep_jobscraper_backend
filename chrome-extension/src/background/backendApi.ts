/**
 * Backend API - Communicates with the Maxun backend server.
 */

import { getState } from './stateManager';
import { buildFieldMap, type BackendFieldInput } from './fieldMapEncoding';

export {
  buildFieldMap,
  encodeFieldSelectorForBackend,
  type BackendFieldInput,
} from './fieldMapEncoding';

function isHiringCafeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'hiring.cafe' || host === 'hiringcafe.com' || host.endsWith('.hiring.cafe');
  } catch {
    return false;
  }
}

function isAccelUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'jobs.accel.com' || host.endsWith('.jobs.accel.com');
  } catch {
    return false;
  }
}

function isSequoiaUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'jobs.sequoiacap.com' || host.endsWith('.jobs.sequoiacap.com');
  } catch {
    return false;
  }
}

function isCapitalGUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'careers.capitalg.com' || host.endsWith('.careers.capitalg.com');
  } catch {
    return false;
  }
}

function isChoppingBlockUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'choppingblock.ai' || host.endsWith('.choppingblock.ai');
  } catch {
    return false;
  }
}

function isAidevboardUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'aidevboard.com' || host.endsWith('.aidevboard.com');
  } catch {
    return false;
  }
}

function isStartupsGalleryUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'startups.gallery' || host.endsWith('.startups.gallery');
  } catch {
    return false;
  }
}

function isLinkedInJobsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return false;
    const path = parsed.pathname.toLowerCase();
    if (path.includes('/preload')) return false;
    return path.includes('/jobs');
  } catch {
    return false;
  }
}

function buildAuthHeaders(state: { apiKey?: string }): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (state.apiKey && state.apiKey.trim()) {
    headers['x-api-key'] = state.apiKey.trim();
  }
  return headers;
}

/**
 * Push extraction config to the Maxun backend.
 */
export async function saveConfigToBackend(payload: {
  automationId?: string;
  /** Scout-X public ID (SX12AB34); optional on create / used for lookup. */
  scoutId?: string;
  automationName?: string;
  companyName?: string;
  tags?: string[];
  startUrl?: string;
  webhookUrl?: string;
  listSelector: string;
  fields: Record<string, BackendFieldInput>;
  pagination?: {
    type: string;
    selector?: string | null;
    maxPages?: number;
    pageDelayMs?: number;
    pageParam?: string;
    startPage?: number;
    maxScrollSteps?: number;
    scrollSpinnerBudgetMs?: number;
    loadMoreWaitMs?: number;
  };
  /** Per-robot cap on total rows to collect. Mirrors the extension's user-supplied input. */
  maxItems?: number;
  /** Overlay / dialog handling knobs. */
  popups?: {
    autoDismiss?: boolean;
    acceptDialogs?: boolean;
  };
  /** CAPTCHA gate config. */
  captcha?: {
    pauseOnDetect?: boolean;
  };
  previewRows?: Record<string, string>[];
  /** Snapshot of the page URL when the preview was generated (filter survival). */
  previewUrl?: string;
  /** Recurring schedule stored under `config.schedule` (POST/PUT automations). */
  schedule?: { enabled: boolean; cron: string | null; timezone: string };
  /** Per-automation metadata merged into every extracted row (sector/industry, F500). */
  rowContext?: { sectorIndustry?: string; f500?: boolean };
  /** When true, only replace listExtraction / preview (layout-change recovery). */
  elementsOnly?: boolean;
}): Promise<any> {
  const state = await getState();
  const apiBase = state.backendUrl.replace(/\/+$/, '');

  const paginationType = payload.pagination?.type;
  const autoScroll =
    paginationType === 'scrollDown' ||
    paginationType === 'scrollUp' ||
    paginationType === 'clickLoadMore';

  const startUrl = payload.startUrl || payload.previewUrl || '';
  const hiringCafe = isHiringCafeUrl(startUrl) || isHiringCafeUrl(payload.previewUrl || '');
  const accelJobs = isAccelUrl(startUrl) || isAccelUrl(payload.previewUrl || '');
  const sequoiaJobs = isSequoiaUrl(startUrl) || isSequoiaUrl(payload.previewUrl || '');
  const capitalGJobs = isCapitalGUrl(startUrl) || isCapitalGUrl(payload.previewUrl || '');
  const choppingBlockJobs =
    isChoppingBlockUrl(startUrl) || isChoppingBlockUrl(payload.previewUrl || '');
  const aidevboardJobs = isAidevboardUrl(startUrl) || isAidevboardUrl(payload.previewUrl || '');
  const startupsGalleryJobs =
    isStartupsGalleryUrl(startUrl) || isStartupsGalleryUrl(payload.previewUrl || '');
  const linkedInJobs =
    isLinkedInJobsUrl(startUrl) || isLinkedInJobsUrl(payload.previewUrl || '');
  const useUrlKey =
    hiringCafe ||
    accelJobs ||
    sequoiaJobs ||
    capitalGJobs ||
    choppingBlockJobs ||
    aidevboardJobs ||
    startupsGalleryJobs;

  const listExtraction = {
    itemSelector: payload.listSelector,
    fields: buildFieldMap(payload.fields),
    uniqueKey: getSuggestedUniqueKey(payload.fields) || (useUrlKey ? 'url' : undefined),
    maxItems:
      typeof payload.maxItems === 'number' && payload.maxItems > 0
        ? payload.maxItems
        : undefined,
    autoScroll,
    pagination: mapPagination(payload.pagination),
    popups: payload.popups || { autoDismiss: true, acceptDialogs: true },
    captcha: payload.captcha || { pauseOnDetect: true },
  };

  const defaultName = `Scout-X scrape (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`;

  const rowCtx = payload.rowContext;
  const serverRowContext = rowCtx
    ? {
        sectorIndustry: rowCtx.sectorIndustry ?? '',
        f500: rowCtx.f500 === true ? 'yes' : rowCtx.f500 === false ? 'no' : '',
      }
    : undefined;

  const companyName =
    typeof payload.companyName === 'string' ? payload.companyName.trim() : undefined;
  const tags = Array.isArray(payload.tags) ? payload.tags : undefined;

  const body: Record<string, unknown> = {
    name: (payload.automationName && String(payload.automationName).trim()) || defaultName,
    startUrl,
    webhookUrl: payload.webhookUrl || '',
    ...(companyName !== undefined ? { companyName } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(payload.scoutId ? { scoutId: String(payload.scoutId).trim().toUpperCase() } : {}),
    ...(payload.elementsOnly ? { elementsOnly: true } : {}),
    config: {
      listExtraction,
      previewRows: payload.previewRows || [],
      ...(payload.previewUrl ? { previewUrl: payload.previewUrl } : {}),
      ...(serverRowContext ? { rowContext: serverRowContext } : {}),
      ...(payload.schedule && !payload.elementsOnly ? { schedule: payload.schedule } : {}),
      ...(companyName !== undefined ? { companyName } : {}),
      ...(tags !== undefined ? { tags } : {}),
      ...(() => {
        if (hiringCafe) {
          return {
            aggregatorProvider: 'hiring_cafe',
            preferAtsCollection: false,
            enrichHiringCafeDetails: true,
          };
        }
        if (accelJobs) {
          return {
            aggregatorProvider: 'accel',
            preferAtsCollection: false,
            enrichAccelDetails: true,
            enrichHiringCafeDetails: false,
          };
        }
        if (sequoiaJobs) {
          return {
            aggregatorProvider: 'sequoia',
            preferAtsCollection: false,
            enrichSequoiaDetails: true,
            enrichHiringCafeDetails: false,
            enrichAccelDetails: false,
          };
        }
        if (capitalGJobs) {
          return {
            aggregatorProvider: 'capitalg',
            preferAtsCollection: false,
            enrichCapitalGDetails: true,
            enrichHiringCafeDetails: false,
            enrichAccelDetails: false,
          };
        }
        if (choppingBlockJobs) {
          return {
            aggregatorProvider: 'choppingblock',
            preferAtsCollection: false,
            enrichChoppingBlockDetails: true,
            enrichHiringCafeDetails: false,
          };
        }
        if (aidevboardJobs) {
          return {
            aggregatorProvider: 'aidevboard',
            preferAtsCollection: false,
            enrichAidevboardDetails: true,
            enrichHiringCafeDetails: false,
          };
        }
        if (startupsGalleryJobs) {
          return {
            aggregatorProvider: 'startups_gallery',
            preferAtsCollection: false,
            enrichHiringCafeDetails: false,
          };
        }
        if (linkedInJobs) {
          return {
            aggregatorProvider: 'linkedin',
            preferAtsCollection: false,
            enrichHiringCafeDetails: false,
          };
        }
        return {};
      })(),
    },
  };

  // If automationId provided, update existing
  if (payload.automationId) {
    const response = await fetch(`${apiBase}/automations/${payload.automationId}/config`, {
      method: 'PUT',
      credentials: 'include',
      headers: buildAuthHeaders(state),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throwBackendFailure(response.status, text, 'Save automation');
    }
    return response.json();
  }

  // Create new automation
  const response = await fetch(`${apiBase}/automations`, {
    method: 'POST',
    credentials: 'include',
    headers: buildAuthHeaders(state),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throwBackendFailure(response.status, text, 'Save automation');
  }
  return response.json();
}

export type AutomationLookupResult = {
  found: boolean;
  automation: {
    id: string;
    scoutId?: string | null;
    name?: string;
    targetUrl?: string;
    companyName?: string;
  } | null;
};

/** Exact URL or Scout-X ID lookup for duplicate / update flows. */
export async function lookupAutomation(params: {
  url?: string;
  scoutId?: string;
}): Promise<AutomationLookupResult> {
  const state = await getState();
  const apiBase = state.backendUrl.replace(/\/+$/, '');
  const qs = new URLSearchParams();
  if (params.scoutId) qs.set('scoutId', String(params.scoutId).trim().toUpperCase());
  else if (params.url) qs.set('url', params.url);
  else throw new Error('url or scoutId is required');

  const response = await fetch(`${apiBase}/automations/lookup?${qs.toString()}`, {
    method: 'GET',
    credentials: 'include',
    headers: buildAuthHeaders(state),
  });

  if (!response.ok) {
    const text = await response.text();
    throwBackendFailure(response.status, text, 'Lookup automation');
  }
  return response.json();
}

export class BackendApiError extends Error {
  status: number;
  code?: string;
  automation?: any;
  body?: any;

  constructor(message: string, opts: { status: number; code?: string; automation?: any; body?: any }) {
    super(message);
    this.name = 'BackendApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.automation = opts.automation;
    this.body = opts.body;
  }
}

function throwBackendFailure(status: number, text: string, action: string): never {
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  const msg =
    (parsed && typeof parsed.error === 'string' && parsed.error) ||
    formatBackendFailure(status, text, action);
  throw new BackendApiError(msg, {
    status,
    code: parsed?.code,
    automation: parsed?.automation,
    body: parsed,
  });
}

/**
 * Trigger a run on the backend.
 */
export async function triggerBackendRun(automationId: string): Promise<any> {
  const state = await getState();
  const apiBase = state.backendUrl.replace(/\/+$/, '');

  const response = await fetch(`${apiBase}/automations/${automationId}/run`, {
    method: 'POST',
    credentials: 'include',
    headers: buildAuthHeaders(state),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(formatBackendFailure(response.status, text, 'Run automation'));
  }
  return response.json();
}

/**
 * Save (or clear) a recurring schedule for an automation on the backend.
 * Calls PUT /automations/:id/schedule.
 */
export async function saveScheduleToBackend(
  automationId: string,
  schedule: { enabled: boolean; cron: string | null; timezone: string }
): Promise<any> {
  const state = await getState();
  const apiBase = state.backendUrl.replace(/\/+$/, '');

  const response = await fetch(`${apiBase}/automations/${automationId}/schedule`, {
    method: 'PUT',
    credentials: 'include',
    headers: buildAuthHeaders(state),
    body: JSON.stringify(schedule),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(formatBackendFailure(response.status, text, 'Save schedule'));
  }
  return response.json();
}


/**
 * Fetch an automation's full server-side record (including schedule.nextRunAt,
 * status, and latest run info).
 */
export async function getAutomationStatus(automationId: string): Promise<any> {
  const state = await getState();
  const apiBase = state.backendUrl.replace(/\/+$/, '');

  const response = await fetch(`${apiBase}/automations/${automationId}`, {
    credentials: 'include',
    headers: buildAuthHeaders(state),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(formatBackendFailure(response.status, text, 'Get automation'));
  }
  return response.json();
}

/**
 * Get run status from backend.
 */
export async function getRunStatus(runId: string): Promise<any> {
  const state = await getState();
  const apiBase = state.backendUrl.replace(/\/+$/, '');

  const response = await fetch(`${apiBase}/runs/${runId}`, {
    credentials: 'include',
    headers: buildAuthHeaders(state),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(formatBackendFailure(response.status, text, 'Get run'));
  }
  return response.json();
}

// ── Helpers ──

function parseBackendErrorBody(text: string): string {
  try {
    const j = JSON.parse(text);
    if (j?.error && typeof j.error === 'string') return j.error;
    if (j?.message && typeof j.message === 'string') return j.message;
  } catch {
    /* raw message */
  }
  return text || '';
}

/** User-visible message; adds auth hints for common extension failures. */
function formatBackendFailure(status: number, bodyText: string, context: string): string {
  const parsed = parseBackendErrorBody(bodyText).trim();
  const base = parsed || `${context} failed (HTTP ${status})`;
  if (status === 401) {
    return (
      `${base}. Add your API key: extension ⚙ → API key (from Dashboard → API key). ` +
      `API base URL must end with /api (e.g. http://localhost:8080/api). ` +
      `Logging into the web app alone does not authenticate the extension.`
    );
  }
  if (status === 403 && /invalid api key/i.test(parsed)) {
    return `${base}. Create or copy a new key on the dashboard and update extension settings.`;
  }
  return base;
}

function getSuggestedUniqueKey(
  fields: Record<string, { selector: string; attribute: string; fallbackSelectors?: string[]; semanticType?: string; label?: string }>
): string {
  for (const field of Object.values(fields)) {
    if (field.semanticType === 'url' && field.attribute === 'href') return 'url';
  }
  if (fields.url) return 'url';
  if (fields.link) return 'link';
  if (fields.image) return 'image';
  if (fields.title) return 'title';
  return '';
}

function mapPagination(pagination?: {
  type: string;
  selector?: string | null;
  maxPages?: number;
  pageDelayMs?: number;
  pageParam?: string;
  startPage?: number;
  maxScrollSteps?: number;
  scrollSpinnerBudgetMs?: number;
  loadMoreWaitMs?: number;
}) {
  if (!pagination || !pagination.type) return { mode: 'none' };

  const selector = typeof pagination.selector === 'string' ? pagination.selector : '';
  const maxPages = pagination.maxPages || 10;
  const pageDelayMs = pagination.pageDelayMs || 1200;

  const scrollKnobs = {
    maxScrollSteps:
      typeof pagination.maxScrollSteps === 'number' && pagination.maxScrollSteps > 0
        ? pagination.maxScrollSteps
        : undefined,
    scrollSpinnerBudgetMs:
      typeof pagination.scrollSpinnerBudgetMs === 'number' && pagination.scrollSpinnerBudgetMs > 0
        ? pagination.scrollSpinnerBudgetMs
        : undefined,
    loadMoreWaitMs:
      typeof pagination.loadMoreWaitMs === 'number' && pagination.loadMoreWaitMs > 0
        ? pagination.loadMoreWaitMs
        : undefined,
  };

  switch (pagination.type) {
    case 'clickNext':
    case 'clickLoadMore':
      return {
        mode: 'next-button',
        nextButtonSelector: selector,
        maxPages,
        pageDelayMs,
        ...scrollKnobs,
      };
    case 'scrollDown':
    case 'scrollUp':
      return {
        mode: 'infinite-scroll',
        maxPages,
        pageDelayMs,
        ...scrollKnobs,
      };
    case 'pageNumber':
      return {
        mode: 'page-number-loop',
        pageParam: pagination.pageParam || 'page',
        startPage: pagination.startPage ?? 1,
        maxPages,
        pageDelayMs,
        ...scrollKnobs,
      };
    default:
      return { mode: 'none' };
  }
}
