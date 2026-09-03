import { Page } from 'playwright-core';
import fetch from 'cross-fetch';
import logger from '../logger';
import ExtractedData from '../models/ExtractedData';
import {
  normalizeFailureReason,
  resolveFailureReason,
  FAILURE_REASON_LABELS,
} from '../utils/failureReason';
import Robot, { IRobot } from '../models/Robot';
import Run, { IRun } from '../models/Run';
import { ListExtractionConfig } from './listExtractor';
import { dispatchAutomationDestinations } from './destinations';
import {
  applyLegacyJobAliases,
  buildCanonicalViewFromStoredData,
  finalizeRowsWithCanonicalData,
  hasCanonicalExtractedShape,
} from './canonicalJobRecord';
import { fixGoogleCareersJobsUrl } from '../utils/googleCareersUrl';
import {
  isCareersJobDetailUrl,
  isGenericJobTitle,
  isKnownPhenomCareersHost,
} from './jobPageParser';
import {
  isHiringCafeUrl,
  isAccelUrl,
  isAccelJobPostingUrl,
  isConsiderBoardUrl,
  isConsiderJobPostingUrl,
  isChoppingBlockUrl,
  isChoppingBlockJobPostingUrl,
  isAidevboardUrl,
  isAidevboardJobPostingUrl,
  isStartupsGalleryUrl,
  shouldEnrichStartupsGalleryDetails,
} from './aggregatorIdentity';
import { isHiringCafeJobPostingUrl } from './hiringCafeDetail';
import { normalizeStartupsGalleryListRow } from './startupsGalleryDetail';
import { toPublicRunDto } from './automationConfigView';

export interface AutomationRuntimeConfig {
  schedule?: {
    enabled?: boolean;
    cron?: string;
    timezone?: string;
  };
  performance?: {
    useBrowserReusePool?: boolean;
    maxPagesPerBrowser?: number;
    blockResources?: boolean;
  };
  destinations?: {
    webhook?: {
      enabled?: boolean;
      url?: string;
      retryAttempts?: number;
      retryDelaySeconds?: number;
      timeoutSeconds?: number;
    };
    googleSheets?: {
      enabled?: boolean;
      spreadsheetId?: string;
      sheetName?: string;
    };
    airtable?: {
      enabled?: boolean;
      apiKey?: string;
      baseId?: string;
      tableName?: string;
    };
    database?: {
      enabled?: boolean;
      type?: 'postgres' | 'mysql';
      connectionString?: string;
      tableName?: string;
    };
  };
  browserLocation?: {
    proxyServer?: string;
    proxyUsername?: string;
    proxyPassword?: string;
    proxyPool?: string[];
    /** When true, future runs may attach last-resort proxy from attempt 0. */
    needsProxy?: boolean;
    needsProxyAt?: string;
  };
  /** Hiring Cafe only — Scrape.do for posting detail when HTTP/proxy fail. */
  hiringCafeEnrichment?: {
    scrapeDoEnabled?: boolean;
    scrapeDoToken?: string;
    scrapeDoMaxTier?: 1 | 2 | 3;
    /** Set true on save to wipe stored Scrape.do token. */
    clearScrapeDo?: boolean;
  };
  userAgent?: string;
  userAgentPool?: string[];
  headless?: boolean;
  useStealth?: boolean;
  reuseSession?: boolean;
  locale?: string;
  cookies?: Array<Record<string, any>>;
  localStorage?: Record<string, string>;
  dataCleanup?: {
    removeEmptyRows?: boolean;
    removeDuplicates?: boolean;
  };
  pagination?: {
    mode?: 'none' | 'auto-scroll' | 'selector' | 'page-number-loop';
    autoScroll?: boolean;
    nextButtonSelector?: string;
    pageParam?: string;
    startPage?: number;
    /** Cap on inner scroll-step loop (parity with extension auto-scroll). */
    maxScrollSteps?: number;
    /** Budget for `waitForLoadingToFinish` between scroll steps. */
    scrollSpinnerBudgetMs?: number;
    /** How long to wait for a click-next / load-more to actually re-render. */
    loadMoreWaitMs?: number;
  };
  /**
   * Pop-up / dialog handling knobs. Mirrors the Chrome extension's behaviour:
   *   - autoDismiss (default: true)   → click visible accept/close buttons.
   *   - acceptDialogs (default: false)→ accept alert/confirm/prompt dialogs
   *     instead of dismissing them.
   */
  popups?: {
    autoDismiss?: boolean;
    acceptDialogs?: boolean;
  };
  /**
   * CAPTCHA handling. Currently: detect + pause the run (no third-party
   * solver). A `captcha:required` socket event is emitted for the UI.
   */
  captcha?: {
    pauseOnDetect?: boolean;
  };
  listExtraction?: ListExtractionConfig;
  screenshots?: {
    enabled?: boolean;
  };
  webhookUrl?: string;
  /**
   * Per-automation column overrides applied at insert time and on read.
   * Keyed by the original column name produced by the recording. Each entry
   * may rename the key (`rename`), blank its value (`clear`), or drop the
   * field entirely (`omit`). `clear` and `omit` must not both be true.
   */
  columnOverrides?: Record<string, ColumnOverride>;
  /**
   * Allowed target attribute names for the Edit columns UI (dropdown mapping).
   * Set in Scraper Configuration — not auto-read from an external database.
   */
  databaseTargetColumns?: string[];
  /**
   * Optional labels copied onto every extracted row (healthcare vs banking, Fortune 500, etc.).
   * Persisted with new runs; omitted keys read back as empty strings.
   */
  rowContext?: RowContextFields;
}

/** Stored under `saasConfig.rowContext`; merged into each row after column overrides. */
export interface RowContextFields {
  sectorIndustry?: string;
  /** Empty string when unset; stored as lowercase `yes` / `no`. */
  f500?: '' | 'yes' | 'no';
}

export const ROW_CONTEXT_KEYS = ['sectorIndustry', 'f500'] as const;

/** Normalize config for merging; output suitable for Mongo `rowContext`. */
export const sanitizeRowContextFields = (input: unknown): RowContextFields => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { sectorIndustry: '', f500: '' };
  }
  const raw = input as Record<string, unknown>;
  const sector =
    typeof raw.sectorIndustry === 'string' ? raw.sectorIndustry.trim().slice(0, 500) : '';
  const fRaw = raw.f500;
  let f500: '' | 'yes' | 'no' = '';
  if (fRaw === true || fRaw === 'yes' || fRaw === 'Yes') f500 = 'yes';
  else if (fRaw === false || fRaw === 'no' || fRaw === 'No') f500 = 'no';
  else if (typeof fRaw === 'string') {
    const low = fRaw.trim().toLowerCase();
    if (low === 'yes') f500 = 'yes';
    else if (low === 'no') f500 = 'no';
  }
  return { sectorIndustry: sector, f500 };
};

/**
 * Adds sector / industry and F500 onto row data (after overrides). Always sets both keys;
 * uses empty strings when unset so exports and UI stay consistent.
 */
export const mergeRowContextIntoRowData = (
  data: Record<string, any>,
  rowContext?: RowContextFields | null
): Record<string, any> => {
  const normalized = sanitizeRowContextFields(rowContext ?? {});
  const f500Display =
    normalized.f500 === 'yes' ? 'Yes' : normalized.f500 === 'no' ? 'No' : '';
  return {
    ...data,
    sectorIndustry: normalized.sectorIndustry,
    f500: f500Display,
  };
};

/** Single column override entry stored in `saasConfig.columnOverrides`. */
export interface ColumnOverride {
  /** Display + storage name to use in place of the original column. */
  rename?: string;
  /** When true the column is kept but its value is written as an empty string. */
  clear?: boolean;
  /**
   * When true the field is omitted from stored rows, exports, and destinations.
   * If `rename` is also set (e.g. after a prior rename), both the original key
   * and that name are stripped so legacy rows stay consistent.
   */
  omit?: boolean;
}

type SerializableOutput = Record<string, any> | null | undefined;

interface ExtractedRow {
  source: string;
  data: Record<string, any>;
}

const isPlainObject = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Deep key-sorted clone for stable duplicate fingerprints (order-independent). */
const sortObject = (value: any): any => {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }

  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, any>>((acc, key) => {
        acc[key] = sortObject(value[key]);
        return acc;
      }, {});
  }

  return value;
};

/** Stable row fingerprint for SaaS removeDuplicates — preserves prior sortObject semantics. */
const fingerprintExtractedRow = (row: Record<string, any>): string =>
  JSON.stringify(sortObject(row));

const isMeaningfulValue = (value: any): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return true;
};

const isMeaningfulRow = (row: Record<string, any>): boolean =>
  Object.values(row).some((value) => isMeaningfulValue(value));

const coerceRow = (value: any): Record<string, any> => {
  if (isPlainObject(value)) {
    return value;
  }

  return { value };
};

const pushRows = (rows: ExtractedRow[], source: string, payload: any) => {
  if (Array.isArray(payload)) {
    payload.forEach((item) => rows.push({ source, data: coerceRow(item) }));
    return;
  }

  if (isPlainObject(payload)) {
    if (Array.isArray(payload.results)) {
      payload.results.forEach((item) => rows.push({ source, data: coerceRow(item) }));
      return;
    }

    const nestedValues = Object.values(payload);
    if (nestedValues.every((item) => Array.isArray(item))) {
      nestedValues.forEach((item) => pushRows(rows, source, item));
      return;
    }
  }

  rows.push({ source, data: coerceRow(payload) });
};

export const getAutomationConfig = (robot: any): AutomationRuntimeConfig => {
  const meta = robot?.recording_meta || {};
  const storedConfig = meta?.saasConfig;
  if (!storedConfig || typeof storedConfig !== 'object') {
    return {};
  }

  return storedConfig as AutomationRuntimeConfig;
};

export const extractRowsFromOutput = (
  serializableOutput: SerializableOutput,
  config?: AutomationRuntimeConfig
): ExtractedRow[] => {
  if (!serializableOutput || typeof serializableOutput !== 'object') {
    return [];
  }

  const rows: ExtractedRow[] = [];
  const typedBuckets = ['scrapeSchema', 'scrapeList', 'crawl'] as const;

  typedBuckets.forEach((bucket) => {
    const current = (serializableOutput as any)[bucket];
    if (!current || typeof current !== 'object') return;

    Object.entries(current).forEach(([name, payload]) => {
      pushRows(rows, `${bucket}:${name}`, payload);
    });
  });

  const search = (serializableOutput as any).search;
  if (search && typeof search === 'object') {
    Object.entries(search).forEach(([name, payload]) => {
      pushRows(rows, `search:${name}`, payload);
    });
  }

  let cleanedRows = rows;

  if (config?.dataCleanup?.removeEmptyRows) {
    cleanedRows = cleanedRows.filter((row) => isMeaningfulRow(row.data));
  }

  if (config?.dataCleanup?.removeDuplicates) {
    const seen = new Set<string>();
    cleanedRows = cleanedRows.filter((row) => {
      const fingerprint = fingerprintExtractedRow(row.data);
      if (seen.has(fingerprint)) return false;
      seen.add(fingerprint);
      return true;
    });
  }

  return cleanedRows;
};

export const countRowsFromOutput = (serializableOutput: SerializableOutput, config?: AutomationRuntimeConfig): number =>
  extractRowsFromOutput(serializableOutput, config).length;

export const buildDashboardStatus = (run?: any): 'pending' | 'completed' | 'failed' | 'dead' | 'queued' | 'running' | 'scheduled' | 'aborted' | 'aborting' | 'idle' => {
  if (!run) return 'idle';
  if (['pending', 'completed', 'success', 'failed', 'dead', 'queued', 'running', 'scheduled', 'aborted', 'aborting'].includes(run.status)) {
    if (run.status === 'success') return 'completed';
    return run.status;
  }
  return 'idle';
};

function getRobotCompanyName(robot?: any): string {
  const meta = robot?.recording_meta || {};
  const fromMeta = typeof meta.companyName === 'string' ? meta.companyName.trim() : '';
  if (fromMeta) return fromMeta;
  const fromSaas =
    typeof meta.saasConfig?.companyName === 'string' ? meta.saasConfig.companyName.trim() : '';
  return fromSaas || '';
}

function getRobotScoutId(robot?: any): string | null {
  const id = robot?.recording_meta?.scoutId;
  return typeof id === 'string' && id.trim() ? id.trim().toUpperCase() : null;
}

/**
 * Keys removed from row `data` when an override marks the column as omitted.
 * Includes the original scrape key and, if present, a previous rename target
 * so legacy persisted rows stay hidden after remove.
 */
export const collectOmitKeys = (overrides: Record<string, ColumnOverride>): Set<string> => {
  const omitKeys = new Set<string>();
  for (const [original, override] of Object.entries(overrides)) {
    if (!override?.omit) continue;
    omitKeys.add(original);
    const r = override.rename?.trim();
    if (r) omitKeys.add(r);
  }
  return omitKeys;
};

/**
 * Single source of truth for the column-override behaviour. Used at insert time
 * (so future runs persist with the renamed/cleared shape) and on read (so old
 * rows render consistently in View Data, Run Details, exports). Returns a new
 * object; never mutates the caller's `data`.
 */
export const applyColumnOverrides = (
  data: Record<string, any> | null | undefined,
  overrides?: Record<string, ColumnOverride>
): Record<string, any> => {
  if (!data || typeof data !== 'object') return {};
  if (!overrides || Object.keys(overrides).length === 0) {
    return { ...data };
  }

  const omitKeys = collectOmitKeys(overrides);

  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (omitKeys.has(key)) {
      continue;
    }
    const override = overrides[key];
    if (!override) {
      out[key] = value;
      continue;
    }
    if (override.omit) {
      continue;
    }
    const targetKey = (override.rename && override.rename.trim()) || key;
    out[targetKey] = override.clear ? '' : value;
  }
  return out;
};

/** City / country lines wrongly stored under companyName (e.g. SIA "Mumbai, Inde"). */
const LOCATION_LINE_IN_COMPANY_RE =
  /mumbai|bangalore|bengaluru|delhi|pune|chennai|hyderabad|kolkata|gurgaon|noida|inde\b|india\b/i;

function looksLikeJobTitleText(s: string): boolean {
  const t = s.trim();
  if (t.length < 6) return false;
  return /\b(engineer|analyst|manager|developer|specialist|supervisor|lead|devops|qa|architect|scientist|consultant|director|officer|administrator|designer|associate|experience)\b/i.test(
    t
  );
}

function looksLikeDepartmentTag(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 80) return false;
  if (/^ai\s*&\s*tech$/i.test(t)) return true;
  if (/^internal\s+role$/i.test(t)) return true;
  if (/^consulting$|^design$/i.test(t)) return true;
  return false;
}

/**
 * Heals common mis-mappings when list fields were saved under the wrong column names
 * (e.g. job title vs category vs location vs company). Safe for other sites: only moves
 * values when patterns strongly suggest a swap; drops obvious non-job URLs for sia-partners.com.
 */
export const normalizeMisalignedJobBoardRow = (data: Record<string, any>): Record<string, any> => {
  if (!data || typeof data !== 'object') return data;
  const rawCategory = String(data.jobCategory ?? '').trim();
  const rawTitle = String(data.jobTitle ?? '').trim();
  const rawDesc = String(data.jobDescription ?? '').trim();

  const out: Record<string, any> = { ...data };
  let cn = String(out.companyName ?? '').trim();
  let loc = String(out.location ?? '').trim();
  let jt = String(out.jobTitle ?? '').trim();
  let jc = String(out.jobCategory ?? '').trim();

  // 1) Full job title captured in location while title holds a department tag (or is short).
  if (loc && looksLikeJobTitleText(loc) && (!looksLikeJobTitleText(jt) || jt.length < loc.length)) {
    out.jobTitle = loc;
    out.location = '';
    jt = out.jobTitle;
    loc = '';
  }

  // 2) City / country line stored as company.
  if (cn && LOCATION_LINE_IN_COMPANY_RE.test(cn) && (!String(out.location ?? '').trim() || String(out.location) === cn)) {
    out.location = cn;
    out.companyName = '';
    cn = '';
  }

  // 3) Department tag in jobTitle, real title in jobCategory (typical SIA AI & Tech cards).
  if (
    jc &&
    jt &&
    jc.length > jt.length &&
    looksLikeJobTitleText(jc) &&
    (looksLikeDepartmentTag(jt) || !looksLikeJobTitleText(jt))
  ) {
    out.jobTitle = jc;
    out.jobCategory = jt;
    if (rawDesc && (rawDesc === rawCategory || rawDesc === rawTitle)) {
      out.jobDescription = out.jobTitle;
    }
  }

  // 4) Internal org labels stored as company (People, Global Administration).
  cn = String(out.companyName ?? '').trim();
  jc = String(out.jobCategory ?? '').trim();
  if (cn && /^(PEOPLE|GLOBAL ADMINISTRATION)$/i.test(cn) && !jc) {
    out.jobCategory = cn;
    out.companyName = '';
  }

  // 5) Employer name missing on SIA career postings — cards often omit it.
  const url = String(out.jobUrl ?? out.job_url ?? out.url ?? out.link ?? '');
  if (/sia-partners\.com/i.test(url) && /\/career\//i.test(url) && !String(out.companyName ?? '').trim()) {
    out.companyName = 'SIA Partners';
  }

  // 6) Google Careers: RFC3986 relative join turns `jobs/results/...` + page `/.../jobs/results` into `/jobs/jobs/results/` (404).
  for (const k of ['jobUrl', 'job_url', 'url', 'link', 'href'] as const) {
    const v = out[k];
    if (typeof v === 'string' && v.trim()) {
      const fixed = fixGoogleCareersJobsUrl(v.trim());
      if (fixed !== v) out[k] = fixed;
    }
  }

  // 7) Google Careers list rows often capture the nav label "Careers" as company (cloud list extraction).
  const jobUrlNorm = String(out.jobUrl ?? out.job_url ?? out.url ?? out.link ?? '').trim();
  if (/google\.com\/about\/careers/i.test(jobUrlNorm) && /^careers?$/i.test(String(out.companyName ?? '').trim())) {
    out.companyName = 'Google';
  }

  return out;
};

/**
 * View Data / run-details: merges overrides + row context; for legacy rows, projects the same canonical `data`
 * shape as persistence (without minting a new jobId when one already exists).
 */
export const applyReadPipelineToExtractedData = (
  rowData: Record<string, any> | null | undefined,
  createdAt: Date,
  columnOverrides?: Record<string, ColumnOverride>,
  rowContext?: RowContextFields | null
): Record<string, any> => {
  const raw = rowData && typeof rowData === 'object' ? rowData : {};
  const pipelineInput = hasCanonicalExtractedShape(raw) ? { ...raw } : applyLegacyJobAliases({ ...raw });
  const merged = mergeRowContextIntoRowData(
    applyColumnOverrides(normalizeMisalignedJobBoardRow(pipelineInput), columnOverrides),
    rowContext
  );
  if (hasCanonicalExtractedShape(raw)) {
    return merged;
  }
  return buildCanonicalViewFromStoredData(merged as Record<string, unknown>, {
    createdAt,
    jobId: typeof raw.jobId === 'string' ? raw.jobId : undefined,
  }) as Record<string, any>;
};

/**
 * Patterns identifying URLs that are clearly not job postings — cookie banners,
 * privacy/legal/terms pages, sitemaps, etc. List extractors sometimes match these
 * because they live in the same repeating DOM structure as real list items
 * (e.g. third-party cookie disclosure rows, footer link grids).
 */
const NON_JOB_URL_HOST_RE =
  /^(?:legal|privacy|policy|policies|safety|cookies?|consent|imprint|impressum|sitemap|gdpr|ccpa)\./i;
const NON_JOB_URL_PATH_RE =
  /\/(?:privacy(?:[-_]?policy)?|cookies?|cookie[-_]?policy|cookie[-_]?notice|cookie[-_]?settings|cookie[-_]?preferences|legal|terms(?:[-_]?of[-_]?(?:service|use))?|gdpr|ccpa|consent|safety|imprint|impressum|sitemap|accessibility|do[-_]?not[-_]?sell|opt[-_]?out)(?:\/|$|[?#])/i;

/** Pagination chrome captured by mistake (e.g. "Last page »", "Next", "Page 3 of 12"). */
const PAGINATION_TITLE_RE =
  /^(?:«+\s*)?(?:first|previous|prev|next|last)(?:\s+page)?(?:\s*»+)?$|^last\s+page\b|^page\s+\d+\s*(?:of\s*\d+)?$|^\d+\s*\/\s*\d+$|^«+$|^»+$/i;

/**
 * Cookie / consent banner labels frequently captured by list extractors when
 * the consent UI lives near or inside the page's main listing area.
 */
const COOKIE_BANNER_TITLE_RE =
  /^(?:learn more about (?:this|the) (?:provider|cookie|partner)|about (?:this|the) (?:provider|cookie|partner)|cookie\s*(?:policy|preferences|settings|notice|details?)|manage\s+(?:cookies?|preferences?|consent)|opt[-_ ]?out|accept(?:\s+(?:all|cookies?))?|reject\s+(?:all|cookies?)?|do not sell(?:\s+my(?:\s+personal)?\s+(?:info(?:rmation)?|data))?|view\s+(?:cookies?|preferences?)|show\s+(?:cookies?|preferences?))$/i;

/**
 * Cookie / localStorage / tracker identifier captured as a title — e.g.
 * `osano_consentmanager_tattles`, `loglevel`, `_ga_X12Y3Z4`, `JSESSIONID`,
 * `cf_clearance`, `amplitude_user_id`. These are single-token technical
 * identifiers, never job titles. Real job titles either have spaces, or are
 * Title Case (capital first letter + lowercase tail), or are short acronyms
 * like CFO/CEO/VP.
 *
 * Heuristic shape — single token (after stripping optional "[x2]"-style
 * suffix), AND one of:
 *  - contains an underscore (real job titles never do)
 *  - starts with a lowercase letter (real titles are Title Case)
 *  - all uppercase, 5+ chars (job acronyms like CFO/CEO/VP are <= 4 chars)
 */
const COOKIE_IDENT_BODY_RE = /^(?:[^\s]*_[^\s]*|[a-z][a-z0-9.]+|[A-Z][A-Z0-9_]{4,})$/;
const COOKIE_IDENT_SUFFIX_STRIP_RE = /\s*\[x?\d+\]\s*$/i;

const isCookieIdentTitle = (title: string): boolean => {
  const stripped = title.replace(COOKIE_IDENT_SUFFIX_STRIP_RE, '').trim();
  if (!stripped || /\s/.test(stripped)) return false;
  return COOKIE_IDENT_BODY_RE.test(stripped);
};

/**
 * Cookie / tracker purpose description sentence captured as title or description.
 * Three sub-patterns, each with low false-positive risk for real job titles:
 *
 *  1. `^used\s+(?:to|by|for)\s+\w` — "Used to/by/for X" is always a tracker description
 *     (not "Used Equipment Sales Manager", which has "Equipment" after "Used").
 *  2. `^verb\s+determiner` — 3rd-person-singular verb followed by a determiner /
 *     pronoun ("Tracks the user", "Registers which...", "Stores user's...").
 *  3. `^verb(?:\s+\S+){5,}` — 3rd-person-singular verb followed by 5+ more words
 *     (real job titles like "Records Manager" are short; cookie descriptions like
 *     "Maintains settings and outputs when using the Developer Tools Console" are long).
 */
const COOKIE_PURPOSE_USED_TO_RE = /^used\s+(?:to|by|for)\s+\w/i;
const COOKIE_PURPOSE_VERB_DETERMINER_RE =
  /^(?:registers?|maintains?|stores?|tracks?|saves?|loads?|allows?|enables?|provides?|determines?|contains?|holds?|identifies|detects?|handles?|sets?|updates?|records?|counts?|measures?|distinguishes?|collects?|preserves?)\s+(?:to|by|the|which|user|whether|if|a|an|in|for|on|with|via|when|that|user's|user\u2019s|browser|session|cookie|data|info|visit(?:or|ors)?)/i;
const COOKIE_PURPOSE_VERB_LONG_DESC_RE =
  /^(?:used|registers?|maintains?|stores?|tracks?|saves?|loads?|allows?|enables?|provides?|determines?|contains?|holds?|identifies|detects?|handles?|sets?|updates?|records?|counts?|measures?|distinguishes?|collects?|preserves?)(?:\s+\S+){5,}/i;

const isCookiePurposeSentence = (s: string): boolean =>
  COOKIE_PURPOSE_USED_TO_RE.test(s) ||
  COOKIE_PURPOSE_VERB_DETERMINER_RE.test(s) ||
  COOKIE_PURPOSE_VERB_LONG_DESC_RE.test(s);

/**
 * Cookie consent expiry labels captured as `companyName` (e.g. Osano's
 * "Pending", "Session", date strings). Used in combination with other signals.
 */
const COOKIE_EXPIRY_COMPANY_RE = /^(?:pending|session|persistent|1st party|3rd party|http(?:\s+only)?)$/i;

/** Drops rows that obviously aren't job postings (cookie banners, footer/legal links, pagination, etc.). */
export const shouldKeepExtractedJobRow = (data: Record<string, any>): boolean => {
  const url = String(data.jobUrl ?? data.job_url ?? data.url ?? data.link ?? '').trim();
  const title = String(data.jobTitle ?? data.title ?? data.name ?? data.job_title ?? '').trim();
  const description = String(
    data.jobDescription ?? data.description ?? data.summary ?? data.job_description ?? ''
  ).trim();
  const companyName = String(data.companyName ?? data.company ?? data.employer ?? data.company_name ?? '').trim();

  // Rows with neither URL nor title are unusable downstream.
  if (!url && !title) return false;

  // HC job postings survive weak Cloudflare titles ("hiringcafe.com") — real title
  // comes from the URL slug or a later detail enrich. Check before cookie-ident drop.
  if (url && isHiringCafeJobPostingUrl(url)) return true;

  // Cookie banner / pagination labels.
  if (title) {
    if (PAGINATION_TITLE_RE.test(title)) return false;
    if (COOKIE_BANNER_TITLE_RE.test(title)) return false;

    // Cookie identifier captured as a title (e.g. `osano_consentmanager_tattles`, `loglevel`, `_ga_X12Y3Z4`).
    if (isCookieIdentTitle(title)) return false;

    // Cookie purpose description sentence captured as a title.
    if (isCookiePurposeSentence(title)) return false;

    // Marketing / hub titles — keep only when URL is a real job detail (title recovered later).
    if (isGenericJobTitle(title) && !(url && isCareersJobDetailUrl(url))) return false;
  }

  // Description that's clearly a cookie purpose statement, combined with weak URL signal.
  if (description && isCookiePurposeSentence(description)) {
    // Strong signal: drop if URL is empty, or if companyName is a cookie expiry label.
    if (!url || COOKIE_EXPIRY_COMPANY_RE.test(companyName)) return false;
  }

  // Cookie expiry label captured as company name — almost always a cookie table row.
  if (companyName && COOKIE_EXPIRY_COMPANY_RE.test(companyName) && !url) return false;

  if (url) {
    // Parse leniently — many scraped URLs are absolute, some are protocol-relative or relative.
    let host = '';
    let pathAndQuery = '';
    try {
      const u = new URL(url, 'https://example.invalid');
      host = u.hostname;
      pathAndQuery = u.pathname + (u.search || '');
    } catch {
      pathAndQuery = url;
    }

    if (host && NON_JOB_URL_HOST_RE.test(host)) return false;
    if (pathAndQuery && NON_JOB_URL_PATH_RE.test(pathAndQuery)) return false;

    // SIA Partners-specific: /our-capabilities/ pages are service pages, not jobs.
    if (/sia-partners\.com/i.test(url) && /\/our-capabilities\//i.test(url)) return false;

    // Ford / Carrier / Toyota careers hosts: only keep real job-detail URLs.
    if (isKnownPhenomCareersHost(url) && !isCareersJobDetailUrl(url)) return false;

    // Aggregator search/index URLs are not job postings.
    // Note: HC job posting URLs already returned true at line ~636 (before cookie-ident drop).
    if (isHiringCafeUrl(url) && !isHiringCafeJobPostingUrl(url)) return false;
    if (isAccelUrl(url) && !isAccelJobPostingUrl(url)) return false;
    if (isConsiderBoardUrl(url) && !isConsiderJobPostingUrl(url)) return false;
    if (isChoppingBlockUrl(url) && !isChoppingBlockJobPostingUrl(url)) return false;
    if (isAidevboardUrl(url) && !isAidevboardJobPostingUrl(url)) return false;
    // startups.gallery list pages are not employer postings; keep outbound employer hrefs.
    if (isStartupsGalleryUrl(url)) return false;
  }

  return true;
};

export const persistExtractedDataForRun = async (run: IRun | any, robot: IRobot | any): Promise<ExtractedRow[]> => {
  const config = getAutomationConfig(robot);
  const extracted = extractRowsFromOutput(run.serializableOutput, config);

  // Transform once; both the persisted documents and the rows handed to
  // destinations (webhook / Sheets / Airtable / DB) get the override shape.
  const rows = extracted
    .map((row) => ({
      ...row,
      data: shouldEnrichStartupsGalleryDetails(robot)
        ? normalizeStartupsGalleryListRow(row.data)
        : row.data,
    }))
    .filter((row) => shouldKeepExtractedJobRow(row.data))
    .map((row) => ({
      source: row.source,
      data: mergeRowContextIntoRowData(
        applyColumnOverrides(
          normalizeMisalignedJobBoardRow(applyLegacyJobAliases({ ...row.data })),
          config.columnOverrides
        ),
        config.rowContext
      ),
    }));

  const createdAt = new Date();
  const canonicalRows = await finalizeRowsWithCanonicalData(rows, createdAt);

  await ExtractedData.deleteMany({ runId: run.runId });

  if (canonicalRows.length > 0) {
    const payload = canonicalRows.map((row) => ({
      runId: run.runId,
      robotMetaId: run.robotMetaId,
      source: row.source,
      data: row.data,
    }));

    const CHUNK_SIZE = 500;
    for (let index = 0; index < payload.length; index += CHUNK_SIZE) {
      await ExtractedData.insertMany(payload.slice(index, index + CHUNK_SIZE));
    }

    // Non-blocking board enrichment enqueue (dedup + completeness gate).
    try {
      const { enqueueJobBoardEnrichments } = await import('./jobBoardEnrichment');
      const { aggregatorSourceForRobot } = await import('./aggregatorIdentity');
      const ownerId = run.runByUserId ?? robot.userId;
      const boardStats = await enqueueJobBoardEnrichments({
        ownerId,
        robotMetaId: run.robotMetaId,
        runId: run.runId,
        rows: canonicalRows,
        source: aggregatorSourceForRobot(robot),
      });
      const jobsAddedToBoard =
        (Number(boardStats.queued) || 0) + (Number(boardStats.readyFromList) || 0);
      const jobsBoardConsidered = Number(boardStats.considered) || 0;
      const jobsBoardDeduped = Number(boardStats.skippedDedup) || 0;
      run.jobsAddedToBoard = jobsAddedToBoard;
      run.jobsBoardConsidered = jobsBoardConsidered;
      run.jobsBoardDeduped = jobsBoardDeduped;
      const RunModel = (await import('../models/Run')).default;
      await RunModel.updateOne(
        { runId: run.runId },
        {
          $set: {
            jobsAddedToBoard,
            jobsBoardConsidered,
            jobsBoardDeduped,
          },
        }
      );
    } catch (enrichErr: any) {
      logger.log(
        'warn',
        `Failed to enqueue job-board enrichments for run ${run.runId}: ${enrichErr?.message || enrichErr}`
      );
    }
  } else {
    run.jobsAddedToBoard = 0;
    run.jobsBoardConsidered = 0;
    run.jobsBoardDeduped = 0;
    try {
      const RunModel = (await import('../models/Run')).default;
      await RunModel.updateOne(
        { runId: run.runId },
        {
          $set: {
            jobsAddedToBoard: 0,
            jobsBoardConsidered: 0,
            jobsBoardDeduped: 0,
          },
        }
      );
    } catch {
      /* ignore */
    }
  }

  return canonicalRows;
};

export const dispatchAutomationWebhook = async (
  run: IRun | any,
  robot: IRobot | any,
  rows: ExtractedRow[]
): Promise<void> => {
  await dispatchAutomationDestinations(run, robot, rows);
};

/** Hard ceiling for displayed run duration (48h). Longer values are almost always bad timestamps. */
export const MAX_SANE_RUN_DURATION_MS = 48 * 60 * 60 * 1000;

/** Canonical timestamp for run startedAt / finishedAt (never toLocaleString). */
export const runTimestampNow = (): string => new Date().toISOString();

/** Only ISO 8601 timestamps are safe to compare in Mongo date aggregations. */
export const isCanonicalRunTimestamp = (value?: string | null): boolean =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.trim());

/**
 * Legacy writers used toLocaleString() which is ambiguous (11/8 = 11 Aug in en-IN, 8 Nov in en-US).
 * Return all plausible epoch-ms readings so duration can pick the sane one.
 */
export const parseRunTimestampCandidates = (value?: string | null): number[] => {
  if (value == null) return [];
  const raw = String(value).trim();
  if (!raw) return [];

  const candidates = new Set<number>();
  const add = (ms: number) => {
    if (!Number.isNaN(ms)) candidates.add(ms);
  };

  add(Date.parse(raw));
  add(new Date(raw).getTime());

  // Slash dates: also try day/month swapped (DMY ↔ MDY).
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})([\s,].*)?$/i);
  if (slash && slash[1] !== slash[2]) {
    const swapped = `${slash[2]}/${slash[1]}/${slash[3]}${slash[4] || ''}`;
    add(Date.parse(swapped));
    add(new Date(swapped).getTime());
  }

  return [...candidates];
};

export const computeRunDurationMs = (startedAt?: string, finishedAt?: string): number | null => {
  if (!startedAt || !finishedAt) return null;
  const starts = parseRunTimestampCandidates(startedAt);
  const ends = parseRunTimestampCandidates(finishedAt);
  if (!starts.length || !ends.length) return null;

  // Prefer the shortest non-negative duration under the sanity ceiling.
  // That rejects MDY "Nov 8" misreads of DMY "11 Aug" finishedAt (~2000h).
  let best: number | null = null;
  for (const start of starts) {
    for (const end of ends) {
      if (end < start) continue;
      const ms = end - start;
      if (ms > MAX_SANE_RUN_DURATION_MS) continue;
      if (best == null || ms < best) best = ms;
    }
  }
  return best;
};

/** Elapsed ms from startedAt to now, with the same locale-ambiguity + 48h guards. */
export const computeElapsedRunDurationMs = (startedAt?: string | null): number | null => {
  if (!startedAt) return null;
  return computeRunDurationMs(startedAt, runTimestampNow());
};

/**
 * Prefer finishedAt-startedAt; fall back to stored duration only when sane.
 * Never returns absurd multi-day values that show as "2000 hours" in the UI.
 */
export const resolveRunDurationMs = (
  run: { duration?: number | null; startedAt?: string | null; finishedAt?: string | null; status?: string } | null | undefined
): number | null => {
  if (!run) return null;
  const status = String(run.status || '').toLowerCase();
  if (status === 'running' || status === 'pending' || status === 'queued') {
    return null;
  }
  const fromTimestamps = computeRunDurationMs(run.startedAt || undefined, run.finishedAt || undefined);
  if (fromTimestamps != null) return fromTimestamps;
  const stored = typeof run.duration === 'number' ? run.duration : null;
  if (stored == null || !Number.isFinite(stored) || stored <= 0) return null;
  if (stored > MAX_SANE_RUN_DURATION_MS) return null;
  return Math.round(stored);
};

export const applyAutomationRuntimeConfig = async (page: Page, robot: any): Promise<void> => {
  const config = getAutomationConfig(robot);

  if (config.userAgent) {
    try {
      await page.setExtraHTTPHeaders({ 'User-Agent': config.userAgent });
      await page.addInitScript((userAgent) => {
        Object.defineProperty(navigator, 'userAgent', {
          get: () => userAgent,
          configurable: true,
        });
      }, config.userAgent);
    } catch (error: any) {
      logger.log('warn', `Failed to apply automation user agent: ${error.message}`);
    }
  }

  if (Array.isArray(config.cookies) && config.cookies.length > 0) {
    try {
      await page.context().addCookies(config.cookies as any);
    } catch (error: any) {
      logger.log('warn', `Failed to apply automation cookies: ${error.message}`);
    }
  }

  if (config.localStorage && typeof config.localStorage === 'object' && Object.keys(config.localStorage).length > 0) {
    try {
      await page.addInitScript((entries) => {
        Object.entries(entries).forEach(([key, value]) => {
          window.localStorage.setItem(key, String(value));
        });
      }, config.localStorage);
    } catch (error: any) {
      logger.log('warn', `Failed to apply automation localStorage: ${error.message}`);
    }
  }

  if (config.pagination?.autoScroll || config.pagination?.mode === 'auto-scroll') {
    try {
      await page.addInitScript(() => {
        window.addEventListener('load', () => {
          setTimeout(() => {
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
          }, 750);
        });
      });
    } catch (error: any) {
      logger.log('warn', `Failed to apply automation auto-scroll: ${error.message}`);
    }
  }
};

export const enrichRunForSaas = async (run: any, robot?: any) => {
  const config = robot ? getAutomationConfig(robot) : undefined;
  const extractedRowsCount = await ExtractedData.countDocuments({ runId: run.runId });
  const rowsExtracted =
    typeof run.rowsExtracted === 'number'
      ? run.rowsExtracted
      : extractedRowsCount || countRowsFromOutput(run.serializableOutput, config);
  const resolved = resolveFailureReason({
    failureReason: run.failureReason,
    failureReasonSource: run.failureReasonSource,
    errorMessage: run.errorMessage,
  });
  const normalizedFailureReason = normalizeFailureReason({
    normalizedFailureReason: run.normalizedFailureReason,
    failureReason: run.failureReason,
    failureReasonSource: run.failureReasonSource,
    errorMessage: run.errorMessage,
  });
  return toPublicRunDto({
    ...run,
    status: buildDashboardStatus(run),
    durationMs: resolveRunDurationMs(run),
    rowsExtracted,
    jobsAddedToBoard: typeof run.jobsAddedToBoard === 'number' ? run.jobsAddedToBoard : 0,
    jobsBoardConsidered: typeof run.jobsBoardConsidered === 'number' ? run.jobsBoardConsidered : 0,
    jobsBoardDeduped: typeof run.jobsBoardDeduped === 'number' ? run.jobsBoardDeduped : 0,
    anomaly: run.anomaly || null,
    anomalyMeta: run.anomalyMeta || null,
    scoutId: run.scoutId || null,
    normalizedFailureReason,
    failureReason: normalizedFailureReason,
    failureReasonSource: resolved.failureReasonSource,
    failureReasonLabel:
      normalizedFailureReason &&
      FAILURE_REASON_LABELS[normalizedFailureReason as keyof typeof FAILURE_REASON_LABELS]
        ? FAILURE_REASON_LABELS[normalizedFailureReason as keyof typeof FAILURE_REASON_LABELS]
        : normalizedFailureReason,
  }, robot, { detail: true });
};

/**
 * Lightweight list enrichment — no per-run DB count, no screenshots, strips bulky fields.
 * Pass `extractedCount` from a batched aggregation when available.
 */
export const enrichRunForList = (
  run: any,
  robot?: any,
  extractedCount: number = 0
) => {
  const {
    serializableOutput: _so,
    binaryOutput: _bo,
    log: _log,
    ...rest
  } = run || {};
  const durationMs = resolveRunDurationMs(run);
  const resolved = resolveFailureReason({
    failureReason: run?.failureReason,
    failureReasonSource: run?.failureReasonSource,
    errorMessage: run?.errorMessage,
  });
  const normalizedFailureReason = normalizeFailureReason({
    normalizedFailureReason: run?.normalizedFailureReason,
    failureReason: run?.failureReason,
    failureReasonSource: run?.failureReasonSource,
    errorMessage: run?.errorMessage,
  });
  return toPublicRunDto({
    ...rest,
    status: buildDashboardStatus(run),
    durationMs,
    duration: durationMs,
    rowsExtracted: typeof run?.rowsExtracted === 'number' ? run.rowsExtracted : extractedCount,
    jobsAddedToBoard: typeof run?.jobsAddedToBoard === 'number' ? run.jobsAddedToBoard : 0,
    jobsBoardConsidered: typeof run?.jobsBoardConsidered === 'number' ? run.jobsBoardConsidered : 0,
    jobsBoardDeduped: typeof run?.jobsBoardDeduped === 'number' ? run.jobsBoardDeduped : 0,
    anomaly: run?.anomaly || null,
    anomalyMeta: run?.anomalyMeta || null,
    normalizedFailureReason,
    failureReason: normalizedFailureReason,
    failureReasonSource: resolved.failureReasonSource,
    failureReasonLabel:
      normalizedFailureReason &&
      FAILURE_REASON_LABELS[normalizedFailureReason as keyof typeof FAILURE_REASON_LABELS]
        ? FAILURE_REASON_LABELS[normalizedFailureReason as keyof typeof FAILURE_REASON_LABELS]
        : normalizedFailureReason,
    errorMessage: run?.errorMessage || '',
    retryCount: typeof run?.retryCount === 'number' ? run.retryCount : 0,
    // Keep empty shells so older UI code that reads these keys does not crash.
    serializableOutput: {},
    binaryOutput: {},
    log: '',
    name: run?.name || robot?.recording_meta?.name || 'Run',
    companyName: getRobotCompanyName(robot),
    scoutId: getRobotScoutId(robot),
    automationId: run?.robotMetaId || robot?.recording_meta?.id || null,
  }, robot, { detail: false });
};

/** Batch ExtractedData counts for a page of runs (one aggregation). */
export async function batchExtractedRowCounts(runIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!runIds.length) return map;
  const rows = await ExtractedData.aggregate([
    { $match: { runId: { $in: runIds } } },
    { $group: { _id: '$runId', count: { $sum: 1 } } },
  ]);
  for (const row of rows) {
    if (row?._id) map.set(String(row._id), Number(row.count) || 0);
  }
  return map;
};
