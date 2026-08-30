import { describe, expect, it } from 'vitest';
import { detectAtsBoard, looksLikePhenomBoard } from './atsAdapters';
import { normalizeAutomationUrl } from '../utils/automationUrl';
import { resolveAtsBoardStartUrl } from './careerSiteAtsConfig';

describe('ATS check preserves exact start URL', () => {
  it('does not rewrite Bank of America URLs on save', () => {
    const filtered =
      'https://careers.bankofamerica.com/en-us/job-search?searchstring=United+States&keywords=data';
    expect(normalizeAutomationUrl(filtered)).toBe(filtered);
  });

  it('detects ATS on the exact filtered URL without changing it', () => {
    const filtered =
      'https://careers.bankofamerica.com/en-us/job-search?searchstring=United+States&keywords=data';
    expect(detectAtsBoard(filtered)?.provider).toBe('bankofamerica');
  });

  it('detects Phenom on the exact search-results URL (filters stay on that URL)', () => {
    const url =
      'https://jobs.thecignagroup.com/us/en/search-results?keywords=engineer&location=United%20States';
    expect(looksLikePhenomBoard(url)).toBe(true);
    expect(detectAtsBoard(url)?.provider).toBe('phenom');
  });
});

describe('resolveAtsBoardStartUrl', () => {
  it('upgrades Travelers homepage to Findly job-search-results at run time', () => {
    const resolved = resolveAtsBoardStartUrl('https://careers.travelers.com/');
    expect(resolved.adjusted).toBe(true);
    expect(resolved.url).toBe('https://careers.travelers.com/job-search-results/');
    expect(detectAtsBoard(resolved.url)?.provider).toBe('findly');
  });

  it('keeps Travelers /job-search-results on Findly (not Phenom rewrite)', () => {
    const recorded =
      'https://careers.travelers.com/job-search-results?keywords=engineer&location=United%20States';
    const resolved = resolveAtsBoardStartUrl(recorded);
    expect(resolved.url).toContain('/job-search-results');
    expect(resolved.url).not.toContain('/us/en/search-results');
    expect(detectAtsBoard(resolved.url)?.provider).toBe('findly');
    expect(detectAtsBoard(resolved.url)?.companyHint).toMatch(/Travelers/i);
  });

  it('keeps an already-filtered Phenom search-results URL for non-Findly hosts', () => {
    const url =
      'https://careers.chubb.com/us/en/search-results?keywords=engineer&location=United%20States';
    const resolved = resolveAtsBoardStartUrl(url);
    expect(resolved.adjusted).toBe(false);
    expect(resolved.url).toBe(url);
  });

  it('resolves DXC Findly homepage and trailing-slash list URL for m-cloud fetch', () => {
    const home = resolveAtsBoardStartUrl('https://careers.dxc.com');
    expect(home.adjusted).toBe(true);
    expect(home.url).toBe('https://careers.dxc.com/job-search-results/');
    expect(detectAtsBoard(home.url)?.provider).toBe('findly');
    expect(detectAtsBoard(home.url)?.companyHint).toBe('DXC');

    const slash = resolveAtsBoardStartUrl('https://careers.dxc.com/job-search-results');
    expect(slash.url).toBe('https://careers.dxc.com/job-search-results/');
    expect(slash.adjusted).toBe(true);
  });

  it('does not rewrite non-Phenom Findly boards', () => {
    const dxc =
      'https://careers.dxc.com/job-search-results/?compliment[]=United%20States&category[]=Software%20Engineering';
    const resolved = resolveAtsBoardStartUrl(dxc);
    expect(resolved.adjusted).toBe(false);
    expect(detectAtsBoard(dxc)?.provider).toBe('findly');
  });

  it('resolves Empower Talent Brew homepage to Workday CXS board', () => {
    const resolved = resolveAtsBoardStartUrl('https://jobs.empower.com');
    expect(resolved.adjusted).toBe(true);
    expect(resolved.url).toBe('https://empower.wd12.myworkdayjobs.com/empower');
    expect(detectAtsBoard(resolved.url)?.provider).toBe('workday');
    expect(detectAtsBoard('https://jobs.empower.com')?.provider).toBe('workday');
  });

  it('does not classify Empower /search-jobs as Phenom', () => {
    const url = 'https://jobs.empower.com/search-jobs?acm=ALL';
    expect(looksLikePhenomBoard(url)).toBe(false);
    expect(detectAtsBoard(url)?.provider).toBe('workday');
  });

  it('resolves UHS Jibe homepage (not Phenom search-results)', () => {
    const resolved = resolveAtsBoardStartUrl('https://jobs.uhsinc.com');
    expect(resolved.adjusted).toBe(true);
    expect(resolved.url).toBe('https://jobs.uhsinc.com/careers/jobs');
    expect(detectAtsBoard(resolved.url)?.provider).toBe('jibe');
    expect(detectAtsBoard('https://jobs.uhsinc.com')?.provider).toBe('jibe');
    expect(looksLikePhenomBoard('https://jobs.uhsinc.com')).toBe(false);
  });

  it('resolves Broadcom hostname-only Workday board to External_Career list shell', () => {
    const resolved = resolveAtsBoardStartUrl('https://broadcom.wd1.myworkdayjobs.com');
    expect(resolved.adjusted).toBe(true);
    expect(resolved.url).toBe(
      'https://broadcom.wd1.myworkdayjobs.com/en-US/External_Career'
    );
    expect(detectAtsBoard(resolved.url)?.provider).toBe('workday');
    expect(detectAtsBoard(resolved.url)?.listApiUrl).toContain('/External_Career/jobs');
  });

  it('does not treat Nationwide Workday hosts as Phenom search-results shells', () => {
    expect(looksLikePhenomBoard('https://nationwide.wd1.myworkdayjobs.com')).toBe(false);
    expect(looksLikePhenomBoard('https://nationwide.wd5.myworkdayjobs.com/en-US/Nationwide')).toBe(
      false
    );
    const hostOnly = resolveAtsBoardStartUrl('https://nationwide.wd1.myworkdayjobs.com');
    expect(hostOnly.adjusted).toBe(true);
    expect(hostOnly.reason).toMatch(/Workday/i);
    expect(hostOnly.url).not.toContain('/search-results');
    expect(hostOnly.url).toMatch(/\/en-US\/Nationwide\/?$/i);
    expect(detectAtsBoard(hostOnly.url)?.provider).toBe('workday');
    expect(detectAtsBoard(hostOnly.url)?.listApiUrl).toContain('/Nationwide/jobs');

    // Phenom-shaped path on a Workday host must rewrite to the CXS site, not /us/en/search-results.
    const misrecorded = resolveAtsBoardStartUrl(
      'https://nationwide.wd1.myworkdayjobs.com/us/en/search-results?q=engineer'
    );
    expect(misrecorded.url).toContain('/en-US/Nationwide');
    expect(misrecorded.url).not.toContain('search-results');
    expect(misrecorded.url).toContain('q=engineer');
    expect(detectAtsBoard(misrecorded.url)?.listApiUrl).toContain('/Nationwide/jobs');
  });

  it('keeps careers.nationwide.com as Phenom (marketing host, not myworkdayjobs)', () => {
    expect(looksLikePhenomBoard('https://careers.nationwide.com')).toBe(true);
    const resolved = resolveAtsBoardStartUrl('https://careers.nationwide.com');
    expect(resolved.url).toBe('https://careers.nationwide.com/us/en/search-results');
    expect(detectAtsBoard(resolved.url)?.provider).toBe('phenom');
  });

  it('preserves query filters when upgrading Broadcom Workday host-only URL', () => {
    const recorded =
      'https://broadcom.wd1.myworkdayjobs.com?q=United+States&country=United+States';
    const resolved = resolveAtsBoardStartUrl(recorded);
    expect(resolved.adjusted).toBe(true);
    expect(resolved.url).toContain('/en-US/External_Career');
    expect(resolved.url).toContain('country=United+States');
  });

  it('upgrades Wells Fargo homepage to HappyDance /en/jobs/ (no longer Phenom)', () => {
    const resolved = resolveAtsBoardStartUrl('https://www.wellsfargojobs.com/');
    expect(resolved.adjusted).toBe(true);
    expect(resolved.url).toBe('https://www.wellsfargojobs.com/en/jobs/');
    expect(detectAtsBoard(resolved.url)?.provider).toBe('happydance');
    expect(detectAtsBoard(resolved.url)?.companyHint).toBe('Wells Fargo');
    expect(looksLikePhenomBoard('https://www.wellsfargojobs.com/')).toBe(false);
  });

  it('rewrites stale Wells Fargo Phenom search-results URL to HappyDance /en/jobs/', () => {
    const recorded =
      'https://www.wellsfargojobs.com/us/en/search-results?search=&country=United+States+of+America&team=Data+%26+Analytics&pagesize=20#results';
    const resolved = resolveAtsBoardStartUrl(recorded);
    expect(resolved.adjusted).toBe(true);
    expect(resolved.url).toContain('/en/jobs/');
    expect(resolved.url).not.toContain('search-results');
    expect(resolved.url).toContain('team=Data+%26+Analytics');
    expect(resolved.url).toContain('country=United+States+of+America');
    expect(resolved.url).toContain('#results');
    expect(detectAtsBoard(resolved.url)?.provider).toBe('happydance');
    expect(detectAtsBoard(resolved.url)?.listApiUrl).toBe(
      'https://www.wellsfargojobs.com/en/jobs/xml/?rss=true'
    );
  });

  it('does not rewrite USAA Talent Brew SEO path to Phenom search-results', () => {
    const url =
      'https://www.usaajobs.com/search-jobs/technology/United%20States/1207/1/2/6252001/39x76/-98x5/50/2';
    const resolved = resolveAtsBoardStartUrl(url);
    expect(resolved.adjusted).toBe(false);
    expect(resolved.url).toBe(url);
    expect(detectAtsBoard(url)?.provider).toBe('talentbrew');
  });

  it('upgrades DocuSign Jibe homepage to careers-home jobs list', () => {
    const resolved = resolveAtsBoardStartUrl('https://careers.docusign.com/?keywords=engineer');
    expect(resolved.adjusted).toBe(true);
    expect(resolved.url).toBe('https://careers.docusign.com/careers-home/jobs?keywords=engineer');
    expect(detectAtsBoard(resolved.url)?.provider).toBe('jibe');
  });

  it('upgrades Persistent Zwayam homepage to explore-opportunities', () => {
    const resolved = resolveAtsBoardStartUrl(
      'https://careers.persistent.com/?keywords=United%20States'
    );
    expect(resolved.adjusted).toBe(true);
    expect(resolved.url).toContain('/explore-opportunities');
    expect(resolved.url).toMatch(/keywords=United(\+|%20)States/);
    expect(detectAtsBoard(resolved.url)?.provider).toBe('zwayam');
  });
});
