import { DESKTOP_BREAKPOINT_PX } from '../../components/dashboard/appShellBehavior';
import { FIRSTSTEP, tint, hiddenScrollbarSx } from '../../components/dashboard/ops/dashboardTokens';

export type AutomationsContentState =
  | 'first-load-skeleton'
  | 'load-error'
  | 'account-empty'
  | 'filtered-empty'
  | 'rows';

export type AutomationMutationAction =
  | 'run'
  | 'delete'
  | 'pause-schedule'
  | 'resume-schedule';

export type PendingActions = Record<string, true>;
export type RowActionErrors = Record<string, string>;

export type FilterLayout = 'one-column' | 'two-row' | 'one-row';
export type ScheduleDisplayState = 'active' | 'paused' | 'manual';

export const SOCKET_INVALIDATE_DEBOUNCE_MS = 400;

export const AUTOMATIONS_TABLE_CAPTION =
  'Automations with name, Scout ID, company, tags, target URL, last run, rows, next run, schedule, and actions';

export const DESKTOP_TABLE_COLUMNS = [
  'name',
  'id',
  'company',
  'tags',
  'targetUrl',
  'lastRun',
  'rows',
  'nextRun',
  'schedule',
  'actions',
] as const;

export const DETAILS_PANEL_FIELDS = [] as const;

export const FILTER_CONTROL_ORDER = ['search', 'scout-id', 'schedule', 'tags'] as const;

export const SAFE_EXTERNAL_LINK_TARGET = '_blank' as const;
export const SAFE_EXTERNAL_LINK_REL = 'noopener noreferrer';

export const FILTER_CONTROL_IDS = {
  search: 'automations-filter-search',
  scoutId: 'automations-filter-scout-id',
  schedule: 'automations-filter-schedule',
  tagsToggle: 'automations-filter-tags-toggle',
  clearAll: 'automations-filter-clear-all',
} as const;

export type CreateAutomationFormInput = {
  name: string;
  companyName: string;
  startUrl: string;
  webhookUrl: string;
};

export const EMPTY_CREATE_AUTOMATION_FORM: CreateAutomationFormInput = {
  name: '',
  companyName: '',
  startUrl: '',
  webhookUrl: '',
};

function isPlausibleUrlHostname(hostname: string): boolean {
  if (!hostname) return false;
  if (hostname === 'localhost') return true;
  return hostname.includes('.');
}

export function normalizeCreateAutomationStartUrl(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    throw new Error('Start URL is required');
  }
  const collapsed = trimmed.replace(/^(https?:\/\/)+/i, (match) =>
    match.toLowerCase().startsWith('https://') ? 'https://' : 'http://',
  );
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(collapsed) ? collapsed : `https://${collapsed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('Enter a valid start URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Start URL must use http or https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Start URL must not contain credentials');
  }
  if (!parsed.hostname) {
    throw new Error('Enter a valid start URL');
  }
  if (!isPlausibleUrlHostname(parsed.hostname)) {
    throw new Error('Enter a valid start URL');
  }
  return parsed.toString();
}

function normalizeOptionalWebhookUrl(value: string): string | undefined {
  const trimmed = String(value || '').trim();
  if (!trimmed) return undefined;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Webhook URL must use http or https');
    }
    if (parsed.username || parsed.password) {
      throw new Error('Webhook URL must not contain credentials');
    }
    if (!parsed.hostname) {
      throw new Error('Enter a valid webhook URL');
    }
    if (!isPlausibleUrlHostname(parsed.hostname)) {
      throw new Error('Enter a valid webhook URL');
    }
    return parsed.toString();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Webhook')) throw error;
    throw new Error('Enter a valid webhook URL');
  }
}

export type CreateAutomationFieldErrors = Partial<Record<keyof CreateAutomationFormInput, string>>;

export function validateCreateAutomationForm(
  form: CreateAutomationFormInput,
): { ok: true } | { ok: false; fieldErrors: CreateAutomationFieldErrors; message: string } {
  const fieldErrors: CreateAutomationFieldErrors = {};

  if (!form.name.trim()) {
    fieldErrors.name = 'Name is required';
  }
  if (!form.companyName.trim()) {
    fieldErrors.companyName = 'Company name is required';
  }
  try {
    normalizeCreateAutomationStartUrl(form.startUrl);
  } catch (error) {
    fieldErrors.startUrl = error instanceof Error ? error.message : 'Enter a valid start URL';
  }
  try {
    normalizeOptionalWebhookUrl(form.webhookUrl);
  } catch (error) {
    fieldErrors.webhookUrl = error instanceof Error ? error.message : 'Enter a valid webhook URL';
  }

  if (Object.keys(fieldErrors).length === 0) {
    return { ok: true };
  }
  return {
    ok: false,
    fieldErrors,
    message: Object.values(fieldErrors)[0] || 'Fix the highlighted fields',
  };
}

export function canSubmitCreateAutomationForm(
  form: CreateAutomationFormInput,
  creating: boolean,
): boolean {
  if (creating) return false;
  return validateCreateAutomationForm(form).ok;
}

export function buildCreateAutomationRequest(
  form: CreateAutomationFormInput,
  tags: string[],
  config: Record<string, unknown>,
) {
  const validation = validateCreateAutomationForm(form);
  if (!validation.ok) {
    throw new Error(validation.message);
  }
  return {
    name: form.name.trim(),
    companyName: form.companyName.trim(),
    startUrl: normalizeCreateAutomationStartUrl(form.startUrl),
    webhookUrl: normalizeOptionalWebhookUrl(form.webhookUrl),
    tags,
    config,
  };
}

export function pendingActionKey(
  automationId: string,
  action: AutomationMutationAction,
): string {
  return `${automationId}:${action}`;
}

export function canSubmitAction(
  pending: PendingActions,
  automationId: string,
  action: AutomationMutationAction,
): boolean {
  return !pending[pendingActionKey(automationId, action)];
}

export function attemptMutation(
  pending: PendingActions,
  automationId: string,
  action: AutomationMutationAction,
): { accepted: false; reason: 'already-pending' } | { accepted: true; pending: PendingActions } {
  if (!canSubmitAction(pending, automationId, action)) {
    return { accepted: false, reason: 'already-pending' };
  }
  return {
    accepted: true,
    pending: { ...pending, [pendingActionKey(automationId, action)]: true },
  };
}

export function releaseMutation(
  pending: PendingActions,
  automationId: string,
  action: AutomationMutationAction,
): PendingActions {
  const next = { ...pending };
  delete next[pendingActionKey(automationId, action)];
  return next;
}

export function shouldShowRowRetry(
  errors: RowActionErrors,
  automationId: string,
  action: AutomationMutationAction,
): boolean {
  return Boolean(errors[pendingActionKey(automationId, action)]);
}

export function resolveAutomationsContentState(input: {
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  hasLoadedData: boolean;
  rowCount: number;
  hasActiveFilters: boolean;
}): AutomationsContentState {
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

export function applyFilterChange<T>(
  setFilter: (value: T) => void,
  setPage: (page: number) => void,
  value: T,
): void {
  setFilter(value);
  setPage(0);
}

export function hasActiveFilters(input: {
  q: string;
  id: string;
  schedule: string;
  tags: string[];
}): boolean {
  return Boolean(input.q.trim() || input.id.trim() || input.schedule || input.tags.length);
}

export type ActiveFilterPill = {
  key: string;
  kind: 'q' | 'id' | 'schedule' | 'tag';
  label: string;
  tag?: string;
};

export function activeFilterPills(input: {
  q: string;
  id: string;
  schedule: string;
  scheduleLabel?: string;
  tags: string[];
}): ActiveFilterPill[] {
  const pills: ActiveFilterPill[] = [];
  if (input.q.trim()) {
    pills.push({ key: 'q', kind: 'q', label: `Search: ${input.q.trim()}` });
  }
  if (input.id.trim()) {
    pills.push({ key: 'id', kind: 'id', label: `Scout ID: ${input.id.trim()}` });
  }
  if (input.schedule) {
    pills.push({
      key: 'schedule',
      kind: 'schedule',
      label: `Schedule: ${input.scheduleLabel || input.schedule}`,
    });
  }
  for (const tag of input.tags) {
    pills.push({ key: `tag:${tag}`, kind: 'tag', label: tag, tag });
  }
  return pills;
}

export function buildDeleteConfirmPayload(automation: { id: string; name: string }): {
  requiresConfirmation: true;
  automationId: string;
  automationName: string;
  title: string;
  confirmLabel: string;
} {
  return {
    requiresConfirmation: true,
    automationId: automation.id,
    automationName: automation.name,
    title: 'Delete automation?',
    confirmLabel: 'Delete everything',
  };
}

export function automationsLiveRegionMessage(input: {
  contentState: AutomationsContentState;
  resultCount: number;
  isFetching: boolean;
}): string {
  switch (input.contentState) {
    case 'first-load-skeleton':
      return 'Loading automations';
    case 'load-error':
      return 'Failed to load automations. Retry available.';
    case 'account-empty':
      return 'No automations yet';
    case 'filtered-empty':
      return 'No automations match the current filters';
    case 'rows': {
      const noun = input.resultCount === 1 ? 'automation' : 'automations';
      return input.isFetching
        ? `Updating ${input.resultCount} ${noun}`
        : `Showing ${input.resultCount} ${noun}`;
    }
  }
}

export function runActionAriaLabel(name: string): string {
  return `Run ${name}`;
}

export function overflowMenuAriaLabel(name: string): string {
  return `More actions for ${name}`;
}

export function namedActionAriaLabel(actionLabel: string, name: string): string {
  return `${actionLabel} ${name}`;
}

export function shouldUseMobileCardList(viewportWidth: number): boolean {
  return viewportWidth < DESKTOP_BREAKPOINT_PX;
}

export function filterLayoutForWidth(viewportWidth: number): FilterLayout {
  if (viewportWidth < 600) return 'one-column';
  if (viewportWidth < 1200) return 'two-row';
  return 'one-row';
}

export function latestRunHealthLabel(status: string): string {
  switch (status) {
    case 'completed':
    case 'success':
      return 'Latest run succeeded';
    case 'failed':
      return 'Latest run failed';
    case 'dead':
      return 'Latest run dead';
    case 'running':
      return 'Latest run running';
    case 'queued':
      return 'Latest run queued';
    case 'pending':
      return 'Latest run pending';
    case 'scheduled':
      return 'Latest run scheduled';
    case 'aborted':
      return 'Latest run aborted';
    case 'aborting':
      return 'Latest run aborting';
    case 'idle':
    case '':
      return 'No latest run';
    default:
      return `Latest run ${status}`;
  }
}

/** Compact status label for dense table cells. */
export function statusChipLabel(status: string): string {
  switch (status) {
    case 'completed':
    case 'success':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'dead':
      return 'dead';
    case 'running':
      return 'running';
    case 'queued':
      return 'queued';
    case 'pending':
      return 'pending';
    case 'scheduled':
      return 'scheduled';
    case 'aborted':
      return 'aborted';
    case 'aborting':
      return 'aborting';
    case 'idle':
    case '':
      return 'idle';
    default:
      return status || 'unknown';
  }
}

export function hasLatestRunFailure(status: string, failureReason?: string | null): boolean {
  return status === 'failed' || status === 'dead' || Boolean(failureReason);
}

export function scheduleDisplayState(
  schedule?: { enabled?: boolean; cron?: string } | null,
): ScheduleDisplayState {
  if (schedule?.enabled && schedule.cron) return 'active';
  if (schedule?.cron && !schedule.enabled) return 'paused';
  return 'manual';
}

export function formatUpdatedAgo(updatedAtMs: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - updatedAtMs);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function freshnessPillLabel(
  automationCount: number,
  updatedAtMs: number | null,
  nowMs: number,
): string {
  const noun = automationCount === 1 ? 'automation' : 'automations';
  const countPart = `${automationCount} ${noun}`;
  if (updatedAtMs == null) return countPart;
  return `${countPart} · updated ${formatUpdatedAgo(updatedAtMs, nowMs)}`;
}

export function formatLastRunActivity(lastRunTime: string | null | undefined): string {
  if (!lastRunTime) return 'Never';
  const parsed = new Date(lastRunTime);
  if (Number.isNaN(parsed.getTime())) return lastRunTime;
  return parsed.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function resultCountLabel(count: number): string {
  return `${count} result${count === 1 ? '' : 's'}`;
}

export type AutomationsSurface = 'hero' | 'kpi' | 'filters' | 'data-workspace';
export type RowRetryHandlerName = 'onRun' | 'onPauseSchedule' | 'onResumeSchedule' | 'onDelete';

export const FAILABLE_ROW_ACTIONS: readonly AutomationMutationAction[] = [
  'run',
  'pause-schedule',
  'resume-schedule',
  'delete',
];

export const CARD_RESTING_SHADOW_LIGHT = '0 1px 2px rgba(2, 51, 69, 0.04)';
export const CARD_RESTING_SHADOW_DARK = 'none';

export const DESKTOP_CONTROL_MIN_HEIGHT_PX = 40;
export const MOBILE_CONTROL_MIN_HEIGHT_PX = 44;

export const DESKTOP_TABLE_HEADER_BG = FIRSTSTEP.surfaceAlt;
export const DESKTOP_TABLE_SIZE = 'medium' as const;
export const DESKTOP_TABLE_ROW_MIN_HEIGHT_PX = 52;
export const DESKTOP_TABLE_ROW_MAX_HEIGHT_PX = 60;
export const DESKTOP_TABLE_ROW_HEIGHT_PX = 56;
export const DESKTOP_TABLE_MIN_WIDTH_PX = 980;
export const DESKTOP_TABLE_ROW_DIVIDER = 'rgba(2, 51, 69, 0.08)';
export const DESKTOP_TABLE_STATUS_MARKER_PX = 4;
export const DESKTOP_TABLE_ROW_HOVER_BG = tint(FIRSTSTEP.teal, 0.08);

export const MOBILE_CARD_HEADER_FIELDS = ['name', 'status'] as const;
export const MOBILE_CARD_BODY_LAYOUT = 'two-column-definition-list' as const;
export const MOBILE_CARD_FOOTER_ACTIONS = ['run', 'overflow'] as const;

const RETRY_ACTION_LABELS: Record<AutomationMutationAction, string> = {
  run: 'Retry run',
  'pause-schedule': 'Retry pause schedule',
  'resume-schedule': 'Retry resume schedule',
  delete: 'Retry delete',
};

export function failedRowActions(
  errors: RowActionErrors,
  automationId: string,
): AutomationMutationAction[] {
  return FAILABLE_ROW_ACTIONS.filter((action) => shouldShowRowRetry(errors, automationId, action));
}

export function retryActionAriaLabel(action: AutomationMutationAction, name: string): string {
  return namedActionAriaLabel(RETRY_ACTION_LABELS[action], name);
}

export function rowRetryHandlerName(action: AutomationMutationAction): RowRetryHandlerName {
  switch (action) {
    case 'run':
      return 'onRun';
    case 'pause-schedule':
      return 'onPauseSchedule';
    case 'resume-schedule':
      return 'onResumeSchedule';
    case 'delete':
      return 'onDelete';
  }
}

export function detailsToggleAriaLabel(expanded: boolean, name: string): string {
  return expanded ? `Hide details for ${name}` : `Show details for ${name}`;
}

export function scheduleChipAriaLabel(state: ScheduleDisplayState, name: string): string {
  const stateLabel = state === 'active' ? 'Active' : state === 'paused' ? 'Paused' : 'Manual';
  return `Schedule ${name} (${stateLabel})`;
}

export function shouldFadeUp(surface: AutomationsSurface): boolean {
  return surface === 'hero' || surface === 'kpi';
}

export function shouldLiftOnHover(surface: AutomationsSurface): boolean {
  return surface === 'kpi';
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

export const TAGS_CELL_VISIBLE_COUNT = 1;
export const SEE_ALL_TAGS_LABEL = 'See all tags';

export function visibleTagsForCell(tags: string[]): string[] {
  return tags.slice(0, TAGS_CELL_VISIBLE_COUNT);
}

export function shouldShowSeeAllTagsChip(tags: string[]): boolean {
  return tags.length > TAGS_CELL_VISIBLE_COUNT;
}

export function seeAllTagsAriaLabel(name: string): string {
  return `See all tags for ${name}`;
}

/** Let MainPage scroll the whole automations page; do not pin the hero while the table scrolls. */
export function automationsPageRootOverflow(): 'visible' {
  return 'visible';
}

export function automationsTableScrollSx() {
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

export const overflowMenuActions = [
  'schedule',
  'view-data',
  'run-history',
  'configure',
  'last-run',
  'copy-scout-id',
  'delete',
] as const;

export function configStartUrlLocked(): boolean {
  return true;
}

export function configShowsRawListExtractionEditor(): boolean {
  return false;
}

/** Max items / max pages only — does not unlock selector JSON. */
export function configShowsPaginationLimits(): boolean {
  return true;
}

export function proxySavedChipLabel(configured: boolean): string | null {
  return configured ? 'Saved (hidden after reload)' : null;
}

export function statusMarkerColor(status: string): string {
  switch (status) {
    case 'completed':
    case 'success':
      return FIRSTSTEP.success;
    case 'failed':
    case 'dead':
      return FIRSTSTEP.danger;
    case 'running':
    case 'queued':
    case 'pending':
      return FIRSTSTEP.teal;
    case 'aborted':
    case 'aborting':
      return FIRSTSTEP.warning;
    default:
      return FIRSTSTEP.border;
  }
}

export function mobileCardDefinitionItems(input: {
  scoutId?: string | null;
  companyName?: string | null;
  lastRunTime?: string | null;
  rowsExtracted?: number | null;
}): Array<{ term: string; value: string }> {
  return [
    { term: 'Scout ID', value: input.scoutId?.trim() || 'No Scout ID' },
    { term: 'Company', value: input.companyName?.trim() || '—' },
    { term: 'Last run', value: formatLastRunActivity(input.lastRunTime) },
    { term: 'Rows', value: String(input.rowsExtracted || 0) },
  ];
}
