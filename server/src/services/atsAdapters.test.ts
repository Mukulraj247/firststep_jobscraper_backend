import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  detectAts,
  detectAtsBoard,
  shouldSkipScrapeDoUrl,
  shouldNeverScrapeDoUrl,
  fetchAtsBoardJobs,
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
  parsePhenomConfigFromHtml,
  buildPhenomWidgetsRequest,
} from './atsAdapters';
import fs from 'fs';
import path from 'path';

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
    expect(d?.provider).toBe('careerhtml');
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
      'Truist'
    );
    expect(detectAts('https://jobs-us.pwc.com/us/en/job/12345/consultant')?.companyHint).toBe('PwC');
  });

  it('does not treat HiringCafe as ATS', () => {
    expect(detectAts('https://hiringcafe.com/job/abc')).toBeNull();
    expect(detectAts('https://hiring.cafe/job/abc')).toBeNull();
    expect(shouldSkipScrapeDoUrl('https://hiringcafe.com/job/abc')).toBe(false);
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

  it('detects Findly / job-search-results boards', () => {
    const dxc = detectAtsBoard(
      'https://careers.dxc.com/job-search-results/?compliment[]=United%20States&category[]=Software%20Engineering&pg=1'
    );
    expect(dxc?.provider).toBe('findly');
    expect(dxc?.listApiUrl).toContain('m-cloud.io');

    const findlyHost = detectAtsBoard('https://acme.site.findly.com/job-search-results/');
    expect(findlyHost?.provider).toBe('findly');
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
      'https://careers.dxc.com/job-search-results/?compliment[]=United%20States%20of%20America&category[]=Software%20Engineering&pg=1'
    );
    expect(result?.provider).toBe('findly');
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0].jobTitle).toBe('Software Engineer');
    expect(result?.rows[0].companyName).toBe('DXC Technology');
    expect(result?.rows[0].location).toContain('New York');
    expect(result?.rows[0].jobUrl).toContain('/job/99/');
    expect(getSpy.mock.calls.some((c) => String(c[0]).includes('facet'))).toBe(true);
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

  it('detects Qualcomm / NVIDIA-style careers.brand.com/careers PCS URLs', () => {
    const qualcomm =
      'https://careers.qualcomm.com/careers?start=0&location=usa&pid=446719744020&sort_by=distance&filter_include_remote=0&filter_job_family=software+engineering';
    expect(looksLikePhenomBoard(qualcomm)).toBe(true);
    expect(detectAtsBoard(qualcomm)?.provider).toBe('phenom');
    expect(detectAtsBoard(qualcomm)?.companyHint).toBe('Qualcomm');
    expect(looksLikePhenomBoard('https://careers.nvidia.com/careers?pid=123456789012')).toBe(true);
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

    it('retries PCSX search without filters when the filtered query is empty', async () => {
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
      expect(result?.rows[0].jobTitle).toBe('Fallback SWE');
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
