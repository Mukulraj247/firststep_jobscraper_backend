import type { OpsMetricsWindow } from '../../api/automation';
import {
  endOfIstDay,
  lastNIstDayYmds,
  startOfIstDay,
} from '../../shared/opsTimezone';

export const DASHBOARD_TAG_LIMIT = 15;
export const DASHBOARD_DATE_LOOKBACK_DAYS = 7;

export const GEO_TAG_NAMESPACES = ['state', 'region', 'city'] as const;

export type DashboardRange =
  | { mode: 'window'; window: OpsMetricsWindow }
  | { mode: 'day'; date: string };

export type DashboardTag = {
  tag: string;
  label: string;
  namespace: string;
  namespaceLabel?: string;
  jobsAdded: number;
  runs: number;
};

export function tagNamespaceOf(tag: { namespace?: string; tag?: string }): string {
  if (tag.namespace) return tag.namespace;
  return String(tag.tag || '').split(':')[0] || '';
}

export function isSelectableDashboardTag(tag: { namespace?: string; tag?: string }): boolean {
  return !(GEO_TAG_NAMESPACES as readonly string[]).includes(tagNamespaceOf(tag));
}

export function toggleDashboardTag(selected: string[], tag: string): string[] {
  if (!isSelectableDashboardTag({ tag })) return selected;
  if (selected.includes(tag)) return selected.filter((item) => item !== tag);
  if (selected.length >= DASHBOARD_TAG_LIMIT) return selected;
  return [...selected, tag];
}

export function applyDashboardTagSelection<T extends DashboardTag>(
  tags: T[],
  selected: string[],
): T[] {
  if (!selected.length) return [];
  const allowed = new Set(
    selected.filter((tag) => isSelectableDashboardTag({ tag })),
  );
  return tags.filter((tag) => allowed.has(tag.tag) && isSelectableDashboardTag(tag));
}

export function failuresHrefFromDashboard(range: DashboardRange): string {
  if (range.mode === 'window') {
    return `/failures?window=${range.window}`;
  }
  const from = startOfIstDay(range.date).toISOString();
  const to = endOfIstDay(range.date).toISOString();
  return `/failures?from=${from}&to=${to}`;
}

export function normalizeChartTimestampMs(t: number): number {
  if (!Number.isFinite(t)) return t;
  return t < 1e12 ? Math.round(t * 1000) : t;
}

export function dashboardDatePickerBounds(nowMs: number = Date.now()): {
  min: string;
  max: string;
} {
  const days = lastNIstDayYmds(nowMs, DASHBOARD_DATE_LOOKBACK_DAYS);
  return { min: days[0], max: days[days.length - 1] };
}

export function selectableDashboardTags<T extends { namespace?: string; tag?: string }>(
  tags: T[],
): T[] {
  return tags.filter((tag) => isSelectableDashboardTag(tag));
}
