import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fetchHiringCafePostingViaScrapeDo } from './hiringCafeScrapeDo';

vi.mock('./scrapeDoClient', () => ({
  scrapeUrlHtml: vi.fn(),
}));

import { scrapeUrlHtml } from './scrapeDoClient';

const scrapeUrlHtmlMock = scrapeUrlHtml as unknown as ReturnType<typeof vi.fn>;

const POSTING =
  'https://hiringcafe.com/job/software-engineer-test-seattle-washington-abc123';

const NEXT_DATA_HTML = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: {
    pageProps: {
      job: {
        apply_url: 'https://example.com/apply',
        job_information: { title: 'Engineer', description: '<p>'.repeat(50) },
        v5_processed_job_data: { core_job_title: 'Engineer' },
      },
    },
  },
})}</script></html>`;

describe('hiringCafeScrapeDo', () => {
  beforeEach(() => {
    scrapeUrlHtmlMock.mockReset();
  });

  it('rejects non-HC URLs', async () => {
    const result = await fetchHiringCafePostingViaScrapeDo('https://example.com/job/1', {
      enabled: true,
      token: 't',
      maxTier: 2,
    });
    expect(result.ok).toBe(false);
    expect(scrapeUrlHtmlMock).not.toHaveBeenCalled();
  });

  it('returns parsed HC html on Scrape.do success and always starts at tier 1', async () => {
    scrapeUrlHtmlMock.mockResolvedValue({
      ok: true,
      status: 200,
      html: NEXT_DATA_HTML,
      tier: 1,
      creditsSpent: 1,
      expired: false,
      rateLimited: false,
    });

    const result = await fetchHiringCafePostingViaScrapeDo(POSTING, {
      enabled: true,
      token: 't',
      maxTier: 2,
    });

    expect(result.ok).toBe(true);
    expect(result.method).toBe('scrape.do');
    expect(result.creditsSpent).toBe(1);
    expect(scrapeUrlHtmlMock).toHaveBeenCalledWith(
      POSTING,
      expect.objectContaining({ token: 't', startTier: 1, maxTier: 2, useLearnedTier: false })
    );
  });

  it('caps maxTier at 2 even if caller asks for 3', async () => {
    scrapeUrlHtmlMock.mockResolvedValue({
      ok: true,
      status: 200,
      html: NEXT_DATA_HTML,
      tier: 1,
      creditsSpent: 1,
      expired: false,
      rateLimited: false,
    });

    await fetchHiringCafePostingViaScrapeDo(POSTING, {
      enabled: true,
      token: 't',
      maxTier: 3 as any,
    });

    expect(scrapeUrlHtmlMock).toHaveBeenCalledWith(
      POSTING,
      expect.objectContaining({ startTier: 1, maxTier: 2 })
    );
  });

  it('respects maxTier 1 (tier 1 only, no tier 2)', async () => {
    scrapeUrlHtmlMock.mockResolvedValue({
      ok: true,
      status: 200,
      html: NEXT_DATA_HTML,
      tier: 1,
      creditsSpent: 1,
      expired: false,
      rateLimited: false,
    });

    await fetchHiringCafePostingViaScrapeDo(POSTING, {
      enabled: true,
      token: 't',
      maxTier: 1,
    });

    expect(scrapeUrlHtmlMock).toHaveBeenCalledWith(
      POSTING,
      expect.objectContaining({ startTier: 1, maxTier: 1 })
    );
  });
});
