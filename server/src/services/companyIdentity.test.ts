import { describe, expect, it } from 'vitest';
import {
  isExcludedJobBoardHost,
  resolveCompanyKey,
} from './companyIdentity';

describe('companyIdentity', () => {
  describe('Tier 2 employer-owned domains', () => {
    const cases: Array<{ url: string; companyKey: string; nameHint?: string }> = [
      {
        url: 'https://jobs.apple.com/en-us/details/200123456/software-engineer',
        companyKey: 'apple.com',
        nameHint: 'Apple',
      },
      {
        url: 'https://enterpriseplatform.dell.com/job/Del-Technologies-Software-Engineer/123',
        companyKey: 'dell.com',
      },
      {
        url: 'https://careers.jpmorganchase.com/us/en/job/210012345/software-engineer',
        companyKey: 'jpmorganchase.com',
      },
      {
        url: 'https://www.capitalonecareers.com/job/mclean/software-engineer/123',
        companyKey: 'capitalonecareers.com',
      },
      {
        url: 'https://apply.deloitte.com/careers/job/123456',
        companyKey: 'deloitte.com',
      },
      {
        url: 'https://www.usaajobs.com/job/software-engineer/123',
        companyKey: 'usaajobs.com',
      },
      {
        url: 'https://vanguardjobs.com/job/software-engineer/123',
        companyKey: 'vanguardjobs.com',
      },
      {
        url: 'https://www.intuit.com/careers/job/software-engineer/123',
        companyKey: 'intuit.com',
      },
    ];

    it.each(cases)('resolves $companyKey from $url', ({ url, companyKey, nameHint }) => {
      const result = resolveCompanyKey(url);
      expect(result).not.toBeNull();
      expect(result?.tier).toBe('employer_domain');
      expect(result?.companyKey).toBe(companyKey);
      expect(result?.confidence).toBe('high');
      if (nameHint) {
        expect(result?.nameHint).toBe(nameHint);
      }
    });
  });

  describe('Tier 1 vendor ATS tenants', () => {
    it('resolves Workday tenant from subdomain', () => {
      const result = resolveCompanyKey(
        'https://hpe.wd5.myworkdayjobs.com/en-US/External/job/San-Jose/Engineer_123'
      );
      expect(result).toEqual(
        expect.objectContaining({
          tier: 'vendor_ats',
          companyKey: 'workday:hpe',
          atsProvider: 'workday',
          confidence: 'high',
        })
      );
    });

    it('resolves EA Workday tenant separately from HPE', () => {
      const ea = resolveCompanyKey(
        'https://ea.wd3.myworkdayjobs.com/en-US/ea_careers/job/Austin/Software-Engineer_123'
      );
      expect(ea?.companyKey).toBe('workday:ea');

      const hpe = resolveCompanyKey(
        'https://hpe.wd5.myworkdayjobs.com/en-US/External/job/San-Jose/Engineer_123'
      );
      expect(hpe?.companyKey).toBe('workday:hpe');
      expect(ea?.companyKey).not.toBe(hpe?.companyKey);
    });

    it('resolves iCIMS tenant from careers subdomain', () => {
      const result = resolveCompanyKey('https://careers-cvshealth.icims.com/jobs/12345/job');
      expect(result).toEqual(
        expect.objectContaining({
          tier: 'vendor_ats',
          companyKey: 'icims:cvshealth',
          atsProvider: 'icims',
        })
      );
    });

    it('resolves Greenhouse board slug', () => {
      const result = resolveCompanyKey('https://boards.greenhouse.io/ramp/jobs/1234567');
      expect(result).toEqual(
        expect.objectContaining({
          tier: 'vendor_ats',
          companyKey: 'greenhouse:ramp',
          atsProvider: 'greenhouse',
        })
      );
    });

    it('resolves Lever tenant from path', () => {
      const result = resolveCompanyKey('https://jobs.lever.co/ramp/abc-123');
      expect(result).toEqual(
        expect.objectContaining({
          tier: 'vendor_ats',
          companyKey: 'lever:ramp',
          atsProvider: 'lever',
        })
      );
    });

    it('resolves ApplicantPro tenant from subdomain', () => {
      const result = resolveCompanyKey('https://mantech.applicantpro.com/jobs/12345.html');
      expect(result).toEqual(
        expect.objectContaining({
          tier: 'vendor_ats',
          companyKey: 'applicantpro:mantech',
          atsProvider: 'applicantpro',
        })
      );
    });

    it('resolves applytojob tenant from subdomain', () => {
      const result = resolveCompanyKey('https://rockymountainprep.applytojob.com/apply/xyz');
      expect(result).toEqual(
        expect.objectContaining({
          tier: 'vendor_ats',
          companyKey: 'applytojob:rockymountainprep',
          atsProvider: 'applytojob',
        })
      );
    });

    it('resolves Jobvite tenant from path on shared host', () => {
      const result = resolveCompanyKey('https://jobs.jobvite.com/acme/job/abc123');
      expect(result).toEqual(
        expect.objectContaining({
          tier: 'vendor_ats',
          companyKey: 'jobvite:acme',
          atsProvider: 'jobvite',
        })
      );
    });
  });

  describe('Tier 0 excluded hosts', () => {
    const excluded = [
      'https://hiring.cafe/job/abc123',
      'https://www.hiringcafe.com/search?q=engineer',
      'https://jobs.accel.com/companies/foo/jobs/bar',
      'https://jobs.sequoiacap.com/jobs/abc',
      'https://www.linkedin.com/jobs/view/123456',
      'https://www.indeed.com/viewjob?jk=abc123',
      'https://www.glassdoor.com/job-listing/software-engineer-JV123',
    ];

    it.each(excluded)('returns null for aggregator/board URL %s', (url) => {
      expect(resolveCompanyKey(url)).toBeNull();
    });

    it('flags known job boards as excluded', () => {
      expect(isExcludedJobBoardHost('www.linkedin.com')).toBe(true);
      expect(isExcludedJobBoardHost('indeed.com')).toBe(true);
      expect(isExcludedJobBoardHost('hiring.cafe')).toBe(true);
      expect(isExcludedJobBoardHost('jobs.apple.com')).toBe(false);
    });
  });

  describe('cross-source dedupe', () => {
    it('maps Dell automation URL and Hiring Cafe-style employer URL to the same key', () => {
      const automation = resolveCompanyKey(
        'https://jobs.dell.com/en/job-round-rock/software-engineer/123'
      );
      const employer = resolveCompanyKey(
        'https://enterpriseplatform.dell.com/job/Del-Technologies-Software-Engineer/123'
      );
      expect(automation?.companyKey).toBe('dell.com');
      expect(employer?.companyKey).toBe('dell.com');
    });

    it('maps Apple jobs regardless of path variant', () => {
      const a = resolveCompanyKey('https://jobs.apple.com/en-us/details/200123456/software-engineer');
      const b = resolveCompanyKey('https://jobs.apple.com/en-us/search?team=AIML');
      expect(a?.companyKey).toBe('apple.com');
      expect(b?.companyKey).toBe('apple.com');
    });
  });

  it('returns null for empty or invalid URLs', () => {
    expect(resolveCompanyKey('')).toBeNull();
    expect(resolveCompanyKey('not-a-url')).toBeNull();
  });
});
