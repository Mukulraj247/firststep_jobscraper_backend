import { describe, expect, it } from 'vitest';
import {
  AGGREGATOR_PROVIDER_HIRING_CAFE,
  AGGREGATOR_SOURCE_HIRING_CAFE,
  aggregatorProviderForUrl,
  aggregatorSourceForRobot,
  applyAggregatorProviderFromUrl,
  isAggregatorApplyHost,
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

  it('does not overwrite an unknown aggregatorProvider', () => {
    const saas: Record<string, unknown> = { aggregatorProvider: 'other' };
    applyAggregatorProviderFromUrl('https://hiring.cafe/search', saas);
    expect(saas.aggregatorProvider).toBe('other');
  });

  it('re-stamps when URL host disagrees with a known provider', () => {
    const saas: Record<string, unknown> = {
      aggregatorProvider: 'hiring_cafe',
      enrichHiringCafeDetails: true,
    };
    applyAggregatorProviderFromUrl('https://jobs.accel.com/jobs', saas);
    expect(saas.aggregatorProvider).toBe('accel');
    expect(saas.enrichAccelDetails).toBe(true);
    expect(saas.enrichHiringCafeDetails).toBe(false);
  });

  it('isAggregatorApplyHost blocks all aggregator boards', () => {
    expect(isAggregatorApplyHost('hiring.cafe')).toBe(true);
    expect(isAggregatorApplyHost('jobs.accel.com')).toBe(true);
    expect(isAggregatorApplyHost('careers.capitalg.com')).toBe(true);
    expect(isAggregatorApplyHost('startups.gallery')).toBe(true);
    expect(isAggregatorApplyHost('boards.greenhouse.io')).toBe(false);
  });

  it('aggregatorProviderForUrl maps hosts', () => {
    expect(aggregatorProviderForUrl('https://aidevboard.com/')).toBe('aidevboard');
    expect(aggregatorProviderForUrl('https://startups.gallery/jobs')).toBe('startups_gallery');
    expect(aggregatorProviderForUrl('https://jobs.example.com/careers')).toBeNull();
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
