import { describe, expect, it, vi, beforeEach } from 'vitest';
import axios from 'axios';
import {
  parseSequoiaJobPageHtml,
  pickSequoiaJobUrl,
  mergeSequoiaDetailIntoRow,
  preferExternalApplyUrl,
} from './sequoiaDetail';
import {
  detectSequoiaLightHtmlJobPage,
  enrichSequoiaRowFromHtml,
  fetchSequoiaPostingHtml,
  isSequoiaHtmlJobPage,
} from './sequoiaHtmlLight';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

const axiosGet = axios.get as unknown as ReturnType<typeof vi.fn>;

const POSTING =
  'https://jobs.sequoiacap.com/jobs?locations=United+States&weekdayJdUid=1965883';

const SEQUOIA_HTML = `
<html><body>
  <h1>Backend Engineer</h1>
  <a href="/companies/bigpanda">BigPanda</a>
  <div>Location: Philadelphia, Pennsylvania</div>
  <script type="application/json">
  {"title":"Backend Engineer","company_name":"BigPanda","apply_url":"https://jobs.gem.com/bigpanda/am9icG9zdDqSvn091vw86rxkrJ8saZbu?utm_source=jobs.sequoiacap.com"}
  </script>
  <a href="https://jobs.gem.com/bigpanda/am9icG9zdDqSvn091vw86rxkrJ8saZbu?utm_source=jobs.sequoiacap.com">Apply</a>
  <footer>Powered by Consider</footer>
</body></html>
`;

describe('sequoiaDetail', () => {
  beforeEach(() => {
    axiosGet.mockReset();
  });

  it('picks Sequoia posting URLs from list rows', () => {
    expect(
      pickSequoiaJobUrl({
        title: 'Backend Engineer',
        url: 'https://example.com',
        jobUrl: POSTING,
      })
    ).toBe(POSTING);
  });

  it('parses external apply URL and metadata from Consider-like HTML', () => {
    const parsed = parseSequoiaJobPageHtml(SEQUOIA_HTML, POSTING);
    expect(parsed.jobTitle).toMatch(/Backend Engineer/i);
    expect(parsed.companyName).toMatch(/BigPanda/i);
    expect(parsed.applyUrl).toMatch(/^https:\/\/jobs\.gem\.com\//);
    expect(parsed.applyUrl).not.toMatch(/utm_source=/);
    expect(parsed.applyUrl).not.toMatch(/sequoiacap/);
  });

  it('merges detail without keeping Sequoia as apply URL', () => {
    const merged = mergeSequoiaDetailIntoRow(
      { company: 'Sequoia', description: 'teaser' },
      {
        jobTitle: 'Backend Engineer',
        companyName: 'BigPanda',
        applyUrl: 'https://jobs.gem.com/bigpanda/abc',
      },
      POSTING
    );
    expect(merged.companyName).toBe('BigPanda');
    expect(merged.applyUrl).toBe('https://jobs.gem.com/bigpanda/abc');
    expect(merged.aggregatorPostingUrl).toBe(POSTING);
  });

  it('preferExternalApplyUrl rejects Sequoia hosts', () => {
    expect(preferExternalApplyUrl(POSTING, 'https://boards.greenhouse.io/x/jobs/1')).toBe(
      'https://boards.greenhouse.io/x/jobs/1'
    );
    expect(preferExternalApplyUrl(POSTING)).toBe('');
  });

  it('detects Sequoia/Consider HTML with apply signals', () => {
    expect(isSequoiaHtmlJobPage(SEQUOIA_HTML)).toBe(true);
    expect(detectSequoiaLightHtmlJobPage('<html><body>hi</body></html>').light).toBe(false);
  });

  it('enriches row from HTML', () => {
    const row = enrichSequoiaRowFromHtml({}, SEQUOIA_HTML, POSTING);
    expect(row.applyUrl).toMatch(/^https:\/\/jobs\.gem\.com\//);
    expect(row._enrichMethod).toBe('http_html');
  });

  it('GETs Sequoia posting HTML and refuses employer URLs', async () => {
    axiosGet.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'text/html' },
      data: SEQUOIA_HTML,
    });
    const ok = await fetchSequoiaPostingHtml(POSTING);
    expect(ok.ok).toBe(true);
    expect(ok.light).toBe(true);

    const bad = await fetchSequoiaPostingHtml('https://jobs.gem.com/bigpanda/abc');
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/Not a (Sequoia|Consider)/i);
  });
});
