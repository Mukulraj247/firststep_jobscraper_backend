import { describe, expect, it } from 'vitest';
import {
  isUsJobLocation,
  jdBlocksSponsorship,
} from './resolveH1bSponsorship';
import { computeCompanyScore } from './buildSponsorshipProfiles';
import { scoreBrandMatch } from './employerBrandMatcher';
import { employerNameNormalize } from './employerNameNormalize';

describe('isUsJobLocation', () => {
  it('accepts US states and names', () => {
    expect(isUsJobLocation('San Francisco, CA')).toBe(true);
    expect(isUsJobLocation('United States')).toBe(true);
    expect(isUsJobLocation('Remote - USA')).toBe(true);
  });

  it('rejects clear non-US locations', () => {
    expect(isUsJobLocation('Toronto, Canada')).toBe(false);
    expect(isUsJobLocation('London, UK')).toBe(false);
  });

  it('treats empty location as eligible', () => {
    expect(isUsJobLocation('')).toBe(true);
  });
});

describe('jdBlocksSponsorship', () => {
  it('blocks when visaSponsorship is no or JD forbids', () => {
    expect(jdBlocksSponsorship('no', '')).toBe(true);
    expect(jdBlocksSponsorship('yes', 'We will not sponsor visas')).toBe(true);
    expect(jdBlocksSponsorship('yes', 'Competitive benefits')).toBe(false);
  });
});

describe('computeCompanyScore', () => {
  it('scores high for multi-year recent certified volume', () => {
    const y = new Date().getUTCFullYear();
    expect(
      computeCompanyScore({
        certifiedCount: 40,
        yearsActive: [y - 3, y - 2, y - 1, y],
        lastFilingYear: y,
      })
    ).toBe('high');
  });

  it('scores medium for recent but thin history', () => {
    const y = new Date().getUTCFullYear();
    expect(
      computeCompanyScore({
        certifiedCount: 2,
        yearsActive: [y - 1],
        lastFilingYear: y - 1,
      })
    ).toBe('medium');
  });
});

describe('scoreBrandMatch', () => {
  it('auto-band exact alias', () => {
    const brandKey = employerNameNormalize('Amazon').key;
    const brands = [
      {
        brandName: 'Amazon',
        brandNameNormalized: 'amazon',
        brandNameKey: brandKey,
        aliasKeys: [employerNameNormalize('AMAZON.COM SERVICES LLC').key],
        aliases: ['AMAZON.COM SERVICES LLC'],
        source: 'seed' as const,
      },
    ] as any;
    const gov = {
      employerNameKey: employerNameNormalize('AMAZON.COM SERVICES LLC').key,
      employerNameNormalized: 'amazon com services',
      employerNameDisplay: 'AMAZON.COM SERVICES LLC',
    };
    const match = scoreBrandMatch(gov, brands);
    expect(match?.confidence).toBeGreaterThanOrEqual(0.88);
    expect(match?.matchMethod).toBe('exact_alias');
  });
});
