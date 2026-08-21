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
    role_type: 'Individual Contributor',
    seniority_level: 'Mid Level',
    formatted_workplace_location: 'Bengaluru, Karnataka, India',
    workplace_cities: ['Bengaluru, Karnataka, IN'],
    workplace_states: ['Karnataka, IN'],
    workplace_countries: ['IN'],
    requirements_summary:
      "Bachelor's degree; 5+ years experience in clinical data services; proficiency with SAS, SQL",
    role_activities: ['developing reports', 'building EDC', 'analyzing problems'],
    technical_tools: ['SAS', 'SQL', 'PLSQL', 'Clinical EDC'],
    licenses_or_certifications: ['GCP'],
    bachelors_degree_requirement: 'Required',
    bachelors_degree_fields_of_study: ['Statistics', 'Computer Science'],
    masters_degree_requirement: 'Preferred',
    masters_degree_fields_of_study: ['Data Science'],
    associates_degree_requirement: 'Not Mentioned',
    doctorate_degree_requirement: 'Not Mentioned',
    min_industry_and_role_yoe: 5,
    listed_compensation_currency: 'USD',
    listed_compensation_frequency: 'Hourly',
    hourly_min_compensation: 33,
    hourly_max_compensation: 49,
    estimated_publish_date: '2026-06-08T00:00:00.000Z',
    '401k_matching': true,
    retirement_plan: true,
    generous_parental_leave: false,
    tuition_reimbursement: true,
    visa_sponsorship: true,
    relocation_assistance: false,
    four_day_work_week: false,
    generous_paid_time_off: true,
  },
  enriched_company_data: {
    name: 'Accenture',
    homepage_uri: 'accenture.com',
    industries: ['Professional Services', 'Information Technology'],
    tagline: 'Global provider of management consulting and technology services.',
    stock_exchange: 'NYSE',
    stock_symbol: 'ACN',
    nb_employees: 742000,
    year_founded: 1989,
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
    expect(parsed.skills).toEqual(['SAS', 'SQL', 'PLSQL', 'Clinical EDC']);
    expect(parsed.responsibilities).toEqual([
      'Developing reports',
      'Building EDC',
      'Analyzing problems',
    ]);
    expect(parsed.minimumQualifications).toEqual([
      "Bachelor's degree",
      '5+ years experience in clinical data services',
      'proficiency with SAS, SQL',
    ]);
    expect(parsed.companyLogoUrl).toContain('accenture.com');
    expect((parsed.jobDescription || '').length).toBeGreaterThan(200);
    expect(parsed.seniorityLevel).toBe('Mid Level');
    expect(parsed.roleType).toBe('Individual Contributor');
    expect(parsed.visaSponsorship).toBe('yes');
    expect(parsed.certifications).toEqual(expect.arrayContaining(['GCP']));
    expect(parsed.benefits).toEqual(
      expect.arrayContaining([
        '401(k) matching',
        'Retirement plan',
        'Tuition reimbursement',
        'Generous PTO',
        'Visa sponsorship',
      ])
    );
    expect(parsed.preferredQualifications).toEqual(
      expect.arrayContaining([expect.stringMatching(/Master.*Data Science.*preferred/i)])
    );
    expect(parsed.educationRequirement).toMatch(/Bachelor/i);
    expect(parsed.educationRequirement).toMatch(/Master/i);
    expect(parsed.companyEmployeeCount).toBe(742000);
    expect(parsed.companyFoundedYear).toBe(1989);
  });

  it('preserves full description sections through merge and list snapshot', () => {
    const parsed = normalizeHiringCafeJobRecord(ACCENTURE_LIKE_JOB);
    const merged = mergeHiringCafeDetailIntoRow({}, parsed, 'https://hiringcafe.com/job/x');
    expect(merged.responsibilities).toEqual([
      'Developing reports',
      'Building EDC',
      'Analyzing problems',
    ]);
    expect(merged.minimumQualifications).toEqual([
      "Bachelor's degree",
      '5+ years experience in clinical data services',
      'proficiency with SAS, SQL',
    ]);
    expect(merged.preferredQualifications).toEqual(
      expect.arrayContaining([expect.stringMatching(/Master.*preferred/i)])
    );
    expect(merged.benefits).toEqual(expect.arrayContaining(['401(k) matching', 'Visa sponsorship']));
    expect(merged.skills).toEqual(['SAS', 'SQL', 'PLSQL', 'Clinical EDC']);
    expect(merged.certifications).toEqual(['GCP']);
    expect(merged.about).toMatch(/management consulting/i);

    const snap = buildListSnapshot(merged);
    expect(snap.responsibilities).toHaveLength(3);
    expect(snap.responsibilities).toEqual(merged.responsibilities);
    expect(snap.minimumQualifications).toHaveLength(3);
    expect(snap.minimumQualifications).toEqual(merged.minimumQualifications);
    expect(snap.preferredQualifications?.length).toBeGreaterThan(0);
    expect(snap.benefits?.length).toBeGreaterThanOrEqual(4);
    expect(snap.skills).toHaveLength(4);
    expect(snap.certifications).toEqual(['GCP']);
    expect(snap.about).toMatch(/consulting/i);
  });

  it('maps many role_activities into responsibilities without dropping mid items', () => {
    const manyActivities = {
      ...ACCENTURE_LIKE_JOB,
      v5_processed_job_data: {
        ...ACCENTURE_LIKE_JOB.v5_processed_job_data,
        role_activities: [
          'owning roadmap delivery',
          'mentoring junior engineers',
          'partnering with product',
          'writing design docs',
          'on-call ownership',
          'improving CI reliability',
        ],
      },
    };
    const parsed = normalizeHiringCafeJobRecord(manyActivities);
    expect(parsed.responsibilities).toHaveLength(6);
    expect(parsed.responsibilities?.[0]).toBe('Owning roadmap delivery');
    expect(parsed.responsibilities?.[5]).toBe('Improving CI reliability');

    const snap = buildListSnapshot(mergeHiringCafeDetailIntoRow({}, parsed, 'https://hiringcafe.com/job/y'));
    expect(snap.responsibilities).toHaveLength(6);
  });

  it('maps education preferred/required when requirements_summary is thin', () => {
    const thin = {
      ...ACCENTURE_LIKE_JOB,
      v5_processed_job_data: {
        ...ACCENTURE_LIKE_JOB.v5_processed_job_data,
        requirements_summary: 'Strong communicator',
      },
    };
    const parsed = normalizeHiringCafeJobRecord(thin);
    expect(parsed.minimumQualifications).toEqual(
      expect.arrayContaining([
        'Strong communicator',
        expect.stringMatching(/Bachelor.*required/i),
      ])
    );
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
    expect(parsed.responsibilities).toEqual([
      'Developing reports',
      'Building EDC',
      'Analyzing problems',
    ]);
    expect(parsed.minimumQualifications).toHaveLength(3);
    expect(parsed.benefits).toEqual(expect.arrayContaining(['401(k) matching']));
    expect(parsed.preferredQualifications?.length).toBeGreaterThan(0);

    const merged = mergeHiringCafeDetailIntoRow({}, parsed, parsed.applyUrl ? 'https://hiringcafe.com/job/x' : '');
    const snap = buildListSnapshot(merged);
    expect(snap.location).toBe('Bengaluru, Karnataka, India');
    expect(snap.skills).toEqual(expect.arrayContaining(['SAS']));
    expect(snap.about).toMatch(/consulting/i);
    expect(snap.f500).toBe('NYSE: ACN');
    expect(snap.salaryRange).toBe('$33-$49/hr');
    expect(snap.benefits).toEqual(expect.arrayContaining(['401(k) matching']));
    expect(snap.seniorityLevel).toBe('Mid Level');
    expect(snap.visaSponsorship).toBe('yes');
    expect(snap.certifications).toEqual(expect.arrayContaining(['GCP']));
    expect(snap.companyEmployeeCount).toBe(742000);
    expect(snap.preferredQualifications?.length).toBeGreaterThan(0);
    expect(snap.responsibilities).toHaveLength(3);
    expect(snap.minimumQualifications).toHaveLength(3);
  });
});
