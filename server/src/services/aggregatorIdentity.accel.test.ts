import { describe, expect, it } from 'vitest';
import {
  AGGREGATOR_PROVIDER_ACCEL,
  AGGREGATOR_SOURCE_ACCEL,
  applyAggregatorProviderFromUrl,
  aggregatorSourceForRobot,
  isAccelJobPostingUrl,
  isAccelUrl,
  isAggregatorRobot,
  shouldEnrichAccelDetails,
  shouldEnrichHiringCafeDetails,
} from './aggregatorIdentity';

const LIST = 'https://jobs.accel.com/jobs?filter=eyJzZWFyY2hhYmxlX2xvY2F0aW9ucyI6WyJVbml0ZWQgU3RhdGVzIl19';
const POSTING =
  'https://jobs.accel.com/companies/sapiom-2/jobs/91689603-software-engineer-agent-infrastructure';

describe('aggregatorIdentity accel', () => {
  it('detects Accel list and posting URLs', () => {
    expect(isAccelUrl(LIST)).toBe(true);
    expect(isAccelUrl(POSTING)).toBe(true);
    expect(isAccelJobPostingUrl(LIST)).toBe(false);
    expect(isAccelJobPostingUrl(POSTING)).toBe(true);
    expect(isAccelJobPostingUrl(`${POSTING}#content`)).toBe(true);
    expect(isAccelUrl('https://code.org/careers')).toBe(false);
  });

  it('stamps accel provider from URL without enabling HC enrich', () => {
    const saas: Record<string, unknown> = {};
    applyAggregatorProviderFromUrl(LIST, saas);
    expect(saas.aggregatorProvider).toBe(AGGREGATOR_PROVIDER_ACCEL);
    expect(saas.enrichAccelDetails).toBe(true);
    expect(saas.enrichHiringCafeDetails).toBe(false);
    expect(saas.preferAtsCollection).toBe(false);
  });

  it('recognizes accel aggregator robots and source', () => {
    const robot = {
      recording_meta: {
        saasConfig: { aggregatorProvider: 'accel', enrichAccelDetails: true },
        tags: ['aggregator', 'accel'],
      },
    };
    expect(isAggregatorRobot(robot)).toBe(true);
    expect(shouldEnrichAccelDetails(robot)).toBe(true);
    expect(shouldEnrichHiringCafeDetails(robot)).toBe(false);
    expect(aggregatorSourceForRobot(robot)).toBe(AGGREGATOR_SOURCE_ACCEL);
  });
});
