/**
 * Aggregator robots (Hiring Cafe, LinkedIn, Accel/Getro, etc.) vs company career scrapers.
 * Stored on saasConfig so Automations can exclude them and Aggregators can list them.
 */

export const AGGREGATOR_PROVIDER_HIRING_CAFE = 'hiring_cafe';
export const AGGREGATOR_PROVIDER_LINKEDIN = 'linkedin';
export const AGGREGATOR_PROVIDER_ACCEL = 'accel';

export const AGGREGATOR_SOURCE_HIRING_CAFE = 'hiring_cafe';
export const AGGREGATOR_SOURCE_LINKEDIN = 'linkedin';
export const AGGREGATOR_SOURCE_ACCEL = 'accel';

const ACCEL_JOB_POSTING_PATH = /\/companies\/[^/]+\/jobs\/[^/?#]+/i;

export function isHiringCafeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'hiring.cafe' || host === 'hiringcafe.com' || host.endsWith('.hiring.cafe');
  } catch {
    return false;
  }
}

/** Accel Getro job board host (jobs.accel.com). */
export function isAccelUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'jobs.accel.com' || host.endsWith('.jobs.accel.com');
  } catch {
    return false;
  }
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
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'linkedin.com' || host.endsWith('.linkedin.com');
  } catch {
    return false;
  }
}

/** Stamp aggregator provider from start URL when client omitted aggregatorProvider. */
export function applyAggregatorProviderFromUrl(
  startUrl: string | undefined,
  saas: Record<string, unknown>
): void {
  if (String(saas.aggregatorProvider || '').trim()) return;
  if (startUrl && isHiringCafeUrl(startUrl)) {
    saas.aggregatorProvider = AGGREGATOR_PROVIDER_HIRING_CAFE;
    saas.enrichHiringCafeDetails = true;
    if (saas.preferAtsCollection === undefined) {
      saas.preferAtsCollection = false;
    }
    return;
  }
  if (startUrl && isAccelUrl(startUrl)) {
    saas.aggregatorProvider = AGGREGATOR_PROVIDER_ACCEL;
    saas.enrichAccelDetails = true;
    saas.enrichHiringCafeDetails = false;
    if (saas.preferAtsCollection === undefined) {
      saas.preferAtsCollection = false;
    }
    return;
  }
  if (startUrl && isLinkedInJobsUrl(startUrl)) {
    saas.aggregatorProvider = AGGREGATOR_PROVIDER_LINKEDIN;
    saas.enrichHiringCafeDetails = false;
    if (saas.preferAtsCollection === undefined) {
      saas.preferAtsCollection = false;
    }
  }
}

/** True when this robot belongs under Aggregators, not Automations. */
export function isAggregatorRobot(robot: any): boolean {
  const cfg = robot?.recording_meta?.saasConfig || robot?.saasConfig || {};
  const provider = String(cfg.aggregatorProvider || cfg.provider || '').trim().toLowerCase();
  if (
    provider === AGGREGATOR_PROVIDER_HIRING_CAFE ||
    provider === AGGREGATOR_PROVIDER_LINKEDIN ||
    provider === AGGREGATOR_PROVIDER_ACCEL ||
    provider === 'aggregator'
  ) {
    return true;
  }
  const tags = [
    ...(Array.isArray(robot?.recording_meta?.tags) ? robot.recording_meta.tags : []),
    ...(Array.isArray(cfg.tags) ? cfg.tags : []),
  ].map((t: unknown) => String(t || '').toLowerCase());
  return tags.some(
    (t) =>
      t === 'aggregator' ||
      t === 'aggregator:hiring_cafe' ||
      t === 'aggregator:linkedin' ||
      t === 'aggregator:accel' ||
      t === 'hiring_cafe' ||
      t === 'linkedin' ||
      t === 'accel'
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

export function aggregatorSourceForRobot(robot: any): string | null {
  if (!isAggregatorRobot(robot)) return null;
  const cfg = robot?.recording_meta?.saasConfig || {};
  const provider = String(cfg.aggregatorProvider || cfg.provider || '').trim().toLowerCase();
  if (provider === AGGREGATOR_PROVIDER_LINKEDIN) {
    return AGGREGATOR_SOURCE_LINKEDIN;
  }
  if (provider === AGGREGATOR_PROVIDER_ACCEL) {
    return AGGREGATOR_SOURCE_ACCEL;
  }
  if (provider === AGGREGATOR_PROVIDER_HIRING_CAFE || !provider) {
    return AGGREGATOR_SOURCE_HIRING_CAFE;
  }
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
