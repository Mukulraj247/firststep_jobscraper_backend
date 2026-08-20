import { describe, expect, it } from 'vitest';
import {
  extractHiringCafeApplyUrl,
  isHiringCafeJobPostingUrl,
  locationFromHiringCafeSlug,
  mergeHiringCafeDetailIntoRow,
  parseHiringCafeJobPageHtml,
  pickHiringCafeJobUrl,
  titleFromHiringCafeSlug,
} from './hiringCafeDetail';

const POSTING =
  'https://hiringcafe.com/job/senior-building-automation-systems-specialist-siemens-raleigh-north-3kuh829x4a1ug9f6';

describe('hiringCafeDetail', () => {
  it('detects posting URLs and rejects the jobs index', () => {
    expect(isHiringCafeJobPostingUrl(POSTING)).toBe(true);
    expect(isHiringCafeJobPostingUrl('https://hiringcafe.com/jobs')).toBe(false);
  });

  it('picks the posting URL from mixed list-row fields', () => {
    expect(
      pickHiringCafeJobUrl({
        company: 'HiringCafe',
        url: 'https://hiringcafe.com/jobs',
        link: POSTING,
        image: 'https://s2.googleusercontent.com/s2/favicons?domain=siemens.com',
      })
    ).toBe(POSTING);
  });

  it('merges detail fields without keeping the portal as employer', () => {
    const merged = mergeHiringCafeDetailIntoRow(
      {
        company: 'HiringCafe',
        description: 'LON, BACnet, N2, Modbus, Microsoft Office',
        url: 'https://hiringcafe.com/jobs',
      },
      {
        jobTitle: 'Senior Building Automation Systems Specialist',
        companyName: 'Siemens',
        jobDescription: 'Commission new distributed digital control systems on construction sites.',
        location: 'Raleigh, North Carolina, United States',
        salaryRange: '$57k-$98k/yr',
        employmentType: 'Full Time',
        remoteType: 'Onsite',
        applyUrl: 'https://jobs.siemens.com/careers/job/123',
      },
      POSTING
    );
    expect(merged.jobUrl).toBe(POSTING);
    expect(merged.jobTitle).toBe('Senior Building Automation Systems Specialist');
    expect(merged.companyName).toBe('Siemens');
    expect(String(merged.jobDescription)).toContain('Commission new distributed');
    expect(merged.applyUrl).toBe('https://jobs.siemens.com/careers/job/123');
    expect(merged.location).toBe('Raleigh, North Carolina, United States');
  });

  it('builds a readable title from the Hiring Cafe slug', () => {
    expect(titleFromHiringCafeSlug(POSTING)).toMatch(/Senior Building Automation/i);
  });

  it('extracts apply_url from Hiring Cafe __NEXT_DATA__ (button has no href)', () => {
    const html = `
      <html><body>
        <button data-testid="job-page-apply" type="button">Apply directly on employer's site</button>
        <script id="__NEXT_DATA__" type="application/json">
          {"props":{"pageProps":{"job":{
            "id":"abc",
            "apply_url":"https://wilhelmsen.wd3.myworkdayjobs.com/wilhelmsen/job/Chennai/Software-Engineer_JOBREQ_12579-1",
            "job_information":{"title":"Software Engineer","description":"${'Join our global team. '.repeat(40)}"},
            "v5_processed_job_data":{"core_job_title":"Software Engineer","workplace_type":"Onsite","workplace_cities":["Chennai"],"workplace_states":["Tamil Nadu"],"workplace_countries":["IN"]},
            "enriched_company_data":{"name":"Wilhelmsen"}
          }}}}
        </script>
      </body></html>
    `;
    expect(extractHiringCafeApplyUrl(html, POSTING)).toBe(
      'https://wilhelmsen.wd3.myworkdayjobs.com/wilhelmsen/job/Chennai/Software-Engineer_JOBREQ_12579-1'
    );
    const parsed = parseHiringCafeJobPageHtml(html, POSTING);
    expect(parsed.applyUrl).toBe(
      'https://wilhelmsen.wd3.myworkdayjobs.com/wilhelmsen/job/Chennai/Software-Engineer_JOBREQ_12579-1'
    );
    expect(parsed.jobTitle).toBe('Software Engineer');
    expect(parsed.companyName).toBe('Wilhelmsen');
    expect(parsed.location).toMatch(/Chennai/);
    expect((parsed.jobDescription || '').length).toBeGreaterThan(100);
  });

  it('extracts the employer apply URL from the job page HTML', () => {
    const html = `
      <a href="/jobs">Jobs</a>
      <a href="https://jobs.siemens.com/careers/job/123">Apply directly on employer's site</a>
    `;
    expect(extractHiringCafeApplyUrl(html, POSTING)).toBe('https://jobs.siemens.com/careers/job/123');
  });

  it('merge stores external applyUrl and never keeps Hiring Cafe as apply', () => {
    const merged = mergeHiringCafeDetailIntoRow(
      { company: 'HiringCafe' },
      {
        jobTitle: 'Engineer',
        companyName: 'Acme',
        jobDescription: 'x'.repeat(450),
        applyUrl: 'https://boards.greenhouse.io/acme/jobs/1',
      },
      POSTING
    );
    expect(merged.applyUrl).toBe('https://boards.greenhouse.io/acme/jobs/1');
    expect(merged.jobUrl).toBe(POSTING);

    const noApply = mergeHiringCafeDetailIntoRow(
      { applyUrl: POSTING },
      { jobTitle: 'Engineer', companyName: 'Acme', jobDescription: 'x'.repeat(450), applyUrl: POSTING },
      POSTING
    );
    expect(noApply.applyUrl).toBeUndefined();
  });

  it('parseHiringCafeJobPageHtml reads __NEXT_DATA__ job payload', () => {
    const html = `
      <html><head><title>ignored</title></head><body>
        <h1>Fallback title</h1>
        <script id="__NEXT_DATA__" type="application/json">
          {"props":{"pageProps":{"job":{
            "title":"Senior Building Automation Systems Specialist",
            "companyName":"Siemens",
            "description":"${'Commission systems. '.repeat(30)}",
            "location":"Raleigh, North Carolina, United States",
            "employmentType":"Full Time"
          }}}}
        </script>
      </body></html>
    `;
    const parsed = parseHiringCafeJobPageHtml(html, POSTING);
    expect(parsed.jobTitle).toBe('Senior Building Automation Systems Specialist');
    expect(parsed.companyName).toBe('Siemens');
    expect(parsed.location).toMatch(/Raleigh/);
    expect((parsed.jobDescription || '').length).toBeGreaterThan(400);
  });

  it('locationFromHiringCafeSlug infers city and state from slug tokens', () => {
    expect(
      locationFromHiringCafeSlug(
        'https://hiringcafe.com/job/software-engineer-acme-austin-texas-abc12345678'
      )
    ).toBe('Austin, Texas');
  });

  it('merge adds slug location when detail omits it', () => {
    const slugUrl =
      'https://hiringcafe.com/job/software-engineer-acme-austin-texas-abc12345678';
    const merged = mergeHiringCafeDetailIntoRow(
      { company: 'HiringCafe' },
      {
        jobTitle: 'Engineer',
        companyName: 'Acme',
        jobDescription: 'x'.repeat(450),
      },
      slugUrl
    );
    expect(merged.location).toBe('Austin, Texas');
  });
});
