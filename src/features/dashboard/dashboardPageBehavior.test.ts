import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_TAG_LIMIT,
  GEO_TAG_NAMESPACES,
  applyDashboardTagSelection,
  dashboardDatePickerBounds,
  defaultDashboardDate,
  failuresHrefFromDashboard,
  isDashboardCalendarDayMode,
  isDashboardToday,
  isSelectableDashboardTag,
  normalizeChartTimestampMs,
  toggleDashboardTag,
} from './dashboardPageBehavior';

describe('failuresHrefFromDashboard', () => {
  it('sends the preset window to the failure dashboard', () => {
    expect(failuresHrefFromDashboard({ mode: 'window', window: '6h' })).toBe(
      '/failures?window=6h',
    );
  });

  it('sends IST day bounds as from/to for a picked calendar day', () => {
    expect(failuresHrefFromDashboard({ mode: 'day', date: '2026-08-11' })).toBe(
      '/failures?from=2026-08-10T18:30:00.000Z&to=2026-08-11T18:29:59.999Z',
    );
  });
});

describe('dashboard today vs past day mode', () => {
  const now = Date.parse('2026-08-18T10:00:00.000Z'); // 15:30 IST on 18 Aug

  it('defaults the day picker to today IST', () => {
    expect(defaultDashboardDate(now)).toBe('2026-08-18');
  });

  it('treats today as rolling window mode, not calendar day', () => {
    expect(isDashboardToday('2026-08-18', now)).toBe(true);
    expect(isDashboardCalendarDayMode('2026-08-18', now)).toBe(false);
    expect(isDashboardCalendarDayMode('', now)).toBe(false);
  });

  it('treats a past IST day as calendar day mode', () => {
    expect(isDashboardToday('2026-08-11', now)).toBe(false);
    expect(isDashboardCalendarDayMode('2026-08-11', now)).toBe(true);
  });
});

describe('dashboard tag filter', () => {
  it('rejects geo tags and caps selection at 15', () => {
    expect(isSelectableDashboardTag({ namespace: 'role' })).toBe(true);
    expect(isSelectableDashboardTag({ namespace: 'function' })).toBe(true);
    expect(GEO_TAG_NAMESPACES.every((ns) => !isSelectableDashboardTag({ namespace: ns }))).toBe(
      true,
    );
    expect(DASHBOARD_TAG_LIMIT).toBe(15);
  });

  it('toggles tags up to the limit and ignores geo tags', () => {
    const selected = toggleDashboardTag([], 'role:Data Scientist');
    expect(selected).toEqual(['role:Data Scientist']);
    expect(toggleDashboardTag(selected, 'role:Data Scientist')).toEqual([]);
    expect(toggleDashboardTag(selected, 'state:North Carolina')).toEqual(selected);

    const atLimit = Array.from({ length: DASHBOARD_TAG_LIMIT }, (_, i) => `role:Tag ${i}`);
    expect(toggleDashboardTag(atLimit, 'role:Overflow')).toEqual(atLimit);
  });

  it('returns no cards until the user confirms a selection', () => {
    const tags = [
      { tag: 'role:Data Scientist', namespace: 'role', jobsAdded: 4, runs: 2, label: 'Data Scientist' },
      { tag: 'state:North Carolina', namespace: 'state', jobsAdded: 9, runs: 1, label: 'North Carolina' },
    ];
    expect(applyDashboardTagSelection(tags, [])).toEqual([]);
    expect(applyDashboardTagSelection(tags, ['role:Data Scientist']).map((t) => t.tag)).toEqual([
      'role:Data Scientist',
    ]);
    expect(applyDashboardTagSelection(tags, ['state:North Carolina'])).toEqual([]);
  });
});

describe('normalizeChartTimestampMs', () => {
  it('promotes unix-second DigitalOcean points to milliseconds', () => {
    expect(normalizeChartTimestampMs(1781960000)).toBe(1781960000000);
    expect(normalizeChartTimestampMs(1781960000000)).toBe(1781960000000);
  });
});

describe('dashboardDatePickerBounds', () => {
  it('limits the calendar to the last 7 IST days', () => {
    const now = Date.parse('2026-08-18T10:00:00.000Z');
    expect(dashboardDatePickerBounds(now)).toEqual({
      min: '2026-08-12',
      max: '2026-08-18',
    });
  });
});
