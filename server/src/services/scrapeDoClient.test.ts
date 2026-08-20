import { describe, expect, it } from 'vitest';
import { scrapeTiersToTry } from './scrapeDoClient';

describe('scrapeTiersToTry', () => {
  it('uses the learned tier through super by default', () => {
    expect(scrapeTiersToTry(2)).toEqual([2, 3]);
  });

  it('cheap ATS-fallback path starts at HTML and never uses super', () => {
    expect(
      scrapeTiersToTry(3, { startTier: 1, maxTier: 2, useLearnedTier: false })
    ).toEqual([1, 2]);
  });
});
