/**
 * Observed regressions from Category QA 1000-job batch audit (2026-09-14).
 */
import { describe, expect, it } from 'vitest';
import { resolveFrozenIndustries } from './frozenIndustries';
import { detectStudentEscape } from './studentEscape';
import { classifyJobLocation } from './frozenLocations';

describe('observed Category QA industry cases', () => {
  it('merges Citi Banking onto Gen AI / software role titles', () => {
    const r = resolveFrozenIndustries({
      title: 'Gen AI Software Engineer - Vice President',
      companyName: 'Citi',
      sectorIndustry: '',
    });
    expect(r.frozenIndustries).toEqual(
      expect.arrayContaining(['Software / SaaS', 'Banking'])
    );
    expect(r.method).toBe('role_title');
  });

  it('uses McKesson company map for non-tech ops titles', () => {
    const r = resolveFrozenIndustries({
      title: 'Janitor',
      companyName: 'Mckesson',
      sectorIndustry: '',
    });
    expect(r.frozenIndustries).toContain('Healthcare');
    expect(r.method).toBe('company_exact');
  });

  it('keeps Salesforce/platform roles as Software even at healthcare employers', () => {
    const r = resolveFrozenIndustries({
      title: 'Lead Salesforce Platform Architect',
      companyName: 'Mckesson',
    });
    expect(r.frozenIndustries).toContain('Software / SaaS');
    expect(r.frozenIndustries).not.toContain('Healthcare');
  });

  it('maps Applied AI / Banking Technology director at Citi to Banking', () => {
    const r = resolveFrozenIndustries({
      title: 'Applied AI Engineering Director for Banking Technology',
      companyName: 'Citi',
      sectorIndustry: '',
    });
    expect(r.frozenIndustries).toContain('Banking');
  });

  it('maps McKesson delivery / janitor ops to Healthcare from company', () => {
    expect(
      resolveFrozenIndustries({
        title: 'Delivery Professional - Parcel Van',
        companyName: 'Mckesson',
      }).frozenIndustries
    ).toContain('Healthcare');
    expect(
      resolveFrozenIndustries({
        title: 'Senior Janitor',
        companyName: 'Mckesson',
      }).frozenIndustries
    ).toContain('Healthcare');
  });
});

describe('observed Category QA student escape cases', () => {
  it('flags intern / co-op titles from ATS title text', () => {
    expect(
      detectStudentEscape({
        title: 'Intern Software Engineer / Agent Engineer - EDA - Poughkeepsie 2027',
        seniorityLevel: '',
      }).studentEscape
    ).toBe(true);
    expect(
      detectStudentEscape({
        title: 'Quality Data Science Co-op- Spring 2027',
        seniorityLevel: 'No Prior Experience Required',
      }).studentEscape
    ).toBe(true);
  });

  it('does not flag senior IC from internship seniority badge alone', () => {
    expect(
      detectStudentEscape({
        title: 'Senior Software Engineer',
        seniorityLevel: 'Internship',
      }).studentEscape
    ).toBe(false);
  });
});

describe('observed Category QA location cases', () => {
  it('resolves Cambridge with NYC/LA to Massachusetts (not MD)', () => {
    const r = classifyJobLocation({
      location: 'Cambridge or New York City or Los Angeles',
      remoteType: 'Onsite',
    });
    expect(r.frozenStates).toEqual(expect.arrayContaining(['MA', 'NY', 'CA']));
    expect(r.method).toBe('unique_city');
  });
});
