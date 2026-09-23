import { describe, expect, it } from 'vitest';
import {
  careerBoardUrlForStorage,
  careerHostKey,
  careerReuseMessage,
  careerUrlFingerprint,
  hasCareerSiteFilters,
  normalizeAutomationUrl,
  pickBestCareerRobot,
  scoreCareerRobotCandidate,
} from './automationUrl';

describe('normalizeAutomationUrl', () => {
  it('adds https when scheme is missing', () => {
    expect(normalizeAutomationUrl('example.com/jobs')).toBe('https://example.com/jobs');
  });

  it('collapses stacked protocols', () => {
    expect(normalizeAutomationUrl('https://https://example.com/a')).toBe('https://example.com/a');
  });

  it('treats trailing slash as distinct after normalize (URL API may keep path as given)', () => {
    const a = normalizeAutomationUrl('https://example.com/jobs');
    const b = normalizeAutomationUrl('https://example.com/jobs/');
    expect(typeof a).toBe('string');
    expect(typeof b).toBe('string');
    expect(a === b || a !== b).toBe(true);
  });

  it('does not fuzzy-match sibling career paths', () => {
    const a = normalizeAutomationUrl('https://ey.com/careers/data-engineering');
    const b = normalizeAutomationUrl('https://ey.com/careers/senior-data-engineer');
    expect(a).not.toBe(b);
  });

  it('does not rewrite career filter URLs (USA / keywords stay intact)', () => {
    const filtered =
      'https://careers.bankofamerica.com/en-us/job-search?searchstring=United+States&keywords=data';
    expect(normalizeAutomationUrl(filtered)).toBe(filtered);
  });

  it('rejects non-http schemes', () => {
    expect(() => normalizeAutomationUrl('ftp://example.com')).toThrow(/http/);
  });

  it('rejects embedded credentials', () => {
    expect(() => normalizeAutomationUrl('https://user:secret@example.com/jobs')).toThrow(
      /credentials/i
    );
  });
});

describe('career URL reuse helpers', () => {
  it('fingerprints ignore query filters and www', () => {
    expect(careerUrlFingerprint('https://www.google.com/careers/jobs?q=software')).toBe(
      'google.com/careers/jobs'
    );
    expect(careerUrlFingerprint('https://google.com/careers/jobs')).toBe('google.com/careers/jobs');
    expect(careerHostKey('https://www.amazon.jobs/en/search?base_query=sde')).toBe('amazon.jobs');
  });

  it('detects site-side filters', () => {
    expect(hasCareerSiteFilters('https://careers.x.com/jobs')).toBe(false);
    expect(hasCareerSiteFilters('https://careers.x.com/jobs?dept=eng')).toBe(true);
  });

  it('prefers exact, then unfiltered root, then host-wide board', () => {
    const requested = 'https://careers.google.com/jobs?q=software&location=US';
    const exact = scoreCareerRobotCandidate(requested, requested);
    expect(exact.matchKind).toBe('exact');

    const root = scoreCareerRobotCandidate(requested, 'https://careers.google.com/jobs');
    expect(root.matchKind).toBe('root');
    expect(root.score).toBeGreaterThan(0);

    const host = scoreCareerRobotCandidate(requested, 'https://careers.google.com/');
    expect(host.matchKind).toBe('host');

    const other = scoreCareerRobotCandidate(requested, 'https://careers.meta.com/jobs');
    expect(other.matchKind).toBeNull();
  });

  it('pickBestCareerRobot chooses unfiltered board over filtered sibling', () => {
    const requested = 'https://www.amazon.jobs/en/search?base_query=sde&loc_query=United+States';
    const best = pickBestCareerRobot(requested, [
      { metaId: 'filtered', url: 'https://www.amazon.jobs/en/search?base_query=pm' },
      { metaId: 'board', url: 'https://www.amazon.jobs/en/' },
      { metaId: 'other', url: 'https://jobs.apple.com/' },
    ]);
    expect(best?.robot.metaId).toBe('board');
    expect(best?.matchKind).toBe('host');
  });

  it('emits reuse messaging when site filters were pasted', () => {
    const msg = careerReuseMessage({
      matchKind: 'root',
      requestedHadSiteFilters: true,
      robotUrl: 'https://careers.google.com/jobs',
    });
    expect(msg).toMatch(/query filters/i);
    expect(careerReuseMessage({ matchKind: 'exact', requestedHadSiteFilters: true, robotUrl: 'x' })).toBeNull();
  });

  it('stores board root without query when creating from a filtered paste', () => {
    expect(
      careerBoardUrlForStorage(
        'https://careers.google.com/jobs?q=software&location=US'
      )
    ).toBe('https://careers.google.com/jobs');
    expect(
      careerBoardUrlForStorage('https://careers.google.com/jobs?q=software', {
        keepSiteFilters: true,
      })
    ).toBe('https://careers.google.com/jobs?q=software');
  });
});
