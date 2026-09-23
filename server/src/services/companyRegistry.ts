/**
 * Company registry: upsert by companyKey with name-precedence rules.
 * Higher precedence wins; equal or lower never overwrites displayName.
 */
import Company, { type CompanyNameSource, type ICompany } from '../models/Company';
import { generateUniqueCompanyId } from '../utils/companyId';
import {
  pickEmployerUrlForCompanyResolution,
  resolveCompanyKey,
  type CompanyKeyResolution,
} from './companyIdentity';
import { isAggregatorListingSource } from './aggregatorIdentity';

export const NAME_PRECEDENCE: Record<CompanyNameSource, number> = {
  ops: 5,
  automation: 4,
  ats_hint: 3,
  aggregator: 2,
  derived: 1,
};

export type CompanyStamp = {
  companyId: string;
  companyKey: string;
  companyResolvedName: string;
};

export type UpsertCompanyInput = {
  companyKey: string;
  displayName?: string;
  nameSource: CompanyNameSource;
  host?: string;
  atsProvider?: string;
  /** Bump jobCount when stamping a new board sighting */
  touchJob?: boolean;
};

function sanitizeDisplayName(raw: unknown): string {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function hostFromUrl(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Follow mergedInto chain to the canonical company record. */
export async function resolveCanonicalCompany(
  companyKey: string,
  maxHops = 5
): Promise<ICompany | null> {
  let key = String(companyKey || '').trim().toLowerCase();
  if (!key) return null;

  for (let hop = 0; hop < maxHops; hop += 1) {
    const doc = await Company.findOne({ companyKey: key }).lean();
    if (!doc) return null;
    const merged = String((doc as any).mergedInto || '').trim().toLowerCase();
    if (!merged || merged === key) return doc as ICompany;
    key = merged;
  }
  return Company.findOne({ companyKey: key }).lean() as Promise<ICompany | null>;
}

/**
 * Upsert a company by key. Name is written only when incoming precedence
 * strictly outranks the stored one (or the record is new).
 */
export async function upsertCompany(input: UpsertCompanyInput): Promise<CompanyStamp | null> {
  const companyKey = String(input.companyKey || '')
    .trim()
    .toLowerCase();
  if (!companyKey) return null;

  const incomingName = sanitizeDisplayName(input.displayName);
  const precedence = NAME_PRECEDENCE[input.nameSource] ?? 1;
  const now = new Date();
  const host = String(input.host || '')
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
  const atsProvider = String(input.atsProvider || '')
    .trim()
    .toLowerCase();

  let existing = await Company.findOne({ companyKey });
  if (existing && existing.mergedInto) {
    const canonical = await resolveCanonicalCompany(companyKey);
    if (canonical && String((canonical as any).companyKey) !== companyKey) {
      existing = await Company.findOne({ companyKey: (canonical as any).companyKey });
    }
  }

  if (!existing) {
    const companyId = await generateUniqueCompanyId(async (id) => {
      const hit = await Company.findOne({ companyId: id }).select('_id').lean();
      return !!hit;
    });
    const displayName = incomingName || companyKey;
    const created = await Company.create({
      companyId,
      companyKey,
      displayName,
      nameSource: input.nameSource,
      namePrecedence: precedence,
      aliases: [],
      hosts: host ? [host] : [],
      atsProviders: atsProvider ? [atsProvider] : [],
      mergedInto: '',
      jobCount: input.touchJob ? 1 : 0,
      firstSeenAt: now,
      lastSeenAt: now,
    });
    return {
      companyId: created.companyId,
      companyKey: created.companyKey,
      companyResolvedName: created.displayName,
    };
  }

  const $set: Record<string, unknown> = { lastSeenAt: now };
  const $addToSet: Record<string, unknown> = {};
  const $inc: Record<string, number> = {};

  if (incomingName && precedence > (existing.namePrecedence || 0)) {
    const prev = String(existing.displayName || '').trim();
    if (prev && prev.toLowerCase() !== incomingName.toLowerCase()) {
      $addToSet.aliases = prev;
    }
    $set.displayName = incomingName;
    $set.nameSource = input.nameSource;
    $set.namePrecedence = precedence;
  } else if (
    incomingName &&
    existing.displayName &&
    incomingName.toLowerCase() !== String(existing.displayName).toLowerCase()
  ) {
    $addToSet.aliases = incomingName;
  }

  if (host) $addToSet.hosts = host;
  if (atsProvider) $addToSet.atsProviders = atsProvider;
  if (input.touchJob) $inc.jobCount = 1;

  const update: Record<string, unknown> = { $set };
  if (Object.keys($addToSet).length) update.$addToSet = $addToSet;
  if (Object.keys($inc).length) update.$inc = $inc;

  const updated = await Company.findOneAndUpdate({ _id: existing._id }, update, {
    returnDocument: 'after',
  }).lean();

  return {
    companyId: String((updated as any)?.companyId || existing.companyId),
    companyKey: String((updated as any)?.companyKey || existing.companyKey),
    companyResolvedName: String(
      (updated as any)?.displayName || existing.displayName || companyKey
    ),
  };
}

export function inferNameSource(opts: {
  listingSource?: string | null;
  hasAtsHint?: boolean;
  fromAutomation?: boolean;
}): CompanyNameSource {
  if (opts.fromAutomation) return 'automation';
  if (opts.hasAtsHint) return 'ats_hint';
  if (isAggregatorListingSource(String(opts.listingSource || '').trim())) {
    return 'aggregator';
  }
  return 'derived';
}

/**
 * Resolve URL → companyKey → registry stamp.
 * Fail-open: returns null when URL cannot be resolved.
 */
export async function resolveAndUpsertCompany(opts: {
  jobUrl?: unknown;
  applyUrl?: unknown;
  displayName?: string;
  nameSource?: CompanyNameSource;
  listingSource?: string | null;
  touchJob?: boolean;
}): Promise<{ stamp: CompanyStamp; resolution: CompanyKeyResolution } | null> {
  const employerUrl = pickEmployerUrlForCompanyResolution({
    jobUrl: opts.jobUrl,
    applyUrl: opts.applyUrl,
  });
  if (!employerUrl) return null;

  const resolution = resolveCompanyKey(employerUrl);
  if (!resolution) return null;

  const nameSource =
    opts.nameSource ||
    inferNameSource({
      listingSource: opts.listingSource,
      hasAtsHint: Boolean(resolution.atsProvider && resolution.nameHint),
    });

  const displayName =
    sanitizeDisplayName(opts.displayName) ||
    sanitizeDisplayName(resolution.nameHint) ||
    resolution.companyKey;

  const stamp = await upsertCompany({
    companyKey: resolution.companyKey,
    displayName,
    nameSource,
    host: hostFromUrl(employerUrl),
    atsProvider: resolution.atsProvider,
    touchJob: opts.touchJob,
  });
  if (!stamp) return null;
  return { stamp, resolution };
}

/** Look up an existing company for a URL without creating one. */
export async function lookupCompanyForUrl(url: string): Promise<{
  companyId: string;
  companyKey: string;
  displayName: string;
  locked: boolean;
} | null> {
  const resolution = resolveCompanyKey(url);
  if (!resolution) return null;

  const doc = await resolveCanonicalCompany(resolution.companyKey);
  if (!doc) {
    return {
      companyId: '',
      companyKey: resolution.companyKey,
      displayName: sanitizeDisplayName(resolution.nameHint) || resolution.companyKey,
      locked: false,
    };
  }

  return {
    companyId: String((doc as any).companyId || ''),
    companyKey: String((doc as any).companyKey || resolution.companyKey),
    displayName: String((doc as any).displayName || resolution.nameHint || ''),
    locked: true,
  };
}
