import { describe, expect, it } from 'vitest';
import {
  formatHiringCafeEmploymentType,
  formatHiringCafeLocation,
  formatHiringCafeRemoteType,
  formatHiringCafeSalary,
  normalizeHiringCafeJobRecord,
} from './hiringCafeNormalize';
import { parseHiringCafeJobPageHtml, mergeHiringCafeDetailIntoRow } from './hiringCafeDetail';
import { buildListSnapshot } from './jobBoardEnrichment';

const ACCENTURE_LIKE_JOB = {
  id: 'abc',
  apply_url: 'https://www.accenture.com/in-en/careers/jobdetails?id=ATCI-5215735-S2023733_en',
  job_information: {
    title: 'Clinical Data Analyst',
    description:
      '<p>Join Accenture to build clinical reports.</p><p>You will develop reports and analyze problems using SAS and SQL.</p>'.repeat(
        20
      ),
  },
  v5_processed_job_data: {
    core_job_title: 'Clinical Data Analyst',
    job_category: 'Data and Analytics',
    commitment: ['Full Time'],
    workplace_type: 'Onsite',
    formatted_workplace_location: 'Bengaluru, Karnataka, India',
    workplace_cities: ['Bengaluru, Karnataka, IN'],
    workplace_states: ['Karnataka, IN'],
    workplace_countries: ['IN'],
    requirements_summary:
      "Bachelor's degree; 5+ years experience in clinical data services; proficiency with SAS, SQL",
    role_activities: ['developing reports', 'building EDC', 'analyzing problems'],
    technical_tools: ['SAS', 'SQL', 'PLSQL', 'Clinical EDC'],
    min_industry_and_role_yoe: 5,
    listed_compensation_currency: 'USD',
    listed_compensation_frequency: 'Hourly',
    hourly_min_compensation: 33,
    hourly_max_compensation: 49,
    estimated_publish_date: '2026-06-08T00:00:00.000Z',
  },
  enriched_company_data: {
    name: 'Accenture',
    homepage_uri: 'accenture.com',
    industries: ['Professional Services', 'Information Technology'],
    tagline: 'Global provider of management consulting and technology services.',
    stock_exchange: 'NYSE',
    stock_symbol: 'ACN',
  },
};

describe('hiringCafeNormalize', () => {
  it('maps Hiring Cafe job payload like the live site structure', () => {
    const parsed = normalizeHiringCafeJobRecord(ACCENTURE_LIKE_JOB);
    expect(parsed.jobTitle).toBe('Clinical Data Analyst');
    expect(parsed.companyName).toBe('Accenture');
    expect(parsed.applyUrl).toContain('accenture.com');
    expect(parsed.location).toBe('Bengaluru, Karnataka, India');
    expect(parsed.employmentType).toBe('Full-time');
    expect(parsed.remoteType).toBe('Onsite');
    expect(parsed.jobCategory).toBe('Data and Analytics');
    expect(parsed.salaryRange).toMatch(/\$33/);
    expect(parsed.salaryRange).toMatch(/49/);
    expect(parsed.salaryRange.toLowerCase()).toMatch(/hr/);
    expect(parsed.jobExperience).toBe(5);
    expect(parsed.f500).toBe('NYSE: ACN');
    expect(parsed.sectorIndustry).toContain('Professional Services');
    expect(parsed.about).toMatch(/management consulting/i);
    expect(parsed.skills).toEqual(expect.arrayContaining(['SAS', 'SQL']));
    expect(parsed.responsibilities?.[0]).toMatch(/Developing reports/i);
    expect(parsed.companyLogoUrl).toContain('accenture.com');
    expect((parsed.jobDescription || '').length).toBeGreaterThan(200);
  });

  it('formats location / employment / remote helpers', () => {
    expect(formatHiringCafeLocation({ formatted_workplace_location: 'Des Moines, Iowa, United States' })).toBe(
      'Des Moines, Iowa, United States'
    );
    expect(formatHiringCafeLocation({ workplace_cities: ['Chennai, Tamil Nadu, IN'] })).toMatch(
      /Chennai, Tamil Nadu, India/
    );
    expect(formatHiringCafeEmploymentType(['Full Time'])).toBe('Full-time');
    expect(formatHiringCafeRemoteType('Hybrid')).toBe('Hybrid');
  });

  it('formats salary bands like Hiring Cafe chips', () => {
    expect(
      formatHiringCafeSalary({
        listed_compensation_currency: 'USD',
        listed_compensation_frequency: 'Yearly',
        yearly_min_compensation: 57000,
        yearly_max_compensation: 98000,
      })
    ).toBe('$57k-$98k/yr');
  });

  it('parseHiringCafeJobPageHtml reads nested HC __NEXT_DATA__', () => {
    const html = `
      <html><body>
        <button data-testid="job-page-apply">Apply directly on employer's site</button>
        <script id="__NEXT_DATA__" type="application/json">
          ${JSON.stringify({ props: { pageProps: { job: ACCENTURE_LIKE_JOB } } })}
        </script>
      </body></html>
    `;
    const parsed = parseHiringCafeJobPageHtml(
      html,
      'https://hiringcafe.com/job/clinical-data-analyst-accenture-bengaluru-abc123'
    );
    expect(parsed.applyUrl).toContain('accenture.com');
    expect(parsed.location).toBe('Bengaluru, Karnataka, India');
    expect(parsed.skills).toEqual(expect.arrayContaining(['SAS']));
    expect(parsed.f500).toBe('NYSE: ACN');
    expect(parsed.employmentType).toBe('Full-time');

    const merged = mergeHiringCafeDetailIntoRow({}, parsed, parsed.applyUrl ? 'https://hiringcafe.com/job/x' : '');
    const snap = buildListSnapshot(merged);
    expect(snap.location).toBe('Bengaluru, Karnataka, India');
    expect(snap.skills).toEqual(expect.arrayContaining(['SAS']));
    expect(snap.about).toMatch(/consulting/i);
    expect(snap.f500).toBe('NYSE: ACN');
    expect(snap.salaryRange).toBe('$33-$49/hr');
  });
});
