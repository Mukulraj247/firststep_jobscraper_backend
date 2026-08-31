import { describe, expect, it, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { parseAccelJobPageHtml, pickAccelJobUrl, mergeAccelDetailIntoRow } from './accelDetail';
import {
  detectAccelLightHtmlJobPage,
  enrichAccelRowFromHtml,
  fetchAccelPostingHtml,
  isAccelHtmlJobPage,
} from './accelHtmlLight';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

const axiosGet = axios.get as unknown as ReturnType<typeof vi.fn>;

const POSTING =
  'https://jobs.accel.com/companies/sapiom-2/jobs/91689603-software-engineer-agent-infrastructure';

const SAPIOM_HTML = `
<html><body>
  <h1>Software Engineer, Agent Infrastructure</h1>
  <a href="/companies/sapiom-2">Sapiom</a>
  <div>Software Engineering, Other Engineering</div>
  <div>San Francisco, CA, USA</div>
  <div>Posted on Aug 31, 2026</div>
  <a href="https://jobs.ashbyhq.com/sapiom/apply">Apply now</a>
  <div id="content">
    <strong>About Sapiom</strong>
    <p>Sapiom is the end-to-end platform that removes barriers to ship and scale agentic products. We unify compute and sandboxes, memory, identity, spend controls, storage and queues, monitoring.</p>
    <h2>About the role</h2>
    <p>Agents can think now. They still can't act — not economically, not reliably. Closing that gap is the whole company. We're a flat org hiring at two levels: engineers one to three years in, and Staff.</p>
    <h2>What we're working on</h2>
    <ul>
      <li>Routing and capacity for model calls.</li>
      <li>Metering and billing correctness.</li>
      <li>Reliability at sustained scale.</li>
    </ul>
    <h2>You may be a fit if</h2>
    <ul>
      <li>You have strong engineering fundamentals and write good code quickly.</li>
      <li>You've shipped something that ran in production.</li>
    </ul>
    <h2>Applying</h2>
    <p>A recruiter screen, then a technical screen. If those go well, a three-part loop.</p>
  </div>
  <footer>Powered by Getro</footer>
</body></html>
`;

describe('accelDetail', () => {
  it('picks Accel posting URLs from list rows', () => {
    expect(
      pickAccelJobUrl({
        title: 'SE',
        link: POSTING + '#content',
        company: 'Sapiom',
      })
    ).toBe(POSTING);
  });

  it('parses Sapiom-like Getro HTML into rich fields', () => {
    const parsed = parseAccelJobPageHtml(SAPIOM_HTML, POSTING);
    expect(parsed.jobTitle).toMatch(/Software Engineer/i);
    expect(parsed.companyName).toMatch(/Sapiom/i);
    expect((parsed.jobDescription || '').length).toBeGreaterThan(200);
    expect(parsed.jobDescription).toMatch(/About the role/i);
    expect(parsed.jobDescription).toMatch(/You may be a fit/i);
    expect(parsed.applyUrl).toContain('ashbyhq.com');
    expect(parsed.about || parsed.jobDescription).toMatch(/end-to-end platform/i);
  });

  it('merges detail without keeping Accel as apply URL', () => {
    const merged = mergeAccelDetailIntoRow(
      { company: 'Accel', description: 'teaser' },
      {
        jobTitle: 'Software Engineer, Agent Infrastructure',
        companyName: 'Sapiom',
        jobDescription: 'x'.repeat(500),
        applyUrl: 'https://jobs.ashbyhq.com/sapiom/apply',
        location: 'San Francisco, CA, USA',
      },
      POSTING
    );
    expect(merged.jobUrl).toBe(POSTING);
    expect(merged.companyName).toBe('Sapiom');
    expect(merged.applyUrl).toContain('ashbyhq.com');
    expect(merged.aggregatorPostingUrl).toBe(POSTING);
  });
});

describe('accelHtmlLight', () => {
  beforeEach(() => {
    axiosGet.mockReset();
  });

  it('detects Accel/Getro HTML job pages', () => {
    expect(isAccelHtmlJobPage(SAPIOM_HTML)).toBe(true);
    expect(detectAccelLightHtmlJobPage('<html><body>hi</body></html>').light).toBe(false);
  });

  it('enriches a list row from HTML without a browser', () => {
    const row = enrichAccelRowFromHtml({}, SAPIOM_HTML, POSTING);
    expect(row.jobTitle).toMatch(/Software Engineer/i);
    expect(String(row.jobDescription).length).toBeGreaterThan(200);
    expect(row.aggregatorPostingUrl).toBe(POSTING);
  });

  it('GETs Accel posting HTML and refuses employer URLs', async () => {
    axiosGet.mockResolvedValueOnce({
      status: 200,
      data: SAPIOM_HTML,
      headers: { 'content-type': 'text/html' },
    });
    const ok = await fetchAccelPostingHtml(POSTING);
    expect(ok.ok).toBe(true);
    expect(ok.light).toBe(true);

    const bad = await fetchAccelPostingHtml('https://jobs.ashbyhq.com/sapiom/apply');
    expect(bad.ok).toBe(false);
    expect(axiosGet).toHaveBeenCalledTimes(1);
  });
});
