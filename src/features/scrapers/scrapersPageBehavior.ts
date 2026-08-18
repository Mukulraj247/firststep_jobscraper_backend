import { getScheduleLabel } from '../../constants/scheduleOptions';
import { FIRSTSTEP, RADIUS, hiddenScrollbarSx, tint } from '../../components/dashboard/ops/dashboardTokens';
import type { ScheduleDisplayState } from '../automations/automationsPageBehavior';
import {
  DESKTOP_TABLE_HEADER_BG,
  DESKTOP_TABLE_MIN_WIDTH_PX,
  DESKTOP_TABLE_ROW_DIVIDER,
  DESKTOP_TABLE_ROW_HEIGHT_PX,
  DESKTOP_TABLE_ROW_HOVER_BG,
  DESKTOP_TABLE_SIZE,
  DESKTOP_TABLE_STATUS_MARKER_PX,
  formatUpdatedAgo,
  paginationControlSx,
  scheduleDisplayState,
  statusMarkerColor,
  workspaceAriaBusy,
  workspaceNoLiftHoverSx,
} from '../automations/automationsPageBehavior';
import type { RobotListSchedule, RobotListSummary, RobotListType } from '../../types/robotList';

export {
  DESKTOP_TABLE_HEADER_BG,
  DESKTOP_TABLE_ROW_DIVIDER,
  DESKTOP_TABLE_ROW_HEIGHT_PX,
  DESKTOP_TABLE_ROW_HOVER_BG,
  DESKTOP_TABLE_SIZE,
  DESKTOP_TABLE_STATUS_MARKER_PX,
  paginationControlSx,
  statusMarkerColor,
  workspaceAriaBusy,
  workspaceNoLiftHoverSx,
};

export type ScrapersContentState =
  | 'first-load-skeleton'
  | 'load-error'
  | 'account-empty'
  | 'filtered-empty'
  | 'rows';

export const SCRAPERS_TABLE_CAPTION =
  'Scrapers with name, type, status, schedule, last run, and actions';

export const SOCKET_INVALIDATE_DEBOUNCE_MS = 400;

export const TYPE_LABELS: Record<RobotListType, string> = {
  extract: 'Extract',
  scrape: 'Scrape',
  crawl: 'Crawl',
  search: 'Search',
};

export function resolveScrapersContentState(input: {
  isLoading: boolean;
  isError: boolean;
  hasLoadedData: boolean;
  rowCount: number;
  hasActiveSearch: boolean;
}): ScrapersContentState {
  if (!input.hasLoadedData && input.isError) return 'load-error';
  if (!input.hasLoadedData) return 'first-load-skeleton';
  if (input.rowCount > 0) return 'rows';
  if (input.hasActiveSearch) return 'filtered-empty';
  return 'account-empty';
}

export function shouldShowBackgroundRefreshBar(input: {
  isFetching: boolean;
  isLoading: boolean;
  hasLoadedData: boolean;
}): boolean {
  return input.isFetching && input.hasLoadedData && !input.isLoading;
}

export function scraperScheduleState(schedule: RobotListSchedule): ScheduleDisplayState {
  return scheduleDisplayState({ enabled: schedule.enabled, cron: schedule.cron });
}

export function scraperScheduleLabel(schedule: RobotListSchedule): string {
  const state = scraperScheduleState(schedule);
  if (state === 'manual') return 'Manual';
  return schedule.label || getScheduleLabel(schedule.cron);
}

export function scraperScheduleChipColor(
  state: ScheduleDisplayState
): 'success' | 'warning' | 'default' {
  if (state === 'active') return 'success';
  if (state === 'paused') return 'warning';
  return 'default';
}

export function scraperStatusLabel(lastRun: RobotListSummary['lastRun']): string {
  if (!lastRun) return 'Idle';
  const s = String(lastRun.status || '').toLowerCase();
  if (s === 'success' || s === 'completed' || s === 'done') return 'Succeeded';
  if (s === 'failed' || s === 'error' || s === 'dead') return 'Failed';
  if (s === 'aborted' || s === 'aborting') return 'Aborted';
  if (s === 'queued') return 'Queued';
  if (s === 'scheduled') return 'Scheduled';
  if (s === 'running' || s === 'pending') return 'Running';
  if (s === 'idle' || !s) return 'Idle';
  return lastRun.status;
}

export function scraperStatusColor(
  lastRun: RobotListSummary['lastRun']
): 'success' | 'error' | 'warning' | 'info' | 'default' {
  if (!lastRun) return 'default';
  const s = String(lastRun.status || '').toLowerCase();
  if (s === 'success' || s === 'completed' || s === 'done') return 'success';
  if (s === 'failed' || s === 'error' || s === 'dead') return 'error';
  if (s === 'aborted' || s === 'aborting') return 'warning';
  if (s === 'running' || s === 'queued' || s === 'scheduled' || s === 'pending') return 'info';
  return 'default';
}

export function scraperStatusMarker(lastRun: RobotListSummary['lastRun']): string {
  if (!lastRun) return FIRSTSTEP.border;
  return statusMarkerColor(lastRun.status);
}

export function formatScraperUpdatedAt(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }
  return value;
}

export function formatScraperLastRunRelative(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  const diffMs = Date.now() - parsed;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return 'Just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  return `${days}d ago`;
}

export function formatScraperLastRunAbsolute(iso: string | null | undefined): string {
  if (!iso) return 'No runs yet';
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  return new Date(parsed).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function scraperLastRunTimestamp(row: RobotListSummary): string | null {
  return row.lastRun?.finishedAt || row.lastRun?.startedAt || null;
}

export function freshnessPillLabel(
  scraperCount: number,
  updatedAtMs: number | null,
  nowMs: number
): string {
  const noun = scraperCount === 1 ? 'scraper' : 'scrapers';
  const countPart = `${scraperCount} ${noun}`;
  if (updatedAtMs == null) return countPart;
  return `${countPart} · updated ${formatUpdatedAgo(updatedAtMs, nowMs)}`;
}

export function scrapersLiveRegionMessage(input: {
  contentState: ScrapersContentState;
  resultCount: number;
  isFetching: boolean;
}): string {
  switch (input.contentState) {
    case 'first-load-skeleton':
      return 'Loading scrapers';
    case 'load-error':
      return 'Failed to load scrapers. Retry available.';
    case 'account-empty':
      return 'No scrapers yet';
    case 'filtered-empty':
      return 'No scrapers match the current search';
    case 'rows': {
      const noun = input.resultCount === 1 ? 'scraper' : 'scrapers';
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

export function scheduleChipAriaLabel(state: ScheduleDisplayState, name: string): string {
  const stateLabel = state === 'active' ? 'Active' : state === 'paused' ? 'Paused' : 'Manual';
  return `Schedule ${name} (${stateLabel})`;
}

export function scrapersTableScrollSx() {
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

export function mobileCardDefinitionItems(row: RobotListSummary): Array<{ term: string; value: string }> {
  return [
    { term: 'Type', value: TYPE_LABELS[row.type] || row.type },
    {
      term: 'Updated',
      value: formatScraperUpdatedAt(row.updatedAt),
    },
    {
      term: 'Last run',
      value: formatScraperLastRunRelative(scraperLastRunTimestamp(row)),
    },
  ];
}

export function stickyHeaderCellSx(extra?: Record<string, unknown>) {
  return {
    bgcolor: (muiTheme: { palette: { mode: string } }) =>
      muiTheme.palette.mode === 'dark' ? 'background.paper' : DESKTOP_TABLE_HEADER_BG,
    top: 0,
    zIndex: 2,
    fontSize: '0.8125rem',
    fontWeight: 600,
    letterSpacing: '0.01em',
    color: 'text.secondary',
    whiteSpace: 'nowrap' as const,
    py: 1.5,
    borderBottom: `1px solid ${DESKTOP_TABLE_ROW_DIVIDER}`,
    ...extra,
  };
}

export function stickyNameCellSx(isHeader = false) {
  return {
    position: 'sticky' as const,
    left: 0,
    zIndex: isHeader ? 3 : 1,
    bgcolor: (muiTheme: { palette: { mode: string; background: { paper: string } } }) =>
      isHeader
        ? muiTheme.palette.mode === 'dark'
          ? muiTheme.palette.background.paper
          : DESKTOP_TABLE_HEADER_BG
        : muiTheme.palette.background.paper,
    boxShadow: '1px 0 0 rgba(2, 51, 69, 0.06)',
  };
}

export const DESKTOP_TABLE_MIN_WIDTH = DESKTOP_TABLE_MIN_WIDTH_PX;

export function typeChipSx() {
  return {
    fontWeight: 600,
    borderRadius: RADIUS.pill,
    height: 24,
  };
}

export function scheduleChipSx(state: ScheduleDisplayState) {
  return {
    fontWeight: 600,
    borderRadius: RADIUS.pill,
    maxWidth: 140,
    height: 24,
    ...(state === 'active'
      ? {
          bgcolor: tint(FIRSTSTEP.success, 0.12),
          color: FIRSTSTEP.successDeep,
        }
      : {}),
  };
}
