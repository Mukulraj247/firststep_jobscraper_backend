import { describe, expect, it } from 'vitest';
import {
  isBrowserFallbackHostAllowed,
  shouldTryBrowserJobFallback,
} from './browserJobFallback';

describe('shouldTryBrowserJobFallback', () => {
  it('uses browser fallback after scrape.do exhausts its tiers against a protected site', () => {
    expect(
      shouldTryBrowserJobFallback({
        ok: false,
        status: 0,
        tier: 3,
        rateLimited: false,
        expired: false,
        error: 'escalate_from_tier_3_status_502',
      })
    ).toBe(true);
    expect(
      shouldTryBrowserJobFallback({
        ok: false,
        status: 0,
        tier: 3,
        rateLimited: false,
        expired: false,
        error: 'tier_3_status_200',
      })
    ).toBe(true);
  });

  it('does not use a browser for terminal or provider-level failures', () => {
    expect(
      shouldTryBrowserJobFallback({
        ok: false,
        status: 429,
        tier: 1,
        rateLimited: true,
        expired: false,
        error: 'rate_limited',
      })
    ).toBe(false);
    expect(
      shouldTryBrowserJobFallback({
        ok: false,
        status: 404,
        tier: 1,
        rateLimited: false,
        expired: true,
        error: 'target_404',
      })
    ).toBe(false);
    expect(
      shouldTryBrowserJobFallback({
        ok: false,
        status: 401,
        tier: 1,
        rateLimited: false,
        expired: false,
        error: 'scrape_do_unauthorized_or_no_credits',
      })
    ).toBe(false);
  });
});

describe('isBrowserFallbackHostAllowed', () => {
  it('only permits explicitly configured job-site hosts and their subdomains', () => {
    const allowed = ['careers.example.com', 'assets.examplecdn.com'];
    expect(isBrowserFallbackHostAllowed('https://careers.example.com/jobs/123', allowed)).toBe(true);
    expect(isBrowserFallbackHostAllowed('https://eu.careers.example.com/jobs/123', allowed)).toBe(true);
    expect(isBrowserFallbackHostAllowed('https://assets.examplecdn.com/app.js', allowed)).toBe(true);
    expect(isBrowserFallbackHostAllowed('https://example.com/jobs/123', allowed)).toBe(false);
    expect(isBrowserFallbackHostAllowed('https://careers.example.com.evil.test/jobs/123', allowed)).toBe(
      false
    );
    expect(isBrowserFallbackHostAllowed('https://evil.com/jobs/123', ['com'])).toBe(false);
    expect(isBrowserFallbackHostAllowed('http://localhost:8080/', ['localhost'])).toBe(false);
    expect(isBrowserFallbackHostAllowed('http://127.0.0.1/', ['127.0.0.1'])).toBe(false);
  });
});
