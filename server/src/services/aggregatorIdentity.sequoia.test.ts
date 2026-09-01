import { describe, expect, it } from 'vitest';
import {
  AGGREGATOR_PROVIDER_SEQUOIA,
  AGGREGATOR_SOURCE_SEQUOIA,
  applyAggregatorProviderFromUrl,
  aggregatorSourceForRobot,
  isSequoiaJobPostingUrl,
  isSequoiaUrl,
  isAggregatorRobot,
  shouldEnrichSequoiaDetails,
  shouldEnrichHiringCafeDetails,
  shouldEnrichAccelDetails,
  usesAggregatorHtmlOnlyEnrichment,
} from './aggregatorIdentity';

const LIST =
  'https://jobs.sequoiacap.com/jobs?jobTypes=Software+Engineer&locations=United+States&postedSince=P1D';
const POSTING =
  'https://jobs.sequoiacap.com/jobs?locations=United+States&weekdayJdUid=1965883';

describe('aggregatorIdentity sequoia', () => {
  it('detects Sequoia list and posting URLs', () => {
    expect(isSequoiaUrl(LIST)).toBe(true);
    expect(isSequoiaUrl(POSTING)).toBe(true);
    expect(isSequoiaJobPostingUrl(LIST)).toBe(false);
    expect(isSequoiaJobPostingUrl(POSTING)).toBe(true);
    expect(isSequoiaUrl('https://jobs.accel.com/jobs')).toBe(false);
  });

  it('stamps sequoia provider from URL without enabling HC/Accel enrich', () => {
    const saas: Record<string, unknown> = {};
    applyAggregatorProviderFromUrl(LIST, saas);
    expect(saas.aggregatorProvider).toBe(AGGREGATOR_PROVIDER_SEQUOIA);
    expect(saas.enrichSequoiaDetails).toBe(true);
    expect(saas.enrichHiringCafeDetails).toBe(false);
    expect(saas.enrichAccelDetails).toBe(false);
    expect(saas.preferAtsCollection).toBe(false);
  });

  it('recognizes sequoia aggregator robots and ATS-first enrichment path', () => {
    const robot = {
      recording_meta: {
        saasConfig: { aggregatorProvider: 'sequoia', enrichSequoiaDetails: true },
        tags: ['aggregator', 'sequoia'],
      },
    };
    expect(isAggregatorRobot(robot)).toBe(true);
    expect(shouldEnrichSequoiaDetails(robot)).toBe(true);
    expect(shouldEnrichHiringCafeDetails(robot)).toBe(false);
    expect(shouldEnrichAccelDetails(robot)).toBe(false);
    expect(aggregatorSourceForRobot(robot)).toBe(AGGREGATOR_SOURCE_SEQUOIA);
    expect(usesAggregatorHtmlOnlyEnrichment('sequoia')).toBe(false);
    expect(usesAggregatorHtmlOnlyEnrichment('hiring_cafe')).toBe(true);
    expect(usesAggregatorHtmlOnlyEnrichment('accel')).toBe(true);
  });
});
