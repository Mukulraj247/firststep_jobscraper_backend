import { describe, expect, it } from 'vitest';
import {
  formatScraperLastRunRelative,
  resolveScrapersContentState,
  scraperStatusLabel,
  scraperScheduleLabel,
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
