import { describe, expect, it } from 'vitest';
import {
  FROZEN_INDUSTRIES,
  INDUSTRY_RULES_VERSION,
  canonicalFrozenIndustry,
  normalizeFrozenIndustryFilter,
  resolveFrozenIndustries,
} from './frozenIndustries';

describe('frozen industry taxonomy', () => {
  it('has unique controlled labels', () => {
    expect(FROZEN_INDUSTRIES.length).toBeGreaterThan(20);
    expect(new Set(FROZEN_INDUSTRIES).size).toBe(FROZEN_INDUSTRIES.length);
  });

  it('canonicalizes aliases used by career Job Metadata and HC scrapes', () => {
    expect(canonicalFrozenIndustry('Banking')).toBe('Banking');
    expect(canonicalFrozenIndustry('fintech')).toBe('FinTech');
    expect(canonicalFrozenIndustry('Professional Services')).toBe('Consulting');
    expect(canonicalFrozenIndustry('not-a-real-industry')).toBeNull();
  });
});

describe('normalizeFrozenIndustryFilter', () => {
  it('parses comma-separated values in taxonomy order', () => {
    expect(normalizeFrozenIndustryFilter('FinTech,Banking')).toEqual(['Banking', 'FinTech']);
    expect(normalizeFrozenIndustryFilter(['Banking', 'unknown'])).toEqual(['Banking']);
  });
});

describe('resolveFrozenIndustries', () => {
  it('career path: normalizes rowContext sectorIndustry to frozenIndustries', () => {
    const result = resolveFrozenIndustries({
      sectorIndustry: 'Banking',
      title: 'Software Engineer',
      companyName: 'JPMorgan',
      isAggregator: false,
    });
    expect(result.frozenIndustries).toEqual(['Banking']);
    expect(result.method).toBe('row_context');
    expect(result.rulesVersion).toBe(INDUSTRY_RULES_VERSION);
  });

  it('career path: resolves from the company map when sectorIndustry is blank', () => {
    const result = resolveFrozenIndustries({
      sectorIndustry: '',
      title: 'Engineer',
      companyName: 'Goldman Sachs',
      isAggregator: false,
    });
    expect(result.frozenIndustries).toEqual(['Investment Banking', 'Financial Services']);
    expect(result.method).toBe('company_exact');
  });

  it('career path: does not invent industry from title when the company is unknown', () => {
    const result = resolveFrozenIndustries({
      sectorIndustry: '',
      title: 'Investment Banking Analyst, Healthcare Coverage',
      companyName: 'Hippo70',
      isAggregator: false,
    });
    expect(result.frozenIndustries).toEqual([]);
    expect(result.method).toBe('none');
  });

  it('aggregator path: maps scraped industry string', () => {
    const result = resolveFrozenIndustries({
      sectorIndustry: 'Professional Services, Technology',
      title: 'Analyst',
      companyName: 'Acme',
      source: 'hiring_cafe',
      isAggregator: true,
    });
    expect(result.frozenIndustries).toContain('Consulting');
    expect(result.method).toBe('scrape_alias');
  });

  it('aggregator path: company map handles known companies before keyword hints', () => {
    const result = resolveFrozenIndustries({
      sectorIndustry: '',
      title: 'SWE',
      companyName: 'Stripe',
      source: 'hiring_cafe',
      isAggregator: true,
    });
    expect(result.frozenIndustries).toEqual(['FinTech']);
    expect(result.method).toBe('company_exact');
  });

  it('aggregator path: keyword hints remain the last resort', () => {
    const result = resolveFrozenIndustries({
      sectorIndustry: '',
      title: 'Analyst, Kaiser Permanente clinic operations',
      companyName: 'Hippo70',
      source: 'hiring_cafe',
      isAggregator: true,
    });
    expect(result.frozenIndustries).toEqual(['Healthcare']);
    expect(result.method).toBe('aggregator_hint');
  });
});
