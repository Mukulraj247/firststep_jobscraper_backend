import { describe, expect, it } from 'vitest';
import {
  detectWorkdayBoard,
  detectWorkableBoard,
  detectRecruiteeBoard,
  detectBambooHrBoard,
  detectPersonioBoard,
  detectBreezyBoard,
  detectGoogleCareersBoard,
  detectIbmCareersBoard,
  detectExtraAtsBoard,
  detectTalentBrewWorkdayBoard,
  workdayAppliedFacetsFromUrl,
} from './atsFreeBoardExtras';

describe('atsFreeBoardExtras detection', () => {
  it('parses Workday tenant/site without rewriting URL', () => {
    const d = detectWorkdayBoard(
      'https://nationwide.wd5.myworkdayjobs.com/en-US/Nationwide/?q=engineer'
    );
    expect(d).toEqual({
      provider: 'workday',
      companyHint: 'Nationwide',
      listApiUrl:
        'https://nationwide.wd5.myworkdayjobs.com/wday/cxs/nationwide/Nationwide/jobs',
    });
  });

  it('detects hostname-only Workday boards with known tenant site slug', () => {
    const d = detectWorkdayBoard('https://broadcom.wd1.myworkdayjobs.com');
    expect(d?.provider).toBe('workday');
    expect(d?.companyHint).toBe('Broadcom');
    expect(d?.listApiUrl).toBe(
      'https://broadcom.wd1.myworkdayjobs.com/wday/cxs/broadcom/External_Career/jobs'
    );
  });

  it('detects Talent Brew marketing hosts via mapped Workday CXS board', () => {
    const d = detectTalentBrewWorkdayBoard('https://jobs.empower.com/search-jobs');
    expect(d?.provider).toBe('workday');
    expect(d?.companyHint).toBe('Empower');
    expect(d?.listApiUrl).toBe(
      'https://empower.wd12.myworkdayjobs.com/wday/cxs/empower/empower/jobs'
    );
    expect(detectExtraAtsBoard('https://jobs.empower.com')?.provider).toBe('workday');
  });

  it('detects mid-market ATS widgets', () => {
    expect(detectWorkableBoard('https://apply.workable.com/foo/j/ABC')?.listApiUrl).toContain(
      '/accounts/foo'
    );
    expect(detectRecruiteeBoard('https://foo.recruitee.com/o/bar')?.provider).toBe('recruitee');
    expect(detectBambooHrBoard('https://foo.bamboohr.com/careers')?.listApiUrl).toContain(
      '/careers/list'
    );
    expect(detectPersonioBoard('https://foo.jobs.personio.de/')?.listApiUrl).toContain('.de/xml');
    expect(detectBreezyBoard('https://foo.breezy.hr/')?.listApiUrl).toContain('/json');
  });

  it('Google list vs detail and IBM SearchJobs', () => {
    expect(
      detectGoogleCareersBoard(
        'https://www.google.com/about/careers/applications/jobs/results?q=x'
      )?.provider
    ).toBe('googlecareers');
    expect(
      detectGoogleCareersBoard(
        'https://www.google.com/about/careers/applications/jobs/results/99-slug'
      )
    ).toBeNull();
    expect(
      detectGoogleCareersBoard(
        'https://careers.google.com/jobs/results/?q=Software&sort_by=relevance'
      )?.provider
    ).toBe('googlecareers');
    expect(
      detectIbmCareersBoard('https://careers.ibm.com/SearchJobs?location=US')?.provider
    ).toBe('ibmcareers');
    expect(detectIbmCareersBoard('https://careers.ibm.com/')).toBeNull();
  });

  it('rewrites ibm.com marketing careers search onto Avature SearchJobs', () => {
    const start =
      'https://www.ibm.com/in-en/careers/search?field_keyword_08[0]=Software%20Engineering&field_keyword_08[1]=Infrastructure%20%26%20Technology&field_keyword_08[2]=Data%20%26%20Analytics&field_keyword_08[3]=Security&field_keyword_05[0]=United%20States&sort=dcdate_desc';
    const d = detectIbmCareersBoard(start);
    expect(d?.provider).toBe('ibmcareers');
    expect(d?.listApiUrl).toMatch(/^https:\/\/careers\.ibm\.com\/SearchJobs/i);
    expect(d?.listApiUrl).toContain('location=United');
    expect(detectIbmCareersBoard('https://www.ibm.com/employment/')).toBeNull();
    expect(detectIbmCareersBoard('https://www.ibm.com/cloud/jobs')).toBeNull();
    expect(detectIbmCareersBoard('https://ibm.com/careers/search')?.listApiUrl).toBe(
      'https://careers.ibm.com/SearchJobs'
    );
  });

  it('detectExtraAtsBoard prefers Workday when host matches', () => {
    expect(
      detectExtraAtsBoard('https://intel.wd1.myworkdayjobs.com/External')?.provider
    ).toBe('workday');
  });

  it('workdayAppliedFacetsFromUrl copies hashed locationCountry and ignores pagination', () => {
    const facets = workdayAppliedFacetsFromUrl(
      'https://intel.wd1.myworkdayjobs.com/External?q=engineer&locationCountry=bc33aa3152ec42d4995f4791a106ed09&page=2'
    );
    expect(facets).toEqual({
      locationCountry: ['bc33aa3152ec42d4995f4791a106ed09'],
    });
  });
});
