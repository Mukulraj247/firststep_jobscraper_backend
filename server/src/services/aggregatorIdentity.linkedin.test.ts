import { describe, expect, it } from 'vitest';
import {
  AGGREGATOR_PROVIDER_LINKEDIN,
  applyAggregatorProviderFromUrl,
  isLinkedInAggregatorRobot,
  isLinkedInJobsUrl,
  validateLinkedInAggregatorUrl,
} from './aggregatorIdentity';

describe('aggregatorIdentity linkedin', () => {
  it('detects LinkedIn jobs URLs', () => {
    expect(
      isLinkedInJobsUrl('https://www.linkedin.com/jobs/search/?keywords=engineer')
    ).toBe(true);
    expect(isLinkedInJobsUrl('https://www.linkedin.com/preload/?_bprMode=vanilla')).toBe(false);
  });

  it('stamps linkedin provider from URL', () => {
    const saas: Record<string, unknown> = {};
    applyAggregatorProviderFromUrl(
      'https://www.linkedin.com/jobs/search/?keywords=data',
      saas
    );
    expect(saas.aggregatorProvider).toBe(AGGREGATOR_PROVIDER_LINKEDIN);
    expect(saas.enrichHiringCafeDetails).toBe(false);
  });

  it('validates linkedin aggregator URLs', () => {
    expect(
      validateLinkedInAggregatorUrl('https://www.linkedin.com/jobs/search/?keywords=x').ok
    ).toBe(true);
    const bad = validateLinkedInAggregatorUrl('https://www.linkedin.com/preload/?x=1');
    expect(bad.ok).toBe(false);
  });

  it('recognizes linkedin aggregator robots', () => {
    expect(
      isLinkedInAggregatorRobot({
        recording_meta: {
          saasConfig: { aggregatorProvider: 'linkedin' },
          tags: ['aggregator'],
        },
      })
    ).toBe(true);
  });
});
