import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  detectAts,
  detectAtsBoard,
  normalizeCareerSearchKeywords,
  parseSmartRecruitersBoardFilters,
  parseJibeBoardFilters,
  parseWayfairBoardFilters,
  buildWayfairSearchRequestBody,
  fetchWayfairBoardJobsInBrowser,
  filterSmartRecruitersPostings,
  shouldSkipScrapeDoUrl,
  shouldNeverScrapeDoUrl,
  fetchAtsJob,
  fetchAtsBoardJobs,
  shouldSkipAtsBoardForUiPagination,
  shouldPreferAtsBoardOverUiPagination,
  atsHttpClient,
  parseFindlyConfigFromHtml,
  findlyFacetsFromUrl,
  looksLikeFindlyBoard,
  looksLikeSuccessFactorsBoard,
  confirmSuccessFactorsHtml,
  parseSuccessFactorsJobsHtml,
  normalizeSuccessFactorsStartUrl,
  mapIbmCareersHtml,
  mapOracleCloud,
  parseOracleCandidateExperienceRoute,
  parseOracleVanityFusionHost,
  looksLikeOracleVanityHashBoard,
  resolveOracleHashVanityFusionHost,
  assertSafeFindlyApiBase,
  looksLikePhenomBoard,
  looksLikeTalentBrewBoard,
  parseTalentBrewBoardFilters,
  parseTalentBrewResultsHtml,
  looksLikeZwayamBoard,
  parseZwayamBoardFilters,
  looksLikeNasActivateBoard,
  looksLikeHappyDanceBoard,
  looksLikeWorkdayBoard,
  looksLikeGreenhouseBoard,
  isSalesforceMarketingJobsUrl,
  applyAtsBoardSearchAndPageLimits,
  startUrlHasCollectionFilters,
  parsePhenomConfigFromHtml,
  buildPhenomWidgetsRequest,
} from './atsAdapters';
import fs from 'fs';
import path from 'path';

describe('startUrlHasCollectionFilters', () => {
  const cases: Array<{ url: string; expect: boolean; name: string }> = [
    {
      name: 'Box filtered Engineering URL',
      url: 'https://careers.box.com/en/jobs/?search=&location=Austin%2C+Texas%2C+United+States&team=Engineering&pagesize=20#results',
      expect: true,
    },
    {
      name: 'Box unfiltered list',
      url: 'https://careers.box.com/en/jobs/',
      expect: false,
    },
    {
      name: 'pagesize and hash only',
      url: 'https://careers.box.com/en/jobs/?pagesize=20#results',
      expect: false,
    },
    {
      name: 'Greenhouse board token only',
      url: 'https://boards.greenhouse.io/stripe',
      expect: false,
    },
    {
      name: 'Greenhouse location query',
      url: 'https://boards.greenhouse.io/stripe?location=New+York',
      expect: true,
    },
    {
      name: 'Workday host only',
      url: 'https://intel.wd1.myworkdayjobs.com/External',
      expect: false,
    },
    {
      name: 'Workday searchText',
      url: 'https://intel.wd1.myworkdayjobs.com/External?q=engineer',
      expect: true,
    },
    {
      name: 'Workday locationCountry facet',
      url: 'https://intel.wd1.myworkdayjobs.com/External?locationCountry=bc33aa3152ec42d4995f4791a106ed09',
      expect: true,
    },
    {
      name: 'Google results without q',
      url: 'https://careers.google.com/jobs/results/',
      expect: false,
    },
    {
      name: 'Google results with q',
      url: 'https://careers.google.com/jobs/results/?q=Software',
      expect: true,
    },
    {
      name: 'BoA without searchstring',
      url: 'https://careers.bankofamerica.com/en-us/job-search',
      expect: false,
    },
    {
      name: 'BoA with keywords',
      url: 'https://careers.bankofamerica.com/en-us/job-search?keywords=data',
      expect: true,
    },
    {
      name: 'SmartRecruiters board only',
      url: 'https://jobs.smartrecruiters.com/AcmeCorp',
      expect: false,
    },
    {
      name: 'SmartRecruiters categories',
      url: 'https://jobs.smartrecruiters.com/AcmeCorp?categories=Engineering',
      expect: true,
    },
    {
      name: 'Phenom category landing path',
      url: 'https://careers.adobe.com/us/en/c/engineering-and-product-jobs',
      expect: true,
    },
    {
      name: 'empty search param is not a filter',
      url: 'https://careers.box.com/en/jobs/?search=',
      expect: false,
    },
    {
      name: 'SX81AH65 Box robot URL',
      url: 'https://careers.box.com/en/jobs/?search=&location=Austin%2C+Texas%2C+United+States&location=US+Remote+-+California+-+San+Diego+Area&team=Engineering&team=IT&team=Security&pagesize=20#results',
      expect: true,
    },
    {
      name: 'Cardinal Health NAS Activate category + country',
      url: 'https://jobs.cardinalhealth.com/search/searchjobs?regionalcountry=United+States&categoryid=a266442d-10a4-4adf-9806-354dc8644a33',
      expect: true,
    },
    {
      name: 'Intuit Talent Brew /search-jobs with tracking query only',
      url: 'https://jobs.intuit.com/search-jobs?cid=directBookmarked_directBookmarked&_gl=1*9qw10m*_gcl_au*NDIxNDI2NjkyLjE3ODc2NDUyMzg.*_ga*OTQ3MDE5NTg5LjE3ODc2NDUyNDI.*_ga_B0XHEYG9RN*czE3ODc2NDUyNDIkbzEkZzAkdDE3ODc2NDUyNDIkajYwJGwwJGgw',
      expect: true,
    },
    {
      name: 'Intuit Talent Brew /search-jobs with no query',
      url: 'https://jobs.intuit.com/search-jobs',
      expect: true,
    },
    {
      name: "Moody's Talent Brew SEO path filters",
      url: 'https://careers.moodys.com/en/search-jobs/technology/United%20States/49841/1/2/6252001/39x7599983215332/-98x5/50/2',
      expect: true,
    },
    {
      name: 'Empower Talent Brew→Workday marketing /search-jobs is not a collection filter shell',
      url: 'https://jobs.empower.com/search-jobs',
      expect: false,
    },
  ];

  it.each(cases)('$name', ({ url, expect: want }) => {
    expect(startUrlHasCollectionFilters(url)).toBe(want);
  });
});

describe('Findly API base validation', () => {
  it('rejects an HTML-derived internal API base', () => {
    expect(() => assertSafeFindlyApiBase('http://169.254.169.254/latest/')).toThrow(/Findly/i);
  });

  it('allows the known Findly API base', () => {
    expect(assertSafeFindlyApiBase('https://jobsapi-internal.m-cloud.io/api/')).toContain(
      'm-cloud.io'
    );
  });
});

describe('detectAts', () => {
  it('detects Greenhouse board URLs', () => {
    const d = detectAts('https://boards.greenhouse.io/stripe/jobs/12345');
    expect(d?.provider).toBe('greenhouse');
    expect(d?.apiUrl).toContain('boards-api.greenhouse.io/v1/boards/stripe/jobs/12345');
  });

  it('detects Stripe Greenhouse vanity career listing URLs', () => {
    const d = detectAts(
      'https://stripe.com/careers/listing/backend-engineer-core-technology/6042172'
    );
    expect(d?.provider).toBe('greenhouse');
    expect(d?.companyHint).toBe('stripe');
    expect(d?.apiUrl).toContain('boards-api.greenhouse.io/v1/boards/stripe/jobs/6042172');
  });

  it('detects Stripe Greenhouse vanity URLs with gh_jid', () => {
    const d = detectAts('https://stripe.com/jobs/search?gh_jid=6042172');
    expect(d?.provider).toBe('greenhouse');
    expect(d?.apiUrl).toContain('/boards/stripe/jobs/6042172');
  });

  it('detects Microsoft Careers job detail URLs', () => {
    expect(
      detectAts('https://jobs.careers.microsoft.com/global/en/job/1810126/software-engineer')
        ?.provider
    ).toBe('microsoftcareers');
    expect(
      detectAts('https://careers.microsoft.com/us/en/job/1810126/software-engineer')?.provider
    ).toBe('microsoftcareers');
  });

  it('detects Salesforce legacy URLs as Workday postings', () => {
    const d = detectAts(
      'https://salesforce.com/company/careers/jobs/JR334544/lead-software-engineer-cloud-erp-finance'
    );
    expect(d?.provider).toBe('workday');
    expect(d?.companyHint).toBe('Salesforce');
    expect(d?.apiUrl).toContain('salesforce.wd12.myworkdayjobs.com/wday/cxs/salesforce');
  });

  it('detects Lever posting URLs', () => {
    const d = detectAts('https://jobs.lever.co/netflix/abc-def');
    expect(d?.provider).toBe('lever');
    expect(d?.apiUrl).toContain('api.lever.co/v0/postings/netflix/abc-def');
  });

  it('detects Workable shortcode URLs', () => {
    const d = detectAts('https://apply.workable.com/acme/j/ABCDEF');
    expect(d?.provider).toBe('workable');
    expect(d?.apiUrl).toContain('apply.workable.com/api/v1/widget/accounts/acme/jobs/ABCDEF');
  });

  it('returns null for non-ATS hosts', () => {
    expect(detectAts('https://careers.example.com/jobs/1')).toBeNull();
  });

  it('detects Oracle Cloud HCM Candidate Experience job URLs', () => {
    const d = detectAts(
      'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210686668?keyword=x'
    );
    expect(d?.provider).toBe('oraclecloud');
    expect(d?.companyHint).toBe('JPMorgan Chase');
    expect(d?.apiUrl).toContain('recruitingCEJobRequisitionDetails');
    expect(d?.apiUrl).toContain('210686668');
    expect(d?.apiUrl).toContain('CX_1001');
  });

  it('detects Oracle HCM Candidate Experience on an employer vanity host', () => {
    const d = detectAts(
      'https://enterpriseplatform.dell.com/hcmUI/CandidateExperience/en/sites/careers/job/R288262'
    );
    expect(d?.provider).toBe('oraclecloud');
    expect(d?.companyHint).toBe('Dell');
    expect(d?.apiUrl).toContain('enterpriseplatform.dell.com/hcmRestApi');
    expect(decodeURIComponent(d?.apiUrl || '')).toContain('Id="R288262"');
  });

  it('does not trust arbitrary Oracle HCM vanity hosts', () => {
    expect(
      detectAts('https://127.0.0.1/hcmUI/CandidateExperience/en/sites/careers/job/123')
    ).toBeNull();
  });

  it('detects Oracle careers vanity job URLs and targets the HCM detail API', () => {
    const d = detectAts(
      'https://careers.oracle.com/en/sites/jobsearch/job/342043?lastSelectedFacet=CATEGORIES'
    );
    expect(d?.provider).toBe('oraclecloud');
    expect(d?.companyHint).toBe('Oracle');
    expect(d?.apiUrl).toContain('eeho.fa.us2.oraclecloud.com');
    expect(decodeURIComponent(d?.apiUrl || '')).toContain('Id="342043"');
    expect(decodeURIComponent(d?.apiUrl || '')).toContain('siteNumber=jobsearch');
  });

  it('ignores Oracle vanity non-job paths', () => {
    expect(
      detectAts('https://careers.oracle.com/en/sites/jobsearch/join-talent-community')
    ).toBeNull();
  });

  it('detects IBM Careers JobDetail URLs', () => {
    const d = detectAts(
      'https://careers.ibm.com/en_IN/careers/JobDetail?jobId=119566&source=WEB_Search_INDIA'
    );
    expect(d?.provider).toBe('ibmcareers');
    expect(d?.companyHint).toBe('IBM');
    expect(d?.apiUrl).toContain('jobId=119566');
  });

  it('does not treat IBM SearchJobs?jobId as a detail page', () => {
    expect(
      detectAts('https://careers.ibm.com/en_US/careers/SearchJobs?jobId=119566')
    ).toBeNull();
  });

  it('detects Greenhouse job-boards host URLs', () => {
    const d = detectAts('https://job-boards.greenhouse.io/acme/jobs/555');
    expect(d?.provider).toBe('greenhouse');
    expect(d?.apiUrl).toContain('boards-api.greenhouse.io/v1/boards/acme/jobs/555');
  });

  it('detects generic Workday myworkdayjobs URLs', () => {
    const d = detectAts(
      'https://intel.wd1.myworkdayjobs.com/en-US/External/job/Santa-Clara/Software-Engineer_JR0245678'
    );
    expect(d?.provider).toBe('workday');
    expect(d?.companyHint).toBe('Intel');
    expect(d?.apiUrl).toBe('https://intel.wd1.myworkdayjobs.com/wday/cxs/intel/External');
  });

  it('detects Workday R-requisition URLs without a locale prefix', () => {
    const d = detectAts(
      'https://td.wd3.myworkdayjobs.com/TD_Bank_Careers/job/Toronto/Analyst_R12345'
    );
    expect(d?.provider).toBe('workday');
    expect(d?.apiUrl).toContain('/wday/cxs/td/TD_Bank_Careers');
  });

  it('detects Adobe Workday apply URLs used on the Phenom career site', () => {
    const d = detectAts(
      'https://adobe.wd5.myworkdayjobs.com/external_experienced/job/San-Jose/Senior-Software-Engineer_R147125-1/apply'
    );
    expect(d?.provider).toBe('workday');
    expect(d?.companyHint).toBe('Adobe');
    expect(d?.apiUrl).toBe(
      'https://adobe.wd5.myworkdayjobs.com/wday/cxs/adobe/external_experienced'
    );
  });

  it('detects Oracle requisition preview URLs as HCM details', () => {
    const d = detectAts(
      'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/requisitions/preview/210686668'
    );
    expect(d?.provider).toBe('oraclecloud');
    expect(decodeURIComponent(d?.apiUrl || '')).toContain('Id="210686668"');
  });

  it('detects Eightfold position URLs', () => {
    const d = detectAts('https://paypal.eightfold.ai/careers?pid=18812&domain=paypal.com');
    expect(d?.provider).toBe('eightfold');
    expect(d?.apiUrl).toContain('paypal.eightfold.ai/api/apply/v2/jobs/18812');
  });

  it('detects NVIDIA PCSX job detail URLs as Phenom apply API posts', () => {
    const d = detectAts('https://jobs.nvidia.com/careers/job/893395760139');
    expect(d?.provider).toBe('phenom');
    expect(d?.companyHint).toBe('Nvidia');
    expect(d?.apiUrl).toBe('https://jobs.nvidia.com/api/apply/v2/jobs/893395760139');
  });

  it('detects NVIDIA PCSX list URLs with pid as Phenom apply API posts', () => {
    const d = detectAts(
      'https://jobs.nvidia.com/careers?start=0&location=united+states&pid=893394926415&sort_by=timestamp'
    );
    expect(d?.provider).toBe('phenom');
    expect(d?.apiUrl).toBe('https://jobs.nvidia.com/api/apply/v2/jobs/893394926415');
  });

  it('does not treat NVIDIA list shells without a job id as detail ATS', () => {
    expect(detectAts('https://jobs.nvidia.com/careers?location=united+states')).toBeNull();
  });

  it('detects Qualcomm PCSX job detail and list pid URLs as Phenom apply API posts', () => {
    const detail = detectAts('https://careers.qualcomm.com/careers/job/446717433364');
    expect(detail?.provider).toBe('phenom');
    expect(detail?.companyHint).toBe('Qualcomm');
    expect(detail?.apiUrl).toBe('https://careers.qualcomm.com/api/apply/v2/jobs/446717433364');

    const list = detectAts(
      'https://careers.qualcomm.com/careers?start=0&location=united+states&pid=446717433364&sort_by=timestamp&filter_job_family=software+engineering'
    );
    expect(list?.provider).toBe('phenom');
    expect(list?.apiUrl).toBe('https://careers.qualcomm.com/api/apply/v2/jobs/446717433364');
  });

  it('detects iCIMS job URLs', () => {
    const d = detectAts('https://staff-emory.icims.com/jobs/12345/registered-nurse/job');
    expect(d?.provider).toBe('icims');
    expect(d?.companyHint).toBe('Emory');
  });

  it('detects Taleo jobdetail URLs', () => {
    const d = detectAts(
      'https://zionsbancorp.taleo.net/careersection/2/jobdetail.ftl?job=1602214'
    );
    expect(d?.provider).toBe('taleo');
    expect(d?.apiUrl).toContain('zionsbancorp.taleo.net');
  });

  it('detects Njoyn job listing URLs', () => {
    const d = detectAts(
      'https://cgi.njoyn.com/CGI/xweb/Xweb.asp?CLID=21001&page=joblisting&JobID=J021234'
    );
    expect(d?.provider).toBe('njoyn');
  });

  it('skips scrape.do for Workday, Taleo, and LinkedIn CDN hosts', () => {
    expect(shouldSkipScrapeDoUrl('https://intel.wd1.myworkdayjobs.com/en-US/External/job/x_JR1')).toBe(
      true
    );
    expect(
      shouldSkipScrapeDoUrl('https://zionsbancorp.taleo.net/careersection/2/jobdetail.ftl?job=1')
    ).toBe(true);
    expect(shouldSkipScrapeDoUrl('https://media.licdn.com/dms/image/foo')).toBe(true);
    expect(shouldSkipScrapeDoUrl('https://careers.example.com/job/1')).toBe(false);
  });

  it('never-scrape list is only junk/CDN, not career ATS hosts', () => {
    expect(shouldNeverScrapeDoUrl('https://media.licdn.com/dms/image/foo')).toBe(true);
    expect(shouldNeverScrapeDoUrl('https://careers.ford.com/us/en/job/JR123')).toBe(false);
    expect(shouldNeverScrapeDoUrl('https://hiringcafe.com/job/abc')).toBe(false);
  });

  it('detects Apple job detail URLs', () => {
    const d = detectAts('https://jobs.apple.com/en-us/details/200612345/software-engineer');
    expect(d?.provider).toBe('applejobs');
    expect(d?.companyHint).toBe('Apple');
  });

  it('detects Amazon.jobs posting URLs', () => {
    const d = detectAts('https://www.amazon.jobs/en/jobs/1234567/sde');
    expect(d?.provider).toBe('careerhtml');
    expect(d?.companyHint).toBe('Amazon');
  });

  it('detects Paylocity, Jobvite, and JazzHR applytojob URLs', () => {
    expect(detectAts('https://recruiting.paylocity.com/Recruiting/Jobs/Details/12345')?.provider).toBe(
      'careerhtml'
    );
    expect(detectAts('https://jobs.jobvite.com/acme/job/abc123')?.provider).toBe('careerhtml');
    expect(detectAts('https://rockymountainprep.applytojob.com/apply/xyz')?.provider).toBe(
      'careerhtml'
    );
  });

  it('detects Phenom-style Ford / Truist / PwC job URLs', () => {
    expect(detectAts('https://careers.ford.com/us/en/job/JR123/software-engineer')?.provider).toBe(
      'careerhtml'
    );
    expect(detectAts('https://careers.truist.com/us/en/job/R01234/teller')?.companyHint).toBe(
      'Truist Financial Corporation'
    );
    expect(detectAts('https://jobs-us.pwc.com/us/en/job/12345/consultant')?.companyHint).toBe('PwC');
  });

  it('does not treat HiringCafe as ATS', () => {
    expect(detectAts('https://hiringcafe.com/job/abc')).toBeNull();
    expect(detectAts('https://hiring.cafe/job/abc')).toBeNull();
    expect(shouldSkipScrapeDoUrl('https://hiringcafe.com/job/abc')).toBe(false);
  });
});

describe('fetchAtsJob Phenom PCSX', () => {
  let getSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getSpy = vi.spyOn(atsHttpClient, 'get');
  });

  afterEach(() => {
    getSpy.mockRestore();
  });

  it('loads NVIDIA job details from the public apply API', async () => {
    getSpy.mockResolvedValue({
      status: 200,
      data: {
        id: 893395760139,
        name: 'ASIC Verification Engineer - GPU',
        location: 'US, CA, Santa Clara',
        locations: ['US, CA, Santa Clara', 'US, NC, Durham'],
        type: 'FULL_TIME',
        job_description:
          '<p>NVIDIA is seeking elite ASIC Verification Engineers to verify the design and implementation of the world leading SoCs.</p><p>You will write test plans, build verification environments, and partner with architecture and design.</p>',
      },
    } as any);

    const result = await fetchAtsJob('https://jobs.nvidia.com/careers/job/893395760139');
    expect(result?.provider).toBe('phenom');
    expect(result?.externalJobId).toBe('893395760139');
    expect(result?.fields.jobTitle).toBe('ASIC Verification Engineer - GPU');
    expect(result?.fields.companyName).toMatch(/nvidia/i);
    expect(result?.fields.jobDescription).toMatch(/ASIC Verification Engineers/i);
    expect(result?.fields.location).toContain('Santa Clara');
    expect(String(getSpy.mock.calls[0]?.[0])).toContain(
      'jobs.nvidia.com/api/apply/v2/jobs/893395760139'
    );
  });

  it('loads Qualcomm job details from the public apply API', async () => {
    getSpy.mockResolvedValue({
      status: 200,
      data: {
        id: 446717433364,
        name: 'IT Engineer, Staff',
        location: 'San Diego, California, United States of America',
        type: 'ATS',
        job_description:
          '<p>Qualcomm is seeking an IT Engineer.</p><p>Responsibilities include building verification environments and partnering with architecture.</p><p>Minimum qualifications: Bachelor degree and 5 years of experience.</p>',
      },
    } as any);

    const result = await fetchAtsJob(
      'https://careers.qualcomm.com/careers?pid=446717433364&filter_job_family=software+engineering'
    );
    expect(result?.provider).toBe('phenom');
    expect(result?.externalJobId).toBe('446717433364');
    expect(result?.fields.jobTitle).toBe('IT Engineer, Staff');
    expect(result?.fields.employmentType).toBe('');
    expect(result?.fields.jobDescription).toMatch(/Minimum qualifications/i);
    expect(String(getSpy.mock.calls[0]?.[0])).toContain(
      'careers.qualcomm.com/api/apply/v2/jobs/446717433364'
    );
  });
});

describe('mapOracleCloud', () => {
  it('maps full Oracle HCM details, flex experience, salary, and a usable brand logo', () => {
    const fields = mapOracleCloud(
      {
        items: [
          {
            Id: '342043',
            Title: 'Senior Platform Software Engineer - Agentic AI Project',
            Category: 'Product and Research',
            PrimaryLocation: 'Nashville, TN, United States',
            JobSchedule: 'Full time',
            ExternalPostedStartDate: '2026-08-13T23:05:17+00:00',
            ExternalDescriptionStr: '<p>Build the region automation service using AI.</p>',
            ExternalResponsibilitiesStr:
              '<p>Responsibilities</p><ul><li>Design distributed cloud services</li></ul>',
            ExternalQualificationsStr:
              'Basic Qualifications<br>4+ years of software development<br>' +
              'US: Hiring Range in USD from: $92,500 to $209,500 per annum.',
            CorporateDescriptionStr: '<p>About Oracle and its benefits.</p>',
            requisitionFlexFields: [
              { Prompt: 'Years', Value: '3 to 5+ years' },
              { Prompt: 'Role', Value: 'Individual Contributor' },
            ],
          },
        ],
      },
      'Oracle',
      'https://careers.oracle.com/en/sites/jobsearch/job/342043'
    );

    expect(fields.jobDescription).toContain('Design distributed cloud services');
    expect(fields.jobDescription).toContain('Hiring Range');
    expect(fields.jobDescription.length).toBeGreaterThan(200);
    expect(fields.location).toBe('Nashville, TN, United States');
    expect(fields.jobCategory).toBe('Product and Research');
    expect(fields.employmentType).toBe('Full time');
    expect(fields.salaryRange).toBe('$92,500 – $209,500');
    expect(fields._jobExperience).toBe(3);
    expect(fields.companyLogoUrl).toContain('oracle.com');
  });

  it('caps Oracle flex-field years of experience at 30', () => {
    const fields = mapOracleCloud(
      {
        items: [
          {
            Title: 'Engineer',
            ExternalDescriptionStr: '<p>Build systems.</p>',
            requisitionFlexFields: [{ Prompt: 'Years', Value: '99 years of experience' }],
          },
        ],
      },
      'Oracle',
      'https://careers.oracle.com/en/sites/jobsearch/job/1'
    );
    expect(fields._jobExperience).toBeUndefined();
  });
});

describe('detectAtsBoard', () => {
  it('detects Greenhouse board root and job URLs', () => {
    const board = detectAtsBoard('https://boards.greenhouse.io/stripe');
    expect(board?.provider).toBe('greenhouse');
    expect(board?.companyHint).toBe('stripe');
    expect(board?.listApiUrl).toContain('/boards/stripe/jobs');

    const fromJob = detectAtsBoard('https://boards.greenhouse.io/stripe/jobs/12345');
    expect(fromJob?.companyHint).toBe('stripe');
  });

  it('detects DocuSign Jibe career site (not SmartRecruiters / Greenhouse)', () => {
    const d = detectAtsBoard('https://careers.docusign.com');
    expect(d?.provider).toBe('jibe');
    expect(d?.companyHint).toBe('DocuSign');
    expect(d?.listApiUrl).toBe('https://careers.docusign.com/api/jobs');
    expect(looksLikeGreenhouseBoard('https://careers.docusign.com/jobs?query=software+developer')).toBe(
      false
    );
    expect(detectAtsBoard('https://careers.docusign.com/careers-home/jobs')?.provider).toBe('jibe');
    expect(detectAtsBoard('https://stripe.com')?.provider).not.toBe('greenhouse');
  });

  it('detects Lever company board', () => {
    const d = detectAtsBoard('https://jobs.lever.co/netflix');
    expect(d?.provider).toBe('lever');
    expect(d?.listApiUrl).toContain('api.lever.co/v0/postings/netflix');
  });

  it('detects Ashby org board', () => {
    const d = detectAtsBoard('https://jobs.ashbyhq.com/openai');
    expect(d?.provider).toBe('ashby');
    expect(d?.listApiUrl).toContain('posting-api/job-board/openai');
  });

  it('detects SmartRecruiters company board', () => {
    const d = detectAtsBoard('https://jobs.smartrecruiters.com/AcmeCorp');
    expect(d?.provider).toBe('smartrecruiters');
    expect(d?.listApiUrl).toContain('companies/AcmeCorp/postings');
  });

  it('detects GitHub Jibe career site (careers-home)', () => {
    const url =
      'https://www.github.careers/careers-home/jobs?keywords=untied%20states&categories=Engineering%7CIT%7CMachine%20learning%20%26%20AI%7CSecurity&page=1&sortBy=posted_date&descending=true';
    const d = detectAtsBoard(url);
    expect(d?.provider).toBe('jibe');
    expect(d?.companyHint).toBe('GitHub');
    expect(d?.listApiUrl).toBe('https://githubinc.jibeapply.com/api/jobs');
    expect(detectAtsBoard('https://www.github.careers/careers-home')?.provider).toBe('jibe');
    expect(detectAtsBoard('https://www.github.careers')?.provider).toBe('jibe');
    expect(detectAtsBoard('https://www.github.careers/')?.companyHint).toBe('GitHub');
  });

  it('detects UHS Jibe career site (not Phenom)', () => {
    const d = detectAtsBoard('https://jobs.uhsinc.com');
    expect(d?.provider).toBe('jibe');
    expect(d?.companyHint).toBe('UHS');
    expect(d?.listApiUrl).toBe('https://uhs.jibeapply.com/api/jobs');
    expect(looksLikePhenomBoard('https://jobs.uhsinc.com')).toBe(false);
    expect(looksLikePhenomBoard('https://jobs.uhsinc.com/careers/jobs')).toBe(false);
  });

  it('detects Ulta Beauty Jibe career site (not Phenom)', () => {
    const url =
      'https://careers.ulta.com/careers/jobs?location=united%20states&stretch=10&stretchUnit=MILES&sortBy=distance_from&page=1&categories=Information%20Technology';
    const d = detectAtsBoard(url);
    expect(d?.provider).toBe('jibe');
    expect(d?.companyHint).toBe('Ulta Beauty');
    expect(d?.listApiUrl).toBe('https://ulta.jibeapply.com/api/jobs');
    expect(looksLikePhenomBoard(url)).toBe(false);
    expect(parseJibeBoardFilters(url)).toMatchObject({
      location: 'united states',
      categories: ['Information Technology'],
    });
    expect(startUrlHasCollectionFilters(url)).toBe(true);
    expect(shouldPreferAtsBoardOverUiPagination(url)).toBe(true);
  });

  it('detects Wayfair careers jobs board', () => {
    const url =
      'https://www.wayfair.com/careers/jobs?teamIds=1&countryIds=1&keywords=technology&locationIds=&stateIds=';
    const d = detectAtsBoard(url);
    expect(d?.provider).toBe('wayfair');
    expect(d?.companyHint).toBe('Wayfair');
    expect(d?.listApiUrl).toBe('https://www.wayfair.com/a/careers/careers/job_search_data');
    expect(startUrlHasCollectionFilters(url)).toBe(true);
  });

  it('detects Persistent Zwayam career SPA (explore-opportunities)', () => {
    const url = 'https://careers.persistent.com/explore-opportunities';
    expect(looksLikeZwayamBoard(url)).toBe(true);
    const d = detectAtsBoard(url);
    expect(d?.provider).toBe('zwayam');
    expect(d?.companyHint).toBe('Persistent');
    expect(d?.listApiUrl).toBe('https://public.zwayam.com/jobs/search');
    expect(shouldPreferAtsBoardOverUiPagination(url)).toBe(true);
    expect(parseZwayamBoardFilters(`${url}?keywords=United%20States`).keywords).toBe(
      'United States'
    );
  });

  it('autofixes untied→united and parses Jibe location + category filters', () => {
    const url =
      'https://www.github.careers/careers-home/jobs?keywords=untied%20states&categories=Engineering%7CIT%7CMachine%20learning%20%26%20AI%7CSecurity';
    expect(normalizeCareerSearchKeywords('untied states')).toBe('united states');
    const filters = parseJibeBoardFilters(url);
    expect(filters.keywords).toBe('united states');
    expect(filters.categories).toEqual([
      'Engineering',
      'IT',
      'Machine learning & AI',
      'Security',
    ]);
    const srFilters = parseSmartRecruitersBoardFilters(url);
    expect(srFilters.countryCode).toBe('us');
  });

  it('keeps SmartRecruiters jobs that match US and selected categories', () => {
    const url =
      'https://www.github.careers/careers-home/jobs?keywords=untied%20states&categories=Engineering%7CIT%7CMachine%20learning%20%26%20AI%7CSecurity';
    const kept = filterSmartRecruitersPostings(
      [
        {
          id: '1',
          name: 'SWE',
          department: { label: 'Engineering' },
          location: { country: 'United States', countryCode: 'us', city: 'Austin' },
        },
        {
          id: '2',
          name: 'AE',
          department: { label: 'Sales' },
          location: { country: 'United States', countryCode: 'us' },
        },
        {
          id: '3',
          name: 'SWE IN',
          department: { label: 'Engineering' },
          location: { country: 'India', countryCode: 'in' },
        },
        {
          id: '4',
          name: 'Sec',
          department: { label: 'Security' },
          location: { country: 'United States', countryCode: 'US' },
        },
        {
          id: '5',
          name: 'IT Ops',
          department: { label: 'IT' },
          location: { country: 'United States of America' },
        },
        {
          id: '6',
          name: 'ML',
          department: { label: 'Machine Learning & AI' },
          location: { countryCode: 'us' },
        },
      ],
      url
    );
    expect(kept.map((j: any) => j.id)).toEqual(['1', '4', '5', '6']);
  });

  it('detects Findly / job-search-results boards', () => {
    const dxc = detectAtsBoard(
      'https://careers.dxc.com/job-search-results/?compliment[]=United%20States&category[]=Software%20Engineering&pg=1'
    );
    expect(dxc?.provider).toBe('findly');
    expect(dxc?.companyHint).toBe('DXC');
    expect(dxc?.listApiUrl).toContain('m-cloud.io');

    const findlyHost = detectAtsBoard('https://acme.site.findly.com/job-search-results/');
    expect(findlyHost?.provider).toBe('findly');
  });

  it('detects Travelers / Edward Jones as Findly (migrated off Phenom directory)', () => {
    const travelers = 'https://careers.travelers.com/job-search-results';
    expect(looksLikeFindlyBoard(travelers)).toBe(true);
    expect(looksLikePhenomBoard(travelers)).toBe(false);
    expect(detectAtsBoard(travelers)?.provider).toBe('findly');
    expect(detectAtsBoard(travelers)?.companyHint).toMatch(/Travelers/i);
    expect(detectAtsBoard('https://careers.edwardjones.com/job-search-results/')?.provider).toBe(
      'findly'
    );
  });

  it('detects SuccessFactors search URLs', () => {
    const d = detectAtsBoard(
      'https://careers.ey.com/search-3?q=&optionsFacetsDD_country=US&startrow=500'
    );
    expect(d?.provider).toBe('successfactors');
    expect(d?.companyHint).toBe('EY');
  });

  it('detects Oracle Cloud Candidate Experience job lists', () => {
    const d = detectAtsBoard(
      'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs?keyword=data+analytics&location=United+States&locationId=300000000289738&selectedPostingDatesFacet=7'
    );
    expect(d?.provider).toBe('oraclecloud');
    expect(d?.companyHint).toBe('JPMorgan Chase');
    expect(d?.listApiUrl).toContain('recruitingCEJobRequisitions');
  });

  it('detects Oracle CE vanity hash-router boards (e.g. Hexaware)', () => {
    const d = detectAtsBoard(
      'https://jobs.hexaware.com/#en/sites/CX_1/jobs?location=United+States&locationId=300000000446660&locationLevel=country&mode=location'
    );
    expect(d?.provider).toBe('oraclecloud');
    expect(d?.companyHint).toBe('Hexaware');
    expect(d?.listApiUrl).toBe('oracle-vanity://resolve');
  });

  it('detects Oracle CE path vanity boards (e.g. Dell)', () => {
    const d = detectAtsBoard(
      'https://enterpriseplatform.dell.com/hcmUI/CandidateExperience/en/sites/careers/jobs?location=United+States&locationId=300000000471434&locationLevel=country&mode=location'
    );
    expect(d?.provider).toBe('oraclecloud');
    expect(d?.companyHint).toBe('Dell');
    expect(d?.listApiUrl).toContain('enterpriseplatform.dell.com/hcmRestApi/');
    expect(d?.listApiUrl).toContain('recruitingCEJobRequisitions');
  });

  it('detects careers.oracle.com CE boards via configured HCM host', () => {
    const d = detectAtsBoard(
      'https://careers.oracle.com/en/sites/jobsearch/jobs?location=United+States&locationId=300000000149325&locationLevel=country&mode=location'
    );
    expect(d?.provider).toBe('oraclecloud');
    expect(d?.companyHint).toBe('Oracle');
    expect(d?.listApiUrl).toContain('eeho.fa.us2.oraclecloud.com/hcmRestApi/');
    expect(d?.listApiUrl).toContain('recruitingCEJobRequisitions');
  });

  it('skips ATS JSON dump when Load More / next-button is configured', () => {
    expect(
      shouldSkipAtsBoardForUiPagination({
        listExtraction: {
          pagination: {
            mode: 'next-button',
            nextButtonSelector: 'button:has-text("Show More Results")',
            maxPages: 3,
          },
        },
      })
    ).toBe(true);
    expect(
      shouldSkipAtsBoardForUiPagination({
        listExtraction: { pagination: { mode: 'next-button', maxPages: 3 } },
      })
    ).toBe(false);
    expect(shouldSkipAtsBoardForUiPagination({ listExtraction: {} })).toBe(false);
  });

  it('treats Greenhouse vanity hosts as ATS-capable even when next-button skip would apply', () => {
    expect(looksLikeGreenhouseBoard('https://careers.docusign.com')).toBe(false);
    expect(looksLikeGreenhouseBoard('https://boards.greenhouse.io/stripe')).toBe(true);
    expect(
      shouldSkipAtsBoardForUiPagination({
        listExtraction: {
          pagination: {
            mode: 'next-button',
            nextButtonSelector: 'button:has-text("Next")',
            maxPages: 3,
          },
        },
      })
    ).toBe(true);
  });

  it('treats Workday hosts as ATS-capable even when next-button skip would apply', () => {
    expect(looksLikeWorkdayBoard('https://broadcom.wd1.myworkdayjobs.com')).toBe(true);
    expect(looksLikeWorkdayBoard('https://intel.wd1.myworkdayjobs.com/en-US/External')).toBe(
      true
    );
    expect(looksLikeWorkdayBoard('https://boards.greenhouse.io/stripe')).toBe(false);
    expect(
      looksLikeWorkdayBoard(
        'https://www.salesforce.com/company/careers/jobs/?country=United+States+of+America&team=Software+Engineering'
      )
    ).toBe(true);
  });

  it('detects Salesforce marketing careers search as the public Workday CXS board', () => {
    const d = detectAtsBoard(
      'https://www.salesforce.com/company/careers/jobs/?country=United+States+of+America&team=Data&team=Software+Engineering&page=1'
    );
    expect(d?.provider).toBe('workday');
    expect(d?.companyHint).toBe('Salesforce');
    expect(d?.listApiUrl).toBe(
      'https://salesforce.wd12.myworkdayjobs.com/wday/cxs/salesforce/External_Career_Site/jobs'
    );
  });

  it('prefers Salesforce Workday CXS over recorded next-button browser pagination', () => {
    const url =
      'https://www.salesforce.com/company/careers/jobs/?country=United+States+of+America&team=Data&team=Software+Engineering&team=Development+%26+Strategy&team=Enterprise+Technology+%26+Infrastructure&page=1';
    expect(shouldPreferAtsBoardOverUiPagination(url)).toBe(true);
    expect(isSalesforceMarketingJobsUrl(url)).toBe(true);
    expect(shouldPreferAtsBoardOverUiPagination('https://www.salesforce.com')).toBe(false);
    expect(shouldPreferAtsBoardOverUiPagination('https://careers.example.com/jobs')).toBe(false);
  });

  it('still matches Pinterest HappyDance while next-button skip would apply in the worker', () => {
    const url =
      'https://www.pinterestcareers.com/jobs/?search=&location=Chicago&team=Engineering&pagesize=20#results';
    expect(looksLikeHappyDanceBoard(url)).toBe(true);
    expect(looksLikePhenomBoard(url)).toBe(false);
    expect(
      shouldSkipAtsBoardForUiPagination({
        listExtraction: {
          pagination: {
            mode: 'next-button',
            nextButtonSelector: 'button:has-text("Show More")',
          },
        },
      })
    ).toBe(true);
  });

  it('still matches Box HappyDance while next-button skip would apply in the worker', () => {
    const url =
      'https://careers.box.com/en/jobs/?search=&team=Engineering&pagesize=20#results';
    expect(looksLikeHappyDanceBoard(url)).toBe(true);
    expect(
      shouldSkipAtsBoardForUiPagination({
        listExtraction: {
          pagination: {
            mode: 'next-button',
            nextButtonSelector: 'button:has-text("Show More")',
          },
        },
      })
    ).toBe(true);
  });

  it('detects Bank of America career job search', () => {
    const d = detectAtsBoard(
      'https://careers.bankofamerica.com/en-us/job-search?ref=search&search=jobsByLocation&start=0&rows=10&searchstring=United+States&keywords=data+analytics'
    );
    expect(d?.provider).toBe('bankofamerica');
    expect(d?.companyHint).toBe('Bank of America');
    expect(d?.listApiUrl).toContain('/services/jobssearchservlet');
  });

  it('returns null for non-board hosts', () => {
    expect(detectAtsBoard('https://careers.example.com/jobs')).toBeNull();
  });

  it('detects Workday CXS career boards from site path', () => {
    const d = detectAtsBoard(
      'https://intel.wd1.myworkdayjobs.com/en-US/External'
    );
    expect(d?.provider).toBe('workday');
    expect(d?.listApiUrl).toBe(
      'https://intel.wd1.myworkdayjobs.com/wday/cxs/intel/External/jobs'
    );
    const fromJob = detectAtsBoard(
      'https://td.wd3.myworkdayjobs.com/TD_Bank_Careers/job/Toronto/Analyst_R12345'
    );
    expect(fromJob?.provider).toBe('workday');
    expect(fromJob?.listApiUrl).toContain('/wday/cxs/td/TD_Bank_Careers/jobs');
    const fromHost = detectAtsBoard('https://broadcom.wd1.myworkdayjobs.com');
    expect(fromHost?.provider).toBe('workday');
    expect(fromHost?.listApiUrl).toContain('/wday/cxs/broadcom/External_Career/jobs');
  });

  it('detects Workable / Recruitee / BambooHR / Personio / Breezy boards', () => {
    expect(detectAtsBoard('https://apply.workable.com/acme/')?.provider).toBe('workable');
    expect(detectAtsBoard('https://acme.recruitee.com/')?.provider).toBe('recruitee');
    expect(detectAtsBoard('https://acme.bamboohr.com/careers')?.provider).toBe('bamboohr');
    expect(detectAtsBoard('https://acme.jobs.personio.com/')?.provider).toBe('personio');
    expect(detectAtsBoard('https://acme.breezy.hr/')?.provider).toBe('breezy');
  });

  it('detects Google Careers and IBM SearchJobs boards (not detail pages)', () => {
    const g = detectAtsBoard(
      'https://www.google.com/about/careers/applications/jobs/results?location=United%20States&q=Software'
    );
    expect(g?.provider).toBe('googlecareers');
    expect(
      detectAtsBoard(
        'https://www.google.com/about/careers/applications/jobs/results/114533168161137350-staff-swe'
      )
    ).toBeNull();
    const ibm = detectAtsBoard(
      'https://careers.ibm.com/SearchJobs?location=United+States'
    );
    expect(ibm?.provider).toBe('ibmcareers');
    expect(
      detectAtsBoard('https://careers.ibm.com/job/123/JobDetail?jobId=456')
    ).toBeNull();
    const ibmMarketing = detectAtsBoard(
      'https://www.ibm.com/in-en/careers/search?field_keyword_05[0]=United%20States'
    );
    expect(ibmMarketing?.provider).toBe('ibmcareers');
    expect(ibmMarketing?.listApiUrl).toMatch(/careers\.ibm\.com\/SearchJobs/i);
  });
});

describe('Oracle vanity helpers', () => {
  it('parseOracleCandidateExperienceRoute reads path-based CE boards', () => {
    const route = parseOracleCandidateExperienceRoute(
      'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/fr/sites/CX_1001/jobs?keyword=x&locationId=1'
    );
    expect(route).toEqual(
      expect.objectContaining({
        locale: 'fr',
        siteNumber: 'CX_1001',
        isJobsList: true,
      })
    );
    expect(route?.searchParams.get('locationId')).toBe('1');
  });

  it('parseOracleCandidateExperienceRoute reads hash-router vanity boards', () => {
    const route = parseOracleCandidateExperienceRoute(
      'https://jobs.hexaware.com/#en/sites/CX_1/jobs?location=United+States&locationId=300000000446660&mode=location'
    );
    expect(route).toEqual(
      expect.objectContaining({
        locale: 'en',
        siteNumber: 'CX_1',
        isJobsList: true,
      })
    );
    expect(route?.searchParams.get('locationId')).toBe('300000000446660');
    expect(route?.searchParams.get('location')).toBe('United States');
  });

  it('parseOracleVanityFusionHost extracts only trusted Fusion CE hosts', () => {
    const html = `
      const host = 'https://fa-etqo-saasfaprod1.fa.ocs.oraclecloud.com'  ;
      const ceBaseURL = host + '/hcmUI/CandidateExperience/';
      xhr.setRequestHeader('ora-irc-vanity-domain', 'Y');
    `;
    expect(parseOracleVanityFusionHost(html)).toBe(
      'fa-etqo-saasfaprod1.fa.ocs.oraclecloud.com'
    );
    expect(parseOracleVanityFusionHost('<html>evil.com</html>')).toBeNull();
    expect(
      parseOracleVanityFusionHost("const host = 'https://evil.example.com';")
    ).toBeNull();
  });

  it('looksLikeOracleVanityHashBoard matches hash CE jobs lists only', () => {
    expect(
      looksLikeOracleVanityHashBoard(
        'https://jobs.hexaware.com/#en/sites/CX_1/jobs?locationId=1'
      )
    ).toBe(true);
    expect(
      looksLikeOracleVanityHashBoard(
        'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs'
      )
    ).toBe(false);
    expect(looksLikeOracleVanityHashBoard('https://jobs.example.com/#/careers')).toBe(false);
  });

  it('resolveOracleHashVanityFusionHost prefers known map over HTML', () => {
    expect(resolveOracleHashVanityFusionHost('jobs.hexaware.com')).toBe(
      'fa-etqo-saasfaprod1.fa.ocs.oraclecloud.com'
    );
    expect(resolveOracleHashVanityFusionHost('unknown.example.com')).toBeNull();
  });
});

describe('Findly helpers', () => {
  it('looksLikeFindlyBoard matches path and host signals', () => {
    expect(looksLikeFindlyBoard('https://careers.dxc.com/job-search-results/')).toBe(true);
    expect(looksLikeFindlyBoard('https://foo.site.findly.com/careers')).toBe(true);
    expect(looksLikeFindlyBoard('https://careers.example.com/jobs')).toBe(false);
  });

  it('parseFindlyConfigFromHtml reads cws_opts', () => {
    const html = `
      <script>var cws_opts = {"org":"2492","api":"https:\\/\\/jobsapi-internal.m-cloud.io\\/api\\/","job_detail_path":"\\/job"};</script>
      <script>CWS.jobs.set_options({ org_id: "2492" });</script>
    `;
    const cfg = parseFindlyConfigFromHtml(html);
    expect(cfg?.orgId).toBe('2492');
    expect(cfg?.apiBase).toContain('m-cloud.io/api/');
    expect(cfg?.jobDetailPath).toBe('/job');
  });

  it('findlyFacetsFromUrl maps category/compliment and skips pg', () => {
    const facets = findlyFacetsFromUrl(
      'https://careers.dxc.com/job-search-results/?compliment[]=United%20States%20of%20America&category[]=Software%20Engineering&pg=2'
    );
    expect(facets).toContain('compliment:United States of America');
    expect(facets).toContain('primary_category:Software Engineering');
    expect(facets.every((f) => !f.startsWith('pg:'))).toBe(true);
  });
});

describe('SuccessFactors helpers', () => {
  it('looksLikeSuccessFactorsBoard matches search + facets/startrow', () => {
    expect(
      looksLikeSuccessFactorsBoard(
        'https://careers.ey.com/search-3?optionsFacetsDD_country=US&startrow=500'
      )
    ).toBe(true);
    expect(looksLikeSuccessFactorsBoard('https://foo.successfactors.eu/careers')).toBe(true);
    expect(looksLikeSuccessFactorsBoard('https://careers.example.com/jobs')).toBe(false);
  });

  it('normalizeSuccessFactorsStartUrl forces startrow=0 and keeps facets', () => {
    const out = normalizeSuccessFactorsStartUrl(
      'https://careers.ey.com/search-3?optionsFacetsDD_country=US&startrow=500'
    );
    expect(out).toContain('startrow=0');
    expect(out).toContain('optionsFacetsDD_country=US');
  });

  it('confirmSuccessFactorsHtml requires ≥2 signals', () => {
    expect(confirmSuccessFactorsHtml('<html>random</html>').ok).toBe(false);
    const html = `
      successfactors rmkcdn.successfactors
      <div id="searchresults"><a href="/ey/job/Foo-IL/123/">Foo</a></div>
      Page 1 of 21
    `;
    expect(confirmSuccessFactorsHtml(html).ok).toBe(true);
  });

  it('parseSuccessFactorsJobsHtml extracts unique jobs and strips +N more', () => {
    const html = `
      <table id="searchresults">
        <tr><td><a href="/ey/job/Chicago-Foo-IL/111/">Foo</a></td>
            <td>Chicago, IL, US +80 more…</td></tr>
        <tr><td><a href="/ey/job/Chicago-Foo-IL/111/">Foo</a></td>
            <td>Chicago, IL, US +80 more…</td></tr>
        <tr><td><a href="/ey/job/NY-Bar-NY/222/">Bar</a></td>
            <td>New York, NY, US</td></tr>
      </table>
      Page 1 of 2
    `;
    const { jobs, pageOf } = parseSuccessFactorsJobsHtml(html, 'https://careers.ey.com');
    expect(jobs).toHaveLength(2);
    expect(jobs[0].location).not.toMatch(/more/i);
    expect(jobs[0].jobUrl).toContain('https://careers.ey.com/');
    expect(pageOf).toEqual({ current: 1, total: 2 });
  });
});

describe('fetchAtsBoardJobs', () => {
  let getSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getSpy = vi.spyOn(atsHttpClient, 'get');
    process.env.SF_BOARD_PAGE_DELAY_MS = '0';
    process.env.ATS_BOARD_PAGE_DELAY_MS = '0';
  });

  afterEach(() => {
    getSpy.mockRestore();
  });

  it('fetches NAS Activate SearchResults JSON for Cardinal Health instead of Phenom', async () => {
    const start =
      'https://jobs.cardinalhealth.com/search/searchjobs?regionalcountry=United+States&geolocationstring=39.5036%2C-99.0184_United+States&categoryid=a266442d-10a4-4adf-9806-354dc8644a33';
    expect(looksLikePhenomBoard(start)).toBe(false);
    expect(looksLikeNasActivateBoard(start)).toBe(true);
    expect(detectAtsBoard(start)?.provider).toBe('nasactivate');
    getSpy.mockResolvedValue({
      status: 200,
      data: {
        Result: 'OK',
        TotalRecordCount: 1,
        Records: [
          {
            ID: 'ec9c27f4-d8b0-42ab-9cc6-eb7cff8e1f12',
            Title: '<span>Sr Engineering Analyst</span>',
            TrackingObject: {
              TitleJson: 'Sr Engineering Analyst',
              PostedDateJson: '8/24/2026',
              TypeNameJson: 'Full time',
              LocationNamesJson: ['Regional'],
              CityStatesDataJson: ['Massachusetts', 'Missouri'],
              CountryNamesJson: ['United States'],
              ActivateCategoryNamesJson: ['Engineering'],
            },
          },
        ],
      },
    } as any);
    const result = await fetchAtsBoardJobs(start);
    expect(String(getSpy.mock.calls[0][0])).toContain('/Search/SearchResults');
    expect(String(getSpy.mock.calls[0][0])).toContain('categoryid=a266442d-10a4-4adf-9806-354dc8644a33');
    expect(String(getSpy.mock.calls[0][0])).toContain('regionalcountry=United');
    expect(result?.provider).toBe('nasactivate');
    expect(result?.companyHint).toBe('Cardinal Health');
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0].jobTitle).toBe('Sr Engineering Analyst');
    expect(result?.rows[0].department).toBe('Engineering');
    expect(result?.rows[0].jobUrl).toContain(
      '/search/jobdetails/sr-engineering-analyst/ec9c27f4-d8b0-42ab-9cc6-eb7cff8e1f12'
    );
  });

  it('maps HappyDance RSS jobs and honors team/location filters from the start URL', async () => {
    const rss = fs.readFileSync(path.join(__dirname, 'fixtures/happydance-rss.xml'), 'utf8');
    getSpy.mockResolvedValue({ status: 200, data: rss } as any);
    const filtered = await fetchAtsBoardJobs(
      'https://careers.box.com/en/jobs/?search=&location=Redwood+City%2C+California%2C+United+States&location=US+Remote+-+California+-+San+Diego+Area&team=Engineering&team=IT&team=Security&pagesize=20#results'
    );
    expect(getSpy).toHaveBeenCalled();
    expect(String(getSpy.mock.calls[0][0])).toBe('https://careers.box.com/en/jobs/xml/?rss=true');
    expect(filtered?.provider).toBe('happydance');
    expect(filtered?.rows.map((r) => r.jobTitle)).toEqual([
      'Senior Software Engineer, ISF',
      'IT Security Analyst',
    ]);
    expect(filtered?.rows[0].jobUrl).toContain('/en/jobs/8147786/');
    expect(filtered?.rows[0].location).toContain('Redwood City');
    expect(filtered?.rows[1].department).toBe('IT');
    expect(filtered?.rows.some((r) => r.jobTitle === 'Account Executive')).toBe(false);
    expect(filtered?.rows.some((r) => r.jobTitle.includes('Organizational'))).toBe(false);

    const unfiltered = await fetchAtsBoardJobs('https://careers.box.com/en/jobs/');
    expect(unfiltered?.rows.map((r) => r.jobTitle)).toEqual([
      'Senior Software Engineer, ISF',
      'IT Security Analyst',
      'Senior Organizational Effectiveness Manager',
    ]);
    expect(unfiltered?.rows.some((r) => r.jobTitle === 'Account Executive')).toBe(false);
  });

  it('fetches Pinterest localless HappyDance RSS instead of Phenom widgets', async () => {
    const rss = fs.readFileSync(path.join(__dirname, 'fixtures/happydance-rss.xml'), 'utf8');
    getSpy.mockResolvedValue({ status: 200, data: rss } as any);
    const result = await fetchAtsBoardJobs(
      'https://www.pinterestcareers.com/jobs/?search=&team=Engineering&pagesize=20#results'
    );
    expect(String(getSpy.mock.calls[0][0])).toBe(
      'https://www.pinterestcareers.com/jobs/xml/?rss=true'
    );
    expect(result?.provider).toBe('happydance');
    expect(result?.companyHint).toBe('Pinterest');
    expect(result?.rows.some((r) => r.jobTitle === 'Senior Software Engineer, ISF')).toBe(true);
  });

  it('maps Salesforce Workday country and team query params onto CXS appliedFacets', async () => {
    const postSpy = vi.spyOn(atsHttpClient, 'post');
    try {
    postSpy.mockResolvedValueOnce({
      status: 200,
      data: {
        total: 2,
        jobPostings: [
          {
            title: 'Account Executive',
            externalPath: '/job/United-Kingdom/ae_JR1',
            locationsText: 'United Kingdom - London',
          },
        ],
        facets: [
          {
            facetParameter: 'CF_-_Country',
            descriptor: 'Country',
            values: [{ descriptor: 'United States of America', id: 'us-id', count: 1 }],
          },
          {
            facetParameter: 'jobFamilyGroup',
            descriptor: 'Job Category',
            values: [
              { descriptor: 'Software Engineering', id: 'eng-id', count: 1 },
              { descriptor: 'Data', id: 'data-id', count: 1 },
            ],
          },
        ],
      },
    } as any);
    postSpy.mockResolvedValueOnce({
      status: 200,
      data: {
        total: 1,
        jobPostings: [
          {
            title: 'Software Engineer',
            externalPath: '/job/United-States/se_JR2',
            locationsText: 'United States - California',
            postedOn: 'Posted Today',
          },
        ],
        facets: [],
      },
    } as any);

    const result = await fetchAtsBoardJobs(
      'https://www.salesforce.com/company/careers/jobs/?country=United+States+of+America&team=Software+Engineering&team=Data&page=1'
    );
    expect(postSpy.mock.calls[0][1]).toMatchObject({ appliedFacets: {}, offset: 0 });
    expect(postSpy.mock.calls[1][1].appliedFacets).toEqual({
      'CF_-_Country': ['us-id'],
      jobFamilyGroup: ['eng-id', 'data-id'],
    });
    expect(result?.provider).toBe('workday');
    expect(result?.rows.map((r) => r.jobTitle)).toEqual(['Software Engineer']);
  } finally {
    postSpy.mockRestore();
  }
  });

  it('keeps Salesforce Workday jobs that list a US city instead of United States of America', async () => {
    const postSpy = vi.spyOn(atsHttpClient, 'post');
    try {
      postSpy.mockResolvedValue({
        status: 200,
        data: {
          total: 2,
          jobPostings: [
            {
              title: 'Software Engineer, AI Applications',
              externalPath: '/job/California---San-Francisco/Software-Engineer--AI-Applications_JR357086',
              locationsText: 'California - San Francisco',
            },
            {
              title: 'Lead Network Engineer',
              externalPath: '/job/Virginia---Mclean/Lead-Network-Engineer---Backbone-Engineering_JR321396',
              locationsText: '3 Locations',
            },
          ],
          facets: [
            {
              facetParameter:
                'CF_-_REC_-_LRV_-_Job_Posting_Anchor_-_Country_from_Job_Posting_Location_Extended',
              descriptor: 'Country',
              values: [{ descriptor: 'United States of America', id: 'us-id', count: 2 }],
            },
            {
              facetParameter: 'jobFamilyGroup',
              descriptor: 'Job Category',
              values: [{ descriptor: 'Software Engineering', id: 'eng-id', count: 2 }],
            },
          ],
        },
      } as any);
      const result = await fetchAtsBoardJobs(
        'https://www.salesforce.com/company/careers/jobs/?country=United+States+of+America&team=Software+Engineering&page=1'
      );
      expect(result?.rows.map((r) => r.jobTitle)).toEqual([
        'Software Engineer, AI Applications',
        'Lead Network Engineer',
      ]);
    } finally {
      postSpy.mockRestore();
    }
  });

  it('does not send United States as Workday searchText and keeps USA- / multi-location Broadcom jobs', async () => {
    const postSpy = vi.spyOn(atsHttpClient, 'post');
    try {
      postSpy.mockResolvedValue({
        status: 200,
        data: {
          total: 2,
          jobPostings: [
            {
              title: 'PCIe QA Engineer',
              externalPath: '/job/USA-California-San-Jose-1320-Ridder-Park-Drive/PCIe-QA-Engineer_R026923',
              locationsText: 'USA-California-San Jose-1320 Ridder Park Drive',
            },
            {
              title: 'Firmware Engineer',
              externalPath: '/job/USA-Colorado-Fort-Collins-4380-Ziegler-Road/Firmware-Engineer_R026738',
              locationsText: '2 Locations',
            },
          ],
          facets: [
            {
              facetParameter: 'jobFamilyGroup',
              descriptor: 'Job Category',
              values: [{ descriptor: 'R&D', id: 'rd-id', count: 2 }],
            },
          ],
        },
      } as any);
      const result = await fetchAtsBoardJobs(
        'https://broadcom.wd1.myworkdayjobs.com?q=United+States&country=United+States'
      );
      expect(postSpy.mock.calls.length).toBeGreaterThan(0);
      for (const call of postSpy.mock.calls) {
        expect(String(call[0])).toContain('/wday/cxs/broadcom/External_Career/jobs');
        expect(call[1]).toMatchObject({ searchText: '' });
      }
      expect(result?.provider).toBe('workday');
      expect(result?.rows.map((r) => r.jobTitle)).toEqual([
        'PCIe QA Engineer',
        'Firmware Engineer',
      ]);
      expect(result?.rows[1].location).toMatch(/USA|United States|Colorado/i);
    } finally {
      postSpy.mockRestore();
    }
  });

  it('fetches Broadcom host-only Workday CXS without injecting a United States facet', async () => {
    const postSpy = vi.spyOn(atsHttpClient, 'post');
    try {
      postSpy.mockResolvedValue({
        status: 200,
        data: {
          total: 1,
          jobPostings: [
            {
              title: 'R&D Engineer Software 3',
              externalPath: '/job/USA-California-San-Jose/RD-Engineer-Software-3_R026000',
              locationsText: 'USA-California-San Jose',
            },
          ],
          facets: [{ facetParameter: 'locationMainGroup', descriptor: 'undefined', values: [] }],
        },
      } as any);
      const result = await fetchAtsBoardJobs('https://broadcom.wd1.myworkdayjobs.com');
      expect(postSpy).toHaveBeenCalledTimes(1);
      expect(postSpy.mock.calls[0][1]).toMatchObject({ appliedFacets: {}, searchText: '' });
      expect(result?.rows.map((r) => r.jobTitle)).toEqual(['R&D Engineer Software 3']);
    } finally {
      postSpy.mockRestore();
    }
  });

  it('maps ServiceNow locale-less HappyDance RSS and honors country plus team filters', async () => {
    const rss = fs.readFileSync(path.join(__dirname, 'fixtures/happydance-rss.xml'), 'utf8');
    getSpy.mockResolvedValue({ status: 200, data: rss } as any);
    const filtered = await fetchAtsBoardJobs(
      'https://careers.servicenow.com/jobs/?search=&team=Engineering&team=IT&country=United+States&pagesize=20#results'
    );
    expect(String(getSpy.mock.calls[0][0])).toBe(
      'https://careers.servicenow.com/jobs/xml/?rss=true'
    );
    expect(filtered?.provider).toBe('happydance');
    expect(filtered?.companyHint).toBe('ServiceNow');
    expect(filtered?.rows.map((r) => r.jobTitle)).toEqual([
      'Senior Software Engineer, ISF',
      'IT Security Analyst',
    ]);
    expect(filtered?.rows.some((r) => r.jobTitle === 'Account Executive')).toBe(false);
  });

  it('fetches Uber HappyDance RSS with countries= and team=Engineer, allowing large feeds', async () => {
    const rss = `<?xml version="1.0"?><source>
      <job>
        <title><![CDATA[Software Engineer II]]></title>
        <url><![CDATA[https://jobs.uber.com/en/job/1]]></url>
        <country><![CDATA[United States]]></country>
        <category><![CDATA[Engineer]]></category>
      </job>
      <job>
        <title><![CDATA[Account Exec]]></title>
        <url><![CDATA[https://jobs.uber.com/en/job/2]]></url>
        <country><![CDATA[United States]]></country>
        <category><![CDATA[Sales]]></category>
      </job>
      <job>
        <title><![CDATA[Engineer UK]]></title>
        <url><![CDATA[https://jobs.uber.com/en/job/3]]></url>
        <country><![CDATA[United Kingdom]]></country>
        <category><![CDATA[Engineer]]></category>
      </job>
    </source>`;
    getSpy.mockResolvedValue({ status: 200, data: rss } as any);
    const result = await fetchAtsBoardJobs(
      'https://jobs.uber.com/en/jobs/?team=Engineer&countries=United+States'
    );
    expect(String(getSpy.mock.calls[0][0])).toBe(
      'https://jobs.uber.com/en/jobs/xml/?rss=true'
    );
    expect(Number(getSpy.mock.calls[0][1]?.maxContentLength || 0)).toBeGreaterThanOrEqual(
      16 * 1024 * 1024
    );
    expect(result?.provider).toBe('happydance');
    expect(result?.companyHint).toBe('Uber');
    expect(result?.rows.map((r) => r.jobTitle)).toEqual(['Software Engineer II']);
  });

  it('maps Greenhouse board jobs', async () => {
    getSpy.mockResolvedValue({
      status: 200,
      data: {
        jobs: [
          {
            title: 'Engineer',
            absolute_url: 'https://boards.greenhouse.io/stripe/jobs/1',
            content: '<p>' + 'Build payments infrastructure. '.repeat(20) + '</p>',
            location: { name: 'Remote' },
            updated_at: '2026-01-01',
          },
        ],
      },
    } as any);
    const result = await fetchAtsBoardJobs('https://boards.greenhouse.io/stripe');
    expect(result?.provider).toBe('greenhouse');
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0].jobTitle).toBe('Engineer');
    expect(result?.rows[0].jobUrl).toContain('/jobs/1');
    expect(result?.rows[0].url).toBe(result?.rows[0].jobUrl);
    expect(result?.rows[0].jobDescription).toContain('Build payments infrastructure');
  });

  it('filters Greenhouse jobs by search query and caps to maxPages of UI-sized chunks', async () => {
    getSpy.mockResolvedValue({
      status: 200,
      data: {
        jobs: [
          {
            title: 'Software Developer',
            absolute_url: 'https://boards.greenhouse.io/docusign/jobs/1',
            location: { name: 'Seattle' },
          },
          {
            title: 'Account Executive',
            absolute_url: 'https://boards.greenhouse.io/docusign/jobs/2',
            location: { name: 'Seattle' },
          },
          {
            title: 'Senior Software Developer',
            absolute_url: 'https://boards.greenhouse.io/docusign/jobs/3',
            location: { name: 'Austin' },
          },
          {
            title: 'Software Developer II',
            absolute_url: 'https://boards.greenhouse.io/docusign/jobs/4',
            location: { name: 'Remote' },
          },
        ],
      },
    } as any);
    const byLocation = await fetchAtsBoardJobs(
      'https://boards.greenhouse.io/docusign?location=Austin'
    );
    expect(byLocation?.rows.map((r) => r.jobTitle)).toEqual(['Senior Software Developer']);

    const result = await fetchAtsBoardJobs(
      'https://boards.greenhouse.io/stripe/jobs?query=software+developer',
      { maxPages: 1 }
    );
    expect(result?.provider).toBe('greenhouse');
    expect(result?.rows.map((r) => r.jobTitle)).toEqual([
      'Software Developer',
      'Senior Software Developer',
      'Software Developer II',
    ]);
    const limited = applyAtsBoardSearchAndPageLimits(result!.rows, 'https://boards.greenhouse.io/stripe/jobs?query=software+developer&pagesize=2', {
      maxPages: 1,
    });
    expect(limited.map((r) => r.jobTitle)).toEqual(['Software Developer', 'Senior Software Developer']);
  });

  it('defaults missing location filters to United States', () => {
    const rows = applyAtsBoardSearchAndPageLimits(
      [
        { jobTitle: 'US Eng', location: 'Austin, TX, United States', department: 'Engineering' },
        { jobTitle: 'JP Eng', location: 'Tokyo, Japan', department: 'Engineering' },
        { jobTitle: 'UK Eng', location: 'London, United Kingdom', department: 'Engineering' },
      ] as any,
      'https://boards.greenhouse.io/acme?department=Engineering'
    );
    expect(rows.map((r) => r.jobTitle)).toEqual(['US Eng']);
  });

  it('fetches GitHub Jibe with US keyword and category filters; autofixes untied', async () => {
    getSpy.mockResolvedValue({
      status: 200,
      data: {
        totalCount: 2,
        count: 2,
        jobs: [
          {
            data: {
              slug: '5734',
              title: 'Backend Engineer',
              category: [' Engineering'],
              country: 'United States',
              country_code: 'US',
            },
          },
          {
            data: {
              slug: '9999',
              title: 'Account Exec',
              category: [' Sales'],
              country: 'United States',
              country_code: 'US',
            },
          },
        ],
      },
    } as any);
    const result = await fetchAtsBoardJobs(
      'https://www.github.careers/careers-home/jobs?keywords=untied%20states&categories=Engineering%7CIT%7CSecurity&page=1&sortBy=posted_date'
    );
    expect(getSpy).toHaveBeenCalled();
    const requested = String(getSpy.mock.calls[0][0]);
    expect(requested).toContain('githubinc.jibeapply.com/api/jobs');
    expect(requested).toMatch(/keywords=united(\+|%20)states/i);
    expect(requested).toMatch(/categories=Engineering/i);
    expect(result?.provider).toBe('jibe');
    expect(result?.rows.map((r) => r.jobTitle)).toEqual(['Backend Engineer']);
    expect(result?.rows[0].jobUrl).toContain('/careers-home/jobs/5734');
  });

  it('fetches Ulta Jibe with location + category filters', async () => {
    getSpy.mockResolvedValue({
      status: 200,
      data: {
        totalCount: 1,
        count: 1,
        jobs: [
          {
            data: {
              slug: 'data-scientist-123',
              title: 'Data Scientist',
              category: ['Information Technology'],
              full_location: 'Chicago, IL, United States',
              country: 'United States',
            },
          },
        ],
      },
    } as any);
    const result = await fetchAtsBoardJobs(
      'https://careers.ulta.com/careers/jobs?location=united%20states&stretch=10&stretchUnit=MILES&sortBy=distance_from&page=1&categories=Information%20Technology'
    );
    expect(getSpy).toHaveBeenCalled();
    const requested = String(getSpy.mock.calls[0][0]);
    expect(requested).toContain('ulta.jibeapply.com/api/jobs');
    expect(requested).toMatch(/location=united(\+|%20)states/i);
    expect(requested).toMatch(/categories=Information(\+|%20)Technology/i);
    expect(requested).toContain('stretch=10');
    expect(result?.provider).toBe('jibe');
    expect(result?.rows.map((r) => r.jobTitle)).toEqual(['Data Scientist']);
    expect(result?.rows[0].jobUrl).toContain('/careers/jobs/data-scientist-123');
  });

  it('returns a confirmed-empty SmartRecruiters board instead of null when the API has 0 postings', async () => {
    getSpy.mockResolvedValue({
      status: 200,
      data: { totalFound: 0, content: [] },
    } as any);
    const result = await fetchAtsBoardJobs(
      'https://jobs.smartrecruiters.com/AcmeCorp?keywords=united%20states&categories=Engineering'
    );
    expect(result?.provider).toBe('smartrecruiters');
    expect(result?.rows).toEqual([]);
    expect(result?.confirmedEmpty).toBe(true);
  });

  it('returns null for empty DocuSign Jibe fetch so browser fallback can run', async () => {
    getSpy.mockResolvedValue({
      status: 200,
      data: { totalCount: 0, count: 0, jobs: [] },
    } as any);
    const vanity = await fetchAtsBoardJobs(
      'https://careers.docusign.com/careers-home/jobs?keywords=software'
    );
    expect(vanity).toBeNull();

    getSpy.mockResolvedValue({
      status: 200,
      data: { totalFound: 0, content: [] },
    } as any);
    const srHost = await fetchAtsBoardJobs(
      'https://jobs.smartrecruiters.com/DocuSign?keywords=software'
    );
    // Public SR board for DocuSign is empty — confirmedEmpty (not a connected vanity host).
    expect(srHost?.provider).toBe('smartrecruiters');
    expect(srHost?.rows).toEqual([]);
    expect(srHost?.confirmedEmpty).toBe(true);
  });

  it('returns null for empty GitHub Jibe fetch so browser fallback can run', async () => {
    getSpy.mockResolvedValue({
      status: 200,
      data: { totalCount: 0, count: 0, jobs: [] },
    } as any);
    const result = await fetchAtsBoardJobs(
      'https://www.github.careers/careers-home/jobs?keywords=united%20states&categories=Engineering'
    );
    expect(result).toBeNull();
  });

  it("fetches Moody's Talent Brew search-jobs/results AJAX and maps rows", async () => {
    getSpy.mockResolvedValue({
      status: 200,
      data: {
        hasJobs: true,
        results: `
          <section id="search-results">
            <ul>
              <li>
                <h2><a href="/en/job/new-york/genai-technology-architect/49841/99720141392">GenAI Technology Architect</a></h2>
                <span class="job-location">New York, United States</span>
              </li>
            </ul>
          </section>`,
      },
    } as any);
    const url =
      'https://careers.moodys.com/en/search-jobs/technology/United%20States/49841/1/2/6252001/39x7599983215332/-98x5/50/2';
    const result = await fetchAtsBoardJobs(url, { maxItems: 10 });
    expect(getSpy).toHaveBeenCalled();
    const requested = String(getSpy.mock.calls[0][0]);
    expect(requested).toContain('careers.moodys.com/en/search-jobs/results');
    expect(requested).toMatch(/Keywords=technology/i);
    expect(requested).toMatch(/OrganizationIds=49841/);
    expect(requested).toMatch(/FacetFilters%5B0%5D\.ID=6252001|FacetFilters\[0\]\.ID=6252001/);
    expect(result?.provider).toBe('talentbrew');
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0].jobTitle).toBe('GenAI Technology Architect');
    expect(result?.rows[0].jobUrl).toContain('/en/job/new-york/genai-technology-architect/');
  });

  it('fetches Wayfair job_search_data with team/country/keyword filters', async () => {
    const postSpy = vi.spyOn(atsHttpClient, 'post');
    try {
      postSpy.mockResolvedValue({
        status: 200,
        data: {
          jobListData: [
            {
              id: 64142,
              eid: '16917',
              title: 'Software Engineer III - Visual AI Technology',
              requisitionId: '16917',
              jobTypeId: 2,
              teamId: 1,
              system: 2,
              category: { name: 'Full Stack Engineering' },
              location: {
                name: 'Boston, MA',
                city: 'Boston',
                state: 'Massachusetts',
                country: 'United States',
              },
              jobTypeDisplayName: 'Full-time',
              createdDate: '2026-01-01',
              applyLink: 'https://wayfair.avature.net/en_US/careers?folderId=16917',
            },
          ],
        },
      } as any);
      const result = await fetchAtsBoardJobs(
        'https://www.wayfair.com/careers/jobs?teamIds=1&countryIds=1&keywords=technology&locationIds=&stateIds='
      );
      expect(postSpy).toHaveBeenCalled();
      expect(String(postSpy.mock.calls[0][0])).toContain('/a/careers/careers/job_search_data');
      expect(postSpy.mock.calls[0][1]).toMatchObject({
        teamIds: [1],
        countryIds: [1],
        keywords: 'technology',
      });
      expect(parseWayfairBoardFilters(
        'https://www.wayfair.com/careers/jobs?teamIds=1&countryIds=1&keywords=technology&locationIds=&stateIds='
      )).toMatchObject({
        teamIds: [1],
        countryIds: [1],
        keywords: 'technology',
        locationIds: [],
        stateIds: [],
      });
      expect(result?.provider).toBe('wayfair');
      expect(result?.rows.map((r) => r.jobTitle)).toEqual([
        'Software Engineer III - Visual AI Technology',
      ]);
      expect(result?.rows[0].jobUrl).toBe(
        'https://www.wayfair.com/careers/job/software-engineer-iii---visual-ai-technology/2-16917'
      );
    } finally {
      postSpy.mockRestore();
    }
  });

  it('fetches Persistent Zwayam jobs/search multipart and maps rows', async () => {
    const postSpy = vi.spyOn(atsHttpClient, 'post');
    try {
      postSpy.mockResolvedValue({
        status: 200,
        data: {
          code: 200,
          data: {
            totalCount: 1,
            facetedSearchConfig: { paginationHowMuch: '9' },
            data: [
              {
                _source: {
                  id: 1061575,
                  jobTitle: 'Snowflake Data Engineer',
                  location: 'United States',
                  jobUrl: 'snowflake-data-engineer-usa-202410161515494',
                  modifiedDate: 1700000000000,
                  deptNameToSet: 'Engineering',
                },
              },
            ],
          },
        },
      } as any);
      const result = await fetchAtsBoardJobs(
        'https://careers.persistent.com/explore-opportunities?keywords=United%20States',
        { maxItems: 10 }
      );
      expect(postSpy).toHaveBeenCalled();
      expect(String(postSpy.mock.calls[0][0])).toBe('https://public.zwayam.com/jobs/search');
      const body = postSpy.mock.calls[0][1];
      const bodyText = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
      expect(bodyText).toContain('name="filterCri"');
      expect(bodyText).toContain('United States');
      expect(bodyText).toContain('MTYzNDQ=');
      expect(result?.provider).toBe('zwayam');
      expect(result?.rows).toHaveLength(1);
      expect(result?.rows[0].jobTitle).toBe('Snowflake Data Engineer');
      expect(result?.rows[0].jobUrl).toContain(
        '/jobview/snowflake-data-engineer-usa-202410161515494'
      );
      expect(result?.rows[0].jobUrl).toContain('id=1061575');
    } finally {
      postSpy.mockRestore();
    }
  });

  it('returns null when Wayfair job_search_data responds with HTML (bot wall)', async () => {
    const postSpy = vi.spyOn(atsHttpClient, 'post');
    try {
      postSpy.mockResolvedValue({
        status: 200,
        data: '<!DOCTYPE html><html><body>Access denied</body></html>',
      } as any);
      const result = await fetchAtsBoardJobs(
        'https://www.wayfair.com/careers/jobs?teamIds=1&countryIds=1&keywords=technology'
      );
      expect(result).toBeNull();
    } finally {
      postSpy.mockRestore();
    }
  });

  it('fetchWayfairBoardJobsInBrowser maps SPA XHR JSON to list rows', async () => {
    const page = {
      evaluate: vi.fn(async () => ({
        jobListData: [
          {
            id: 1,
            eid: '16917',
            title: 'Software Engineer III',
            jobTypeId: 2,
            location: { name: 'Boston, MA', city: 'Boston', state: 'Massachusetts', country: 'United States' },
            jobTypeDisplayName: 'Full-time',
            createdDate: '2026-01-01',
          },
        ],
      })),
    };
    const rows = await fetchWayfairBoardJobsInBrowser(
      page as any,
      'https://www.wayfair.com/careers/jobs?teamIds=1&countryIds=1&keywords=technology'
    );
    expect(buildWayfairSearchRequestBody(
      'https://www.wayfair.com/careers/jobs?teamIds=1&countryIds=1&keywords=technology&locationIds=&stateIds='
    )).toMatchObject({ teamIds: [1], countryIds: [1], locationIds: [], stateIds: [] });
    expect(rows).toHaveLength(1);
    expect(rows[0].jobTitle).toBe('Software Engineer III');
    expect(rows[0].jobUrl).toContain('/careers/job/');
  });

  it('maps Lever postings array', async () => {
    getSpy.mockResolvedValue({
      status: 200,
      data: [
        {
          text: 'Designer',
          hostedUrl: 'https://jobs.lever.co/netflix/abc',
          categories: { location: 'LA', commitment: 'Full-time' },
        },
      ],
    } as any);
    const result = await fetchAtsBoardJobs('https://jobs.lever.co/netflix');
    expect(result?.provider).toBe('lever');
    expect(result?.rows[0].title).toBe('Designer');
    expect(result?.rows[0].location).toBe('LA');
  });

  it('returns null when API is empty', async () => {
    getSpy.mockResolvedValue({ status: 200, data: { jobs: [] } } as any);
    expect(await fetchAtsBoardJobs('https://boards.greenhouse.io/stripe')).toBeNull();
  });

  it('maps and paginates Oracle Cloud Candidate Experience jobs', async () => {
    getSpy.mockImplementation(async (url: string) => {
      const finder = decodeURIComponent(new URL(String(url)).searchParams.get('finder') || '');
      expect(finder).not.toContain('location=New York');
      expect(finder).toContain('locationId=300000000289738');
      const offset = Number(finder.match(/offset=(\d+)/)?.[1] || '0');
      return {
        status: 200,
        data: {
          items: [
            {
              TotalJobsCount: 2,
              requisitionList:
                offset === 0
                  ? [
                      {
                        Id: '123',
                        Title: 'Data Engineer',
                        PrimaryLocation: 'New York, NY, United States',
                        PostedDate: '2026-08-01',
                        JobFamily: 'Technology',
                        JobType: 'Regular',
                      },
                    ]
                  : [
                      {
                        Id: '124',
                        Title: 'Analytics Engineer',
                        PrimaryLocation: 'Columbus, OH, United States',
                        PostedDate: '2026-08-02',
                      },
                    ],
            },
          ],
        },
      } as any;
    });

    const result = await fetchAtsBoardJobs(
      'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/fr/sites/CX_1001/jobs?keyword=data+analytics&location=New%20York,%20NY,%20United%20States&locationId=300000000289738',
      { maxPages: 2 }
    );
    expect(result?.provider).toBe('oraclecloud');
    expect(result?.rows).toHaveLength(2);
    expect(result?.rows[0].jobUrl).toContain('/CandidateExperience/fr/sites/');
    expect(result?.rows[0].jobUrl).toContain('/job/123');
    expect(result?.rows[0].companyName).toBe('JPMorgan Chase');
    const firstFinder = decodeURIComponent(
      new URL(String(getSpy.mock.calls[0][0])).searchParams.get('finder') || ''
    );
    expect(firstFinder).toContain('siteNumber=CX_1001');
    expect(firstFinder).toContain('keyword=data analytics');
    expect(firstFinder).toContain('locationId=300000000289738');
  });

  it('keeps paging Oracle Cloud when TotalJobsCount is missing', async () => {
    getSpy.mockImplementation(async (url: string) => {
      const finder = decodeURIComponent(new URL(String(url)).searchParams.get('finder') || '');
      const offset = Number(finder.match(/offset=(\d+)/)?.[1] || '0');
      const mk = (id: number) => ({ Id: String(id), Title: `Role ${id}`, PrimaryLocation: 'US' });
      return {
        status: 200,
        data: {
          items: [
            {
              // No TotalJobsCount — must continue while pages are full.
              requisitionList: offset === 0 ? Array.from({ length: 100 }, (_, i) => mk(i + 1)) : [mk(101)],
            },
          ],
        },
      } as any;
    });

    const result = await fetchAtsBoardJobs(
      'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs',
      { maxPages: 2 }
    );
    expect(result?.rows).toHaveLength(101);
    expect(result?.rows[0].jobTitle).toBe('Role 1');
    expect(result?.rows[100].jobTitle).toBe('Role 101');
    expect(getSpy.mock.calls.length).toBe(2);
  });

  it('resolves Oracle CE vanity hash boards via Fusion host HTML then list API', async () => {
    getSpy.mockImplementation(async (url: string) => {
      const href = String(url);
      if (href === 'https://jobs.hexaware.com/' || href === 'https://jobs.hexaware.com') {
        throw new Error('HTML should not be fetched for known Hexaware fusion host');
      }
      if (href.includes('recruitingCEJobRequisitions')) {
        const finder = decodeURIComponent(new URL(href).searchParams.get('finder') || '');
        expect(href).toContain('fa-etqo-saasfaprod1.fa.ocs.oraclecloud.com');
        expect(finder).toContain('siteNumber=CX_1');
        expect(finder).toContain('locationId=300000000446660');
        return {
          status: 200,
          data: {
            items: [
              {
                TotalJobsCount: 1,
                requisitionList: [
                  {
                    Id: '672523',
                    Title: 'DevOps Track Sr.Engineer',
                    PrimaryLocation: 'United States',
                    PostedDate: '2026-08-01',
                  },
                ],
              },
            ],
          },
        } as any;
      }
      throw new Error(`unexpected url ${href}`);
    });

    const result = await fetchAtsBoardJobs(
      'https://jobs.hexaware.com/#en/sites/CX_1/jobs?location=United+States&locationId=300000000446660&locationLevel=country&mode=location'
    );
    expect(result?.provider).toBe('oraclecloud');
    expect(result?.companyHint).toBe('Hexaware');
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0].jobTitle).toBe('DevOps Track Sr.Engineer');
    expect(result?.rows[0].jobUrl).toContain(
      'fa-etqo-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/672523'
    );
  });

  it('surfaces Oracle vanity resolve failures instead of silent empty rows', async () => {
    getSpy.mockImplementation(async (url: string) => {
      const href = String(url);
      if (href.startsWith('https://jobs.unknown-oracle-vanity.test')) {
        return { status: 200, data: '<html>no fusion host here</html>' } as any;
      }
      throw new Error(`unexpected url ${href}`);
    });

    await expect(
      fetchAtsBoardJobs(
        'https://jobs.unknown-oracle-vanity.test/#en/sites/CX_9/jobs?locationId=1'
      )
    ).rejects.toThrow(/Fusion host not found|vanity/i);
  });

  it('fetches Dell path-vanity Oracle CE boards from the vanity host API', async () => {
    getSpy.mockImplementation(async (url: string) => {
      const href = String(url);
      expect(href).toContain('enterpriseplatform.dell.com/hcmRestApi/');
      const finder = decodeURIComponent(new URL(href).searchParams.get('finder') || '');
      expect(finder).toContain('siteNumber=careers');
      expect(finder).toContain('locationId=300000000471434');
      return {
        status: 200,
        data: {
          items: [
            {
              TotalJobsCount: 1,
              requisitionList: [
                {
                  Id: 'R288262',
                  Title: 'Software Engineer',
                  PrimaryLocation: 'United States',
                },
              ],
            },
          ],
        },
      } as any;
    });

    const result = await fetchAtsBoardJobs(
      'https://enterpriseplatform.dell.com/hcmUI/CandidateExperience/en/sites/careers/jobs?location=United+States&locationId=300000000471434'
    );
    expect(result?.provider).toBe('oraclecloud');
    expect(result?.companyHint).toBe('Dell');
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0].jobUrl).toContain(
      'enterpriseplatform.dell.com/hcmUI/CandidateExperience/en/sites/careers/job/R288262'
    );
  });

  it('fetches careers.oracle.com boards via HCM host and builds vanity job URLs', async () => {
    getSpy.mockImplementation(async (url: string) => {
      const href = String(url);
      expect(href).toContain('eeho.fa.us2.oraclecloud.com/hcmRestApi/');
      const finder = decodeURIComponent(new URL(href).searchParams.get('finder') || '');
      expect(finder).toContain('siteNumber=jobsearch');
      expect(finder).toContain('locationId=300000000149325');
      return {
        status: 200,
        data: {
          items: [
            {
              TotalJobsCount: 1,
              requisitionList: [
                {
                  Id: '342043',
                  Title: 'Principal Engineer',
                  PrimaryLocation: 'United States',
                },
              ],
            },
          ],
        },
      } as any;
    });

    const result = await fetchAtsBoardJobs(
      'https://careers.oracle.com/en/sites/jobsearch/jobs?location=United+States&locationId=300000000149325'
    );
    expect(result?.provider).toBe('oraclecloud');
    expect(result?.companyHint).toBe('Oracle');
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0].jobUrl).toBe(
      'https://careers.oracle.com/en/sites/jobsearch/job/342043'
    );
  });

  it('maps and paginates Bank of America jobs through its search API', async () => {
    getSpy.mockImplementation(async (url: string) => {
      const params = new URL(String(url)).searchParams;
      const start = Number(params.get('start') || '0');
      const end = Number(params.get('rows') || '0');
      // BoA uses inclusive start + exclusive end. start===end returns [].
      if (!(end > start)) {
        return { status: 200, data: { totalMatches: 2, jobsList: [] } } as any;
      }
      return {
        status: 200,
        data: {
          totalMatches: 2,
          jobsList:
            start === 0
              ? [
                  {
                    postingTitle: 'Data Engineer',
                    jcrURL: '/en-us/job-detail/123/data-engineer',
                    location: 'Charlotte, NC',
                    postedDate: '08/01/2026',
                    lob: 'Global Technology',
                    workShift: '1st shift',
                  },
                ]
              : [
                  {
                    postingTitle: 'Analytics Engineer',
                    jcrURL: '/en-us/job-detail/124/analytics-engineer',
                    location: 'New York, NY',
                    postedDate: '08/02/2026',
                  },
                ],
        },
      } as any;
    });

    const result = await fetchAtsBoardJobs(
      'https://careers.bankofamerica.com/en-us/job-search?ref=search&search=jobsByLocation&start=0&rows=1&searchstring=United+States&keywords=data+analytics',
      { maxPages: 2 }
    );
    expect(result?.provider).toBe('bankofamerica');
    expect(result?.rows).toHaveLength(2);
    expect(result?.rows[0].jobUrl).toBe(
      'https://careers.bankofamerica.com/en-us/job-detail/123/data-engineer'
    );
    expect(result?.rows[0].department).toBe('Global Technology');
    expect(String(getSpy.mock.calls[0][0])).toContain('start=0');
    expect(String(getSpy.mock.calls[0][0])).toContain('rows=1');
    expect(String(getSpy.mock.calls[1][0])).toContain('start=1');
    expect(String(getSpy.mock.calls[1][0])).toContain('rows=2');
    expect(getSpy.mock.calls[0][0]).toContain('term=data+analytics');
    expect(getSpy.mock.calls[0][0]).toContain('searchstring=United+States');
  });

  it('fetches Findly/m-cloud board via HTML config + job API', async () => {
    getSpy.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('careers.dxc.com')) {
        return {
          status: 200,
          data: `var cws_opts = {"org":"2492","api":"https:\\/\\/jobsapi-internal.m-cloud.io\\/api\\/","job_detail_path":"\\/job"};`,
        } as any;
      }
      if (u.includes('m-cloud.io') && u.includes('Organization=2492')) {
        return {
          status: 200,
          data: {
            totalHits: 1,
            queryResult: [
              {
                id: 99,
                title: 'Software Engineer',
                company_name: 'DXC Technology',
                url: 'https://careers.dxc.com/job/99/software-engineer/',
                primary_city: 'New York',
                primary_state: 'NY',
                primary_country: 'US',
                primary_category: 'Software Engineering',
                employment_type: 'Full time',
                open_date: '2026-01-01T00:00:00Z',
              },
            ],
          },
        } as any;
      }
      return { status: 404, data: null } as any;
    });

    const result = await fetchAtsBoardJobs(
      'https://careers.dxc.com/job-search-results/?compliment[]=United%20States%20of%20America&category[]=Software%20Engineering&keywords=java&pg=1'
    );
    expect(result?.provider).toBe('findly');
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0].jobTitle).toBe('Software Engineer');
    expect(result?.rows[0].companyName).toBe('DXC Technology');
    expect(result?.rows[0].location).toContain('New York');
    expect(result?.rows[0].jobUrl).toContain('/job/99/');
    expect(getSpy.mock.calls.some((c) => String(c[0]).includes('facet'))).toBe(true);
    expect(getSpy.mock.calls.some((c) => String(c[0]).includes('keyword=java'))).toBe(true);
  });

  it('paginates SuccessFactors HTML by startrow', async () => {
    getSpy.mockImplementation(async (url: string) => {
      const u = new URL(String(url));
      const start = Number(u.searchParams.get('startrow') || '0');
      if (start === 0) {
        return {
          status: 200,
          data: `successfactors rmkcdn.successfactors
            <div id="searchresults">
              <a href="/ey/job/Role-A/1/">Role A</a><a href="/ey/job/Role-B/2/">Role B</a>
            </div> Page 1 of 2`,
        } as any;
      }
      return {
        status: 200,
        data: `successfactors
          <div id="searchresults"><a href="/ey/job/Role-C/3/">Role C</a></div>
          Page 2 of 2`,
      } as any;
    });

    const result = await fetchAtsBoardJobs(
      'https://careers.ey.com/search-3?optionsFacetsDD_country=US&startrow=500'
    );
    expect(result?.provider).toBe('successfactors');
    expect(result?.rows.map((r) => r.jobTitle).sort()).toEqual(['Role A', 'Role B', 'Role C']);
    expect(String(getSpy.mock.calls[0][0])).toContain('startrow=0');
  });

  it('honors maxPages from robot/extension config for SuccessFactors', async () => {
    getSpy.mockImplementation(async (url: string) => {
      const u = new URL(String(url));
      const start = Number(u.searchParams.get('startrow') || '0');
      // First page has 2 jobs → pageSize=2, so offsets are 0, 2, 4…
      const pageJobs =
        start === 0
          ? `<a href="/ey/job/P1a/1/">P1a</a><a href="/ey/job/P1b/2/">P1b</a>`
          : start === 2
            ? `<a href="/ey/job/P2a/3/">P2a</a>`
            : `<a href="/ey/job/P3a/4/">P3a</a>`;
      const pageNum = start === 0 ? 1 : start === 2 ? 2 : 3;
      return {
        status: 200,
        data: `successfactors rmkcdn.successfactors
          <div id="searchresults">${pageJobs}</div>
          Page ${pageNum} of 21`,
      } as any;
    });

    const result = await fetchAtsBoardJobs(
      'https://careers.ey.com/search-3?optionsFacetsDD_country=US&startrow=0',
      { maxPages: 2 }
    );
    expect(result?.provider).toBe('successfactors');
    expect(result?.rows.map((r) => r.jobTitle).sort()).toEqual(['P1a', 'P1b', 'P2a']);
    expect(result?.rows.some((r) => r.jobTitle === 'P3a')).toBe(false);
    // page 1 + page 2 only
    expect(getSpy.mock.calls.length).toBe(2);
  });

  it('returns null when SuccessFactors HTML lacks confirmation signals', async () => {
    getSpy.mockResolvedValue({
      status: 200,
      data: '<html><body>not a job board</body></html>',
    } as any);
    expect(
      await fetchAtsBoardJobs(
        'https://careers.ey.com/search-3?optionsFacetsDD_country=US&startrow=0'
      )
    ).toBeNull();
  });
});

describe('Phenom board adapter', () => {
  const pcsxHtml = fs.readFileSync(
    path.join(__dirname, 'fixtures/phenom-pcsx-home.html'),
    'utf8'
  );
  const widgetsHtml = fs.readFileSync(
    path.join(__dirname, 'fixtures/phenom-widgets-home.html'),
    'utf8'
  );

  it('detects Phenom career hosts in detectAtsBoard', () => {
    const board = detectAtsBoard('https://hiring.jhu.edu/careers');
    expect(board?.provider).toBe('phenom');
    expect(board?.listApiUrl).toBe('phenom-widgets://resolve');
    expect(detectAtsBoard('https://boards.greenhouse.io/stripe')?.provider).toBe('greenhouse');
    expect(
      detectAtsBoard(
        'https://careers.google.com/jobs/results/?q=Software&sort_by=relevance'
      )?.provider
    ).toBe('googlecareers');
    expect(
      looksLikePhenomBoard(
        'https://careers.google.com/jobs/results/?q=Software&sort_by=relevance'
      )
    ).toBe(false);
  });

  it('looksLikePhenomBoard matches hiring hosts and pid query without treating pid as refNum', () => {
    expect(looksLikePhenomBoard('https://hiring.jhu.edu/careers?pid=1133910207165')).toBe(true);
    expect(looksLikePhenomBoard('https://careers.acme.phenompeople.com/us/en/search-results')).toBe(
      true
    );
    expect(looksLikePhenomBoard('https://boards.greenhouse.io/stripe')).toBe(false);
    const cfg = parsePhenomConfigFromHtml(
      widgetsHtml,
      'https://careers.acme.com/search?pid=1133910207165'
    );
    expect(cfg?.refNum).toBe('REF-ACME-99');
    expect(cfg?.refNum).not.toBe('1133910207165');
  });

  it('detects Intuit Talent Brew /search-jobs boards (Radancy, not Phenom)', () => {
    const url =
      'https://jobs.intuit.com/search-jobs?cid=directBookmarked_directBookmarked&_gl=1*9qw10m*_gcl_au*NDIxNDI2NjkyLjE3ODc2NDUyMzg.*_ga*OTQ3MDE5NTg5LjE3ODc2NDUyNDI.*_ga_B0XHEYG9RN*czE3ODc2NDUyNDIkbzEkZzAkdDE3ODc2NDUyNDIkajYwJGwwJGgw';
    expect(looksLikeTalentBrewBoard(url)).toBe(true);
    expect(looksLikePhenomBoard(url)).toBe(false);
    expect(detectAtsBoard(url)?.provider).toBe('talentbrew');
    expect(detectAtsBoard(url)?.companyHint).toMatch(/Intuit/i);
    expect(parseTalentBrewBoardFilters(url).organizationIds).toBe('27595');
    expect(looksLikeTalentBrewBoard('https://jobs.intuit.com/search-jobs')).toBe(true);
  });

  it("detects Moody's Talent Brew /search-jobs SEO boards (not Phenom)", () => {
    const url =
      'https://careers.moodys.com/en/search-jobs/technology/United%20States/49841/1/2/6252001/39x7599983215332/-98x5/50/2';
    expect(looksLikeTalentBrewBoard(url)).toBe(true);
    expect(looksLikePhenomBoard(url)).toBe(false);
    expect(detectAtsBoard(url)?.provider).toBe('talentbrew');
    expect(detectAtsBoard(url)?.companyHint).toBe("Moody's");
    expect(detectAtsBoard(url)?.listApiUrl).toBe(
      'https://careers.moodys.com/en/search-jobs/results'
    );
    expect(parseTalentBrewBoardFilters(url)).toMatchObject({
      locale: 'en',
      keywords: 'technology',
      location: 'United States',
      organizationIds: '49841',
      locationType: '2',
      locationPath: '6252001',
      latitude: '39.7599983215332',
      longitude: '-98.5',
      distance: '50',
      searchType: '2',
    });
    expect(shouldPreferAtsBoardOverUiPagination(url)).toBe(true);
  });

  it('does not classify Empower Talent Brew→Workday as talentbrew', () => {
    expect(looksLikeTalentBrewBoard('https://jobs.empower.com/search-jobs')).toBe(false);
    expect(looksLikeWorkdayBoard('https://jobs.empower.com/search-jobs')).toBe(true);
  });

  it('parses Talent Brew results HTML into job rows', () => {
    const html = `
      <section id="search-results" data-total-job-results="2">
        <ul>
          <li>
            <h2><a href="/en/job/new-york/genai-technology-architect/49841/99720141392">GenAI Technology Architect</a></h2>
            <span class="job-location">New York, United States</span>
          </li>
          <li>
            <h2><a href="/en/job/charlotte/senior-it-auditor/49841/96571737728">Senior IT Auditor</a></h2>
            <span class="job-location">Charlotte, United States</span>
          </li>
        </ul>
      </section>`;
    const jobs = parseTalentBrewResultsHtml(html, 'https://careers.moodys.com');
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      title: 'GenAI Technology Architect',
      jobUrl:
        'https://careers.moodys.com/en/job/new-york/genai-technology-architect/49841/99720141392',
      location: 'New York, United States',
    });
  });

  it('detects Uber HappyDance /en/jobs lists (countries query, not Phenom)', () => {
    const url = 'https://jobs.uber.com/en/jobs/?team=Engineer&countries=United+States';
    expect(looksLikeHappyDanceBoard(url)).toBe(true);
    expect(detectAtsBoard(url)?.provider).toBe('happydance');
    expect(detectAtsBoard(url)?.companyHint).toBe('Uber');
    expect(detectAtsBoard(url)?.listApiUrl).toBe(
      'https://jobs.uber.com/en/jobs/xml/?rss=true'
    );
    expect(startUrlHasCollectionFilters(url)).toBe(true);
  });

  it('detects Pinterest HappyDance vanity host so filtered /jobs RSS skips Cloudflare browser scrape', () => {
    const url =
      'https://www.pinterestcareers.com/jobs/?search=&location=Chicago&location=Los+Angeles&team=Engineering&pagesize=20#results';
    expect(looksLikeHappyDanceBoard(url)).toBe(true);
    expect(looksLikePhenomBoard(url)).toBe(false);
    expect(detectAtsBoard(url)?.provider).toBe('happydance');
    expect(detectAtsBoard(url)?.companyHint).toBe('Pinterest');
    expect(detectAtsBoard(url)?.listApiUrl).toBe(
      'https://www.pinterestcareers.com/jobs/xml/?rss=true'
    );
    expect(detectAtsBoard('https://careers.pinterest.com/careers')?.provider).toBe('phenom');
  });

  it('detects Verizon HappyDance /jobs lists so RSS collection skips Cloudflare browser scrape', () => {
    const url =
      'https://mycareer.verizon.com/jobs/?country=United+States+of+America&team=Technology';
    expect(looksLikeHappyDanceBoard(url)).toBe(true);
    expect(looksLikePhenomBoard(url)).toBe(false);
    expect(detectAtsBoard(url)?.provider).toBe('happydance');
    expect(detectAtsBoard(url)?.companyHint).toBe('Verizon');
    expect(detectAtsBoard(url)?.listApiUrl).toBe(
      'https://mycareer.verizon.com/jobs/xml/?rss=true'
    );
    expect(startUrlHasCollectionFilters(url)).toBe(true);
    expect(shouldPreferAtsBoardOverUiPagination(url)).toBe(true);
  });

  it('detects Box HappyDance /en/jobs lists so filtered RSS collection skips Cloudflare', () => {
    const url =
      'https://careers.box.com/en/jobs/?search=&location=Austin%2C+Texas%2C+United+States&team=Engineering&team=IT&team=Security&pagesize=20#results';
    expect(looksLikeHappyDanceBoard(url)).toBe(true);
    expect(looksLikePhenomBoard(url)).toBe(false);
    expect(detectAtsBoard(url)?.provider).toBe('happydance');
    expect(detectAtsBoard(url)?.companyHint).toBe('Box');
    expect(detectAtsBoard('https://careers.box.com')?.provider).toBe('happydance');
    const unmarked =
      'https://careers.acme.com/en/jobs/?search=&location=Austin&team=Engineering&pagesize=20#results';
    expect(looksLikeHappyDanceBoard(unmarked)).toBe(true);
    expect(detectAtsBoard(unmarked)?.provider).toBe('happydance');
    expect(detectAtsBoard('https://careers.example.com/jobs')).toBeNull();
  });

  it('detects Nutanix HappyDance /en/jobs lists (not Phenom widgets)', () => {
    const url =
      'https://careers.nutanix.com/en/jobs/?search=&country=United+States&team=Engineering&team=Information+Technology&pagesize=20#results';
    expect(looksLikeHappyDanceBoard(url)).toBe(true);
    expect(looksLikePhenomBoard(url)).toBe(false);
    expect(detectAtsBoard(url)?.provider).toBe('happydance');
    expect(detectAtsBoard(url)?.companyHint).toBe('Nutanix');
  });

  it('detects Wells Fargo HappyDance (migrated off Phenom search-results)', () => {
    expect(looksLikePhenomBoard('https://www.wellsfargojobs.com/')).toBe(false);
    expect(looksLikePhenomBoard('https://www.wellsfargojobs.com/us/en/search-results')).toBe(false);
    expect(detectAtsBoard('https://www.wellsfargojobs.com/')?.provider).toBe('happydance');
    expect(detectAtsBoard('https://www.wellsfargojobs.com/')?.companyHint).toBe('Wells Fargo');
    const list =
      'https://www.wellsfargojobs.com/en/jobs/?search=&country=United+States+of+America&team=Data+%26+Analytics&pagesize=20#results';
    expect(looksLikeHappyDanceBoard(list)).toBe(true);
    expect(detectAtsBoard(list)?.provider).toBe('happydance');
    expect(detectAtsBoard(list)?.listApiUrl).toBe(
      'https://www.wellsfargojobs.com/en/jobs/xml/?rss=true'
    );
    // Stale Phenom path on HappyDance host must still resolve RSS under /en/jobs/xml
    expect(
      detectAtsBoard(
        'https://www.wellsfargojobs.com/us/en/search-results?team=Data+%26+Analytics'
      )?.listApiUrl
    ).toBe('https://www.wellsfargojobs.com/en/jobs/xml/?rss=true');
  });

  it('detects Qualcomm / NVIDIA-style careers.brand.com/careers PCS URLs', () => {
    const qualcomm =
      'https://careers.qualcomm.com/careers?start=0&location=usa&pid=446719744020&sort_by=distance&filter_include_remote=0&filter_job_family=software+engineering';
    expect(looksLikePhenomBoard(qualcomm)).toBe(true);
    expect(detectAtsBoard(qualcomm)?.provider).toBe('phenom');
    expect(detectAtsBoard(qualcomm)?.companyHint).toBe('Qualcomm');
    expect(looksLikePhenomBoard('https://careers.nvidia.com/careers?pid=123456789012')).toBe(true);
  });

  it('detects Adobe Phenom category landing pages as a Phenom board', () => {
    const adobe =
      'https://careers.adobe.com/us/en/c/engineering-and-product-jobs';
    expect(looksLikePhenomBoard(adobe)).toBe(true);
    expect(detectAtsBoard(adobe)?.provider).toBe('phenom');
    expect(detectAtsBoard(adobe)?.companyHint).toBe('Adobe');
  });

  it('parsePhenomConfigFromHtml discovers PCSX domain from embedded JSON', () => {
    const cfg = parsePhenomConfigFromHtml(pcsxHtml, 'https://hiring.acme.example/careers');
    expect(cfg?.kind).toBe('pcsx');
    expect(cfg?.domain).toBe('acme.example');
    expect(cfg?.refNum).toBeUndefined();
  });

  it('buildPhenomWidgetsRequest includes refNum and pagination offset', () => {
    const body = buildPhenomWidgetsRequest(
      {
        kind: 'widgets',
        companyHint: 'Acme',
        refNum: 'REF-ACME-99',
        ddoKey: 'refineSearch',
        pageName: 'search-results',
      },
      40,
      20
    );
    expect(body).toMatchObject({
      ddoKey: 'refineSearch',
      pageName: 'search-results',
      from: 40,
      size: 20,
      refNum: 'REF-ACME-99',
    });
  });

  describe('fetchAtsBoardJobs', () => {
    let getSpy: ReturnType<typeof vi.spyOn>;
    let postSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      getSpy = vi.spyOn(atsHttpClient, 'get');
      postSpy = vi.spyOn(atsHttpClient, 'post');
      process.env.ATS_BOARD_PAGE_DELAY_MS = '0';
    });

    afterEach(() => {
      getSpy.mockRestore();
      postSpy.mockRestore();
    });

    it('maps PCSX search positions with absolute job URLs', async () => {
      getSpy.mockImplementation(async (url: string) => {
        if (String(url).includes('/api/pcsx/search')) {
          return {
            status: 200,
            data: {
              data: {
                count: 1,
                positions: [
                  {
                    id: 1133915268883,
                    name: 'Neuropsychometrist',
                    locations: ['Baltimore, MD, United States'],
                    positionUrl: '/careers/job/1133915268883',
                    postedTs: 1787176050,
                    workLocationOption: 'onsite',
                  },
                ],
              },
            },
          } as any;
        }
        return { status: 200, data: pcsxHtml } as any;
      });
      const result = await fetchAtsBoardJobs('https://hiring.acme.example/careers');
      expect(result?.provider).toBe('phenom');
      expect(result?.rows).toHaveLength(1);
      expect(result?.rows[0].jobTitle).toBe('Neuropsychometrist');
      expect(result?.rows[0].jobUrl).toBe('https://hiring.acme.example/careers/job/1133915268883');
    });

    it('forwards PCSX location and filter_* query params from the start URL', async () => {
      getSpy.mockImplementation(async (url: string) => {
        if (String(url).includes('/api/pcsx/search')) {
          const parsed = new URL(String(url));
          expect(parsed.searchParams.get('location')).toBe('usa');
          expect(parsed.searchParams.get('filter_job_family')).toBe('software engineering');
          expect(parsed.searchParams.get('pid')).toBeNull();
          return {
            status: 200,
            data: {
              data: {
                count: 1,
                positions: [{ id: 1, name: 'SWE', positionUrl: '/careers/job/1', locations: ['US'] }],
              },
            },
          } as any;
        }
        return { status: 200, data: pcsxHtml } as any;
      });
      const result = await fetchAtsBoardJobs(
        'https://careers.qualcomm.com/careers?location=usa&pid=446719744020&filter_job_family=software+engineering'
      );
      expect(result?.rows[0].jobTitle).toBe('SWE');
    });

    it('does not retry PCSX search without filters when the filtered query is empty', async () => {
      getSpy.mockImplementation(async (url: string) => {
        if (String(url).includes('/api/pcsx/search')) {
          const parsed = new URL(String(url));
          const filtered = parsed.searchParams.has('filter_job_family');
          return {
            status: 200,
            data: {
              data: {
                count: filtered ? 0 : 1,
                positions: filtered
                  ? []
                  : [{ id: 9, name: 'Fallback SWE', positionUrl: '/careers/job/9', locations: ['US'] }],
              },
            },
          } as any;
        }
        return { status: 200, data: pcsxHtml } as any;
      });
      const result = await fetchAtsBoardJobs(
        'https://careers.qualcomm.com/careers?location=usa&filter_job_family=software+engineering,hardware+engineering'
      );
      expect(result).toBeNull();
    });

    it('paginates PCSX search by start offset', async () => {
      getSpy.mockImplementation(async (url: string) => {
        if (String(url).includes('start=0')) {
          return {
            status: 200,
            data: {
              data: {
                count: 2,
                positions: [
                  { id: 1, name: 'Job A', positionUrl: '/careers/job/1', locations: ['NY'] },
                ],
              },
            },
          } as any;
        }
        if (String(url).includes('start=1')) {
          return {
            status: 200,
            data: {
              data: {
                count: 2,
                positions: [
                  { id: 2, name: 'Job B', positionUrl: '/careers/job/2', locations: ['LA'] },
                ],
              },
            },
          } as any;
        }
        return { status: 200, data: pcsxHtml } as any;
      });
      const result = await fetchAtsBoardJobs('https://hiring.acme.example/careers', { maxPages: 5 });
      expect(result?.rows.map((r) => r.jobTitle)).toEqual(['Job A', 'Job B']);
    });

    it('maps classic Phenom /widgets refineSearch jobs', async () => {
      getSpy.mockResolvedValue({ status: 200, data: widgetsHtml } as any);
      postSpy.mockResolvedValue({
        status: 200,
        data: {
          refineSearch: {
            data: {
              totalHits: 1,
              jobs: [
                {
                  title: 'Engineer',
                  applyUrl: '/us/en/job/12345/engineer',
                  location: 'Remote',
                },
              ],
            },
          },
        },
      } as any);
      const result = await fetchAtsBoardJobs('https://careers.acme.phenompeople.com/us/en/search-results');
      expect(postSpy).toHaveBeenCalled();
      const [, body] = postSpy.mock.calls[0];
      expect(body).toMatchObject({ refNum: 'REF-ACME-99', from: 0 });
      expect(result?.rows[0].jobTitle).toBe('Engineer');
      expect(result?.rows[0].jobUrl).toContain('/us/en/job/12345/engineer');
    });

    it('maps widgets keywords and selected_fields from the start URL and post-filters department', async () => {
      getSpy.mockResolvedValue({ status: 200, data: widgetsHtml } as any);
      postSpy.mockResolvedValue({
        status: 200,
        data: {
          refineSearch: {
            data: {
              totalHits: 2,
              jobs: [
                {
                  title: 'Backend Engineer',
                  category: 'Engineering',
                  applyUrl: '/us/en/job/1/be',
                  location: 'Remote',
                },
                {
                  title: 'Recruiter',
                  category: 'People',
                  applyUrl: '/us/en/job/2/hr',
                  location: 'Remote',
                },
              ],
            },
          },
        },
      } as any);
      const result = await fetchAtsBoardJobs(
        'https://careers.acme.phenompeople.com/us/en/search-results?search=engineer&team=Engineering'
      );
      const [, body] = postSpy.mock.calls[0];
      expect(body).toMatchObject({
        keywords: 'engineer',
        selected_fields: { category: ['Engineering'] },
      });
      expect(result?.rows.map((r) => r.jobTitle)).toEqual(['Backend Engineer']);
    });

    it('dedupes duplicate job URLs from widgets responses', async () => {
      getSpy.mockResolvedValue({ status: 200, data: widgetsHtml } as any);
      postSpy.mockResolvedValue({
        status: 200,
        data: {
          refineSearch: {
            data: {
              totalHits: 2,
              jobs: [
                { title: 'Dup', applyUrl: 'https://careers.acme.com/job/1' },
                { title: 'Dup copy', applyUrl: 'https://careers.acme.com/job/1' },
              ],
            },
          },
        },
      } as any);
      const result = await fetchAtsBoardJobs('https://careers.acme.phenompeople.com/search');
      expect(result?.rows).toHaveLength(1);
    });

    it('returns null when widgets API responds with HTTP 403', async () => {
      getSpy.mockResolvedValue({ status: 200, data: widgetsHtml } as any);
      postSpy.mockResolvedValue({ status: 403, data: { message: 'blocked' } } as any);
      expect(
        await fetchAtsBoardJobs('https://careers.acme.phenompeople.com/us/en/search-results')
      ).toBeNull();
    });

    it('returns null when PCSX HTML lacks Phenom config', async () => {
      getSpy.mockResolvedValue({ status: 200, data: '<html><body>hello</body></html>' } as any);
      expect(await fetchAtsBoardJobs('https://hiring.jhu.edu/careers')).toBeNull();
    });

    it('stops widgets pagination on empty page even when totalHits exceeds from', async () => {
      getSpy.mockResolvedValue({ status: 200, data: widgetsHtml } as any);
      postSpy
        .mockResolvedValueOnce({
          status: 200,
          data: {
            refineSearch: { data: { totalHits: 100, jobs: [] } },
          },
        } as any);
      expect(
        await fetchAtsBoardJobs('https://careers.acme.phenompeople.com/search')
      ).toBeNull();
      expect(postSpy).toHaveBeenCalledTimes(1);
    });
  });
});

describe('mapIbmCareersHtml', () => {
  it('extracts title, location, salary, and description from Avature JobDetail HTML', () => {
    const fixture = fs.readFileSync(
      path.join(__dirname, 'fixtures/ibm-careers-jobdetail.html'),
      'utf8'
    );
    const fields = mapIbmCareersHtml(
      fixture,
      'https://careers.ibm.com/en_US/careers/JobDetail?jobId=119566'
    );
    expect(fields.companyName).toBe('IBM');
    expect(fields.jobTitle).toBe('Sr. Software Engineer (TS/SCI)');
    expect(fields.jobDescription.length).toBeGreaterThan(200);
    expect(fields.jobDescription).toMatch(/Introduction/i);
    expect(fields.location).toMatch(/Hampton|Virginia|United States|Ashburn/i);
    expect(fields.location).not.toMatch(/State\s*\/\s*Province/i);
    expect(fields.remoteType).toBe('Hybrid');
    expect(fields.jobCategory).toMatch(/Data/i);
    expect(fields.salaryRange).toMatch(/144/);
    expect(fields.location).toMatch(/Virginia|United States/i);
  });
});

describe('ATS vs browser gate (provider table)', () => {
  const rows: Array<{
    name: string;
    url: string;
    expectAts: boolean;
    expectProvider?: string;
  }> = [
    {
      name: 'Box SX81AH65',
      url: 'https://careers.box.com/en/jobs/?search=&location=Austin%2C+Texas%2C+United+States&team=Engineering&team=IT&team=Security&pagesize=20#results',
      expectAts: true,
      expectProvider: 'happydance',
    },
    {
      name: 'Box unfiltered host allowlist',
      url: 'https://careers.box.com/en/jobs/',
      expectAts: false,
      expectProvider: 'happydance',
    },
    {
      name: 'Greenhouse Stripe board',
      url: 'https://boards.greenhouse.io/stripe',
      expectAts: false,
      expectProvider: 'greenhouse',
    },
    {
      name: 'Greenhouse location',
      url: 'https://boards.greenhouse.io/stripe?location=New+York',
      expectAts: true,
      expectProvider: 'greenhouse',
    },
    {
      name: 'Workday host only',
      url: 'https://intel.wd1.myworkdayjobs.com/External',
      expectAts: false,
      expectProvider: 'workday',
    },
    {
      name: 'Workday q',
      url: 'https://intel.wd1.myworkdayjobs.com/External?q=engineer',
      expectAts: true,
      expectProvider: 'workday',
    },
    {
      name: 'Lever company only',
      url: 'https://jobs.lever.co/acme',
      expectAts: false,
      expectProvider: 'lever',
    },
    {
      name: 'Ashby org only',
      url: 'https://jobs.ashbyhq.com/acme',
      expectAts: false,
      expectProvider: 'ashby',
    },
    {
      name: 'SmartRecruiters categories',
      url: 'https://jobs.smartrecruiters.com/AcmeCorp?categories=Engineering',
      expectAts: true,
      expectProvider: 'smartrecruiters',
    },
    {
      name: 'Google q',
      url: 'https://careers.google.com/jobs/results/?q=Software',
      expectAts: true,
      expectProvider: 'googlecareers',
    },
    {
      name: 'Google no q',
      url: 'https://careers.google.com/jobs/results/',
      expectAts: false,
      expectProvider: 'googlecareers',
    },
    {
      name: 'IBM location',
      url: 'https://careers.ibm.com/SearchJobs?location=US',
      expectAts: true,
      expectProvider: 'ibmcareers',
    },
    {
      name: 'BoA keywords',
      url: 'https://careers.bankofamerica.com/en-us/job-search?keywords=data',
      expectAts: true,
      expectProvider: 'bankofamerica',
    },
    {
      name: 'BoA pagination only',
      url: 'https://careers.bankofamerica.com/en-us/job-search',
      expectAts: false,
      expectProvider: 'bankofamerica',
    },
    {
      name: 'Cardinal Health SX94RZ41',
      url: 'https://jobs.cardinalhealth.com/search/searchjobs?regionalcountry=United+States&geolocationstring=39.5036%2C-99.0184_United+States&categoryid=a266442d-10a4-4adf-9806-354dc8644a33',
      expectAts: true,
      expectProvider: 'nasactivate',
    },
  ];

  it.each(rows)('$name', ({ url, expectAts, expectProvider }) => {
    expect(startUrlHasCollectionFilters(url)).toBe(expectAts);
    if (expectProvider) {
      expect(detectAtsBoard(url)?.provider).toBe(expectProvider);
    }
  });
});
