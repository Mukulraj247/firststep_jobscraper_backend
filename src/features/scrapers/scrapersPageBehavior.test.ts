import { describe, expect, it } from 'vitest';
import {
  HEATMAP_EMPTY_COLOR,
  HEATMAP_HIGH_COLOR,
  HEATMAP_LOW_COLOR,
  buildReconfigureMovesCsv,
  buildScheduleFiresCsv,
  buildScheduleFiresCsvFilename,
  formatHeatmapDateChip,
  formatIsoAsIstClock,
  formatScraperLastRunRelative,
  HEATMAP_HOUR_PERIODS,
  heatmapHourAriaLabel,
  heatmapHourCellMinHeightPx,
  heatmapHourColor,
  heatmapHourLabel,
  heatmapScheduledTotal,
  resolveScrapersContentState,
  scraperStatusLabel,
  scraperScheduleLabel,
  scrapersOverflowMenuActions,
  scrapersPageShowsScraperList,
  scrapersUsesRecordingsListApi,
  reconfigureApiMovesToCsvRows,
  SCRAPERS_HEATMAP_PATH,
  SCRAPERS_PAGE_SECTIONS,
  scheduleFireLabel,
} from './scrapersPageBehavior';

describe('resolveScrapersContentState', () => {
  it('returns load-error when fetch fails before data loads', () => {
    expect(
      resolveScrapersContentState({
        isLoading: false,
        isError: true,
        hasLoadedData: false,
        rowCount: 0,
        hasActiveSearch: false,
      })
    ).toBe('load-error');
  });

  it('returns filtered-empty when search has no matches', () => {
    expect(
      resolveScrapersContentState({
        isLoading: false,
        isError: false,
        hasLoadedData: true,
        rowCount: 0,
        hasActiveSearch: true,
      })
    ).toBe('filtered-empty');
  });
});

describe('scraperStatusLabel', () => {
  it('labels scheduled runs distinctly from running', () => {
    expect(scraperStatusLabel({ status: 'scheduled', startedAt: null, finishedAt: null })).toBe(
      'Scheduled'
    );
    expect(scraperStatusLabel({ status: 'running', startedAt: null, finishedAt: null })).toBe(
      'Running'
    );
  });
});

describe('scraperScheduleLabel', () => {
  it('uses human schedule labels from API', () => {
    expect(
      scraperScheduleLabel({ enabled: true, cron: '0 0 * * *', label: 'Every day' })
    ).toBe('Every day');
  });
});

describe('formatScraperLastRunRelative', () => {
  it('returns Never when timestamp missing', () => {
    expect(formatScraperLastRunRelative(null)).toBe('Never');
  });
});

describe('scrapers overflow menu', () => {
  it('keeps schedule, settings, and delete; hides unused Maxun actions', () => {
    expect([...scrapersOverflowMenuActions]).toEqual(['schedule', 'settings', 'delete']);
    expect(scrapersOverflowMenuActions).not.toContain('integrate');
    expect(scrapersOverflowMenuActions).not.toContain('retrain');
    expect(scrapersOverflowMenuActions).not.toContain('duplicate');
    expect(scrapersOverflowMenuActions).not.toContain('edit');
  });
});

describe('schedule heatmap presentation', () => {
  it('labels today vs other IST days on the date strip', () => {
    expect(formatHeatmapDateChip('2026-08-18', '2026-08-18')).toBe('Today');
    expect(formatHeatmapDateChip('2026-08-15', '2026-08-18')).toBe('15 Aug');
  });

  it('labels hours in 12-hour IST clock', () => {
    expect(heatmapHourLabel(0)).toBe('12 AM');
    expect(heatmapHourLabel(6)).toBe('6 AM');
    expect(heatmapHourLabel(18)).toBe('6 PM');
  });

  it('colors few fires dark green and many dark red; empty hours stay neutral', () => {
    const counts = [0, 1, 4, 12];
    expect(heatmapHourColor(0, counts)).toBe(HEATMAP_EMPTY_COLOR);
    expect(heatmapHourColor(1, counts)).toBe(HEATMAP_LOW_COLOR);
    expect(heatmapHourColor(12, counts)).toBe(HEATMAP_HIGH_COLOR);
  });

  it('formats a minute-by-minute fire as Company — 6:12 PM', () => {
    expect(
      scheduleFireLabel({ company: 'Google', name: 'Google jobs', hour: 18, minute: 12 })
    ).toBe('Google — 6:12 PM');
    expect(scheduleFireLabel({ company: '', name: 'Wipro', hour: 18, minute: 45 })).toBe(
      'Wipro — 6:45 PM'
    );
  });

  it('names an hour cell for screen readers', () => {
    expect(heatmapHourAriaLabel(18, 12)).toBe('6 PM, 12 scheduled');
    expect(heatmapHourAriaLabel(0, 1)).toBe('12 AM, 1 scheduled');
  });

  it('is the scrapers page: heatmap only, no scraper list or create table', () => {
    expect([...SCRAPERS_PAGE_SECTIONS]).toEqual(['hero', 'heatmap']);
    expect(scrapersPageShowsScraperList()).toBe(false);
    expect(scrapersUsesRecordingsListApi()).toBe(false);
    expect(SCRAPERS_HEATMAP_PATH).toBe('/api/dashboard/schedule-heatmap');
    expect(heatmapHourCellMinHeightPx()).toBeGreaterThanOrEqual(120);
    expect(HEATMAP_HOUR_PERIODS).toHaveLength(4);
    expect(HEATMAP_HOUR_PERIODS.map((period) => period.startHour)).toEqual([0, 6, 12, 18]);
    expect(heatmapScheduledTotal([{ count: 4 }, { count: 0 }, { count: 19 }])).toBe(23);
  });
});

describe('scraper schedule CSV export', () => {
  it('names the download after the selected IST date', () => {
    expect(buildScheduleFiresCsvFilename('2026-08-19')).toBe('scraper-schedules-2026-08-19.csv');
  });

  it('sorts fires by timestamp and numbers repeats of the same company', () => {
    const csv = buildScheduleFiresCsv([
      {
        hour: 17,
        minute: 0,
        at: '2026-08-19T11:30:00.000Z',
        automationId: 'g-3',
        name: 'Google three',
        company: 'Google',
      },
      {
        hour: 6,
        minute: 0,
        at: '2026-08-19T00:30:00.000Z',
        automationId: 'jpm',
        name: 'JP data engineer',
        company: 'JP Morgan Chase',
      },
      {
        hour: 1,
        minute: 0,
        at: '2026-08-18T19:30:00.000Z',
        automationId: 'g-1',
        name: 'Google one',
        company: 'Google',
      },
      {
        hour: 9,
        minute: 0,
        at: '2026-08-19T03:30:00.000Z',
        automationId: 'g-2',
        name: 'Google two',
        company: 'Google',
      },
    ]);

    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(
      '"occurrence_label","company","scraper","automation_id","time_ist","iso"'
    );
    expect(lines[1]).toContain('"Google 1"');
    expect(lines[1]).toContain('"g-1"');
    expect(lines[1]).toContain('"1:00 AM"');
    expect(lines[2]).toContain('"JP Morgan Chase 1"');
    expect(lines[2]).toContain('"6:00 AM"');
    expect(lines[3]).toContain('"Google 2"');
    expect(lines[3]).toContain('"9:00 AM"');
    expect(lines[4]).toContain('"Google 3"');
    expect(lines[4]).toContain('"5:00 PM"');
  });

  it('falls back to scraper name when company is blank', () => {
    const csv = buildScheduleFiresCsv([
      {
        hour: 8,
        minute: 15,
        at: '2026-08-19T02:45:00.000Z',
        automationId: 'wipro',
        name: 'Wipro careers',
        company: '',
      },
    ]);
    expect(csv).toContain('"Wipro careers 1"');
    expect(csv).toContain('"Wipro careers"');
  });

  it('omits unchanged robots from the reconfigure moves CSV', () => {
    const csv = buildReconfigureMovesCsv([
      {
        company: 'JP Morgan Chase',
        scraper: 'JP data engineer',
        fromIst: '6:00 AM',
        toIst: '9:00 AM',
      },
    ]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('"company","scraper","from_ist","to_ist"');
    expect(lines[1]).toContain('"JP Morgan Chase"');
    expect(lines[1]).toContain('"6:00 AM"');
    expect(lines[1]).toContain('"9:00 AM"');
    expect(lines).toHaveLength(2);
  });

  it('formats API move timestamps as IST clocks for the reconfigure CSV', () => {
    expect(formatIsoAsIstClock('2026-08-19T00:30:00.000Z')).toBe('6:00 AM');
    expect(formatIsoAsIstClock('2026-08-19T03:30:00.000Z')).toBe('9:00 AM');
    const rows = reconfigureApiMovesToCsvRows([
      {
        company: 'JP Morgan Chase',
        name: 'JP data engineer',
        fromAt: '2026-08-19T00:30:00.000Z',
        toAt: '2026-08-19T03:30:00.000Z',
      },
    ]);
    expect(rows).toEqual([
      {
        company: 'JP Morgan Chase',
        scraper: 'JP data engineer',
        fromIst: '6:00 AM',
        toIst: '9:00 AM',
      },
    ]);
  });
});
