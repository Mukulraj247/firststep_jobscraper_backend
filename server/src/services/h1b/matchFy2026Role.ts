import SponsorshipProfile from '../../models/SponsorshipProfile';
import EmployerBrandMapping from '../../models/EmployerBrandMapping';
import CompanyBrand from '../../models/CompanyBrand';
import { employerNameNormalize, tokenJaccard } from './employerNameNormalize';
import { isUsJobLocation, jdBlocksSponsorship } from './resolveH1bSponsorship';

/** High-only title match threshold (Jaccard on significant tokens). */
export const H1B_FY2026_TITLE_MATCH_MIN = 0.7;

export type Fy2026ResolveInput = {
  companyName: string;
  jobTitle?: string;
  location?: string;
  remoteType?: string;
  visaSponsorship?: string;
  jobDescription?: string;
};

export type Fy2026ResolveResult = {
  h1bFy2026Match: boolean;
  h1bFy2026TitleConfidence: number;
  h1bFy2026MatchedTitle: string;
  h1bFy2026CertifiedCount: number;
  h1bFy2026DataAsOf: Date | null;
};

const EMPTY: Fy2026ResolveResult = {
  h1bFy2026Match: false,
  h1bFy2026TitleConfidence: 0,
  h1bFy2026MatchedTitle: '',
  h1bFy2026CertifiedCount: 0,
  h1bFy2026DataAsOf: null,
};

const SENIORITY_STOP = new Set([
  'senior',
  'junior',
  'staff',
  'principal',
  'ii',
  'iii',
  'iv',
  'sr',
  'jr',
  'lead',
]);

/**
 * Pure title match against FY2026 filed titles.
 * Returns best DOL title when Jaccard ≥ H1B_FY2026_TITLE_MATCH_MIN.
 */
export function matchFy2026Role(
  jobTitle: string,
  topTitles: Array<{ title: string; n: number }>
): { matched: boolean; confidence: number; matchedTitle: string } {
  if (!jobTitle || !topTitles?.length) {
    return { matched: false, confidence: 0, matchedTitle: '' };
  }
  const jobTokens = employerNameNormalize(jobTitle).tokens.filter((t) => !SENIORITY_STOP.has(t));
  if (!jobTokens.length) {
    return { matched: false, confidence: 0, matchedTitle: '' };
  }

  let best = 0;
  let bestTitle = '';
  for (const t of topTitles) {
    const filed = String(t.title || '').trim();
    if (!filed) continue;
    const j = tokenJaccard(jobTokens, employerNameNormalize(filed).tokens);
    if (j > best) {
      best = j;
      bestTitle = filed;
    }
  }

  const confidence = Math.round(best * 1000) / 1000;
  if (best < H1B_FY2026_TITLE_MATCH_MIN) {
    return { matched: false, confidence, matchedTitle: '' };
  }
  return { matched: true, confidence, matchedTitle: bestTitle };
}

/**
 * FY2026-only job-level filing match.
 * Uses SponsorshipProfile.fy2026 — never 7yr topJobTitles.
 */
export async function resolveFy2026JobMatch(
  input: Fy2026ResolveInput
): Promise<Fy2026ResolveResult> {
  if (!isUsJobLocation(input.location || '', input.remoteType)) {
    return { ...EMPTY };
  }

  if (jdBlocksSponsorship(input.visaSponsorship, input.jobDescription)) {
    return { ...EMPTY };
  }

  const company = String(input.companyName || '').trim();
  if (!company) return { ...EMPTY };

  const key = employerNameNormalize(company).key;
  if (!key) return { ...EMPTY };

  const brand =
    (await CompanyBrand.findOne({
      $or: [{ brandNameKey: key }, { aliasKeys: key }],
    }).lean()) || null;
  if (!brand) return { ...EMPTY };

  const mapping = await EmployerBrandMapping.findOne({
    brandId: brand._id,
    status: { $in: ['auto_approved', 'approved'] },
  })
    .sort({ confidence: -1 })
    .lean();
  if (!mapping) return { ...EMPTY };

  const profile = await SponsorshipProfile.findOne({ brandNameKey: brand.brandNameKey }).lean();
  const fy = profile?.fy2026;
  if (!fy || (fy.certifiedCount || 0) < 1) {
    return { ...EMPTY };
  }

  const role = matchFy2026Role(input.jobTitle || '', fy.topJobTitles || []);
  if (!role.matched) {
    return {
      h1bFy2026Match: false,
      h1bFy2026TitleConfidence: role.confidence,
      h1bFy2026MatchedTitle: '',
      h1bFy2026CertifiedCount: fy.certifiedCount || 0,
      h1bFy2026DataAsOf: fy.dataAsOf || null,
    };
  }

  return {
    h1bFy2026Match: true,
    h1bFy2026TitleConfidence: role.confidence,
    h1bFy2026MatchedTitle: role.matchedTitle,
    h1bFy2026CertifiedCount: fy.certifiedCount || 0,
    h1bFy2026DataAsOf: fy.dataAsOf || null,
  };
}
