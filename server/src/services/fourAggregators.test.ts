import { describe, expect, it, vi, beforeEach } from 'vitest';
import axios from 'axios';
import {
  parseChoppingBlockJobPageHtml,
  pickChoppingBlockJobUrl,
  mergeChoppingBlockDetailIntoRow,
} from './choppingblockDetail';
import {
  fetchChoppingBlockPostingHtml,
  isChoppingBlockHtmlJobPage,
} from './choppingblockHtmlLight';
import { mapAidevboardApiJob, pickAidevboardJobUrl, preferExternalApplyUrl } from './aidevboardDetail';
import { fetchAidevboardJobHtml } from './aidevboardApiLight';
import { isStartupsGalleryUrl, isAidevboardUrl } from './aggregatorIdentity';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    create: vi.fn(() => ({ get: vi.fn(), post: vi.fn() })),
  },
}));

const axiosGet = axios.get as unknown as ReturnType<typeof vi.fn>;

const CB_POSTING =
  'https://www.choppingblock.ai/jobs/machine-learning-engineer-multimodal-perception-and-authentication-at-openai';

const CB_HTML = `
<html><body>
  <h1>Machine Learning Engineer, Multimodal Perception and Authentication</h1>
  <h2>Job Description</h2>
  <div class="w-richtext">
    <p>We're looking for a machine learning engineer to help shape how future AI systems understand the physical world and the people in it. The role focuses on multimodal perception and authentication, bringing together signals from cameras, microphones, and other sensors.</p>
    <p>You'll work with specialized perception models and larger multimodal models, and partner with hardware, firmware, software, and product teams to bring new research into real-world systems.</p>
    <ul><li>Research and develop multimodal perception methods.</li><li>Design data, training, and evaluation approaches.</li></ul>
  </div>
</body></html>
`;

describe('choppingblock detail', () => {
  beforeEach(() => axiosGet.mockReset());

  it('parses Webflow-style JD HTML', () => {
    const parsed = parseChoppingBlockJobPageHtml(CB_HTML, CB_POSTING);
    expect(parsed.jobTitle).toMatch(/Machine Learning Engineer/i);
    expect(parsed.companyName).toMatch(/Openai/i);
    expect((parsed.jobDescription || '').length).toBeGreaterThan(200);
  });

  it('picks choppingblock posting URLs', () => {
    expect(pickChoppingBlockJobUrl({ url: CB_POSTING, title: 'x' })).toBe(CB_POSTING);
  });

  it('merges without treating choppingblock as apply', () => {
    const merged = mergeChoppingBlockDetailIntoRow(
      { company: 'Chopping Block' },
      { jobTitle: 'ML Eng', companyName: 'OpenAI', jobDescription: 'x'.repeat(500) },
      CB_POSTING
    );
    expect(merged.companyName).toBe('OpenAI');
    expect(merged.applyUrl).toBeUndefined();
  });

  it('refuses non-choppingblock light fetch', async () => {
    const bad = await fetchChoppingBlockPostingHtml('https://jobs.ashbyhq.com/x');
    expect(bad.ok).toBe(false);
    expect(isChoppingBlockHtmlJobPage(CB_HTML)).toBe(true);
  });
});

describe('aidevboard detail', () => {
  beforeEach(() => axiosGet.mockReset());

  it('maps API job payload to Scout-X fields', () => {
    const fields = mapAidevboardApiJob({
      id: '74bd7349-e7f3-4d98-a3f0-ba2a67cb91ec',
      title: 'Director, Finance Systems',
      company_name: 'Anthropic',
      description: 'About Anthropic\n'.repeat(40),
      location: 'San Francisco, CA',
      salary_min: 270000,
      salary_max: 315000,
      workplace: 'hybrid',
      apply_url: 'https://job-boards.greenhouse.io/anthropic/jobs/5409055008',
      url: 'https://aidevboard.com/job/74bd7349-e7f3-4d98-a3f0-ba2a67cb91ec',
    });
    expect(fields.jobTitle).toMatch(/Director/i);
    expect(fields.companyName).toBe('Anthropic');
    expect((fields.jobDescription || '').length).toBeGreaterThan(100);
    expect(fields.applyUrl).toMatch(/greenhouse/i);
  });

  it('picks /job/{uuid} URLs and refuses employer URLs for light HTML', async () => {
    expect(
      pickAidevboardJobUrl({
        url: 'https://aidevboard.com/job/74bd7349-e7f3-4d98-a3f0-ba2a67cb91ec',
      })
    ).toContain('/job/');
    const bad = await fetchAidevboardJobHtml('https://job-boards.greenhouse.io/anthropic/jobs/1');
    expect(bad.ok).toBe(false);
    expect(
      preferExternalApplyUrl(
        'https://aidevboard.com/job/x',
        'https://boards.greenhouse.io/a/jobs/1'
      )
    ).toMatch(/greenhouse/i);
    expect(isAidevboardUrl('https://aidevboard.com/job/x')).toBe(true);
  });
});

describe('startups.gallery list_ats', () => {
  it('recognizes gallery host (list rows should key on employer ATS URLs)', () => {
    expect(isStartupsGalleryUrl('https://startups.gallery/jobs')).toBe(true);
    expect(isStartupsGalleryUrl('https://boards.greenhouse.io/vast/jobs/1')).toBe(false);
  });
});
