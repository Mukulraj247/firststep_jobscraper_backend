import { FIRSTSTEP, RADIUS, tint } from '../../components/dashboard/ops/dashboardTokens';
import { formatRunJobAddedAt } from '../jobs/jobBoardPageBehavior';
import {
  DESKTOP_TABLE_HEADER_BG,
  DESKTOP_TABLE_ROW_DIVIDER,
  DESKTOP_TABLE_ROW_HOVER_BG,
} from './automationsPageBehavior';

export const DATA_COLUMN_LABELS: Record<string, string> = {
  sectorIndustry: 'Sector / industry',
  f500: 'F500',
  jobId: 'Job ID',
  jobUrl: 'URL',
  applyUrl: 'Apply URL',
  aggregatorPostingUrl: 'Aggregator URL',
  job_url: 'URL',
  jobTitle: 'Title',
  job_title: 'Title',
  companyName: 'Company',
  location: 'Location',
  date: 'Posted',
};

export const URLISH_COLUMNS = new Set([
  'jobUrl',
  'job_url',
  'applicationUrl',
  'application_url',
  'applyUrl',
  'aggregatorPostingUrl',
  'url',
  'link',
]);

const TITLE_COLUMNS = new Set(['jobTitle', 'job_title', 'title', 'name']);

export function dataColumnLabel(column: string): string {
  if (DATA_COLUMN_LABELS[column]) return DATA_COLUMN_LABELS[column];
  const spaced = column.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  if (!spaced) return column;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function formatSourceLabel(source: string): string {
  return String(source || '').replace(/^scrapeList:/i, '').trim() || source;
}

export function isUrlishColumn(column: string): boolean {
  return URLISH_COLUMNS.has(column);
}

export function isTitleColumn(column: string): boolean {
  return TITLE_COLUMNS.has(column);
}

export function dataColumnMinWidthPx(column: string): number {
  if (isTitleColumn(column)) return 280;
  if (isUrlishColumn(column)) return 88;
  if (column === 'date' || column === 'datePosted' || column === 'posted') return 220;
  if (column === 'f500' || column === 'jobId') return 96;
  return 160;
}

export type ExtractedCellDisplay = {
  text: string;
  href?: string;
  title: string;
  kind: 'url' | 'f500' | 'text';
};

export function formatExtractedCellDisplay(
  column: string,
  value: unknown,
): ExtractedCellDisplay {
  if (value == null || value === '') {
    return { text: '', title: '', kind: 'text' };
  }
  if (column === 'f500') {
    const raw = String(value).trim().toLowerCase();
    if (raw === 'yes' || raw === 'true') return { text: 'Yes', title: 'Fortune 500: Yes', kind: 'f500' };
    if (raw === 'no' || raw === 'false') return { text: 'No', title: 'Fortune 500: No', kind: 'f500' };
  }
  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    return {
      text: json.length > 80 ? `${json.slice(0, 77)}…` : json,
      title: json,
      kind: 'text',
    };
  }
  const raw = String(value);
  if (isUrlishColumn(column) || /^https?:\/\//i.test(raw)) {
    return {
      text: 'Open',
      href: /^https?:\/\//i.test(raw) ? raw : undefined,
      title: raw,
      kind: 'url',
    };
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const formatted = formatRunJobAddedAt(raw);
    if (formatted) return { text: formatted, title: raw, kind: 'text' };
  }
  if (!isTitleColumn(column) && raw.length > 100) {
    return { text: `${raw.slice(0, 97)}…`, title: raw, kind: 'text' };
  }
  return { text: raw, title: raw, kind: 'text' };
}

export function extractedDataDialogPaperSx() {
  return {
    borderRadius: { xs: 0, md: RADIUS.panel },
    height: { xs: '100%', md: '88vh' },
    maxHeight: { xs: '100%', md: '88vh' },
    maxWidth: 1320,
    width: { xs: '100%', md: 'calc(100% - 48px)' },
    m: { xs: 0, md: 3 },
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
    bgcolor: FIRSTSTEP.white,
    boxShadow: `0 28px 80px ${tint(FIRSTSTEP.navyInk, 0.28)}`,
  };
}

export function extractedDataDialogBackdropSx() {
  return {
    bgcolor: 'rgba(0, 29, 41, 0.55)',
    backdropFilter: 'blur(10px)',
  };
}

export function extractedDataTableHeaderCellSx() {
  return {
    bgcolor: DESKTOP_TABLE_HEADER_BG,
    top: 0,
    zIndex: 2,
    fontSize: '0.75rem',
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
    color: FIRSTSTEP.textMuted,
    whiteSpace: 'nowrap' as const,
    py: 1.25,
    px: 1.5,
    borderBottom: `1px solid ${DESKTOP_TABLE_ROW_DIVIDER}`,
  };
}

export function extractedDataTableScrollSx() {
  return {
    flex: 1,
    minHeight: 0,
    overflowX: 'scroll' as const,
    overflowY: 'auto' as const,
    scrollbarGutter: 'stable',
    scrollbarWidth: 'auto' as const,
    msOverflowStyle: 'auto' as const,
    '&::-webkit-scrollbar': {
      display: 'block',
      width: 12,
      height: 12,
    },
    '&::-webkit-scrollbar-track': {
      bgcolor: FIRSTSTEP.surfaceAlt,
    },
    '&::-webkit-scrollbar-thumb': {
      bgcolor: tint(FIRSTSTEP.teal, 0.65),
      borderRadius: 8,
      border: `2px solid ${FIRSTSTEP.surfaceAlt}`,
    },
  };
}

export function extractedDataTableMinWidthPx(dataColumnCount: number): number {
  return 460 + dataColumnCount * 180;
}

export function extractedDataTableRowHoverSx() {
  return {
    '&:hover': { bgcolor: DESKTOP_TABLE_ROW_HOVER_BG },
    '& td': { borderBottom: `1px solid ${DESKTOP_TABLE_ROW_DIVIDER}` },
  };
}

/** Key columns shown first on Run Details (aggregator / job list rows). */
export const RUN_DETAIL_KEY_COLUMNS = [
  'jobTitle',
  'job_title',
  'companyName',
  'company',
  'location',
  'jobUrl',
  'job_url',
  'applyUrl',
  'aggregatorPostingUrl',
  'date',
  'datePosted',
  'posted',
  'salaryRange',
  'employmentType',
  'remoteType',
  'jobCategory',
  'seniorityLevel',
  'sectorIndustry',
  'f500',
] as const;

const RUN_DETAIL_KEY_SET = new Set<string>(RUN_DETAIL_KEY_COLUMNS);

export function columnHasValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return String(value).length > 0;
}

/** Build ordered column list from run row payloads. */
export function buildRunDetailColumns(
  rows: Array<{ data?: Record<string, unknown> }>,
  opts?: { keyColumnsOnly?: boolean }
): string[] {
  const keySet = new Set<string>();
  rows.forEach((row) => {
    Object.keys(row.data || {}).forEach((k) => keySet.add(k));
  });
  const keys = Array.from(keySet);
  const priority = RUN_DETAIL_KEY_COLUMNS.filter((k) => keySet.has(k));
  const rest = keys
    .filter((k) => !RUN_DETAIL_KEY_SET.has(k))
    .sort((a, b) => a.localeCompare(b));
  let ordered = [...priority, ...rest];
  if (opts?.keyColumnsOnly) {
    ordered = ordered.filter((k) => RUN_DETAIL_KEY_SET.has(k));
  }
  return ordered.filter((column) =>
    rows.some((row) => columnHasValue(row.data?.[column]))
  );
}
