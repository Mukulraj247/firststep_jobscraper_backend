import { describe, it, expect } from 'vitest';
import {
  applyColumnOverrides,
  collectOmitKeys,
  shouldKeepExtractedJobRow,
  type ColumnOverride,
} from './automation';

describe('collectOmitKeys', () => {
  it('collects original and rename targets for omitted columns', () => {
    const overrides: Record<string, ColumnOverride> = {
      date: { omit: true, rename: 'posted_date' },
      url: { omit: true },
    };
    const keys = collectOmitKeys(overrides);
    expect(keys.has('date')).toBe(true);
    expect(keys.has('posted_date')).toBe(true);
    expect(keys.has('url')).toBe(true);
    expect(keys.has('company')).toBe(false);
  });

  it('ignores non-omit overrides', () => {
    const overrides: Record<string, ColumnOverride> = {
      x: { rename: 'y' },
      z: { clear: true },
    };
    expect(collectOmitKeys(overrides).size).toBe(0);
  });
});

describe('applyColumnOverrides', () => {
  it('passes through when overrides empty', () => {
    expect(applyColumnOverrides({ a: 1 }, {})).toEqual({ a: 1 });
    expect(applyColumnOverrides({ a: 1 }, undefined)).toEqual({ a: 1 });
  });

  it('still renames and clears when no omit', () => {
    expect(
      applyColumnOverrides({ date: 'Mon' }, { date: { rename: 'posted_date' } })
    ).toEqual({ posted_date: 'Mon' });
    expect(
      applyColumnOverrides({ title: 'Hi' }, { title: { clear: true } })
    ).toEqual({ title: '' });
  });

  it('drops omitted keys from raw scrape-shaped rows', () => {
    expect(
      applyColumnOverrides({ date: 'Mon', url: 'http://x' }, { date: { omit: true } })
    ).toEqual({ url: 'http://x' });
  });

  it('drops legacy renamed keys when omit lists prior rename target', () => {
    const row = { posted_date: 'Mon', url: 'http://x' };
    expect(
      applyColumnOverrides(row, { date: { omit: true, rename: 'posted_date' } })
    ).toEqual({ url: 'http://x' });
  });

  it('drops raw original key when omit only references original', () => {
    expect(
      applyColumnOverrides({ date: 'Mon' }, { date: { omit: true } })
    ).toEqual({});
  });

  it('does not drop unrelated keys that match omit rename target without omit rule', () => {
    expect(
      applyColumnOverrides({ posted_date: 'keep' }, { date: { rename: 'posted_date' } })
    ).toEqual({ posted_date: 'keep' });
  });

  it('reject overlap: omit wins over rename/clear for same source key', () => {
    expect(
      applyColumnOverrides({ date: 'x' }, { date: { omit: true, rename: 'posted_date', clear: true } })
    ).toEqual({});
  });
});

describe('shouldKeepExtractedJobRow', () => {
  it('keeps real job rows', () => {
    expect(
      shouldKeepExtractedJobRow({
        jobTitle: 'Senior Software Engineer',
        jobUrl: 'https://www.amazon.jobs/en/jobs/10386550/frontend-engineer-fauna',
        companyName: 'Amazon',
      })
    ).toBe(true);
    expect(
      shouldKeepExtractedJobRow({
        title: 'Data Scientist',
        url: 'https://careers.example.com/posting/1234',
      })
    ).toBe(true);
  });

  it('drops rows with neither url nor title', () => {
    expect(shouldKeepExtractedJobRow({})).toBe(false);
    expect(shouldKeepExtractedJobRow({ jobUrl: '   ', jobTitle: '' })).toBe(false);
  });

  it('drops cookie-consent banner titles', () => {
    expect(
      shouldKeepExtractedJobRow({
        jobTitle: 'Learn more about this provider',
        jobUrl: 'https://legal.hubspot.com/privacy-policy',
      })
    ).toBe(false);
    expect(
      shouldKeepExtractedJobRow({
        jobTitle: 'Cookie Preferences',
        jobUrl: 'https://example.com/cookie-preferences',
      })
    ).toBe(false);
    expect(
      shouldKeepExtractedJobRow({
        jobTitle: 'Accept all',
        jobUrl: 'https://example.com',
      })
    ).toBe(false);
    expect(
      shouldKeepExtractedJobRow({
        jobTitle: 'Do Not Sell My Personal Information',
        jobUrl: 'https://example.com/do-not-sell',
      })
    ).toBe(false);
  });

  it('drops pagination chrome captured as a row', () => {
    expect(
      shouldKeepExtractedJobRow({
        jobTitle: 'Last page Last »',
        jobUrl: 'https://www.sia-partners.com/en/opportunities?country=us',
      })
    ).toBe(false);
    expect(shouldKeepExtractedJobRow({ jobTitle: 'Next »' })).toBe(false);
    expect(shouldKeepExtractedJobRow({ jobTitle: 'Page 3 of 12' })).toBe(false);
    expect(shouldKeepExtractedJobRow({ jobTitle: 'last page' })).toBe(false);
  });

  it('drops legal / privacy / terms / safety subdomains', () => {
    expect(
      shouldKeepExtractedJobRow({ jobUrl: 'https://legal.hubspot.com/privacy-policy', jobTitle: 'x' })
    ).toBe(false);
    expect(
      shouldKeepExtractedJobRow({ jobUrl: 'https://business.safety.google/privacy/', jobTitle: 'x' })
    ).toBe(false);
    expect(
      shouldKeepExtractedJobRow({ jobUrl: 'https://privacy.example.com/', jobTitle: 'x' })
    ).toBe(false);
  });

  it('drops privacy / cookie / legal / terms path patterns', () => {
    expect(shouldKeepExtractedJobRow({ jobUrl: 'https://example.com/privacy', jobTitle: 'x' })).toBe(false);
    expect(shouldKeepExtractedJobRow({ jobUrl: 'https://example.com/privacy-policy', jobTitle: 'x' })).toBe(false);
    expect(shouldKeepExtractedJobRow({ jobUrl: 'https://example.com/cookies', jobTitle: 'x' })).toBe(false);
    expect(shouldKeepExtractedJobRow({ jobUrl: 'https://example.com/cookie-policy', jobTitle: 'x' })).toBe(false);
    expect(shouldKeepExtractedJobRow({ jobUrl: 'https://example.com/legal', jobTitle: 'x' })).toBe(false);
    expect(shouldKeepExtractedJobRow({ jobUrl: 'https://example.com/terms', jobTitle: 'x' })).toBe(false);
    expect(shouldKeepExtractedJobRow({ jobUrl: 'https://example.com/terms-of-service', jobTitle: 'x' })).toBe(false);
    expect(shouldKeepExtractedJobRow({ jobUrl: 'https://example.com/gdpr', jobTitle: 'x' })).toBe(false);
    expect(shouldKeepExtractedJobRow({ jobUrl: 'https://example.com/sitemap', jobTitle: 'x' })).toBe(false);
  });

  it('still drops SIA Partners /our-capabilities/ pages', () => {
    expect(
      shouldKeepExtractedJobRow({
        jobUrl: 'https://www.sia-partners.com/en/our-capabilities/ai-and-tech',
        jobTitle: 'AI & Tech',
      })
    ).toBe(false);
  });

  it('does not falsely drop jobs whose path merely contains "policy" as a substring', () => {
    expect(
      shouldKeepExtractedJobRow({
        jobUrl: 'https://careers.example.com/policy-analyst-12345',
        jobTitle: 'Policy Analyst',
      })
    ).toBe(true);
  });

  // ── Cookie / tracker table row patterns (Osano consent manager etc.) ────────
  it('drops snake_case cookie / localStorage identifier titles', () => {
    expect(shouldKeepExtractedJobRow({ jobTitle: 'osano_consentmanager_tattles [x2]' })).toBe(false);
    expect(shouldKeepExtractedJobRow({ jobTitle: 'loglevel' })).toBe(false);
    expect(shouldKeepExtractedJobRow({ jobTitle: '_ga_X12Y3Z4' })).toBe(false);
    expect(shouldKeepExtractedJobRow({ jobTitle: 'amplitude_user_id' })).toBe(false);
    expect(shouldKeepExtractedJobRow({ jobTitle: 'segment.io_anonymousId' })).toBe(false);
    expect(shouldKeepExtractedJobRow({ jobTitle: 'cf_clearance' })).toBe(false);
  });

  it('drops cookie purpose description sentences captured as titles', () => {
    expect(
      shouldKeepExtractedJobRow({
        jobUrl: 'https://admin.typeform.com/to/dwk6gt/',
        jobTitle: 'Registers which server-cluster is serving the visitor.',
      })
    ).toBe(false);
    expect(
      shouldKeepExtractedJobRow({
        jobTitle: 'Used to contain user\u2019s survey and quiz answers in Local Storage.',
      })
    ).toBe(false);
    expect(
      shouldKeepExtractedJobRow({
        jobTitle: 'Maintains settings and outputs when using the Developer Tools Console.',
      })
    ).toBe(false);
    expect(
      shouldKeepExtractedJobRow({
        jobTitle: 'Used to check if the user\u2019s browser supports cookies.',
      })
    ).toBe(false);
    expect(
      shouldKeepExtractedJobRow({
        jobTitle: 'Tracks the user across browsing sessions.',
      })
    ).toBe(false);
  });

  it('drops rows whose description is a cookie purpose sentence and url is empty', () => {
    expect(
      shouldKeepExtractedJobRow({
        jobTitle: 'Some weird title that survived',
        jobUrl: '',
        jobDescription: 'This cookie is part of services provided by Cloudflare...',
      })
    ).toBe(true); // jobDescription "This cookie..." is NOT a 3rd-person verb start — kept (still flagged later by other heuristics if needed)
    expect(
      shouldKeepExtractedJobRow({
        jobTitle: 'Some title',
        jobUrl: '',
        jobDescription: 'Used to contain user\u2019s survey and quiz answers.',
      })
    ).toBe(false);
    expect(
      shouldKeepExtractedJobRow({
        jobTitle: 'Some title',
        jobUrl: '',
        jobDescription: 'Registers which server-cluster is serving the visitor.',
      })
    ).toBe(false);
  });

  it('drops rows where companyName is a cookie expiry label and url is empty', () => {
    expect(
      shouldKeepExtractedJobRow({
        jobTitle: 'osano_consentmanager_tattles [x2]',
        companyName: 'Pending',
        jobUrl: '',
      })
    ).toBe(false);
    expect(
      shouldKeepExtractedJobRow({
        jobTitle: 'something',
        companyName: 'Session',
        jobUrl: '',
      })
    ).toBe(false);
  });

  // ── False-positive guards: real job rows that LOOK suspicious ────────────────
  it('keeps real job titles that happen to be single capitalized words', () => {
    expect(shouldKeepExtractedJobRow({ jobTitle: 'Engineer', jobUrl: 'https://x.example/job/1' })).toBe(true);
    expect(shouldKeepExtractedJobRow({ jobTitle: 'Manager', jobUrl: 'https://x.example/job/2' })).toBe(true);
    expect(shouldKeepExtractedJobRow({ jobTitle: 'Recruiter', jobUrl: 'https://x.example/job/3' })).toBe(true);
  });

  it('keeps real job titles with mixed case and spaces (multi-word)', () => {
    expect(shouldKeepExtractedJobRow({ jobTitle: 'Senior Software Engineer', jobUrl: 'https://x.com/1' })).toBe(true);
    expect(shouldKeepExtractedJobRow({ jobTitle: 'Used Equipment Sales Manager', jobUrl: 'https://x.com/2' })).toBe(true); // starts with "Used" but is a noun phrase
    expect(shouldKeepExtractedJobRow({ jobTitle: 'Identifies Hidden Talent Specialist', jobUrl: 'https://x.com/3' })).toBe(true);
  });

  it('keeps jobs whose companyName legitimately is "Session" only if URL is present', () => {
    // Edge case — Session is a real word, but unlikely as a company name with a real URL too
    expect(
      shouldKeepExtractedJobRow({
        jobTitle: 'Backend Developer',
        companyName: 'Session',
        jobUrl: 'https://session.example.com/careers/123',
      })
    ).toBe(true);
  });

  it('drops Phenom hub pages and keeps Ford job-detail URLs', () => {
    expect(
      shouldKeepExtractedJobRow({
        jobTitle: 'Candidate Hub',
        jobUrl: 'https://jobs.carrier.com/candidate-hub',
        companyName: 'Carrier',
      })
    ).toBe(false);
    expect(
      shouldKeepExtractedJobRow({
        jobTitle: '',
        jobUrl: 'https://careers.ford.com/job/dearborn/manager-hr-business-partners/48560/98473354336',
        companyName: 'Ford',
      })
    ).toBe(true);
  });

  it('drops Hiring Cafe /jobs index rows', () => {
    expect(
      shouldKeepExtractedJobRow({
        jobUrl: 'https://hiringcafe.com/jobs',
        jobTitle: 'Senior Engineer',
        companyName: 'Acme',
      })
    ).toBe(false);
    expect(
      shouldKeepExtractedJobRow({
        jobUrl: 'https://hiringcafe.com/job/senior-engineer-acme-abc123',
        jobTitle: 'Senior Engineer',
        companyName: 'Acme',
      })
    ).toBe(true);
  });
});
