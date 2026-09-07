import { describe, expect, it } from 'vitest';
import {
  H1B_FY2026_TITLE_MATCH_MIN,
  matchFy2026Role,
} from './matchFy2026Role';
import { jdBlocksSponsorship, isUsJobLocation } from './resolveH1bSponsorship';

describe('matchFy2026Role', () => {
  const titles = [
    { title: 'software engineer', n: 100 },
    { title: 'data scientist', n: 40 },
    { title: 'product manager', n: 20 },
  ];

  it('matches high title overlap (≥0.70)', () => {
    const r = matchFy2026Role('Senior Software Engineer', titles);
    expect(r.matched).toBe(true);
    expect(r.confidence).toBeGreaterThanOrEqual(H1B_FY2026_TITLE_MATCH_MIN);
    expect(r.matchedTitle.toLowerCase()).toContain('software');
  });

  it('rejects below high threshold', () => {
    const r = matchFy2026Role('Marketing Coordinator', titles);
    expect(r.matched).toBe(false);
    expect(r.matchedTitle).toBe('');
  });

  it('returns empty for blank title or empty list', () => {
    expect(matchFy2026Role('', titles).matched).toBe(false);
    expect(matchFy2026Role('Software Engineer', []).matched).toBe(false);
  });
});

describe('FY2026 gates (shared helpers)', () => {
  it('blocks non-US and JD no-sponsor', () => {
    expect(isUsJobLocation('London, UK')).toBe(false);
    expect(jdBlocksSponsorship('no', '')).toBe(true);
    expect(jdBlocksSponsorship('yes', 'We will not sponsor visas')).toBe(true);
  });
});
