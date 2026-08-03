export const MAX_CRAWL_PAGES = 200;
export const MAX_SEARCH_RESULTS = 50;
export const DEFAULT_CRAWL_PAGES = 50;
export const DEFAULT_SEARCH_RESULTS = 10;
/** Screenshots disallowed on crawl when page limit exceeds this. */
export const MAX_CRAWL_PAGES_WITH_SCREENSHOT = 25;

export function clampCrawlLimit(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return DEFAULT_CRAWL_PAGES;
  return Math.min(MAX_CRAWL_PAGES, Math.max(1, Math.floor(n)));
}

export function clampSearchLimit(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return DEFAULT_SEARCH_RESULTS;
  return Math.min(MAX_SEARCH_RESULTS, Math.max(1, Math.floor(n)));
}

export function formatsIncludeScreenshot(formats: string[] | undefined): boolean {
  return (formats ?? []).some((f) => String(f).startsWith('screenshot'));
}

export function assertCrawlFormatsAllowed(formats: string[] | undefined, limit: number): void {
  if (formatsIncludeScreenshot(formats) && limit > MAX_CRAWL_PAGES_WITH_SCREENSHOT) {
    throw new Error(
      `Screenshot formats require crawl limit ≤ ${MAX_CRAWL_PAGES_WITH_SCREENSHOT} (got ${limit}).`
    );
  }
}
