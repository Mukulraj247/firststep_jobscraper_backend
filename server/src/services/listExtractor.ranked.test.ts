import { describe, it, expect, vi } from 'vitest';
import {
  applySelectorPromotions,
  computeSelectorPromotions,
  listNavigationAttempts,
  mapJsonLdRowsToConfiguredFields,
  normalizeFieldSelectorList,
  normalizeListStartUrl,
  primaryItemSelector,
  tryJsonLdJobPostingListFallback,
  waitForAsyncListHydration,
} from './listExtractor';

describe('normalizeFieldSelectorList', () => {
  it('accepts a single string', () => {
    expect(normalizeFieldSelectorList('a.job-title')).toEqual(['a.job-title']);
  });

  it('dedupes ranked arrays and drops empties', () => {
    expect(normalizeFieldSelectorList(['a.title', '', 'a.title', 'h2'])).toEqual(['a.title', 'h2']);
  });
});

describe('primaryItemSelector', () => {
  it('returns the first ranked item selector', () => {
    expect(primaryItemSelector(['ul.jobs li', 'li.job'])).toBe('ul.jobs li');
    expect(primaryItemSelector('li.card')).toBe('li.card');
  });
});

describe('computeSelectorPromotions', () => {
  it('promotes a fallback that wins ≥50% of non-empty extractions', () => {
    const promotions = computeSelectorPromotions(
      { title: ['a.broken', 'h2.title', 'span.name'] },
      { title: [1, 8, 1] }
    );
    expect(promotions).toHaveLength(1);
    expect(promotions[0].field).toBe('title');
    expect(promotions[0].from).toBe('a.broken');
    expect(promotions[0].to).toBe('h2.title');
    expect(promotions[0].winRatio).toBeCloseTo(0.8);
  });

  it('does not promote when primary still wins', () => {
    const promotions = computeSelectorPromotions(
      { title: ['h2.title', 'a.fallback'] },
      { title: [7, 3] }
    );
    expect(promotions).toHaveLength(0);
  });
});

describe('applySelectorPromotions', () => {
  it('moves the winning selector to index 0', () => {
    const next = applySelectorPromotions(
      { title: ['a.broken', 'h2.title'] },
      [{ field: 'title', from: 'a.broken', to: 'h2.title', winRatio: 0.9 }]
    );
    expect(next.title).toEqual(['h2.title', 'a.broken']);
  });
});

describe('normalizeListStartUrl', () => {
  it('resets pg=2 to pg=1 for Findly-style URLs', () => {
    const out = normalizeListStartUrl(
      'https://careers.dxc.com/job-search-results/?compliment[]=United%20States&category[]=Software%20Engineering&pg=2'
    );
    expect(out).toContain('pg=1');
    expect(out).not.toMatch(/pg=2(?:&|$)/);
  });

  it('resets startrow even when pageParam is a different key', () => {
    const out = normalizeListStartUrl(
      'https://careers.ey.com/search-3?optionsFacetsDD_country=US&optionsFacetsDD_customfield1=Assurance&startrow=50',
      { mode: 'page-number-loop', pageParam: 'page', startPage: 1 }
    );
    expect(out).toContain('startrow=0');
    expect(out).not.toMatch(/startrow=50/);
    expect(out).toContain('optionsFacetsDD_customfield1=Assurance');
  });

  it('honors pagination.startPage and pageParam', () => {
    expect(
      normalizeListStartUrl('https://example.com/jobs?page=5', {
        mode: 'page-number-loop',
        pageParam: 'page',
        startPage: 1,
      })
    ).toContain('page=1');
  });

  it('resets preferred offset pageParam to 0', () => {
    expect(
      normalizeListStartUrl('https://example.com/jobs?startrow=75', {
        mode: 'page-number-loop',
        pageParam: 'startrow',
        startPage: 1,
      })
    ).toContain('startrow=0');
  });

  it('leaves URLs without a page param unchanged', () => {
    const url = 'https://example.com/jobs?q=engineer';
    expect(normalizeListStartUrl(url)).toBe(url);
  });
});

describe('waitForAsyncListHydration', () => {
  it('returns true when item selector attaches', async () => {
    const page = {
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn(),
      waitForTimeout: vi.fn(),
    } as any;
    await expect(waitForAsyncListHydration(page, 'div.job', 2000)).resolves.toBe(true);
    expect(page.waitForSelector).toHaveBeenCalled();
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('falls back to live-results heuristic when selector times out', async () => {
    const page = {
      waitForSelector: vi.fn().mockRejectedValue(new Error('timeout')),
      evaluate: vi.fn().mockResolvedValue(true),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    } as any;
    await expect(waitForAsyncListHydration(page, 'div.missing', 1500)).resolves.toBe(true);
    expect(page.evaluate).toHaveBeenCalled();
  });
});

describe('listNavigationAttempts', () => {
  it('keeps retrying a slow navigation within the scraper job budget', () => {
    expect(listNavigationAttempts('https://example.com/jobs')).toEqual([
      { waitUntil: 'domcontentloaded', timeout: 45_000 },
      { waitUntil: 'commit', timeout: 20_000 },
    ]);
  });

  it('gives Persistent its known HTTP/2-impaired navigation budget', () => {
    expect(listNavigationAttempts('https://careers.persistent.com/explore-opportunities')).toEqual([
      { waitUntil: 'domcontentloaded', timeout: 75_000 },
      { waitUntil: 'commit', timeout: 20_000 },
    ]);
  });
});

describe('mapJsonLdRowsToConfiguredFields', () => {
  it('maps schema rows onto configured field names', () => {
    const mapped = mapJsonLdRowsToConfiguredFields(
      [
        {
          title: 'Engineer',
          company: 'Acme',
          url: 'https://jobs.acme.com/1',
          location: 'Remote',
        },
      ],
      ['Job Title', 'company', 'url']
    );
    expect(mapped).toEqual([
      {
        'Job Title': 'Engineer',
        company: 'Acme',
        url: 'https://jobs.acme.com/1',
      },
    ]);
  });
});

describe('tryJsonLdJobPostingListFallback', () => {
  it('returns rows from JobPosting JSON-LD when DOM would yield nothing', async () => {
    const html = `<!DOCTYPE html><html><head>
<script type="application/ld+json">
{"@type":"JobPosting","title":"Backend Engineer","hiringOrganization":{"name":"Widget Co"},"url":"https://widget.example/jobs/be","jobLocation":{"address":{"addressLocality":"Austin","addressRegion":"TX","addressCountry":"US"}}}
</script>
</head><body><div class="login-wall">Sign in</div></body></html>`;
    const page = {
      content: async () => html,
      url: () => 'https://www.linkedin.com/jobs/view/123',
    };
    const rows = await tryJsonLdJobPostingListFallback(page, ['title', 'company', 'url', 'location']);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Backend Engineer');
    expect(rows[0].company).toBe('Widget Co');
    expect(rows[0].url).toContain('/jobs/be');
    expect(rows[0].location).toContain('Austin');
  });
});
