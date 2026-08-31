import { describe, expect, it } from 'vitest';
import {
  LINKEDIN_NO_SESSION_HINT,
  isLinkedInHost,
  shouldFailFastLinkedInWithoutSession,
} from './linkedinSessionGate';

describe('isLinkedInHost', () => {
  it('matches linkedin.com and www', () => {
    expect(isLinkedInHost('linkedin.com')).toBe(true);
    expect(isLinkedInHost('www.linkedin.com')).toBe(true);
    expect(isLinkedInHost('jobs.linkedin.com')).toBe(true);
  });

  it('rejects other hosts', () => {
    expect(isLinkedInHost('example.com')).toBe(false);
    expect(isLinkedInHost('careers.linkedin.example.com')).toBe(false);
    expect(isLinkedInHost(null)).toBe(false);
  });
});

describe('shouldFailFastLinkedInWithoutSession', () => {
  it('is true for LinkedIn URL with empty cookies and no storage state', () => {
    expect(
      shouldFailFastLinkedInWithoutSession({
        url: 'https://www.linkedin.com/jobs/search/?keywords=engineer',
        cookies: [],
        hasReusableStorageState: false,
      })
    ).toBe(true);
    expect(
      shouldFailFastLinkedInWithoutSession({
        url: 'https://linkedin.com/jobs/',
        cookies: undefined,
        hasReusableStorageState: false,
      })
    ).toBe(true);
  });

  it('is false when cookies are present', () => {
    expect(
      shouldFailFastLinkedInWithoutSession({
        url: 'https://www.linkedin.com/jobs/',
        cookies: [{ name: 'li_at', value: 'x', domain: '.linkedin.com' }],
        hasReusableStorageState: false,
      })
    ).toBe(false);
  });

  it('is false when reusable storage state exists', () => {
    expect(
      shouldFailFastLinkedInWithoutSession({
        url: 'https://www.linkedin.com/jobs/',
        cookies: [],
        hasReusableStorageState: true,
      })
    ).toBe(false);
  });

  it('is false when LinkedIn ENV account pool is configured', () => {
    expect(
      shouldFailFastLinkedInWithoutSession({
        url: 'https://www.linkedin.com/jobs/',
        cookies: [],
        hasReusableStorageState: false,
        hasLinkedInAccountPool: true,
      })
    ).toBe(false);
  });

  it('is false for non-LinkedIn URLs', () => {
    expect(
      shouldFailFastLinkedInWithoutSession({
        url: 'https://jobs.example.com/search',
        cookies: [],
        hasReusableStorageState: false,
      })
    ).toBe(false);
  });

  it('exposes a clear user-facing hint', () => {
    expect(LINKEDIN_NO_SESSION_HINT).toMatch(/cookies/i);
    expect(LINKEDIN_NO_SESSION_HINT).toMatch(/session/i);
  });
});
