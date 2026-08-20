export type HiringCafeSearchSummary = {
  headline: string;
  chips: string[];
  host: string;
};

const PRIORITY_KEYS: Array<{ keys: string[]; label?: string }> = [
  { keys: ['searchQuery', 'search', 'query', 'keywords', 'q', 'jobTitle', 'title'] },
  { keys: ['departments', 'department', 'roles', 'role', 'jobTitles'] },
  { keys: ['locations', 'location', 'countries', 'country', 'states', 'state'] },
  { keys: ['workplaceTypes', 'workplace_types', 'workplace', 'workType', 'remote'] },
  { keys: ['datePosted', 'date_posted', 'postedWithin', 'recency', 'timeRange'] },
  { keys: ['sort', 'sortBy', 'sort_by', 'order'] },
  { keys: ['experience', 'seniority', 'commitment', 'employmentType'] },
];

function asText(value: unknown): string {
  if (value == null || value === '') return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    return value.map(asText).filter(Boolean).slice(0, 4).join(', ');
  }
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    const named =
      asText(rec.name) ||
      asText(rec.label) ||
      asText(rec.formatted) ||
      asText(rec.displayName) ||
      asText(rec.city) ||
      asText(rec.country) ||
      asText(rec.state);
    if (named) return named;
  }
  return '';
}

function pickFirst(state: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    if (!(key in state)) continue;
    const text = asText(state[key]);
    if (text) return text;
  }
  return '';
}

export function parseHiringCafeSearchState(url: string): Record<string, unknown> | null {
  try {
    const parsed = new URL(url);
    const raw = parsed.searchParams.get('searchState') || parsed.searchParams.get('state');
    if (!raw) return null;
    const decoded = decodeURIComponent(raw.replace(/\+/g, ' '));
    const json = JSON.parse(decoded);
    return json && typeof json === 'object' && !Array.isArray(json) ? json : null;
  } catch {
    return null;
  }
}

export function summarizeHiringCafeUrl(url: string): HiringCafeSearchSummary {
  let host = 'hiring.cafe';
  try {
    host = new URL(url).hostname.replace(/^www\./, '') || host;
  } catch {
    /* keep default */
  }

  const state = parseHiringCafeSearchState(url);
  const chips: string[] = [];
  if (state) {
    for (const group of PRIORITY_KEYS) {
      const value = pickFirst(state, group.keys);
      if (value && !chips.includes(value)) chips.push(value);
      if (chips.length >= 5) break;
    }
  }

  const headline = chips[0] || 'Hiring Cafe search';
  const rest = chips.slice(1);
  return {
    headline,
    chips: rest,
    host,
  };
}

export function listExtractionCap(config?: {
  listExtraction?: { maxItems?: unknown; pagination?: { maxPages?: unknown } };
}): { label: string; maxItems: number | null } {
  const maxItems = config?.listExtraction?.maxItems;
  if (typeof maxItems === 'number' && maxItems > 0) {
    return { label: `Cap ${maxItems}`, maxItems };
  }
  const maxPages = config?.listExtraction?.pagination?.maxPages;
  if (typeof maxPages === 'number' && maxPages > 0) {
    return { label: `${maxPages} page${maxPages === 1 ? '' : 's'}`, maxItems: null };
  }
  return { label: 'No cap', maxItems: null };
}

export function mappedFieldCount(config?: { listExtraction?: { fields?: unknown } }): number {
  const fields = config?.listExtraction?.fields;
  if (!fields || typeof fields !== 'object') return 0;
  return Object.keys(fields as Record<string, unknown>).length;
}

export type AggregatorOverview = {
  searchCount: number;
  scheduledCount: number;
  rowsLastRun: number;
  jobsOnBoard: number;
  workingCount: number;
  failedCount: number;
  healthyCount: number;
};

export function aggregatorOverview(
  searches: Array<{
    status?: string;
    rowsExtracted?: number;
    jobsAddedToBoard?: number;
    schedule?: { enabled?: boolean; cron?: string | null } | null;
  }>
): AggregatorOverview {
  let scheduledCount = 0;
  let rowsLastRun = 0;
  let jobsOnBoard = 0;
  let workingCount = 0;
  let failedCount = 0;
  let healthyCount = 0;
  for (const row of searches) {
    if (row.schedule?.enabled && row.schedule.cron) scheduledCount += 1;
    rowsLastRun += Number(row.rowsExtracted) || 0;
    jobsOnBoard += Number(row.jobsAddedToBoard) || 0;
    const status = String(row.status || '');
    if (status === 'running' || status === 'queued' || status === 'pending') workingCount += 1;
    else if (status === 'failed' || status === 'dead') failedCount += 1;
    else if ((status === 'completed' || status === 'success') && (Number(row.rowsExtracted) || 0) > 0) {
      healthyCount += 1;
    }
  }
  return {
    searchCount: searches.length,
    scheduledCount,
    rowsLastRun,
    jobsOnBoard,
    workingCount,
    failedCount,
    healthyCount,
  };
}

export function aggregatorHealthLabel(status: string, rowsExtracted: number): string {
  switch (status) {
    case 'running':
    case 'queued':
    case 'pending':
      return 'Working now';
    case 'completed':
    case 'success':
      return rowsExtracted > 0 ? 'Healthy' : 'Ran · 0 jobs';
    case 'failed':
    case 'dead':
      return 'Failed';
    case 'idle':
    case '':
      return 'Not run yet';
    default:
      return status;
  }
}
