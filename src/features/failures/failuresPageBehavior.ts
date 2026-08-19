import { DESKTOP_BREAKPOINT_PX } from '../../components/dashboard/appShellBehavior';
import { FIRSTSTEP, tint, hiddenScrollbarSx } from '../../components/dashboard/ops/dashboardTokens';
import type { OpsMetricsWindow } from '../../api/automation';

export type FailureTimeWindow = OpsMetricsWindow | 'all';

export type FailuresContentState =
  | 'first-load-skeleton'
  | 'load-error'
  | 'account-empty'
  | 'filtered-empty'
  | 'rows';

export type FailureMutationAction = 'retry' | 'update-reason';
export type PendingActions = Record<string, true>;
export type RowActionErrors = Record<string, string>;
export type FilterLayout = 'one-column' | 'two-row' | 'one-row';
export type FailuresSurface = 'hero' | 'reason-summary' | 'filters' | 'data-workspace';
export type DangerAccentSurface =
  | 'hero'
  | 'page-background'
  | 'terminal-count'
  | 'row-status'
  | 'retry-confirm';
export type LabelledSelectName = 'status' | 'reason' | 'anomaly' | 'window';
export type ReasonSummaryLayout = 'two-column' | 'wrap';

export const SOCKET_INVALIDATE_DEBOUNCE_MS = 400;

export const HERO_OVERLINE = 'Run reliability';
export const HERO_TITLE = 'Failures';
export const HERO_REFRESH_VARIANT = 'outlined' as const;
export const FAILURES_HAS_DESTRUCTIVE_PRIMARY_CTA = false;

export const FAILURE_WINDOWS: FailureTimeWindow[] = ['15m', '30m', '1h', '3h', '6h', '24h', 'all'];

export const DEFAULT_FAILURE_STATUS_FILTER = 'failed,dead,aborted';

export const FAILURE_REASON_OPTIONS: { code: string; label: string }[] = [
  { code: 'layout_change', label: 'Layout change' },
  { code: 'captcha', label: 'CAPTCHA' },
  { code: 'browser_closed', label: 'Browser closed' },
  { code: 'navigation_error', label: 'Navigation' },
  { code: 'timeout', label: 'Timeout' },
  { code: 'circuit_open', label: 'Host circuit' },
  { code: 'unknown', label: 'Unknown' },
];

export const REASON_SUMMARY_ITEMS: { code: string; label: string }[] = [
  { code: '', label: 'All' },
  ...FAILURE_REASON_OPTIONS,
];

export const FAILURES_TABLE_CAPTION =
  'Failed and dead runs with status, reason, error, anomaly, timing, and attempts';

export const DESKTOP_TABLE_COLUMNS = [
  'automation',
  'status',
  'reason',
  'error',
  'anomaly',
  'timing',
  'attempts',
  'actions',
] as const;

export const FILTER_CONTROL_ORDER = ['search', 'status', 'reason', 'anomaly'] as const;

export const FILTER_CONTROL_IDS = {
  search: 'failures-filter-search',
  status: 'failures-filter-status',
  reason: 'failures-filter-reason',
  anomaly: 'failures-filter-anomaly',
  window: 'failures-window-select',
  clearAll: 'failures-filter-clear-all',
} as const;

export const FILTER_LABEL_IDS = {
  status: 'failures-filter-status-label',
  reason: 'failures-filter-reason-label',
  anomaly: 'failures-filter-anomaly-label',
  window: 'failures-window-label',
} as const;

export const ERROR_SUMMARY_LINE_CLAMP = 2;

export const MOBILE_CARD_HEADER_FIELDS = ['automation', 'status'] as const;
export const MOBILE_CARD_BODY_SECTIONS = ['reason-error', 'timing-attempts'] as const;
export const MOBILE_CARD_FOOTER_ACTIONS = ['details', 'retry'] as const;

export const RETRY_CONFIRM_TITLE = 'Retry this run?';
export const RETRY_CONFIRM_BODY =
  'Retry creates a new run from the current automation configuration. It does not replay the original runtime state.';
export const RETRY_CONFIRM_LABEL = 'Retry';

export const CARD_RESTING_SHADOW_LIGHT = '0 1px 2px rgba(2, 51, 69, 0.04)';
export const CARD_RESTING_SHADOW_DARK = 'none';

export const DESKTOP_CONTROL_MIN_HEIGHT_PX = 40;
export const MOBILE_CONTROL_MIN_HEIGHT_PX = 44;

export const DESKTOP_TABLE_HEADER_BG = FIRSTSTEP.surfaceAlt;
export const DESKTOP_TABLE_SIZE = 'medium' as const;
export const DESKTOP_TABLE_ROW_MIN_HEIGHT_PX = 56;
export const DESKTOP_TABLE_ROW_MAX_HEIGHT_PX = 64;
export const DESKTOP_TABLE_ROW_HEIGHT_PX = 60;
export const DESKTOP_TABLE_STATUS_MARKER_PX = 4;
export const DESKTOP_TABLE_ROW_HOVER_BG = tint(FIRSTSTEP.teal, 0.08);

const LABELLED_SELECTS: Record<LabelledSelectName, { id: string; labelId: string; label: string }> = {
  status: {
    id: FILTER_CONTROL_IDS.status,
    labelId: FILTER_LABEL_IDS.status,
    label: 'Status',
  },
  reason: {
    id: FILTER_CONTROL_IDS.reason,
    labelId: FILTER_LABEL_IDS.reason,
    label: 'Failure reason',
  },
  anomaly: {
    id: FILTER_CONTROL_IDS.anomaly,
    labelId: FILTER_LABEL_IDS.anomaly,
    label: 'Anomaly',
  },
  window: {
    id: FILTER_CONTROL_IDS.window,
    labelId: FILTER_LABEL_IDS.window,
    label: 'Window',
  },
};

export function labelledSelectContract(name: LabelledSelectName) {
  return LABELLED_SELECTS[name];
}

export function failureReasonLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return FAILURE_REASON_OPTIONS.find((option) => option.code === code)?.label || code;
}

export function normalizeReasonCounts(counts: Record<string, number> | undefined): {
  all: number;
  byCode: Record<string, number>;
} {
  const byCode: Record<string, number> = {};
  let all = 0;
  for (const option of FAILURE_REASON_OPTIONS) {
    const value = Number(counts?.[option.code]) || 0;
    byCode[option.code] = value;
    all += value;
  }
  return { all, byCode };
}

export function pendingActionKey(runId: string, action: FailureMutationAction): string {
  return `${runId}:${action}`;
}

export function canSubmitAction(
  pending: PendingActions,
  runId: string,
  action: FailureMutationAction,
): boolean {
  return !pending[pendingActionKey(runId, action)];
}

export function attemptMutation(
  pending: PendingActions,
  runId: string,
  action: FailureMutationAction,
): { accepted: false; reason: 'already-pending' } | { accepted: true; pending: PendingActions } {
  if (!canSubmitAction(pending, runId, action)) {
    return { accepted: false, reason: 'already-pending' };
  }
  return {
    accepted: true,
    pending: { ...pending, [pendingActionKey(runId, action)]: true },
  };
}

export function releaseMutation(
  pending: PendingActions,
  runId: string,
  action: FailureMutationAction,
): PendingActions {
  const next = { ...pending };
  delete next[pendingActionKey(runId, action)];
  return next;
}

export function beginRetryAttempt(
  pending: PendingActions,
  runId: string,
  createKey: () => string,
):
  | { accepted: false; reason: 'already-pending' }
  | { accepted: true; pending: PendingActions; idempotencyKey: string } {
  const attempt = attemptMutation(pending, runId, 'retry');
  if (!attempt.accepted) return attempt;
  return {
    accepted: true,
    pending: attempt.pending,
    idempotencyKey: createKey(),
  };
}

export function clampPage(page: number, total: number, rowsPerPage: number): number {
  if (total <= 0) return 0;
  const maxPage = Math.max(0, Math.ceil(total / (rowsPerPage || 1)) - 1);
  return Math.min(Math.max(0, page), maxPage);
}

export function applyFilterChange<T>(
  setFilter: (value: T) => void,
  setPage: (page: number) => void,
  value: T,
): void {
  setFilter(value);
  setPage(0);
}

export function resolveFailuresContentState(input: {
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  hasLoadedData: boolean;
  rowCount: number;
  hasActiveFilters: boolean;
}): FailuresContentState {
  if (!input.hasLoadedData && input.isError) return 'load-error';
  if (!input.hasLoadedData) return 'first-load-skeleton';
  if (input.rowCount > 0) return 'rows';
  if (input.hasActiveFilters) return 'filtered-empty';
  return 'account-empty';
}

export function shouldShowBackgroundRefreshBar(input: {
  isFetching: boolean;
  isLoading: boolean;
  hasLoadedData: boolean;
}): boolean {
  return input.isFetching && input.hasLoadedData;
}

export function workspaceAriaBusy(isFetching: boolean): boolean {
  return isFetching;
}

export function hasActiveFilters(input: {
  q: string;
  status: string;
  reason: string;
  anomaly: string;
}): boolean {
  return Boolean(
    input.q.trim()
    || (input.status && input.status !== DEFAULT_FAILURE_STATUS_FILTER)
    || input.reason
    || input.anomaly,
  );
}

export type ActiveFilterPill = {
  key: string;
  kind: 'q' | 'status' | 'reason' | 'anomaly';
  label: string;
};

export function activeFilterPills(input: {
  q: string;
  status: string;
  statusLabel?: string;
  reason: string;
  reasonLabel?: string;
  anomaly: string;
  anomalyLabel?: string;
}): ActiveFilterPill[] {
  const pills: ActiveFilterPill[] = [];
  if (input.q.trim()) {
    pills.push({ key: 'q', kind: 'q', label: `Search: ${input.q.trim()}` });
  }
  if (input.status && input.status !== DEFAULT_FAILURE_STATUS_FILTER) {
    pills.push({
      key: 'status',
      kind: 'status',
      label: `Status: ${input.statusLabel || input.status}`,
    });
  }
  if (input.reason) {
    pills.push({
      key: 'reason',
      kind: 'reason',
      label: `Reason: ${input.reasonLabel || failureReasonLabel(input.reason)}`,
    });
  }
  if (input.anomaly) {
    pills.push({
      key: 'anomaly',
      kind: 'anomaly',
      label: `Anomaly: ${input.anomalyLabel || input.anomaly}`,
    });
  }
  return pills;
}

export function failuresLiveRegionMessage(input: {
  contentState: FailuresContentState;
  resultCount: number;
  isFetching: boolean;
}): string {
  switch (input.contentState) {
    case 'first-load-skeleton':
      return 'Loading failed runs';
    case 'load-error':
      return 'Failed to load failed runs. Retry available.';
    case 'account-empty':
      return 'No failed runs in this window';
    case 'filtered-empty':
      return 'No failed runs match the current filters';
    case 'rows': {
      const noun = input.resultCount === 1 ? 'failed run' : 'failed runs';
      return input.isFetching
        ? `Updating ${input.resultCount} ${noun}`
        : `Showing ${input.resultCount} ${noun}`;
    }
  }
}

export function reasonSelectId(runId: string): string {
  return `failure-reason-${runId}`;
}

export function reasonSelectLabelId(runId: string): string {
  return `${reasonSelectId(runId)}-label`;
}

export function reasonSelectAriaLabel(automationName: string, runId: string): string {
  return `Failure reason for ${automationName} (${runId})`;
}

export function detailsActionAriaLabel(name: string): string {
  return `Details for ${name}`;
}

export function retryActionAriaLabel(name: string): string {
  return `Retry ${name}`;
}

export function rowStatusLabel(status: string): string {
  if (status === 'failed') return 'Failed';
  if (status === 'dead') return 'Dead';
  if (status === 'aborted') return 'Aborted';
  return status;
}

export function failureWindowSelectLabel(window: FailureTimeWindow): string {
  if (window === 'all') return 'All';
  return `Last ${window}`;
}

export function parseFailureDashboardSearch(search: string | URLSearchParams): {
  timeWindow: FailureTimeWindow;
  from?: string;
  to?: string;
} {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const windowRaw = String(params.get('window') || '').trim().toLowerCase();
  const timeWindow = (FAILURE_WINDOWS as string[]).includes(windowRaw)
    ? (windowRaw as FailureTimeWindow)
    : '1h';
  const from = params.get('from')?.trim() || '';
  const to = params.get('to')?.trim() || '';
  if (from && to) {
    return { timeWindow, from, to };
  }
  return { timeWindow };
}

export function windowStatusPillLabel(count: number, window: FailureTimeWindow): string {
  const noun = count === 1 ? 'failure' : 'failures';
  if (window === 'all') return `${count} ${noun} · all time`;
  return `${count} ${noun} · last ${window}`;
}

export function resultCountLabel(count: number): string {
  return `${count} result${count === 1 ? '' : 's'}`;
}

export function shouldUseMobileCardList(viewportWidth: number): boolean {
  return viewportWidth < DESKTOP_BREAKPOINT_PX;
}

export function filterLayoutForWidth(viewportWidth: number): FilterLayout {
  if (viewportWidth < 600) return 'one-column';
  if (viewportWidth < 1200) return 'two-row';
  return 'one-row';
}

export function reasonSummaryLayoutForWidth(viewportWidth: number): ReasonSummaryLayout {
  if (viewportWidth < 600) return 'two-column';
  return 'wrap';
}

export function shouldFadeUp(surface: FailuresSurface): boolean {
  return surface === 'hero' || surface === 'reason-summary';
}

export function shouldLiftOnHover(surface: FailuresSurface): boolean {
  return surface === 'reason-summary';
}

export function workspaceNoLiftHover(mode: 'light' | 'dark'): {
  transform: 'none';
  boxShadow: string;
} {
  return {
    transform: 'none',
    boxShadow: mode === 'dark' ? CARD_RESTING_SHADOW_DARK : CARD_RESTING_SHADOW_LIGHT,
  };
}

export const workspaceNoLiftHoverSx = {
  '&:hover': {
    transform: 'none' as const,
    boxShadow: (theme: { palette: { mode: string } }) =>
      workspaceNoLiftHover(theme.palette.mode === 'dark' ? 'dark' : 'light').boxShadow,
  },
};

export function controlMinHeight(isMobile: boolean): number {
  return isMobile ? MOBILE_CONTROL_MIN_HEIGHT_PX : DESKTOP_CONTROL_MIN_HEIGHT_PX;
}

export function filterControlSx(isMobile: boolean) {
  return {
    '& .MuiInputBase-root': { minHeight: controlMinHeight(isMobile) },
  };
}

export function paginationControlSx(isMobile: boolean) {
  const minHeight = controlMinHeight(isMobile);
  return {
    '& .MuiTablePagination-toolbar': { minHeight },
    '& .MuiIconButton-root': { minHeight, minWidth: minHeight },
    '& .MuiInputBase-root': { minHeight },
  };
}

export function failuresTableScrollSx() {
  return {
    flex: 'none',
    minWidth: 0,
    width: '100%',
    maxWidth: '100%',
    overflowX: 'auto',
    overflowY: 'visible',
    ...hiddenScrollbarSx,
  };
}

export function statusMarkerColor(status: string): string {
  if (status === 'failed' || status === 'dead' || status === 'aborted') return FIRSTSTEP.danger;
  return FIRSTSTEP.border;
}

export function isDangerAccentAllowed(surface: DangerAccentSurface): boolean {
  return surface === 'terminal-count' || surface === 'row-status' || surface === 'retry-confirm';
}

export function parseRetryConflict(error: unknown): {
  isConflict: boolean;
  activeRunId: string | null;
  message: string;
  href: string | null;
} {
  const err = error as {
    response?: {
      status?: number;
      data?: {
        code?: string;
        error?: string;
        activeRunId?: string;
        runId?: string;
        activeRun?: { runId?: string };
      };
    };
  };
  const data = err?.response?.data;
  const isConflict =
    err?.response?.status === 409
    && (data?.code === 'AUTOMATION_RUN_ACTIVE' || /active run/i.test(String(data?.error || '')));
  if (!isConflict) {
    return {
      isConflict: false,
      activeRunId: null,
      message: data?.error || 'Failed to retry run',
      href: null,
    };
  }
  const activeRunId = data?.activeRunId || data?.activeRun?.runId || data?.runId || null;
  return {
    isConflict: true,
    activeRunId,
    href: activeRunId ? `/run/${activeRunId}` : null,
    message: activeRunId
      ? `This automation already has an active run (${activeRunId}). Open it before retrying.`
      : 'This automation already has an active run. Open the active run before retrying.',
  };
}

export function retrySuccessHref(runId: string): string {
  return `/run/${runId}`;
}

export function retrySuccessMessage(
  result: {
    runId: string;
    retryOfRunId?: string;
    originalRunId?: string;
    retrySequence?: number;
    previouslyAccepted?: boolean;
  },
  automationName?: string,
): string {
  const name = automationName || 'automation';
  const accepted = result.previouslyAccepted ? ' already accepted' : ' queued';
  const lineage = result.retryOfRunId
    ? ` Retry ${result.retrySequence ?? 1} of ${result.retryOfRunId}.`
    : '';
  return `Retry${accepted} for ${name}: ${result.runId}.${lineage}`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms > 48 * 60 * 60 * 1000) return '—';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/** Prefer ISO display; for legacy locale strings, pick the reading closest to anchor. */
export function formatRunWhen(value?: string | null, anchor?: string | null): string {
  if (!value) return '—';
  const raw = String(value).trim();
  if (!raw) return '—';

  const candidates = new Set<number>();
  const add = (ms: number) => {
    if (!Number.isNaN(ms)) candidates.add(ms);
  };
  add(Date.parse(raw));
  add(new Date(raw).getTime());
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})([\s,].*)?$/i);
  if (slash && slash[1] !== slash[2]) {
    const swapped = `${slash[2]}/${slash[1]}/${slash[3]}${slash[4] || ''}`;
    add(Date.parse(swapped));
    add(new Date(swapped).getTime());
  }
  if (!candidates.size) return raw;

  const anchorMs = anchor ? Date.parse(String(anchor)) : NaN;
  let best: number | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const ms of candidates) {
    if (!Number.isNaN(anchorMs)) {
      if (ms < anchorMs) continue;
      const delta = ms - anchorMs;
      if (delta > 48 * 60 * 60 * 1000) continue;
      if (delta < bestDelta) {
        bestDelta = delta;
        best = ms;
      }
    } else if (best == null) {
      best = ms;
    }
  }
  if (best == null) best = [...candidates][0];
  return new Date(best).toLocaleString();
}

export function anomalyLabel(anomaly: string | null | undefined, meta?: { escalated?: boolean }): string | null {
  if (!anomaly) return null;
  if (anomaly === 'zero_rows') return 'Zero rows';
  if (anomaly === 'row_drop') {
    return meta?.escalated ? 'Row drop (escalated)' : 'Row drop';
  }
  return anomaly;
}

export function attemptsLabel(retryCount: number | null | undefined): string {
  const retries = retryCount ?? 0;
  const attempts = retries + 1;
  return `${attempts} ${attempts === 1 ? 'attempt' : 'attempts'}`;
}

export function runDisplayName(run: { name?: string | null }): string {
  return run.name?.trim() || 'Run';
}

export function runIdentity(run: { runId?: string; _id?: string }): string {
  return String(run.runId || run._id || '');
}
