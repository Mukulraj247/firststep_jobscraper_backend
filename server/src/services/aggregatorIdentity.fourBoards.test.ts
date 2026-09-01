import { describe, expect, it } from 'vitest';
import {
  AGGREGATOR_PROVIDER_CAPITALG,
  AGGREGATOR_PROVIDER_CHOPPINGBLOCK,
  AGGREGATOR_PROVIDER_AIDEVBOARD,
  AGGREGATOR_PROVIDER_STARTUPS_GALLERY,
  applyAggregatorProviderFromUrl,
  aggregatorSourceForRobot,
  isCapitalGUrl,
  isCapitalGJobPostingUrl,
  isChoppingBlockUrl,
  isChoppingBlockJobPostingUrl,
  isAidevboardUrl,
  isAidevboardJobPostingUrl,
  isStartupsGalleryUrl,
  isConsiderBoardUrl,
  isConsiderJobPostingUrl,
  shouldEnrichCapitalGDetails,
  shouldEnrichChoppingBlockDetails,
  shouldEnrichAidevboardDetails,
  usesAggregatorHtmlOnlyEnrichment,
  usesConsiderApplyThenAtsEnrichment,
} from './aggregatorIdentity';

describe('four new aggregators identity', () => {
  it('detects CapitalG Consider URLs', () => {
    const list = 'https://careers.capitalg.com/jobs?locations=United+States&postedSince=P1D';
    const posting =
      'https://careers.capitalg.com/jobs?locations=United+States&weekdayJdUid=12345';
    expect(isCapitalGUrl(list)).toBe(true);
    expect(isConsiderBoardUrl(list)).toBe(true);
    expect(isCapitalGJobPostingUrl(list)).toBe(false);
    expect(isConsiderJobPostingUrl(posting)).toBe(true);
    expect(isCapitalGJobPostingUrl(posting)).toBe(true);
  });

  it('stamps capitalg for ATS-first Consider path', () => {
    const saas: Record<string, unknown> = {};
    applyAggregatorProviderFromUrl('https://careers.capitalg.com/jobs', saas);
    expect(saas.aggregatorProvider).toBe(AGGREGATOR_PROVIDER_CAPITALG);
    expect(saas.enrichCapitalGDetails).toBe(true);
    expect(usesConsiderApplyThenAtsEnrichment('capitalg')).toBe(true);
    expect(usesAggregatorHtmlOnlyEnrichment('capitalg')).toBe(false);
  });

  it('detects Chopping Block detail URLs and html-only enrich', () => {
    expect(isChoppingBlockUrl('https://www.choppingblock.ai/jobs')).toBe(true);
    expect(isChoppingBlockJobPostingUrl('https://www.choppingblock.ai/jobs')).toBe(false);
    expect(
      isChoppingBlockJobPostingUrl(
        'https://www.choppingblock.ai/jobs/machine-learning-engineer-at-openai'
      )
    ).toBe(true);
    const saas: Record<string, unknown> = {};
    applyAggregatorProviderFromUrl('https://www.choppingblock.ai/jobs', saas);
    expect(saas.aggregatorProvider).toBe(AGGREGATOR_PROVIDER_CHOPPINGBLOCK);
    expect(shouldEnrichChoppingBlockDetails({ recording_meta: { saasConfig: saas } })).toBe(true);
    expect(usesAggregatorHtmlOnlyEnrichment('choppingblock')).toBe(true);
  });

  it('detects AI Dev Board job URLs and html/api enrich', () => {
    expect(isAidevboardUrl('https://aidevboard.com/')).toBe(true);
    expect(
      isAidevboardJobPostingUrl('https://aidevboard.com/job/74bd7349-e7f3-4d98-a3f0-ba2a67cb91ec')
    ).toBe(true);
    expect(isAidevboardJobPostingUrl('https://aidevboard.com/')).toBe(false);
    const saas: Record<string, unknown> = {};
    applyAggregatorProviderFromUrl('https://aidevboard.com/', saas);
    expect(saas.aggregatorProvider).toBe(AGGREGATOR_PROVIDER_AIDEVBOARD);
    expect(shouldEnrichAidevboardDetails({ recording_meta: { saasConfig: saas } })).toBe(true);
    expect(usesAggregatorHtmlOnlyEnrichment('aidevboard')).toBe(true);
  });

  it('stamps startups_gallery as list_ats (not html-only)', () => {
    const saas: Record<string, unknown> = {};
    applyAggregatorProviderFromUrl('https://startups.gallery/jobs', saas);
    expect(saas.aggregatorProvider).toBe(AGGREGATOR_PROVIDER_STARTUPS_GALLERY);
    expect(isStartupsGalleryUrl('https://startups.gallery/jobs')).toBe(true);
    expect(usesAggregatorHtmlOnlyEnrichment('startups_gallery')).toBe(false);
    expect(
      aggregatorSourceForRobot({
        recording_meta: { saasConfig: saas },
      })
    ).toBe('startups_gallery');
  });

  it('recognizes capitalg enrich flag', () => {
    expect(
      shouldEnrichCapitalGDetails({
        recording_meta: {
          saasConfig: { aggregatorProvider: 'capitalg', enrichCapitalGDetails: true },
        },
      })
    ).toBe(true);
  });
});
