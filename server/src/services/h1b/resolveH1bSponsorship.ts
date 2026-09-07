import SponsorshipProfile, { H1bCompanyScore } from '../../models/SponsorshipProfile';
import EmployerBrandMapping from '../../models/EmployerBrandMapping';
import CompanyBrand from '../../models/CompanyBrand';
import { employerNameNormalize, tokenJaccard } from './employerNameNormalize';

export type H1bRoleScore = 'high' | 'medium' | 'low' | 'unknown';

export type H1bResolveInput = {
  companyName: string;
  jobTitle?: string;
  location?: string;
  remoteType?: string;
  visaSponsorship?: string;
  jobDescription?: string;
};

export type H1bResolveResult = {
  h1bEligible: boolean;
  h1bCompanyScore: H1bCompanyScore;
  h1bRoleScore: H1bRoleScore;
  h1bCompanyConfidence: number;
  h1bRoleConfidence: number;
  h1bFilingCount: number;
  h1bLastFilingYear: number;
  h1bMatchedGovEmployer: string;
  h1bCapExempt: boolean;
  h1bDataAsOf: Date | null;
  h1bMappingStatus: 'auto' | 'approved' | 'rejected' | 'none';
};

const US_STATE_RE =
  /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/i;
const US_NAME_RE = /\b(united states|u\.?s\.?a\.?|u\.?s\.?)\b/i;
const NON_US_RE =
  /\b(canada|uk|united kingdom|india|germany|france|australia|singapore|ireland|netherlands|mexico|brazil|china|japan|remote[- ]?(only )?(europe|emea|apac))\b/i;
const NO_SPONSOR_RE =
  /\b(will not sponsor|no sponsorship|not sponsor|cannot sponsor|must be (a )?us citizen|citizens? only|no visa sponsorship)\b/i;

export function isUsJobLocation(location: string, remoteType?: string): boolean {
  const loc = String(location || '').trim();
  if (NON_US_RE.test(loc) && !US_NAME_RE.test(loc) && !US_STATE_RE.test(loc)) return false;
  if (US_STATE_RE.test(loc) || US_NAME_RE.test(loc)) return true;
  if (!loc && /\b(us|usa|united states)\b/i.test(String(remoteType || ''))) return true;
  // Empty location: treat as eligible so we don't hide US remote postings lacking location
  if (!loc) return true;
  return false;
}

export function jdBlocksSponsorship(visaSponsorship?: string, jobDescription?: string): boolean {
  if (String(visaSponsorship || '').toLowerCase() === 'no') return true;
  return NO_SPONSOR_RE.test(String(jobDescription || ''));
}

function scoreRole(jobTitle: string, topTitles: Array<{ title: string; n: number }>): {
  score: H1bRoleScore;
  confidence: number;
} {
  if (!jobTitle || !topTitles?.length) return { score: 'low', confidence: 0 };
  const jobTokens = employerNameNormalize(jobTitle).tokens.filter(
    (t) => !['senior', 'junior', 'staff', 'principal', 'ii', 'iii', 'iv', 'sr', 'jr'].includes(t)
  );
  let best = 0;
  for (const t of topTitles) {
    const j = tokenJaccard(jobTokens, employerNameNormalize(t.title).tokens);
    if (j > best) best = j;
  }
  if (best >= 0.7) return { score: 'high', confidence: best };
  if (best >= 0.4) return { score: 'medium', confidence: best };
  return { score: 'low', confidence: best };
}

const EMPTY: H1bResolveResult = {
  h1bEligible: false,
  h1bCompanyScore: 'unknown',
  h1bRoleScore: 'unknown',
  h1bCompanyConfidence: 0,
  h1bRoleConfidence: 0,
  h1bFilingCount: 0,
  h1bLastFilingYear: 0,
  h1bMatchedGovEmployer: '',
  h1bCapExempt: false,
  h1bDataAsOf: null,
  h1bMappingStatus: 'none',
};

/**
 * Fast lookup for enrichment: brand key → sponsorship profile.
 * Auto-approved / approved mappings only (rejected never surface).
 */
export async function resolveH1bSponsorship(input: H1bResolveInput): Promise<H1bResolveResult> {
  const eligible = isUsJobLocation(input.location || '', input.remoteType);
  if (!eligible) {
    return { ...EMPTY, h1bEligible: false };
  }

  if (jdBlocksSponsorship(input.visaSponsorship, input.jobDescription)) {
    return {
      ...EMPTY,
      h1bEligible: true,
      h1bMappingStatus: 'none',
      h1bCompanyScore: 'unknown',
      h1bRoleScore: 'unknown',
    };
  }

  const company = String(input.companyName || '').trim();
  if (!company) {
    return { ...EMPTY, h1bEligible: true };
  }

  const key = employerNameNormalize(company).key;
  if (!key) return { ...EMPTY, h1bEligible: true };

  const brand =
    (await CompanyBrand.findOne({
      $or: [{ brandNameKey: key }, { aliasKeys: key }],
    }).lean()) || null;

  if (!brand) {
    return { ...EMPTY, h1bEligible: true };
  }

  const mapping = await EmployerBrandMapping.findOne({
    brandId: brand._id,
    status: { $in: ['auto_approved', 'approved'] },
  })
    .sort({ confidence: -1 })
    .lean();

  if (!mapping) {
    // Brand exists but no approved gov link yet
    const pending = await EmployerBrandMapping.findOne({
      brandId: brand._id,
      status: 'pending_review',
    }).lean();
    if (pending) {
      return { ...EMPTY, h1bEligible: true, h1bMappingStatus: 'none' };
    }
    return { ...EMPTY, h1bEligible: true };
  }

  const profile = await SponsorshipProfile.findOne({ brandNameKey: brand.brandNameKey }).lean();
  if (!profile) {
    return {
      ...EMPTY,
      h1bEligible: true,
      h1bMappingStatus: mapping.status === 'approved' ? 'approved' : 'auto',
      h1bCompanyConfidence: mapping.confidence || 0,
      h1bMatchedGovEmployer: mapping.govEmployerKey || '',
    };
  }

  const role = scoreRole(input.jobTitle || '', profile.topJobTitles || []);

  return {
    h1bEligible: true,
    h1bCompanyScore: profile.companyScore || 'unknown',
    h1bRoleScore: role.score,
    h1bCompanyConfidence: mapping.confidence || 0,
    h1bRoleConfidence: Math.round(role.confidence * 1000) / 1000,
    h1bFilingCount: profile.filingCount7yr || profile.certifiedCount || 0,
    h1bLastFilingYear: profile.lastFilingYear || 0,
    h1bMatchedGovEmployer: (profile.govEmployerKeys && profile.govEmployerKeys[0]) || mapping.govEmployerKey || '',
    h1bCapExempt: !!profile.capExempt,
    h1bDataAsOf: profile.dataAsOf || null,
    h1bMappingStatus: mapping.status === 'approved' ? 'approved' : 'auto',
  };
}
