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
  it('upgrades Travelers homepage to Phenom search-results at run time', () => {
    const resolved = resolveAtsBoardStartUrl('https://careers.travelers.com/');
    expect(resolved.adjusted).toBe(true);
    expect(resolved.url).toBe('https://careers.travelers.com/us/en/search-results');
    expect(detectAtsBoard(resolved.url)?.provider).toBe('phenom');
  });

  it('upgrades Travelers /job-search-results (Findly mis-record) to Phenom list shell', () => {
    const recorded =
      'https://careers.travelers.com/job-search-results?keywords=engineer&location=United%20States';
    const resolved = resolveAtsBoardStartUrl(recorded);
    expect(resolved.adjusted).toBe(true);
    expect(resolved.url).toContain('/us/en/search-results');
    expect(resolved.url).toContain('keywords=engineer');
    expect(detectAtsBoard(resolved.url)?.provider).toBe('phenom');
    expect(detectAtsBoard(resolved.url)?.companyHint).toBe('Travelers');
  });

  it('does not rewrite an already-filtered Phenom search-results URL', () => {
    const url =
      'https://careers.travelers.com/us/en/search-results?keywords=engineer&location=United%20States';
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

  it('preserves query filters when upgrading Broadcom Workday host-only URL', () => {
    const recorded =
      'https://broadcom.wd1.myworkdayjobs.com?q=United+States&country=United+States';
    const resolved = resolveAtsBoardStartUrl(recorded);
    expect(resolved.adjusted).toBe(true);
    expect(resolved.url).toContain('/en-US/External_Career');
    expect(resolved.url).toContain('country=United+States');
  });

  it('upgrades DocuSign SmartRecruiters homepage to careers-home jobs list', () => {
    const resolved = resolveAtsBoardStartUrl('https://careers.docusign.com/?keywords=engineer');
    expect(resolved.adjusted).toBe(true);
    expect(resolved.url).toBe('https://careers.docusign.com/careers-home/jobs?keywords=engineer');
    expect(detectAtsBoard(resolved.url)?.provider).toBe('smartrecruiters');
  });
});
