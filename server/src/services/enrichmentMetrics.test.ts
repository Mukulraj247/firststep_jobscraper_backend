import { describe, expect, it } from 'vitest';
import { buildCreditSeries14d, nonHiringCafeEnrichmentMatch } from './enrichmentMetrics';

describe('buildCreditSeries14d', () => {
  it('fills 14 UTC days from a day map', () => {
    const now = new Date('2026-08-20T15:00:00.000Z');
    const series = buildCreditSeries14d(
      new Map([
        ['2026-08-20', 120],
        ['2026-08-18', 40],
      ]),
      now
    );
    expect(series).toHaveLength(14);
    expect(series[0].label).toBe('08-07');
    expect(series[series.length - 1]).toMatchObject({
      label: '08-20',
      credits: 120,
    });
    expect(series[series.length - 3]).toMatchObject({
      label: '08-18',
      credits: 40,
    });
    expect(series[1].credits).toBe(0);
  });
});

describe('nonHiringCafeEnrichmentMatch', () => {
  it('excludes hiring_cafe source from usage history', () => {
    const since = new Date('2026-08-01T00:00:00.000Z');
    const match = nonHiringCafeEnrichmentMatch(since);
    expect(match.source).toEqual({ $nin: ['hiring_cafe', 'hiringcafe'] });
    expect(match['enrichment.lastEnrichedAt']).toEqual({ $gte: since });
  });
});
