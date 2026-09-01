/**
 * Aggregator robots (Hiring Cafe, LinkedIn, Accel/Getro, Consider, etc.)
 * vs company career scrapers.
 * Stored on saasConfig so Automations can exclude them and Aggregators can list them.
 */

export const AGGREGATOR_PROVIDER_HIRING_CAFE = 'hiring_cafe';
export const AGGREGATOR_PROVIDER_LINKEDIN = 'linkedin';
export const AGGREGATOR_PROVIDER_ACCEL = 'accel';
export const AGGREGATOR_PROVIDER_SEQUOIA = 'sequoia';
export const AGGREGATOR_PROVIDER_CAPITALG = 'capitalg';
export const AGGREGATOR_PROVIDER_CHOPPINGBLOCK = 'choppingblock';
export const AGGREGATOR_PROVIDER_AIDEVBOARD = 'aidevboard';
export const AGGREGATOR_PROVIDER_STARTUPS_GALLERY = 'startups_gallery';

export const AGGREGATOR_SOURCE_HIRING_CAFE = 'hiring_cafe';
export const AGGREGATOR_SOURCE_LINKEDIN = 'linkedin';
export const AGGREGATOR_SOURCE_ACCEL = 'accel';
export const AGGREGATOR_SOURCE_SEQUOIA = 'sequoia';
export const AGGREGATOR_SOURCE_CAPITALG = 'capitalg';
export const AGGREGATOR_SOURCE_CHOPPINGBLOCK = 'choppingblock';
export const AGGREGATOR_SOURCE_AIDEVBOARD = 'aidevboard';
export const AGGREGATOR_SOURCE_STARTUPS_GALLERY = 'startups_gallery';

const ACCEL_JOB_POSTING_PATH = /\/companies\/[^/]+\/jobs\/[^/?#]+/i;

const CONSIDER_BOARD_HOSTS = new Set(['jobs.sequoiacap.com', 'careers.capitalg.com']);

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function isHiringCafeUrl(url: string): boolean {
  const host = hostnameOf(url);
  return host === 'hiring.cafe' || host === 'hiringcafe.com' || host.endsWith('.hiring.cafe');
}

/** Accel Getro job board host (jobs.accel.com). */
export function isAccelUrl(url: string): boolean {
  const host = hostnameOf(url);
  return host === 'jobs.accel.com' || host.endsWith('.jobs.accel.com');
}

/** Accel / Getro job detail: /companies/{slug}/jobs/{id-slug}. */
export function isAccelJobPostingUrl(url: string): boolean {
  if (!isAccelUrl(url)) return false;
  try {
    return ACCEL_JOB_POSTING_PATH.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** Consider-powered board hosts (Sequoia, CapitalG, …). */
export function isConsiderBoardUrl(url: string): boolean {
  const host = hostnameOf(url);
  if (!host) return false;
  if (CONSIDER_BOARD_HOSTS.has(host)) return true;
  for (const allowed of CONSIDER_BOARD_HOSTS) {
    if (host.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

/**
 * Consider job identity URL: /jobs path with weekdayJdUid (or similar)
 * or /jobs/{id} — not bare filtered list pages.
 */
export function isConsiderJobPostingUrl(url: string): boolean {
  if (!isConsiderBoardUrl(url)) return false;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, '') || '/';
    if (!path.includes('/jobs')) return false;
    const jdUid =
      parsed.searchParams.get('weekdayJdUid') ||
      parsed.searchParams.get('jdUid') ||
      parsed.searchParams.get('jobId') ||
      parsed.searchParams.get('job_id');
    if (jdUid && String(jdUid).trim()) return true;
    const parts = path.split('/').filter(Boolean);
    const jobsIdx = parts.indexOf('jobs');
    if (jobsIdx >= 0 && parts[jobsIdx + 1] && parts[jobsIdx + 1] !== 'companies') {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Sequoia Consider job board host (jobs.sequoiacap.com). */
export function isSequoiaUrl(url: string): boolean {
  const host = hostnameOf(url);
  return host === 'jobs.sequoiacap.com' || host.endsWith('.jobs.sequoiacap.com');
}

export function isSequoiaJobPostingUrl(url: string): boolean {
  return isSequoiaUrl(url) && isConsiderJobPostingUrl(url);
}

/** CapitalG Consider job board host (careers.capitalg.com). */
export function isCapitalGUrl(url: string): boolean {
  const host = hostnameOf(url);
  return host === 'careers.capitalg.com' || host.endsWith('.careers.capitalg.com');
}

export function isCapitalGJobPostingUrl(url: string): boolean {
  return isCapitalGUrl(url) && isConsiderJobPostingUrl(url);
}

/** Chopping Block AI jobs (Webflow). */
export function isChoppingBlockUrl(url: string): boolean {
  const host = hostnameOf(url);
  return host === 'choppingblock.ai' || host.endsWith('.choppingblock.ai');
}

/** Detail: /jobs/{slug-at-company} — not bare /jobs index. */
export function isChoppingBlockJobPostingUrl(url: string): boolean {
  if (!isChoppingBlockUrl(url)) return false;
  try {
    const path = new URL(url).pathname.toLowerCase().replace(/\/+$/, '') || '/';
    const parts = path.split('/').filter(Boolean);
    const jobsIdx = parts.indexOf('jobs');
    return jobsIdx >= 0 && Boolean(parts[jobsIdx + 1]);
  } catch {
    return false;
  }
}

/** AI Dev Board. */
export function isAidevboardUrl(url: string): boolean {
  const host = hostnameOf(url);
  return host === 'aidevboard.com' || host.endsWith('.aidevboard.com');
}

/** Detail: /job/{slug-or-uuid} (not homepage, /jobs list, or /apply). */
export function isAidevboardJobPostingUrl(url: string): boolean {
  if (!isAidevboardUrl(url)) return false;
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '') || '/';
    if (!/^\/job\/[^/?#]+/i.test(path)) return false;
    const slug = path.replace(/^\/job\//i, '');
    if (!slug || slug === 'jobs') return false;
    return true;
  } catch {
    return false;
  }
}

/** startups.gallery aggregator. */
export function isStartupsGalleryUrl(url: string): boolean {
  const host = hostnameOf(url);
  return host === 'startups.gallery' || host.endsWith('.startups.gallery');
}

/** True when hostname is an aggregator board — never use as direct Apply target. */
export function isAggregatorApplyHost(hostname: string): boolean {
  const host = String(hostname || '')
    .toLowerCase()
    .replace(/^www\./, '');
  if (!host) return false;
  return (
    host === 'hiring.cafe' ||
    host === 'hiringcafe.com' ||
    host.endsWith('.hiring.cafe') ||
    host === 'jobs.accel.com' ||
    host.endsWith('.jobs.accel.com') ||
    host === 'jobs.sequoiacap.com' ||
    host.endsWith('.jobs.sequoiacap.com') ||
    host === 'careers.capitalg.com' ||
    host.endsWith('.careers.capitalg.com') ||
    host === 'choppingblock.ai' ||
    host.endsWith('.choppingblock.ai') ||
    host === 'aidevboard.com' ||
    host.endsWith('.aidevboard.com') ||
    host === 'startups.gallery' ||
    host.endsWith('.startups.gallery')
  );
}

/** True when URL is on any known aggregator host (list or detail). */
export function isAggregatorHostUrl(url: string): boolean {
  return (
    isHiringCafeUrl(url) ||
    isAccelUrl(url) ||
    isConsiderBoardUrl(url) ||
    isChoppingBlockUrl(url) ||
    isAidevboardUrl(url) ||
    isStartupsGalleryUrl(url)
  );
}

/** True when URL is a job posting on an aggregator (not a bare list/search page). */
export function isAggregatorJobPostingUrl(url: string): boolean {
  if (!url) return false;
  if (isHiringCafeUrl(url)) {
    try {
      return /\/job\/[^/?#]+/i.test(new URL(url).pathname);
    } catch {
      return false;
    }
  }
  return (
    isAccelJobPostingUrl(url) ||
    isConsiderJobPostingUrl(url) ||
    isChoppingBlockJobPostingUrl(url) ||
    isAidevboardJobPostingUrl(url)
  );
}

/** LinkedIn jobs search / collection URLs (not preload or auth walls). */
export function isLinkedInJobsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return false;
    const path = parsed.pathname.toLowerCase();
    if (path.includes('/preload')) return false;
    if (path.includes('/authwall')) return false;
    return path.includes('/jobs');
  } catch {
    return false;
  }
}

export function isLinkedInHostUrl(url: string): boolean {
  const host = hostnameOf(url);
  return host === 'linkedin.com' || host.endsWith('.linkedin.com');
}

/** Derive aggregator provider from a start/list URL, or null when not an aggregator. */
export function aggregatorProviderForUrl(url: string | undefined): string | null {
  if (!url) return null;
  if (isHiringCafeUrl(url)) return AGGREGATOR_PROVIDER_HIRING_CAFE;
  if (isAccelUrl(url)) return AGGREGATOR_PROVIDER_ACCEL;
  if (isSequoiaUrl(url)) return AGGREGATOR_PROVIDER_SEQUOIA;
  if (isCapitalGUrl(url)) return AGGREGATOR_PROVIDER_CAPITALG;
  if (isChoppingBlockUrl(url)) return AGGREGATOR_PROVIDER_CHOPPINGBLOCK;
  if (isAidevboardUrl(url)) return AGGREGATOR_PROVIDER_AIDEVBOARD;
  if (isStartupsGalleryUrl(url)) return AGGREGATOR_PROVIDER_STARTUPS_GALLERY;
  if (isLinkedInJobsUrl(url)) return AGGREGATOR_PROVIDER_LINKEDIN;
  return null;
}

function stampAggregator(
  saas: Record<string, unknown>,
  provider: string,
  flags: Record<string, unknown>
): void {
  saas.aggregatorProvider = provider;
  Object.assign(saas, flags);
  if (saas.preferAtsCollection === undefined) {
    saas.preferAtsCollection = false;
  }
}

function clearEnrichFlags(saas: Record<string, unknown>): void {
  saas.enrichHiringCafeDetails = false;
  saas.enrichAccelDetails = false;
  saas.enrichSequoiaDetails = false;
  saas.enrichCapitalGDetails = false;
  saas.enrichChoppingBlockDetails = false;
  saas.enrichAidevboardDetails = false;
}

/** Stamp aggregator provider from start URL when client omitted aggregatorProvider. */
export function applyAggregatorProviderFromUrl(
  startUrl: string | undefined,
  saas: Record<string, unknown>
): void {
  const derived = aggregatorProviderForUrl(startUrl);
  const existing = String(saas.aggregatorProvider || '').trim().toLowerCase();

  if (existing && existing !== 'aggregator') {
    if (!derived) return;
    if (existing === derived) return;
    if (!KNOWN_PROVIDERS.has(existing)) return;
    // URL host disagrees with stored provider — re-stamp from URL.
    delete saas.aggregatorProvider;
    clearEnrichFlags(saas);
  } else if (existing) {
    return;
  }

  if (startUrl && isHiringCafeUrl(startUrl)) {
    stampAggregator(saas, AGGREGATOR_PROVIDER_HIRING_CAFE, { enrichHiringCafeDetails: true });
    return;
  }
  if (startUrl && isAccelUrl(startUrl)) {
    stampAggregator(saas, AGGREGATOR_PROVIDER_ACCEL, {
      enrichAccelDetails: true,
      enrichHiringCafeDetails: false,
      enrichSequoiaDetails: false,
    });
    return;
  }
  if (startUrl && isSequoiaUrl(startUrl)) {
    stampAggregator(saas, AGGREGATOR_PROVIDER_SEQUOIA, {
      enrichSequoiaDetails: true,
      enrichHiringCafeDetails: false,
      enrichAccelDetails: false,
    });
    return;
  }
  if (startUrl && isCapitalGUrl(startUrl)) {
    stampAggregator(saas, AGGREGATOR_PROVIDER_CAPITALG, {
      enrichCapitalGDetails: true,
      enrichSequoiaDetails: false,
      enrichHiringCafeDetails: false,
      enrichAccelDetails: false,
    });
    return;
  }
  if (startUrl && isChoppingBlockUrl(startUrl)) {
    stampAggregator(saas, AGGREGATOR_PROVIDER_CHOPPINGBLOCK, {
      enrichChoppingBlockDetails: true,
      enrichHiringCafeDetails: false,
      enrichAccelDetails: false,
    });
    return;
  }
  if (startUrl && isAidevboardUrl(startUrl)) {
    stampAggregator(saas, AGGREGATOR_PROVIDER_AIDEVBOARD, {
      enrichAidevboardDetails: true,
      enrichHiringCafeDetails: false,
      enrichAccelDetails: false,
    });
    return;
  }
  if (startUrl && isStartupsGalleryUrl(startUrl)) {
    stampAggregator(saas, AGGREGATOR_PROVIDER_STARTUPS_GALLERY, {
      enrichHiringCafeDetails: false,
      enrichAccelDetails: false,
    });
    return;
  }
  if (startUrl && isLinkedInJobsUrl(startUrl)) {
    stampAggregator(saas, AGGREGATOR_PROVIDER_LINKEDIN, { enrichHiringCafeDetails: false });
  }
}

const KNOWN_PROVIDERS = new Set([
  AGGREGATOR_PROVIDER_HIRING_CAFE,
  AGGREGATOR_PROVIDER_LINKEDIN,
  AGGREGATOR_PROVIDER_ACCEL,
  AGGREGATOR_PROVIDER_SEQUOIA,
  AGGREGATOR_PROVIDER_CAPITALG,
  AGGREGATOR_PROVIDER_CHOPPINGBLOCK,
  AGGREGATOR_PROVIDER_AIDEVBOARD,
  AGGREGATOR_PROVIDER_STARTUPS_GALLERY,
  'aggregator',
]);

/** True when this robot belongs under Aggregators, not Automations. */
export function isAggregatorRobot(robot: any): boolean {
  const cfg = robot?.recording_meta?.saasConfig || robot?.saasConfig || {};
  const provider = String(cfg.aggregatorProvider || cfg.provider || '').trim().toLowerCase();
  if (KNOWN_PROVIDERS.has(provider)) return true;
  const tags = [
    ...(Array.isArray(robot?.recording_meta?.tags) ? robot.recording_meta.tags : []),
    ...(Array.isArray(cfg.tags) ? cfg.tags : []),
  ].map((t: unknown) => String(t || '').toLowerCase());
  return tags.some(
    (t) =>
      t === 'aggregator' ||
      t.startsWith('aggregator:') ||
      t === 'hiring_cafe' ||
      t === 'linkedin' ||
      t === 'accel' ||
      t === 'sequoia' ||
      t === 'capitalg' ||
      t === 'choppingblock' ||
      t === 'aidevboard' ||
      t === 'startups_gallery'
  );
}

export function isLinkedInAggregatorRobot(robot: any): boolean {
  if (!isAggregatorRobot(robot)) return false;
  const cfg = robot?.recording_meta?.saasConfig || robot?.saasConfig || {};
  const provider = String(cfg.aggregatorProvider || cfg.provider || '').trim().toLowerCase();
  if (provider === AGGREGATOR_PROVIDER_LINKEDIN) return true;
  const tags = [
    ...(Array.isArray(robot?.recording_meta?.tags) ? robot.recording_meta.tags : []),
    ...(Array.isArray(cfg.tags) ? cfg.tags : []),
  ].map((t: unknown) => String(t || '').toLowerCase());
  return tags.includes('linkedin');
}

/** True when post-list detail visits should run (Hiring Cafe posting pages). */
export function shouldEnrichHiringCafeDetails(robot: any): boolean {
  if (!isAggregatorRobot(robot)) return false;
  const cfg = robot?.recording_meta?.saasConfig || robot?.saasConfig || {};
  if (cfg.enrichHiringCafeDetails === false) return false;
  const provider = String(cfg.aggregatorProvider || cfg.provider || '').trim().toLowerCase();
  return provider === AGGREGATOR_PROVIDER_HIRING_CAFE || provider === '' || provider === 'aggregator';
}

/** True when post-list Accel/Getro detail HTML enrich should run. */
export function shouldEnrichAccelDetails(robot: any): boolean {
  if (!isAggregatorRobot(robot)) return false;
  const cfg = robot?.recording_meta?.saasConfig || robot?.saasConfig || {};
  if (cfg.enrichAccelDetails === false) return false;
  const provider = String(cfg.aggregatorProvider || cfg.provider || '').trim().toLowerCase();
  if (provider === AGGREGATOR_PROVIDER_ACCEL) return true;
  if (cfg.enrichAccelDetails === true) return true;
  return false;
}

/** True when post-list Sequoia apply-URL resolve should run (not full JD scrape). */
export function shouldEnrichSequoiaDetails(robot: any): boolean {
  if (!isAggregatorRobot(robot)) return false;
  const cfg = robot?.recording_meta?.saasConfig || robot?.saasConfig || {};
  if (cfg.enrichSequoiaDetails === false) return false;
  const provider = String(cfg.aggregatorProvider || cfg.provider || '').trim().toLowerCase();
  if (provider === AGGREGATOR_PROVIDER_SEQUOIA) return true;
  if (cfg.enrichSequoiaDetails === true) return true;
  return false;
}

/** True when post-list CapitalG Consider apply-URL resolve should run. */
export function shouldEnrichCapitalGDetails(robot: any): boolean {
  if (!isAggregatorRobot(robot)) return false;
  const cfg = robot?.recording_meta?.saasConfig || robot?.saasConfig || {};
  if (cfg.enrichCapitalGDetails === false) return false;
  const provider = String(cfg.aggregatorProvider || cfg.provider || '').trim().toLowerCase();
  if (provider === AGGREGATOR_PROVIDER_CAPITALG) return true;
  if (cfg.enrichCapitalGDetails === true) return true;
  return false;
}

/** Sequoia or CapitalG Consider apply-URL resolve. */
export function shouldEnrichConsiderDetails(robot: any): boolean {
  return shouldEnrichSequoiaDetails(robot) || shouldEnrichCapitalGDetails(robot);
}

export function shouldEnrichChoppingBlockDetails(robot: any): boolean {
  if (!isAggregatorRobot(robot)) return false;
  const cfg = robot?.recording_meta?.saasConfig || robot?.saasConfig || {};
  if (cfg.enrichChoppingBlockDetails === false) return false;
  const provider = String(cfg.aggregatorProvider || cfg.provider || '').trim().toLowerCase();
  if (provider === AGGREGATOR_PROVIDER_CHOPPINGBLOCK) return true;
  if (cfg.enrichChoppingBlockDetails === true) return true;
  return false;
}

export function shouldEnrichAidevboardDetails(robot: any): boolean {
  if (!isAggregatorRobot(robot)) return false;
  const cfg = robot?.recording_meta?.saasConfig || robot?.saasConfig || {};
  if (cfg.enrichAidevboardDetails === false) return false;
  const provider = String(cfg.aggregatorProvider || cfg.provider || '').trim().toLowerCase();
  if (provider === AGGREGATOR_PROVIDER_AIDEVBOARD) return true;
  if (cfg.enrichAidevboardDetails === true) return true;
  return false;
}

/** True when post-list startups.gallery ATS link normalize / DOM harvest should run. */
export function shouldEnrichStartupsGalleryDetails(robot: any): boolean {
  if (!isAggregatorRobot(robot)) return false;
  const cfg = robot?.recording_meta?.saasConfig || robot?.saasConfig || {};
  if (cfg.enrichStartupsGalleryDetails === false) return false;
  const provider = String(cfg.aggregatorProvider || cfg.provider || '').trim().toLowerCase();
  if (provider === AGGREGATOR_PROVIDER_STARTUPS_GALLERY) return true;
  if (cfg.enrichStartupsGalleryDetails === true) return true;
  return false;
}

/**
 * HC / Accel / Chopping Block / AI Dev Board enrich from aggregator payload only.
 * Consider (Sequoia/CapitalG) and startups.gallery use ATS/employer paths.
 */
export function usesAggregatorHtmlOnlyEnrichment(source: string | null | undefined): boolean {
  const s = String(source || '').trim().toLowerCase();
  return (
    s === AGGREGATOR_SOURCE_HIRING_CAFE ||
    s === AGGREGATOR_SOURCE_ACCEL ||
    s === AGGREGATOR_SOURCE_CHOPPINGBLOCK ||
    s === AGGREGATOR_SOURCE_AIDEVBOARD
  );
}

/** Sources that resolve apply then run Tier 0 ATS (Consider boards). */
export function usesConsiderApplyThenAtsEnrichment(source: string | null | undefined): boolean {
  const s = String(source || '').trim().toLowerCase();
  return s === AGGREGATOR_SOURCE_SEQUOIA || s === AGGREGATOR_SOURCE_CAPITALG;
}

export function aggregatorSourceForRobot(robot: any): string | null {
  if (!isAggregatorRobot(robot)) return null;
  const cfg = robot?.recording_meta?.saasConfig || {};
  const provider = String(cfg.aggregatorProvider || cfg.provider || '').trim().toLowerCase();
  if (provider === AGGREGATOR_PROVIDER_LINKEDIN) return AGGREGATOR_SOURCE_LINKEDIN;
  if (provider === AGGREGATOR_PROVIDER_ACCEL) return AGGREGATOR_SOURCE_ACCEL;
  if (provider === AGGREGATOR_PROVIDER_SEQUOIA) return AGGREGATOR_SOURCE_SEQUOIA;
  if (provider === AGGREGATOR_PROVIDER_CAPITALG) return AGGREGATOR_SOURCE_CAPITALG;
  if (provider === AGGREGATOR_PROVIDER_CHOPPINGBLOCK) return AGGREGATOR_SOURCE_CHOPPINGBLOCK;
  if (provider === AGGREGATOR_PROVIDER_AIDEVBOARD) return AGGREGATOR_SOURCE_AIDEVBOARD;
  if (provider === AGGREGATOR_PROVIDER_STARTUPS_GALLERY) return AGGREGATOR_SOURCE_STARTUPS_GALLERY;
  if (provider === AGGREGATOR_PROVIDER_HIRING_CAFE || !provider) return AGGREGATOR_SOURCE_HIRING_CAFE;
  return provider;
}

/** Mongo filter: company career robots only (hide from Aggregators). */
export function careerRobotsOnlyMongoClause(): Record<string, unknown> {
  return {
    $or: [
      { 'recording_meta.saasConfig.aggregatorProvider': { $exists: false } },
      { 'recording_meta.saasConfig.aggregatorProvider': null },
      { 'recording_meta.saasConfig.aggregatorProvider': '' },
    ],
  };
}

/** Mongo filter: aggregator robots (optionally one provider). */
export function aggregatorRobotsOnlyMongoClause(provider?: string): Record<string, unknown> {
  if (provider) {
    return { 'recording_meta.saasConfig.aggregatorProvider': String(provider).trim() };
  }
  return {
    'recording_meta.saasConfig.aggregatorProvider': { $exists: true, $nin: [null, ''] },
  };
}

/** Validate LinkedIn aggregator start URL at create time. */
export function validateLinkedInAggregatorUrl(url: string): { ok: true } | { ok: false; error: string } {
  const trimmed = String(url || '').trim();
  if (!trimmed) {
    return { ok: false, error: 'LinkedIn aggregator URL is required' };
  }
  if (!isLinkedInHostUrl(trimmed)) {
    return { ok: false, error: 'LinkedIn aggregator URL must be on linkedin.com' };
  }
  if (trimmed.toLowerCase().includes('/preload')) {
    return { ok: false, error: 'LinkedIn preload URLs are not valid job search targets' };
  }
  if (!isLinkedInJobsUrl(trimmed)) {
    return {
      ok: false,
      error: 'LinkedIn aggregator URL must be a jobs search URL (path contains /jobs)',
    };
  }
  return { ok: true };
}
