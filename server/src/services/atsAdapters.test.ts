import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  detectAts,
  detectAtsBoard,
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
} from './atsAdapters';
import fs from 'fs';
import path from 'path';

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
