import Robot from '../models/Robot';
import type { AutomationRuntimeConfig } from './automation';

export type HiringCafeScrapeDoTier = 2 | 3;

export type HiringCafeScrapeDoOptions = {
  enabled: boolean;
  token: string;
  maxTier: HiringCafeScrapeDoTier;
};

type HiringCafeEnrichmentConfig = NonNullable<AutomationRuntimeConfig['hiringCafeEnrichment']>;

function envHcScrapeDoEnabled(): boolean {
  const raw = String(process.env.HIRING_CAFE_SCRAPE_DO_ENABLED || '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

function normalizeMaxTier(value: unknown): HiringCafeScrapeDoTier {
  const n = Number(value);
  return n === 3 ? 3 : 2;
}

/** Resolve Scrape.do settings from automation saasConfig (robot credentials + enable flag). */
export function resolveHiringCafeScrapeDoFromConfig(
  config: unknown
): HiringCafeScrapeDoOptions | null {
  const cfg = config as AutomationRuntimeConfig | null | undefined;
  const hc = cfg?.hiringCafeEnrichment;
  if (!hc?.scrapeDoEnabled) return null;

  const token = String(hc.scrapeDoToken || process.env.SCRAPE_DO_TOKEN || '').trim();
  if (!token) return null;

  return {
    enabled: true,
    token,
    maxTier: normalizeMaxTier(hc.scrapeDoMaxTier),
  };
}

/** Env-only fallback when no per-robot token is stored (droplet-wide). */
export function resolveHiringCafeScrapeDoFromEnv(): HiringCafeScrapeDoOptions | null {
  if (!envHcScrapeDoEnabled()) return null;
  const token = String(process.env.SCRAPE_DO_TOKEN || '').trim();
  if (!token) return null;
  const maxTier = normalizeMaxTier(process.env.HIRING_CAFE_SCRAPE_DO_MAX_TIER);
  return { enabled: true, token, maxTier };
}

export function resolveHiringCafeScrapeDoFromRobot(robot: unknown): HiringCafeScrapeDoOptions | null {
  const stored = (robot as any)?.recording_meta?.saasConfig;
  return resolveHiringCafeScrapeDoFromConfig(stored) || resolveHiringCafeScrapeDoFromEnv();
}

/** Load Scrape.do options for a board row (first linked robot, then env). */
export async function resolveHiringCafeScrapeDoForListing(doc: {
  robotMetaIds?: string[] | null;
}): Promise<HiringCafeScrapeDoOptions | null> {
  const ids = Array.isArray(doc.robotMetaIds) ? doc.robotMetaIds.filter(Boolean) : [];
  for (const robotMetaId of ids) {
    const robot = await Robot.findOne({ 'recording_meta.id': robotMetaId }).lean();
    const opts = resolveHiringCafeScrapeDoFromRobot(robot);
    if (opts) return opts;
  }
  return resolveHiringCafeScrapeDoFromEnv();
}

export function sanitizeHiringCafeEnrichmentConfig(
  input: unknown
): HiringCafeEnrichmentConfig | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const raw = input as Record<string, unknown>;
  const scrapeDoEnabled =
    raw.scrapeDoEnabled === true ||
    raw.scrapeDoEnabled === 'true' ||
    raw.scrapeDoEnabled === 1 ||
    raw.scrapeDoEnabled === '1';
  const scrapeDoToken =
    typeof raw.scrapeDoToken === 'string' ? raw.scrapeDoToken.trim() : undefined;
  const scrapeDoMaxTier = normalizeMaxTier(raw.scrapeDoMaxTier);
  if (!scrapeDoEnabled && !scrapeDoToken && raw.scrapeDoMaxTier == null) return undefined;
  return {
    scrapeDoEnabled,
    ...(scrapeDoToken ? { scrapeDoToken } : {}),
    scrapeDoMaxTier,
  };
}
