/**
 * Aggregator robots (Hiring Cafe, etc.) vs company career scrapers.
 * Stored on saasConfig so Automations can exclude them and Aggregators can list them.
 */

export const AGGREGATOR_PROVIDER_HIRING_CAFE = 'hiring_cafe';

export const AGGREGATOR_SOURCE_HIRING_CAFE = 'hiring_cafe';

export function isHiringCafeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'hiring.cafe' || host === 'hiringcafe.com' || host.endsWith('.hiring.cafe');
  } catch {
    return false;
  }
}

/** Stamp Hiring Cafe searches as aggregators when the client omitted aggregatorProvider. */
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
  }
}

/** True when this robot belongs under Aggregators, not Automations. */
export function isAggregatorRobot(robot: any): boolean {
  const cfg = robot?.recording_meta?.saasConfig || robot?.saasConfig || {};
  const provider = String(cfg.aggregatorProvider || cfg.provider || '').trim().toLowerCase();
  if (provider === AGGREGATOR_PROVIDER_HIRING_CAFE || provider === 'aggregator') return true;
  const tags = [
    ...(Array.isArray(robot?.recording_meta?.tags) ? robot.recording_meta.tags : []),
    ...(Array.isArray(cfg.tags) ? cfg.tags : []),
  ].map((t: unknown) => String(t || '').toLowerCase());
  return tags.some(
    (t) => t === 'aggregator' || t === 'aggregator:hiring_cafe' || t === 'hiring_cafe'
  );
}

/** True when post-list detail visits should run (Hiring Cafe posting pages). */
export function shouldEnrichHiringCafeDetails(robot: any): boolean {
  if (!isAggregatorRobot(robot)) return false;
  const cfg = robot?.recording_meta?.saasConfig || robot?.saasConfig || {};
  if (cfg.enrichHiringCafeDetails === false) return false;
  const provider = String(cfg.aggregatorProvider || cfg.provider || '').trim().toLowerCase();
  return (
    provider === AGGREGATOR_PROVIDER_HIRING_CAFE ||
    provider === '' ||
    provider === 'aggregator'
  );
}

export function aggregatorSourceForRobot(robot: any): string | null {
  if (!isAggregatorRobot(robot)) return null;
  const cfg = robot?.recording_meta?.saasConfig || {};
  const provider = String(cfg.aggregatorProvider || cfg.provider || '').trim().toLowerCase();
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
