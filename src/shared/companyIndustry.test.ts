import { describe, expect, it } from 'vitest';
import { normalizeCompanyName, resolveIndustryFromCompany } from './companyIndustry';
import { resolveFrozenIndustries, INDUSTRY_RULES_VERSION } from './frozenIndustries';

describe('normalizeCompanyName', () => {
  it('strips the aggregator "see more open positions at" prefix', () => {
    expect(normalizeCompanyName('See more open positions at Instana')).toBe('instana');
    expect(normalizeCompanyName('see more open positions at Arista Networks')).toBe(
      'arista networks'
    );
  });

  it('resolves ticker-style names to the underlying company', () => {
    expect(normalizeCompanyName('NASDAQ: CTSH')).toBe('cognizant');
    expect(normalizeCompanyName('NYSE: LMT')).toBe('lockheed martin');
    expect(normalizeCompanyName('NASDAQ: GOOG, GOOGL')).toBe('google');
  });

  it('drops punctuation and normalizes ampersands', () => {
    expect(normalizeCompanyName('Citizens Bank, N.A.')).toBe('citizens bank n a');
    expect(normalizeCompanyName("Moody's")).toBe('moody s');
    expect(normalizeCompanyName('Burns & McDonnell')).toBe('burns and mcdonnell');
  });
});

describe('resolveIndustryFromCompany — exact tier', () => {
  it('maps head companies', () => {
    expect(resolveIndustryFromCompany('Qualcomm')).toEqual({
      industries: ['Semiconductor'],
      method: 'company_exact',
    });
    expect(resolveIndustryFromCompany('McKesson').industries).toEqual(['Healthcare']);
    expect(resolveIndustryFromCompany('Apple').industries).toEqual([
      'Big Tech',
      'Hardware / Electronics',
    ]);
  });

  it('matches after legal suffixes are stripped', () => {
    expect(resolveIndustryFromCompany('Citizens Bank, N.A.').industries).toEqual(['Banking']);
    expect(resolveIndustryFromCompany('Oracle Corporation').industries).toEqual([
      'Software / SaaS',
    ]);
    expect(resolveIndustryFromCompany('Caterpillar Inc.').industries).toEqual(['Manufacturing']);
  });

  it('resolves through the aggregator prefix', () => {
    expect(resolveIndustryFromCompany('See more open positions at Anthropic').industries).toEqual([
      'Software / SaaS',
    ]);
  });
});

describe('resolveIndustryFromCompany — pattern tier', () => {
  it('catches long-tail hospitals', () => {
    const r = resolveIndustryFromCompany('Carondelet St. Josephs Hospital');
    expect(r).toEqual({ industries: ['Healthcare'], method: 'company_pattern' });
    expect(resolveIndustryFromCompany('Desert Regional Medical Center').industries).toEqual([
      'Healthcare',
    ]);
  });

  it('catches banks, universities and government bodies', () => {
    expect(resolveIndustryFromCompany('Zions Bank Careers').industries).toEqual(['Banking']);
    expect(resolveIndustryFromCompany('Montana State University').industries).toEqual([
      'Education / EdTech',
    ]);
    expect(resolveIndustryFromCompany('State of Washington').industries).toEqual([
      'Government / Public Sector',
    ]);
    expect(resolveIndustryFromCompany('Harris County, Texas').industries).toEqual([
      'Government / Public Sector',
    ]);
  });

  it('catches engineering and construction firms', () => {
    expect(resolveIndustryFromCompany('Everus Construction Group').industries).toEqual([
      'Construction & Engineering',
    ]);
  });

  it('does not treat bare "technologies" or "systems" as software', () => {
    expect(resolveIndustryFromCompany('Rainmaker Technology Corporation').method).toBeNull();
    expect(resolveIndustryFromCompany('Neumo Systems').method).toBeNull();
  });
});

describe('resolveIndustryFromCompany — refuses to guess', () => {
  it('returns nothing for scraper junk', () => {
    for (const junk of [
      'Professional',
      'Public',
      'Early Career',
      'Other Staff',
      'Company Info',
      'Texas Staff HQ',
      'myhrabc',
    ]) {
      expect(resolveIndustryFromCompany(junk).method, junk).toBeNull();
    }
  });

  it('returns nothing for unknown companies and blanks', () => {
    expect(resolveIndustryFromCompany('').method).toBeNull();
    expect(resolveIndustryFromCompany('Hippo70').method).toBeNull();
    expect(resolveIndustryFromCompany('fa-ewgu-saasfaprod1').method).toBeNull();
  });
});

describe('resolveFrozenIndustries — precedence', () => {
  it('sectorIndustry selector always outranks the company map', () => {
    const r = resolveFrozenIndustries({
      sectorIndustry: 'Banking',
      companyName: 'Qualcomm',
      title: 'Engineer',
      isAggregator: true,
    });
    expect(r.frozenIndustries).toEqual(['Banking']);
    expect(r.method).toBe('scrape_alias');
  });

  it('uses row_context for career listings with a selector', () => {
    const r = resolveFrozenIndustries({
      sectorIndustry: 'Manufacturing',
      companyName: 'Google',
      isAggregator: false,
    });
    expect(r.frozenIndustries).toEqual(['Manufacturing']);
    expect(r.method).toBe('row_context');
  });

  it('falls back to the company map for career listings with no selector', () => {
    const r = resolveFrozenIndustries({
      sectorIndustry: '',
      companyName: 'Lockheed Martin',
      title: 'Program Analyst',
      isAggregator: false,
    });
    expect(r.frozenIndustries).toEqual(['Defense', 'Aerospace']);
    expect(r.method).toBe('company_exact');
    expect(r.rulesVersion).toBe(INDUSTRY_RULES_VERSION);
  });

  it('software engineer at a defense employer keeps Defense alongside Software', () => {
    const r = resolveFrozenIndustries({
      sectorIndustry: '',
      companyName: 'Lockheed Martin',
      title: 'Software Engineer',
      isAggregator: false,
    });
    expect(r.frozenIndustries).toContain('Software / SaaS');
    expect(r.frozenIndustries).toContain('Defense');
    expect(r.method).toBe('role_title');
  });

  it('never infers an industry from the job title alone', () => {
    const r = resolveFrozenIndustries({
      sectorIndustry: '',
      companyName: 'Hippo70',
      title: 'Senior Investment Banking Analyst',
      isAggregator: false,
    });
    expect(r.frozenIndustries).toEqual([]);
    expect(r.method).toBe('none');
  });

  it('caps at the per-job industry maximum', () => {
    const r = resolveFrozenIndustries({
      sectorIndustry: 'Banking, Insurance, Manufacturing, Retail',
      companyName: 'Acme',
      isAggregator: true,
    });
    expect(r.frozenIndustries.length).toBeLessThanOrEqual(2);
  });
});

describe('resolveFrozenIndustries — sector parsing', () => {
  it('keeps parenthesized trade lists intact', () => {
    const r = resolveFrozenIndustries({
      sectorIndustry: 'Specialty Trade Contractors (HVAC, Plumbing, Electrical)',
      companyName: 'Acme',
      isAggregator: true,
    });
    expect(r.frozenIndustries).toEqual(['Construction & Engineering']);
    expect(r.method).toBe('scrape_alias');
  });

  it('canonicalizes previously unmatched Hiring Cafe labels', () => {
    const cases: Array<[string, string]> = [
      ['Scientific Research & Development', 'Scientific Research'],
      ['Data Centers & Cloud Infrastructure', 'Cloud Infrastructure'],
      ['Asset & Wealth Management', 'Financial Services'],
      ['Wholesale & Distribution', 'Logistics / Supply Chain'],
      ['Security Services', 'Security Services'],
      ['Marketing & Advertising', 'Marketing & Advertising'],
      ['Grocery & Supermarkets', 'Food & Beverage'],
      ['Behavioral & Mental Health', 'Healthcare'],
    ];
    for (const [raw, expected] of cases) {
      const r = resolveFrozenIndustries({
        sectorIndustry: raw,
        companyName: 'Acme',
        isAggregator: true,
      });
      expect(r.frozenIndustries[0], raw).toBe(expected);
    }
  });
});
