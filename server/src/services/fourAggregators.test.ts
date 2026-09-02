import { describe, expect, it, vi, beforeEach } from 'vitest';
import axios from 'axios';
import {
  parseChoppingBlockJobPageHtml,
  pickChoppingBlockJobUrl,
  mergeChoppingBlockDetailIntoRow,
  deriveChoppingBlockCompany,
  isChoppingBlockNoiseCompany,
} from './choppingblockDetail';
import {
  fetchChoppingBlockPostingHtml,
  isChoppingBlockHtmlJobPage,
} from './choppingblockHtmlLight';
import { mapAidevboardApiJob, pickAidevboardJobUrl, preferExternalApplyUrl } from './aidevboardDetail';
import { fetchAidevboardJobHtml } from './aidevboardApiLight';
import { isStartupsGalleryUrl, isAidevboardUrl } from './aggregatorIdentity';
import {
  normalizeStartupsGalleryListRow,
  parseStartupsGalleryCardLabel,
  pickAtsUrlFromRow,
  pickEmployerUrlFromRow,
  isStartupsGalleryListRowUsable,
  isStartupsGalleryEmployerJobHref,
} from './startupsGalleryDetail';

vi.mock('axios', () => {
  const interceptors = {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  };
  const instance = {
    get: vi.fn(),
    post: vi.fn(),
    interceptors,
  };
  return {
    default: {
      get: vi.fn(),
      create: vi.fn(() => instance),
      interceptors,
    },
  };
});

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

const REPLIT_POSTING =
  'https://www.choppingblock.ai/jobs/ai-agent-security-architect-at-replit';

const REPLIT_HTML = `
<html><head>
<title>AI Agent Security Architect at Replit | AI Chopping Block</title>
<meta property="og:title" content="AI Agent Security Architect at Replit | AI Chopping Block"/>
</head><body>
  <h1 class="heading-style-h4">AI Agent Security Architect</h1>
  <div class="job-header_metatag-list">
    <div class="job-header_metatag-link"><div class="text-size-regular">501-1000</div></div>
    <div class="tag is-small is-round-left"><img class="job_country_flag" alt="US.svg"/><div class="text-weight-medium">United States</div></div>
  </div>
  <a href="https://jobs.ashbyhq.com/replit/df7b6d30-9da1-4ace-8121-17c2aa55aa6f/application">Apply now</a>
  <div class="w-richtext">
    <p>Replit is the agentic software creation platform that enables anyone to build applications using natural language.</p>
    <p>We are looking for an AI Agent Security Architect to function as the primary technical authority for Replit's autonomous and AI agent security blueprint.</p>
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

  it('overwrites Top AI list noise with detail employer', () => {
    const merged = mergeChoppingBlockDetailIntoRow(
      { companyName: 'Top AI', location: 'remote' },
      {
        jobTitle: 'AI Agent Security Architect',
        companyName: 'Replit',
        jobDescription: 'Replit is the agentic software creation platform.',
        location: 'United States',
      },
      REPLIT_POSTING
    );
    expect(merged.companyName).toBe('Replit');
    expect(merged.location).toBe('United States');
  });

  it('parses Replit posting metadata from live-style HTML', () => {
    const parsed = parseChoppingBlockJobPageHtml(REPLIT_HTML, REPLIT_POSTING);
    expect(parsed.jobTitle).toMatch(/AI Agent Security Architect/i);
    expect(parsed.companyName).toBe('Replit');
    expect(parsed.location).toBe('United States');
    expect(parsed.companyEmployeeCount).toBe(751);
    expect(parsed.applyUrl).toMatch(/ashbyhq\.com\/replit/i);
  });

  it('derives company from slug when stored name is portal noise', () => {
    expect(isChoppingBlockNoiseCompany('Top AI')).toBe(true);
    expect(
      deriveChoppingBlockCompany(
        REPLIT_POSTING,
        'Replit is the agentic software creation platform.',
        'Top AI'
      )
    ).toBe('Replit');
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

  it('parses card label into title, location, and date', () => {
    const parsed = parseStartupsGalleryCardLabel(
      'Senior Software Engineer — Infra Agent Systems UK Together AI · London · Posted on Sep 1, 2026'
    );
    expect(parsed.location).toBe('London');
    expect(parsed.date).toBe('Sep 1, 2026');
    expect(parsed.jobTitle).toMatch(/Together AI/i);
  });

  it('normalizes gallery list rows to ATS URLs and splits title/company', () => {
    const card =
      'AI Agent Security Architect Replit · Foster City, CA · Posted on Sep 1, 2026';
    const normalized = normalizeStartupsGalleryListRow({
      url: 'https://startups.gallery/jobs',
      jobTitle: card,
      title: card,
    });
    expect(pickAtsUrlFromRow(normalized)).toBe('');

    const withAts = normalizeStartupsGalleryListRow({
      url: 'https://jobs.ashbyhq.com/replit/df7b6d30-9da1-4ace-8121-17c2aa55aa6f',
      jobTitle: card,
    });
    expect(withAts.jobUrl).toMatch(/jobs\.ashbyhq\.com\/replit/i);
    expect(String(withAts.jobTitle)).toMatch(/AI Agent Security Architect/i);
    expect(String(withAts.companyName)).toMatch(/Replit/i);
    expect(withAts.location).toBe('Foster City, CA');
    expect(isStartupsGalleryListRowUsable(withAts)).toBe(true);
  });

  it('accepts non-ATS employer careers URLs for Phenom / scrape.do enrichment', () => {
    const card = 'Software Engineer Acme · Remote · Posted on Sep 1, 2026';
    const careersUrl = 'https://careers.acme.example/jobs/software-engineer';
    expect(isStartupsGalleryEmployerJobHref(careersUrl)).toBe(true);
    expect(isStartupsGalleryEmployerJobHref('https://startups.gallery/jobs')).toBe(false);
    expect(isStartupsGalleryEmployerJobHref('https://tally.so/r/VLlEz6')).toBe(false);

    const withCareers = normalizeStartupsGalleryListRow({
      jobUrl: careersUrl,
      jobTitle: card,
    });
    expect(pickEmployerUrlFromRow(withCareers)).toBe(careersUrl);
    expect(withCareers.jobUrl).toBe(careersUrl);
    expect(isStartupsGalleryListRowUsable(withCareers)).toBe(true);
  });

  it('harvests employer ATS anchors from Framer SSR HTML without Playwright', async () => {
    const {
      harvestStartupsGalleryJobsFromHtml,
      normalizeStartupsGalleryListUrl,
    } = await import('./startupsGalleryListScrape');
    expect(normalizeStartupsGalleryListUrl('https://startups.gallery/jobs?position=software+')).toBe(
      'https://startups.gallery/jobs?position=software'
    );
    const html = `
      <a class="framer-zpdfqp" href="https://jobs.ashbyhq.com/replit/df7b6d30-9da1-4ace-8121-17c2aa55aa6f" target="_blank">
        <p>AI Agent Security Architect Replit · Foster City, CA · Posted on Sep 1, 2026</p>
      </a>
      <a href="https://startups.gallery/jobs">ignore me</a>
    `;
    const rows = harvestStartupsGalleryJobsFromHtml(html, 10, { positionTokens: ['security'] });
    expect(rows.length).toBe(1);
    expect(String(rows[0].jobUrl)).toMatch(/ashbyhq\.com\/replit/i);
  });
});
