import { describe, expect, it, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

vi.mock('./hiringCafeScrapeDo', () => ({
  fetchHiringCafePostingViaScrapeDo: vi.fn(),
}));

import {
  isHiringCafeHtmlJobPage,
  detectLightHtmlJobPage,
  fetchHiringCafePostingHtml,
  enrichHiringCafeRowFromHtml,
} from './hiringCafeHtmlLight';
import { fetchHiringCafePostingViaScrapeDo } from './hiringCafeScrapeDo';

const axiosGet = axios.get as unknown as ReturnType<typeof vi.fn>;
const scrapeDoMock = fetchHiringCafePostingViaScrapeDo as unknown as ReturnType<typeof vi.fn>;

const POSTING =
  'https://hiringcafe.com/job/software-engineer-teacher-experience-codeai-seattle-washington-q02dz2ndx7k31eq2';

const NEXT_DATA_HTML = `
<html><head><title>Software Engineer at CodeAI</title></head><body>
  <h1>Software Engineer, Teacher Experience</h1>
  <script id="__NEXT_DATA__" type="application/json">
    ${JSON.stringify({
      props: {
        pageProps: {
          job: {
            id: 'q02',
            apply_url: 'https://code.org/careers/apply/123',
            job_information: {
              title: 'Software Engineer, Teacher Experience',
              description:
                '<h2>COMPANY PROFILE</h2><p>CodeAI is an education innovation nonprofit.</p>'.repeat(15) +
                '<h2>JOB SUMMARY</h2><p>Build tools for teachers.</p>'.repeat(10),
            },
            v5_processed_job_data: {
              core_job_title: 'Software Engineer, Teacher Experience',
              commitment: ['Full Time'],
              workplace_type: 'Remote',
              formatted_workplace_location: 'United States or Seattle',
              yearly_min_compensation: 126900,
              yearly_max_compensation: 162000,
              listed_compensation_currency: 'USD',
              listed_compensation_frequency: 'Yearly',
              role_activities: ['developing features', 'prototyping products'],
              technical_tools: ['JavaScript', 'TypeScript', 'React'],
              requirements_summary: 'Requires 8+ years building full-stack web applications; JavaScript/TypeScript, React',
              min_industry_and_role_yoe: 8,
            },
            enriched_company_data: {
              name: 'CodeAI',
              homepage_uri: 'code.org',
              tagline: 'U.S. nonprofit providing free K–12 AI and computer-science curriculum.',
              nb_employees: 384,
              year_founded: 2013,
              industries: ['Education Services & Tutoring', 'Nonprofit Organizations & Foundations'],
            },
          },
        },
      },
    })}
  </script>
</body></html>
`;

describe('hiringCafeHtmlLight', () => {
  it('detects Hiring Cafe HTML pages that embed __NEXT_DATA__ job payload', () => {
    expect(isHiringCafeHtmlJobPage(NEXT_DATA_HTML)).toBe(true);
    expect(detectLightHtmlJobPage(NEXT_DATA_HTML)).toEqual({
      kind: 'hiring_cafe_next_data',
      light: true,
    });
  });

  it('rejects empty / JS-shell pages without usable job JSON', () => {
    expect(isHiringCafeHtmlJobPage('<html><body><div id="root"></div></body></html>')).toBe(false);
    expect(isHiringCafeHtmlJobPage('')).toBe(false);
    expect(detectLightHtmlJobPage('<html><body>loading…</body></html>')).toEqual({
      kind: 'unknown',
      light: false,
    });
  });

  it('parses full job + company fields from light HTML without a browser', () => {
    const row = enrichHiringCafeRowFromHtml({}, NEXT_DATA_HTML, POSTING);
    expect(row.jobTitle).toMatch(/Software Engineer/i);
    expect(row.companyName).toBe('CodeAI');
    expect(String(row.jobDescription)).toMatch(/COMPANY PROFILE/i);
    expect(String(row.jobDescription).length).toBeGreaterThan(400);
    expect(row.applyUrl).toContain('code.org');
    expect(row.companyWebsite).toMatch(/code\.org/i);
    expect(row.companyEmployeeCount).toBe(384);
    expect(row.companyFoundedYear).toBe(2013);
    expect(row.aggregatorPostingUrl).toBe(POSTING);
    expect(row.jobUrl).toBe(POSTING);
  });
});

describe('fetchHiringCafePostingHtml', () => {
  beforeEach(() => {
    axiosGet.mockReset();
    scrapeDoMock.mockReset();
  });

  it('GETs the Hiring Cafe posting URL and returns HTML when Content-Type is text/html', async () => {
    axiosGet.mockResolvedValueOnce({
      status: 200,
      data: NEXT_DATA_HTML,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });

    const result = await fetchHiringCafePostingHtml(POSTING);
    expect(result.ok).toBe(true);
    expect(result.method).toBe('http');
    expect(result.light).toBe(true);
    expect(result.html).toContain('__NEXT_DATA__');
    expect(axiosGet).toHaveBeenCalledWith(
      POSTING,
      expect.objectContaining({
        responseType: 'text',
      })
    );
  });

  it('refuses non–Hiring Cafe URLs (employer pages must not be fetched here)', async () => {
    const result = await fetchHiringCafePostingHtml('https://code.org/careers/apply/123');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/hiring.?cafe/i);
    expect(axiosGet).not.toHaveBeenCalled();
  });

  it('uses Scrape.do immediately when robot opts are set (skips HTTP/proxy)', async () => {
    scrapeDoMock.mockResolvedValue({
      ok: true,
      html: NEXT_DATA_HTML,
      method: 'scrape.do',
      light: true,
      tier: 2,
      creditsSpent: 5,
    });

    const result = await fetchHiringCafePostingHtml(POSTING, {
      scrapeDo: { enabled: true, token: 'tok', maxTier: 2 },
    });

    expect(result.ok).toBe(true);
    expect(result.method).toBe('scrape.do');
    expect(result.creditsSpent).toBe(5);
    expect(scrapeDoMock).toHaveBeenCalled();
    expect(axiosGet).not.toHaveBeenCalled();
  });
});
