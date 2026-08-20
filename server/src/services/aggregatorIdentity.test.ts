import { describe, expect, it } from 'vitest';
import {
  AGGREGATOR_PROVIDER_HIRING_CAFE,
  AGGREGATOR_SOURCE_HIRING_CAFE,
  aggregatorSourceForRobot,
  applyAggregatorProviderFromUrl,
  isAggregatorRobot,
  isHiringCafeUrl,
  shouldEnrichHiringCafeDetails,
} from './aggregatorIdentity';

describe('aggregatorIdentity', () => {
  it('detects hiring.cafe hosts', () => {
    expect(isHiringCafeUrl('https://hiring.cafe/job/abc')).toBe(true);
    expect(isHiringCafeUrl('https://www.hiringcafe.com/search')).toBe(true);
    expect(isHiringCafeUrl('https://boards.greenhouse.io/acme/jobs/1')).toBe(false);
  });

  it('stamps aggregatorProvider from a Hiring Cafe URL when omitted', () => {
    const saas: Record<string, unknown> = {};
    applyAggregatorProviderFromUrl('https://hiringcafe.com/search?q=eng', saas);
    expect(saas.aggregatorProvider).toBe(AGGREGATOR_PROVIDER_HIRING_CAFE);
    expect(saas.preferAtsCollection).toBe(false);
  });

  it('does not overwrite an existing aggregatorProvider', () => {
    const saas: Record<string, unknown> = { aggregatorProvider: 'other' };
    applyAggregatorProviderFromUrl('https://hiring.cafe/search', saas);
    expect(saas.aggregatorProvider).toBe('other');
  });

  it('does not stamp career-site URLs', () => {
    const saas: Record<string, unknown> = {};
    applyAggregatorProviderFromUrl('https://jobs.example.com/careers', saas);
    expect(saas.aggregatorProvider).toBeUndefined();
  });

  it('detects aggregator robots via saasConfig.provider', () => {
    const robot = {
      recording_meta: { saasConfig: { aggregatorProvider: 'hiring_cafe' } },
    };
    expect(isAggregatorRobot(robot)).toBe(true);
    expect(aggregatorSourceForRobot(robot)).toBe(AGGREGATOR_SOURCE_HIRING_CAFE);
  });

  it('does not treat career robots as aggregators', () => {
    expect(
      isAggregatorRobot({
        recording_meta: { tags: ['role:SWE'], saasConfig: {} },
      })
    ).toBe(false);
    expect(aggregatorSourceForRobot({ recording_meta: { saasConfig: {} } })).toBeNull();
  });

  it('shouldEnrichHiringCafeDetails respects enrichHiringCafeDetails flag', () => {
    const enabled = {
      recording_meta: {
        saasConfig: { aggregatorProvider: 'hiring_cafe', enrichHiringCafeDetails: true },
      },
    };
    const disabled = {
      recording_meta: {
        saasConfig: { aggregatorProvider: 'hiring_cafe', enrichHiringCafeDetails: false },
      },
    };
    expect(shouldEnrichHiringCafeDetails(enabled)).toBe(true);
    expect(shouldEnrichHiringCafeDetails(disabled)).toBe(false);
    expect(shouldEnrichHiringCafeDetails({ recording_meta: { saasConfig: {} } })).toBe(false);
  });
});
