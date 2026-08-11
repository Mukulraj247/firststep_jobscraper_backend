import { describe, expect, it } from 'vitest';
import {
  canonicalizeCompanyName,
  decodeHtmlEntities,
  isBoardQualityPass,
  isCareersJobDetailUrl,
  isGenericJobTitle,
  isJunkDescription,
  isPortalCompanyName,
  makeDescriptionSnippet,
  normalizeJobDescription,
  parseJobPageHtml,
  parseJsonLdJobPosting,
  parseMetaTags,
  pickBestDescription,
  preferJobUrlTitle,
  titleFromJobUrl,
  htmlToPlainText,
  normalizeSalaryRange,
  normalizeLocation,
} from './jobPageParser';

const JSON_LD_FIXTURE = `<!DOCTYPE html><html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "JobPosting",
  "title": "Senior Software Engineer",
  "description": "<p>Build reliable systems for our customers across the platform. Responsibilities include designing APIs and requirements gathering.</p>",
  "datePosted": "2026-08-01",
  "employmentType": "FULL_TIME",
  "hiringOrganization": { "@type": "Organization", "name": "Acme Corp", "logo": "https://cdn.acme.com/logo.png" },
  "jobLocation": {
    "@type": "Place",
    "address": {
      "@type": "PostalAddress",
      "addressLocality": "Seattle",
      "addressRegion": "WA",
      "addressCountry": "US"
    }
  },
  "baseSalary": {
    "@type": "MonetaryAmount",
    "currency": "USD",
    "value": { "@type": "QuantitativeValue", "minValue": 150000, "maxValue": 200000, "unitText": "YEAR" }
  },
  "url": "https://jobs.acme.com/apply/123"
}
</script>
</head><body><h1>Ignore me</h1></body></html>`;

const META_FIXTURE = `<!DOCTYPE html><html><head>
<meta property="og:title" content="Frontend Engineer" />
<meta property="og:description" content="Join our product team building delightful UIs. Requirements include React experience." />
<meta property="og:site_name" content="Widget Inc" />
<meta property="og:url" content="https://widget.example/jobs/fe" />
<link rel="icon" href="/favicon.ico" />
</head><body></body></html>`;

const CHROME_FIXTURE = `Home > Careers Former Former Explore Explore Cookie Policy Privacy Policy All rights reserved Sign in Create account About Blog News Login Apply now Careers Contact`;

describe('jobPageParser', () => {
  it('parses JSON-LD JobPosting without cheerio for the common path', () => {
    const parsed = parseJsonLdJobPosting(JSON_LD_FIXTURE);
    expect(parsed?.jobTitle).toBe('Senior Software Engineer');
    expect(parsed?.companyName).toBe('Acme Corp');
    expect(parsed?.location).toContain('Seattle');
    expect(parsed?.salaryRange).toContain('150K');
    expect(parsed?.employmentType).toBe('Full-time');
    expect(parsed?.applyUrl).toContain('jobs.acme.com');
    expect(parsed?.companyLogoUrl).toContain('logo.png');
    expect(parsed?.source).toBe('jsonld');
  });

  it('rejects portal company names', () => {
    expect(isPortalCompanyName('Careers')).toBe(true);
    expect(isPortalCompanyName('Greenhouse')).toBe(true);
    expect(isPortalCompanyName('JPMC Candidate Experience page')).toBe(true);
    expect(isPortalCompanyName('Acme Corp')).toBe(false);
  });

  it('rejects nav chrome as junk description', () => {
    expect(isJunkDescription(CHROME_FIXTURE)).toBe(true);
    expect(
      isJunkDescription(
        'We are looking for a Consultant. Responsibilities include data science delivery and requirements workshops with clients.'
      )
    ).toBe(false);
  });

  it('prefers real JD over longer chrome', () => {
    const real =
      'About the role: you will lead marketing data science. Responsibilities include modeling and stakeholder management. Requirements: 5 years experience.';
    const picked = pickBestDescription(CHROME_FIXTURE + ' ' + CHROME_FIXTURE, real);
    expect(picked).toBe(real);
  });

  it('decodes HTML entities in titles', () => {
    expect(decodeHtmlEntities('Marketing Data Science &amp; AI')).toBe('Marketing Data Science & AI');
  });

  it('parses OG meta tags from head', () => {
    const parsed = parseMetaTags(META_FIXTURE, 'https://widget.example/jobs/fe');
    expect(parsed?.jobTitle).toBe('Frontend Engineer');
    expect(parsed?.companyName).toBe('Widget Inc');
    expect(parsed?.jobDescription).toContain('product team');
    expect(parsed?.companyLogoUrl).toContain('favicon.ico');
  });

  it('parseJobPageHtml prefers JSON-LD over heuristics', () => {
    const parsed = parseJobPageHtml(JSON_LD_FIXTURE);
    expect(parsed.source).toBe('jsonld');
    expect(parsed.jobTitle).toBe('Senior Software Engineer');
  });

  it('strips HTML job descriptions into readable plain text', () => {
    const html =
      '<p style="text-align:left"><b>Overview</b></p><p>Collaborative. Respectful.</p><ul><li><p>Design apps</p></li></ul>';
    const plain = normalizeJobDescription(html);
    expect(plain).not.toMatch(/<p|<b|<li/i);
    expect(plain).toContain('Overview');
    expect(plain).toContain('Collaborative');
    expect(plain).toContain('•');
  });

  it('rejects marketing and hub titles as generic', () => {
    expect(isGenericJobTitle('Working at Ford Motor Company')).toBe(true);
    expect(isGenericJobTitle('Search our Job Opportunities at Carrier')).toBe(true);
    expect(isGenericJobTitle('Candidate Hub')).toBe(true);
    expect(isGenericJobTitle('Building a World of Opportunity')).toBe(true);
    expect(isGenericJobTitle('Software Engineer')).toBe(false);
  });

  it('prefers Phenom URL slug over SPA marketing titles', () => {
    const ford =
      'https://careers.ford.com/job/brook-park/manager-hr-business-partners/48560/98473354336';
    expect(preferJobUrlTitle('Building a World of Opportunity', ford).toLowerCase()).toContain(
      'manager'
    );
    expect(preferJobUrlTitle('Manager HR Business Partners', ford).toLowerCase()).toContain(
      'manager'
    );
  });

  it('rejects search-widget and Toyota overview chrome as junk', () => {
    expect(
      isJunkDescription(
        'Search Jobs Search Jobs Job Category Select Communications Customer Experience Enterprise Technology Remote Country Select'
      )
    ).toBe(true);
    expect(
      isJunkDescription(
        'Overview Who we are Collaborative. Respectful. A place to dream and do. These are just a few words that describe what life is like at Toyota.'
      )
    ).toBe(true);
  });

  it('canonicalizes Carrier / Meta / Ford / Toyota aliases', () => {
    expect(canonicalizeCompanyName('Carrierjobs')).toBe('Carrier');
    expect(canonicalizeCompanyName('C01 Carrier Corporation')).toBe('Carrier');
    expect(canonicalizeCompanyName('Metacareers')).toBe('Meta');
    expect(canonicalizeCompanyName('Ford Motor Company')).toBe('Ford');
    expect(canonicalizeCompanyName('Toyota Motor North America')).toBe('Toyota');
  });

  it('detects Phenom/Toyota job detail URLs and recovers titles from slugs', () => {
    const ford =
      'https://careers.ford.com/job/brook-park/manager-hr-business-partners/48560/98473354336';
    const carrier =
      'https://jobs.carrier.com/en/job/muncie/associate-project-manager/29289/98720876112';
    const toyota =
      'https://careers.toyota.com/us/en/job/10329384/Cyber-Product-Security-Engineer-Lead';
    expect(isCareersJobDetailUrl(ford)).toBe(true);
    expect(isCareersJobDetailUrl(carrier)).toBe(true);
    expect(isCareersJobDetailUrl(toyota)).toBe(true);
    expect(isCareersJobDetailUrl('https://jobs.carrier.com/candidate-hub')).toBe(false);
    expect(titleFromJobUrl(ford).toLowerCase()).toContain('manager');
    expect(titleFromJobUrl(toyota).toLowerCase()).toContain('cyber');
  });

  it('fails board quality for hub URLs and junk shells', () => {
    expect(
      isBoardQualityPass({
        title: 'Working at Ford Motor Company',
        description:
          'Search Jobs Search Jobs Job Category Select Communications Customer Experience Remote',
        jobUrl: 'https://careers.ford.com/job/dearborn/manager-hr/48560/123',
      })
    ).toBe(false);
    expect(
      isBoardQualityPass({
        title: 'Candidate Hub',
        description: 'Search Carrier Jobs Keyword(s) Location Radius 50',
        jobUrl: 'https://jobs.carrier.com/candidate-hub',
      })
    ).toBe(false);
    expect(
      isBoardQualityPass({
        title: 'Senior Software Engineer',
        description:
          'About the role: you will build APIs. Responsibilities include design. Requirements: 5 years experience.',
        jobUrl: 'https://jobs.carrier.com/en/job/muncie/senior-software-engineer/29289/1',
      })
    ).toBe(true);
  });

  it('htmlToPlainText strips chrome and preserves content', () => {
    const html = `
      <html><head><script>evil()</script><style>.x{}</style></head>
      <body>
        <nav>Home Careers</nav>
        <h1>Software Engineer</h1>
        <p>About the job</p>
        <ul><li>Build APIs</li><li>Ship features</li></ul>
        <footer>Copyright</footer>
      </body></html>`;
    const text = htmlToPlainText(html, 5000);
    expect(text).toContain('Software Engineer');
    expect(text).toContain('Build APIs');
    expect(text.toLowerCase()).not.toContain('evil');
    expect(text.length).toBeLessThan(5000);
  });

  describe('normalizeSalaryRange', () => {
    it('returns empty for blank input', () => {
      expect(normalizeSalaryRange('')).toBe('');
      expect(normalizeSalaryRange(null)).toBe('');
      expect(normalizeSalaryRange(undefined)).toBe('');
    });

    it('keeps already-compact ranges', () => {
      expect(normalizeSalaryRange('$55,400 to $113,000')).toBe('$55,400 – $113,000');
      expect(normalizeSalaryRange('$103,600-$189,900')).toBe('$103,600 – $189,900');
      expect(normalizeSalaryRange('$142,860.00 per year')).toBe('$142,860 / year');
    });

    it('collapses EY multi-geo prose to the first compact range', () => {
      const prose =
        'The base salary range for this job in all geographic locations in the US is $76,600 to $126,300. The base salary range for New York City Metro Area, Washington State and California (excluding Sacramento) is $91,800 to $143,400.';
      expect(normalizeSalaryRange(prose)).toBe('$76,600 – $126,300');
    });

    it('extracts the first range from labeled multi-geo strings', () => {
      expect(
        normalizeSalaryRange(
          'US: $142,600 to $261,500; New York City Metro Area, Washington State and California (excluding Sacramento): $171,200 to $297,200'
        )
      ).toBe('$142,600 – $261,500');
    });

    it('prefers location-matched range when location hints NYC/CA/WA', () => {
      const prose =
        'The base salary range for this job in all geographic locations in the US is $76,600 to $126,300. The base salary range for New York City Metro Area, Washington State and California (excluding Sacramento) is $91,800 to $143,400.';
      expect(normalizeSalaryRange(prose, { location: 'New York, Dallas' })).toBe(
        '$91,800 – $143,400'
      );
    });
  });

  describe('normalizeLocation', () => {
    it('returns empty for blank input', () => {
      expect(normalizeLocation('')).toBe('');
      expect(normalizeLocation(null)).toBe('');
    });

    it('keeps already-clean city/region strings', () => {
      expect(normalizeLocation('Charlotte, North Carolina, United States')).toBe(
        'Charlotte, North Carolina'
      );
      expect(normalizeLocation('Remote')).toBe('Remote');
      expect(normalizeLocation('New York, NY')).toBe('New York, NY');
    });

    it('collapses Workday facility dumps to City, ST', () => {
      expect(
        normalizeLocation(
          'CAO01: CCS-Oklahoma City, 6101 West Reno Avenue, Oklahoma City, OK, 73127 USA, United States of America'
        )
      ).toBe('Oklahoma City, OK');
    });

    it('joins multi-site pipes into compact cities', () => {
      expect(
        normalizeLocation(
          'Charlotte, North Carolina, United States | Indianapolis, Indiana, United States'
        )
      ).toBe('Charlotte, North Carolina · Indianapolis, Indiana');
    });
  });
});
