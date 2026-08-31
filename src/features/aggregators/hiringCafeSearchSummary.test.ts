import { describe, expect, it } from 'vitest';
import {
  aggregatorHealthLabel,
  aggregatorOverview,
  listExtractionCap,
  mappedFieldCount,
  summarizeHiringCafeUrl,
} from './hiringCafeSearchSummary';

describe('summarizeHiringCafeUrl', () => {
  it('does not dump the encoded searchState', () => {
    const url =
      'https://hiring.cafe/?searchState=' +
      encodeURIComponent(
        JSON.stringify({
          searchQuery: 'software engineer',
          locations: [{ country: 'United States' }],
          datePosted: 'Past 24 hours',
          sort: 'Most recent',
          workplaceTypes: ['Remote'],
        })
      );

    const summary = summarizeHiringCafeUrl(url);
    expect(summary.headline).toBe('software engineer');
    expect(summary.chips.join(' ')).toContain('United States');
    expect(summary.chips.join(' ')).toContain('Past 24 hours');
    expect(JSON.stringify(summary)).not.toContain('searchState');
    expect(summary.headline.length).toBeLessThan(80);
  });

  it('falls back when the URL has no searchState', () => {
    const summary = summarizeHiringCafeUrl('https://hiringcafe.com/');
    expect(summary.headline).toBe('Aggregator');
    expect(summary.host).toBe('hiringcafe.com');
  });
});

describe('list extraction helpers', () => {
  it('reports a row cap and mapped field count', () => {
    expect(listExtractionCap({ listExtraction: { maxItems: 40 } }).label).toBe('Cap 40');
    expect(mappedFieldCount({ listExtraction: { fields: { title: {}, company: {} } } })).toBe(2);
  });

  it('describes run health without exposing URLs', () => {
    expect(aggregatorHealthLabel('idle', 0)).toBe('Not run yet');
    expect(aggregatorHealthLabel('running', 0)).toBe('Working now');
    expect(aggregatorHealthLabel('completed', 12)).toBe('Healthy');
    expect(aggregatorHealthLabel('completed', 0)).toBe('Ran · 0 jobs');
    expect(aggregatorHealthLabel('failed', 0)).toBe('Failed');
  });

  it('rolls up Hiring Cafe search totals', () => {
    const overview = aggregatorOverview([
      { status: 'completed', rowsExtracted: 12, jobsAddedToBoard: 8, schedule: { enabled: true, cron: '0 * * * *' } },
      { status: 'failed', rowsExtracted: 0, jobsAddedToBoard: 0, schedule: { enabled: false, cron: '' } },
      { status: 'running', rowsExtracted: 0, jobsAddedToBoard: 0, schedule: { enabled: true, cron: '0 * * * *' } },
    ]);
    expect(overview.searchCount).toBe(3);
    expect(overview.scheduledCount).toBe(2);
    expect(overview.rowsLastRun).toBe(12);
    expect(overview.jobsOnBoard).toBe(8);
    expect(overview.workingCount).toBe(1);
    expect(overview.failedCount).toBe(1);
    expect(overview.healthyCount).toBe(1);
  });
});
