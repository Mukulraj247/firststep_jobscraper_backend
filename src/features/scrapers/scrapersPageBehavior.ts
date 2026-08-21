import { getScheduleLabel } from '../../constants/scheduleOptions';
import { FIRSTSTEP, RADIUS, hiddenScrollbarSx, tint } from '../../components/dashboard/ops/dashboardTokens';
import { escapeCsvSpreadsheetCell } from '../../utils/spreadsheet';
import type { ScheduleHeatmapFire } from '../../api/automation';
import type { ScheduleDisplayState } from '../automations/automationsPageBehavior';
import { istHourOf, istMinuteOf } from '../../shared/opsTimezone';
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

export const scrapersOverflowMenuActions = ['schedule', 'settings', 'delete'] as const;

export type ScrapersOverflowMenuAction = (typeof scrapersOverflowMenuActions)[number];

export const HEATMAP_EMPTY_COLOR = '#e8eef0';
export const HEATMAP_LOW_COLOR = '#065f46';
export const HEATMAP_HIGH_COLOR = '#7f1d1d';

export const SCRAPERS_PAGE_SECTIONS = ['hero', 'heatmap'] as const;

export function scrapersPageShowsScraperList(): boolean {
  return false;
}

export const SCRAPERS_HEATMAP_PATH = '/api/dashboard/schedule-heatmap';

export function scrapersUsesRecordingsListApi(): boolean {
  return false;
}

export const HEATMAP_HOUR_PERIODS = [
  { id: 'night', label: 'Night', startHour: 0 },
  { id: 'morning', label: 'Morning', startHour: 6 },
  { id: 'afternoon', label: 'Afternoon', startHour: 12 },
  { id: 'evening', label: 'Evening', startHour: 18 },
] as const;

export function heatmapHourCellMinHeightPx(): number {
  return 112;
}

export function heatmapScheduledTotal(hours: Array<{ count: number }>): number {
  return hours.reduce((sum, hour) => sum + hour.count, 0);
}

const HEATMAP_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export function formatHeatmapDateChip(ymd: string, todayYmd: string): string {
  if (ymd === todayYmd) return 'Today';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return ymd;
  return `${Number(match[3])} ${HEATMAP_MONTHS[Number(match[2]) - 1]}`;
}

export function heatmapHourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12} ${period}`;
}

function parseHexRgb(color: string): [number, number, number] {
  const hex = color.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((ch) => ch + ch).join('') : hex;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function lerpHex(from: string, to: string, t: number): string {
  const a = parseHexRgb(from);
  const b = parseHexRgb(to);
  const mix = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t);
  return `#${[mix(0), mix(1), mix(2)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Color by that day's count range: few → dark green, many → dark red. Zero stays empty. */
export function heatmapHourColor(count: number, counts: number[]): string {
  if (count <= 0) return HEATMAP_EMPTY_COLOR;
  const positives = counts.filter((value) => value > 0);
  if (positives.length === 0) return HEATMAP_EMPTY_COLOR;
  const min = Math.min(...positives);
  const max = Math.max(...positives);
  if (min === max) return lerpHex(HEATMAP_LOW_COLOR, HEATMAP_HIGH_COLOR, 0.5);
  return lerpHex(HEATMAP_LOW_COLOR, HEATMAP_HIGH_COLOR, (count - min) / (max - min));
}

export function formatHourMinute12(hour: number, minute: number): string {
  const h = ((hour % 24) + 24) % 24;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${period}`;
}

export function scheduleFireLabel(fire: {
  company?: string | null;
  name?: string | null;
  hour: number;
  minute: number;
}): string {
  const who = (fire.company || fire.name || 'Untitled').trim() || 'Untitled';
  return `${who} — ${formatHourMinute12(fire.hour, fire.minute)}`;
}

export function heatmapHourAriaLabel(hour: number, count: number): string {
  return `${heatmapHourLabel(hour)}, ${count} scheduled`;
}

export function heatmapFiresForHour<T extends { hour: number }>(fires: T[], hour: number): T[] {
  return fires.filter((fire) => fire.hour === hour);
}

export function buildScheduleFiresCsvFilename(dateYmd: string): string {
  return `scraper-schedules-${dateYmd}.csv`;
}

export function buildReconfigureMovesCsvFilename(dateYmd: string): string {
  return `scraper-reconfigure-${dateYmd}.csv`;
}

function fireGroupKey(fire: { company?: string | null; name?: string | null }): string {
  const company = (fire.company || '').trim();
  if (company) return company;
  return (fire.name || 'Untitled').trim() || 'Untitled';
}

export function buildScheduleFiresCsv(fires: ScheduleHeatmapFire[]): string {
  const sorted = [...fires].sort((a, b) => {
    const aMs = Date.parse(a.at);
    const bMs = Date.parse(b.at);
    if (aMs !== bMs) return aMs - bMs;
    if (a.hour !== b.hour) return a.hour - b.hour;
    if (a.minute !== b.minute) return a.minute - b.minute;
    return fireGroupKey(a).localeCompare(fireGroupKey(b));
  });

  const seen = new Map<string, number>();
  const header = ['occurrence_label', 'company', 'scraper', 'automation_id', 'time_ist', 'iso']
    .map(escapeCsvSpreadsheetCell)
    .join(',');

  const rows = sorted.map((fire) => {
    const key = fireGroupKey(fire);
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    const timeIst = formatHourMinute12(fire.hour, fire.minute);
    return [
      `${key} ${n}`,
      fire.company || '',
      fire.name || '',
      fire.automationId || '',
      timeIst,
      fire.at || '',
    ]
      .map(escapeCsvSpreadsheetCell)
      .join(',');
  });

  return [header, ...rows].join('\n');
}

export type ReconfigureMoveCsvRow = {
  company: string;
  scraper: string;
  fromIst: string;
  toIst: string;
};

export function buildReconfigureMovesCsv(moves: ReconfigureMoveCsvRow[]): string {
  const header = ['company', 'scraper', 'from_ist', 'to_ist'].map(escapeCsvSpreadsheetCell).join(',');
  const rows = moves.map((move) =>
    [move.company, move.scraper, move.fromIst, move.toIst].map(escapeCsvSpreadsheetCell).join(',')
  );
  return [header, ...rows].join('\n');
}

export function formatIsoAsIstClock(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return formatHourMinute12(istHourOf(ms), istMinuteOf(ms));
}

export function reconfigureApiMovesToCsvRows(
  moves: Array<{ company: string; name: string; fromAt: string; toAt: string }>,
): ReconfigureMoveCsvRow[] {
  return moves.map((move) => ({
    company: move.company || '',
    scraper: move.name || '',
    fromIst: formatIsoAsIstClock(move.fromAt),
    toIst: formatIsoAsIstClock(move.toAt),
  }));
}

export function downloadTextFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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
