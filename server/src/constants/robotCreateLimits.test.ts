import { describe, expect, it } from 'vitest';
import {
  MAX_CRAWL_PAGES,
  MAX_SEARCH_RESULTS,
  DEFAULT_CRAWL_PAGES,
  DEFAULT_SEARCH_RESULTS,
  clampCrawlLimit,
  clampSearchLimit,
  formatsIncludeScreenshot,
  assertCrawlFormatsAllowed,
} from './robotCreateLimits';

describe('robotCreateLimits', () => {
  it('exposes production caps', () => {
    expect(MAX_CRAWL_PAGES).toBe(200);
    expect(MAX_SEARCH_RESULTS).toBe(50);
    expect(DEFAULT_CRAWL_PAGES).toBe(50);
    expect(DEFAULT_SEARCH_RESULTS).toBe(10);
  });

  it('clamps crawl and search limits', () => {
    expect(clampCrawlLimit(undefined)).toBe(DEFAULT_CRAWL_PAGES);
    expect(clampCrawlLimit(0)).toBe(1);
    expect(clampCrawlLimit(9999)).toBe(MAX_CRAWL_PAGES);
    expect(clampSearchLimit(1000)).toBe(MAX_SEARCH_RESULTS);
  });

  it('rejects screenshot formats when crawl limit is high', () => {
    expect(formatsIncludeScreenshot(['markdown', 'screenshot-fullpage'])).toBe(true);
    expect(() => assertCrawlFormatsAllowed(['screenshot-visible'], 80)).toThrow(/screenshot/i);
    expect(() => assertCrawlFormatsAllowed(['markdown'], 80)).not.toThrow();
    expect(() => assertCrawlFormatsAllowed(['screenshot-visible'], 20)).not.toThrow();
  });
});
