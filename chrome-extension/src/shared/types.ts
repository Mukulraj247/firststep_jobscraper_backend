// ── Extension State ──

export interface ExtensionState {
  activeTool: ToolType;
  activeTabId: number | null;
  /** Base URL for Maxun API, e.g. https://app.example.com/api or http://localhost:8080/api */
  backendUrl: string;
  /** Optional; preferred for Chrome extension (avoids cookie issues). From Dashboard → API key. */
  apiKey: string;
  list: ListExtractionState;
  table: TableExtractionState;
  text: TextExtractionState;
}

export type ToolType = 'none' | 'list' | 'table' | 'text';

// ── List Extraction ──

export type ListPhase =
  | 'idle'
  | 'selecting'
  | 'configuring'
  | 'previewing'
  | 'extracting'
  | 'complete';

/** Draft for recurring cloud runs; persisted with list state until sent or synced from server. */
export interface CloudScheduleDraft {
  enabled: boolean;
  cron: string | null;
  timezone: string;
}

export function defaultCloudScheduleDraft(): CloudScheduleDraft {
  return {
    enabled: false,
    cron: null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  };
}

/** Shape expected under `config.schedule` on POST/PUT automations. */
export function configScheduleFromDraft(draft: CloudScheduleDraft): {
  enabled: boolean;
  cron: string | null;
  timezone: string;
} {
  const tz = (draft.timezone && draft.timezone.trim()) || 'UTC';
  const cronTrim = draft.cron?.trim() || null;
  const enabled = !!cronTrim && draft.enabled;
  return {
    enabled,
    cron: enabled ? cronTrim : null,
    timezone: tz,
  };
}

/** Build a draft from GET /automations schedule (dashboard shape). */
export function cloudScheduleDraftFromApiSchedule(s: any | null | undefined): CloudScheduleDraft | null {
  if (!s || typeof s !== 'object') return null;
  const cron =
    typeof s.cron === 'string' && s.cron.trim()
      ? s.cron.trim()
      : null;
  const tz = typeof s.timezone === 'string' && s.timezone.trim() ? s.timezone.trim() : 'UTC';
  const paused = !!s.paused;
  const enabledOnServer = !!s.enabled && !paused;
  if (!cron && !paused && !enabledOnServer) {
    return { enabled: false, cron: null, timezone: tz };
  }
  return {
    enabled: !!(cron && enabledOnServer),
    cron: paused ? null : cron,
    timezone: tz,
  };
}

export interface ListExtractionState {
  phase: ListPhase;
  listSelector: string;
  listXPath: string;
  itemCount: number;
  fields: Record<string, FieldConfig>;
  pagination: PaginationConfig;
  previewRows: ExtractedRow[];
  extractedRows: ExtractedRow[];
  currentPage: number;
  maxPages: number;
  /** Human-readable progress message during multi-page extraction. */
  progressMessage?: string;
  /** Auto-scroll: number of scroll steps performed so far. */
  scrollSteps?: number;
  /** Auto-scroll: true once end-of-page has been detected (no new items / no height growth). */
  scrollEndReached?: boolean;
  /** Auto-scroll: true while the page's loading indicator is visible. */
  scrollLoading?: boolean;
  /** Persisted automation metadata so subsequent saves update instead of duplicating. */
  savedAutomation?: SavedAutomationInfo;
  /** Optional recurring schedule applied on next Send to Scout-X (and editable in settings). */
  cloudScheduleDraft: CloudScheduleDraft;
  /** Per-automation metadata fields (not extracted from DOM). */
  rowContext: RowContextDraft;
}

export interface RowContextDraft {
  sectorIndustry: string;
  f500: boolean;
}

export interface SavedAutomationInfo {
  id: string;
  name?: string;
  /** Latest run status surfaced from the backend (completed/failed/running/queued/...). */
  lastRunStatus?: string | null;
  /** Latest run finishedAt/startedAt string. */
  lastRunTime?: string | null;
  /** Scheduled next run ISO string. */
  nextRunAt?: string | null;
  /** Whether a recurring schedule is enabled. */
  scheduleEnabled?: boolean;
  /** True when cron exists but Agenda triggers are paused. */
  schedulePaused?: boolean;
  /** Currently saved cron expression (if any). */
  cron?: string | null;
  /** Schedule timezone. */
  timezone?: string | null;
  /** Last-sync timestamp for this status snapshot. */
  fetchedAt?: string;
}

export interface FieldConfig {
  selector: string;
  attribute: string;
  label: string;
  semanticType: SemanticType;
  tag?: string;
  isShadow?: boolean;
  /** If true, this field is extracted from Schema.org JSON-LD structured data, not DOM */
  fromSchema?: boolean;
  /** For schema fields: the schema.org property name (e.g. "baseSalary", "hiringOrganization") */
  schemaField?: string;
}

export type SemanticType =
  | 'title'
  | 'company'
  | 'description'
  | 'price'
  | 'date'
  | 'location'
  | 'url'
  | 'image'
  | 'rating'
  | 'category'
  | 'unknown'
  | 'companyUrl'
  | 'employmentType'
  | 'qualifications'
  | 'responsibilities'
  | 'skills'
  | 'benefits'
  | 'experience'
  | 'education'
  | 'industry'
  | 'remote'
  | 'currency';

export interface PaginationConfig {
  type: '' | 'clickNext' | 'clickLoadMore' | 'scrollDown' | 'scrollUp' | 'pageNumber';
  selector: string | null;
  confidence: 'high' | 'medium' | 'low';
  maxPages: number;
  pageDelayMs: number;
  /** For page-number-loop mode: URL param name, e.g. "page" */
  pageParam?: string;
  /** For page-number-loop mode: starting page number, default 1 */
  startPage?: number;
}

export type ExtractedRow = Record<string, string>;

// ── Table Extraction ──

export type TablePhase = 'idle' | 'detecting' | 'selecting' | 'extracting' | 'complete';

export interface DetectedTable {
  index: number;
  selector: string;
  headers: string[];
  rowCount: number;
  previewRows: string[][];
}

export interface TableExtractionState {
  phase: TablePhase;
  detectedTables: DetectedTable[];
  selectedTableIndex: number | null;
  headers: string[];
  rows: string[][];
}

// ── Text Extraction ──

export type TextPhase = 'idle' | 'extracting' | 'complete';
export type TextFormat = 'plain' | 'markdown';

export interface TextExtractionState {
  phase: TextPhase;
  content: string;
  format: TextFormat;
}

// ── Helpers ──

export function buildEmptyState(): ExtensionState {
  return {
    activeTool: 'none',
    activeTabId: null,
    backendUrl: 'http://174.138.34.210:8080/api',
    apiKey: '',
    list: {
      phase: 'idle',
      listSelector: '',
      listXPath: '',
      itemCount: 0,
      fields: {},
      pagination: {
        type: '',
        selector: null,
        confidence: 'low',
        maxPages: 10,
        pageDelayMs: 1200,
      },
      previewRows: [],
      extractedRows: [],
      currentPage: 0,
      maxPages: 10,
      cloudScheduleDraft: defaultCloudScheduleDraft(),
      rowContext: { sectorIndustry: '', f500: false },
    },
    table: {
      phase: 'idle',
      detectedTables: [],
      selectedTableIndex: null,
      headers: [],
      rows: [],
    },
    text: {
      phase: 'idle',
      content: '',
      format: 'plain',
    },
  };
}
