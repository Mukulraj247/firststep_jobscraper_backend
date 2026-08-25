import { describe, expect, it } from 'vitest';
import {
  applePositionIdFromUrl,
  mapAppleSearchResult,
  microsoftJobIdFromUrl,
  parseAppleJobsHydration,
  parsePhenomJobDdo,
} from './spaEmbeddedJobJson';

describe('spaEmbeddedJobJson', () => {
  it('parses Apple hydration job details without a browser', () => {
    const job = {
      postingTitle: 'Software Engineer, Cloud Services',
      jobSummary:
        'You will design and ship services used by millions of customers. Responsibilities include building APIs and reviewing designs.',
      minimumQualifications: 'BS in Computer Science and 3 years of software experience.',
      preferredQualifications: 'Experience with distributed systems.',
      locations: [{ name: 'Cupertino, California' }],
      employmentType: 'Full-time',
    };
    const html = `<html><script>window.__staticRouterHydrationData = ${JSON.stringify({
      loaderData: { jobDetails: { jobsData: job } },
    })};</script></html>`;
    const parsed = parseAppleJobsHydration(
      html,
      'https://jobs.apple.com/en-us/details/200612345/software-engineer-cloud-services'
    );
    expect(parsed?.jobTitle).toBe('Software Engineer, Cloud Services');
    expect(parsed?.companyName).toBe('Apple');
    expect(parsed?.jobDescription).toMatch(/Responsibilities include/i);
    expect(parsed?.location).toContain('Cupertino');
  });

  it('parses live Apple JSON.parse hydration wrappers', () => {
    const job = {
      postingTitle: 'Hardware Engineer',
      jobSummary:
        'Responsibilities include schematic review and bringing up boards. Minimum qualifications include a BS in EE.',
      locations: [{ name: 'Austin, Texas' }],
    };
    const inner = JSON.stringify({ loaderData: { jobDetails: { jobsData: job } } });
    const html = `<script>window.__staticRouterHydrationData = JSON.parse(${JSON.stringify(inner)});</script>`;
    const parsed = parseAppleJobsHydration(html, 'https://jobs.apple.com/en-us/details/9/hardware-engineer');
    expect(parsed?.jobTitle).toBe('Hardware Engineer');
    expect(parsed?.jobDescription).toMatch(/schematic/i);
  });

  it('parses a double-encoded Apple hydration string', () => {
    const inner = JSON.stringify({
      loaderData: {
        jobDetails: {
          jobsData: {
            postingTitle: 'Business Analyst',
            jobSummary:
              'About the role. You will partner with teams on operations. Qualifications include SQL and stakeholder management.',
          },
        },
      },
    });
    const html = `<script>window.__staticRouterHydrationData = ${JSON.stringify(inner)};</script>`;
    const parsed = parseAppleJobsHydration(html, 'https://jobs.apple.com/en-us/details/1/x');
    expect(parsed?.jobTitle).toBe('Business Analyst');
    expect(parsed?.jobDescription.length).toBeGreaterThan(40);
  });

  it('parses Microsoft Phenom phApp.ddo job details', () => {
    const ddo = {
      jobDetail: {
        data: {
          job: {
            title: 'Senior Software Engineer',
            companyName: 'Microsoft',
            description:
              '<p>Responsibilities include building Azure services and mentoring engineers.</p><p>Qualifications: 5 years of software development.</p>',
            city: 'Redmond',
            state: 'WA',
            country: 'United States',
            applyUrl: 'https://jobs.careers.microsoft.com/global/en/job/1810126/apply',
          },
        },
      },
    };
    const html = `<script>phApp.ddo = ${JSON.stringify(ddo)}; phApp.localization = {};</script>`;
    const parsed = parsePhenomJobDdo(
      html,
      'https://jobs.careers.microsoft.com/global/en/job/1810126/Senior-Software-Engineer'
    );
    expect(parsed?.jobTitle).toBe('Senior Software Engineer');
    expect(parsed?.jobDescription).toMatch(/Azure services/i);
    expect(parsed?.location).toContain('Redmond');
  });

  it('maps Apple search API rows', () => {
    const fields = mapAppleSearchResult(
      {
        postingTitle: 'ML Engineer',
        jobSummary:
          'Minimum qualifications include a degree in CS. You will train models and ship evaluations.',
        locations: [{ city: 'Austin' }],
      },
      'https://jobs.apple.com/en-us/details/2001/ml-engineer'
    );
    expect(fields.jobTitle).toBe('ML Engineer');
    expect(fields.companyName).toBe('Apple');
  });

  it('reads Apple and Microsoft ids from public URLs', () => {
    expect(
      applePositionIdFromUrl(
        'https://jobs.apple.com/en-us/details/200677755-3956/senior-business-operations-analyst'
      )
    ).toBe('200677755-3956');
    expect(
      microsoftJobIdFromUrl(
        'https://jobs.careers.microsoft.com/global/en/job/1810126/Software-Engineer'
      )
    ).toBe('1810126');
  });
});
