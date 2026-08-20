/**
 * ScoutX enrichment usage for the Dashboard.
 * Built only from Job Board listings — no scrape.do /info token calls.
 * Hiring Cafe aggregator rows are excluded from history and charts.
 */
import JobBoardListing from '../models/JobBoardListing';
import { AGGREGATOR_SOURCE_HIRING_CAFE } from './aggregatorIdentity';

const DAY_MS = 24 * 60 * 60 * 1000;

export type EnrichmentDayPoint = {
  t: number;
  label: string;
  credits: number;
};

export type EnrichmentMethodStat = {
  method: string;
  jobs: number;
  credits: number;
};

export type ScoutXEnrichmentMetrics = {
  creditsSpentToday: number;
  dailyCreditBudget: number;
  creditsSpentLast14Days: number;
  series14d: EnrichmentDayPoint[];
  methods14d: EnrichmentMethodStat[];
};

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayStartUtcMs(dayKey: string): number {
  return Date.parse(`${dayKey}T00:00:00.000Z`);
}

/** Fill a contiguous 14-day UTC series from day→credits map. */
export function buildCreditSeries14d(
  byDay: Map<string, number> | Record<string, number>,
  now = new Date()
): EnrichmentDayPoint[] {
  const map = byDay instanceof Map ? byDay : new Map(Object.entries(byDay));
  const series: EnrichmentDayPoint[] = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    const key = utcDayKey(d);
    series.push({
      t: dayStartUtcMs(key),
      label: key.slice(5),
      credits: map.get(key) || 0,
    });
  }
  return series;
}

/** Company scrapers only — never Hiring Cafe / aggregator source. */
export function nonHiringCafeEnrichmentMatch(sinceDate: Date) {
  return {
    source: { $nin: [AGGREGATOR_SOURCE_HIRING_CAFE, 'hiringcafe'] },
    'enrichment.lastEnrichedAt': { $gte: sinceDate },
    'enrichment.method': { $exists: true, $nin: [null, '', 'none'] },
  };
}

export async function getScoutXEnrichmentMetrics(): Promise<ScoutXEnrichmentMetrics> {
  const dailyCreditBudget = parseInt(process.env.SCRAPE_DO_DAILY_CREDIT_BUDGET || '15000', 10);
  const sinceKey = utcDayKey(new Date(Date.now() - 13 * DAY_MS));
  const sinceDate = new Date(dayStartUtcMs(sinceKey));
  const match = nonHiringCafeEnrichmentMatch(sinceDate);

  const [dayRows, methodRows] = await Promise.all([
    JobBoardListing.aggregate<{ _id: string; credits: number }>([
      { $match: match },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$enrichment.lastEnrichedAt',
              timezone: 'UTC',
            },
          },
          credits: { $sum: { $ifNull: ['$enrichment.creditsSpent', 0] } },
        },
      },
    ]).catch(() => []),
    JobBoardListing.aggregate<{ _id: string; jobs: number; credits: number }>([
      { $match: match },
      {
        $group: {
          _id: '$enrichment.method',
          jobs: { $sum: 1 },
          credits: { $sum: { $ifNull: ['$enrichment.creditsSpent', 0] } },
        },
      },
      { $sort: { jobs: -1 } },
    ]).catch(() => []),
  ]);

  const byDay = new Map<string, number>();
  for (const row of dayRows || []) {
    const key = String(row._id || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    byDay.set(key, Number(row.credits) || 0);
  }

  const series14d = buildCreditSeries14d(byDay);
  const creditsSpentToday = series14d[series14d.length - 1]?.credits || 0;
  const creditsSpentLast14Days = series14d.reduce((sum, p) => sum + p.credits, 0);

  const methods14d: EnrichmentMethodStat[] = (methodRows || []).map((row) => ({
    method: String(row._id || 'unknown'),
    jobs: row.jobs || 0,
    credits: row.credits || 0,
  }));

  return {
    creditsSpentToday,
    dailyCreditBudget,
    creditsSpentLast14Days,
    series14d,
    methods14d,
  };
}
