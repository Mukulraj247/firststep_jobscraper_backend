import CompanyBrand, { ICompanyBrand } from '../../models/CompanyBrand';
import EmployerBrandMapping from '../../models/EmployerBrandMapping';
import MappingRejection from '../../models/MappingRejection';
import GovEmployer, { IGovEmployer } from '../../models/GovEmployer';
import {
  employerNameNormalize,
  levenshteinRatio,
  tokenJaccard,
} from './employerNameNormalize';

export const H1B_AUTO_APPROVE_CONFIDENCE = parseFloat(
  process.env.H1B_AUTO_APPROVE_CONFIDENCE || '0.88'
);
export const H1B_REVIEW_CONFIDENCE = parseFloat(process.env.H1B_REVIEW_CONFIDENCE || '0.65');

export type MatchCandidate = {
  brand: ICompanyBrand;
  confidence: number;
  matchMethod: 'exact_alias' | 'exact_name' | 'fuzzy' | 'token' | 'subsidiary';
};

type BrandIndex = {
  brands: ICompanyBrand[];
  byKey: Map<string, ICompanyBrand>;
  byNormalized: Map<string, ICompanyBrand>;
  tokensByBrandId: Map<string, string[]>;
};

function brandId(b: ICompanyBrand): string {
  return String((b as any)._id);
}

export function buildBrandIndex(brands: ICompanyBrand[]): BrandIndex {
  const byKey = new Map<string, ICompanyBrand>();
  const byNormalized = new Map<string, ICompanyBrand>();
  const tokensByBrandId = new Map<string, string[]>();

  for (const brand of brands) {
    if (brand.brandNameKey) byKey.set(brand.brandNameKey, brand);
    for (const k of brand.aliasKeys || []) {
      if (k && !byKey.has(k)) byKey.set(k, brand);
    }
    if (brand.brandNameNormalized && !byNormalized.has(brand.brandNameNormalized)) {
      byNormalized.set(brand.brandNameNormalized, brand);
    }
    tokensByBrandId.set(brandId(brand), employerNameNormalize(brand.brandName).tokens);
  }

  return { brands, byKey, byNormalized, tokensByBrandId };
}

/**
 * Score best brand match for a gov employer.
 * Exact alias/key first (O(1)); fuzzy only if needed.
 */
export function scoreBrandMatch(
  gov: Pick<IGovEmployer, 'employerNameKey' | 'employerNameNormalized' | 'employerNameDisplay'>,
  brandsOrIndex: ICompanyBrand[] | BrandIndex
): MatchCandidate | null {
  const index = Array.isArray(brandsOrIndex) ? buildBrandIndex(brandsOrIndex) : brandsOrIndex;
  const govNorm = employerNameNormalize(gov.employerNameDisplay || gov.employerNameNormalized);

  const exact =
    index.byKey.get(gov.employerNameKey) ||
    (govNorm.key ? index.byKey.get(govNorm.key) : undefined);
  if (exact) {
    return { brand: exact, confidence: 0.95, matchMethod: 'exact_alias' };
  }

  const byName = index.byNormalized.get(govNorm.normalized);
  if (byName) {
    return { brand: byName, confidence: 0.9, matchMethod: 'exact_name' };
  }

  let best: MatchCandidate | null = null;
  for (const brand of index.brands) {
    const brandTokens = index.tokensByBrandId.get(brandId(brand)) || [];
    const j = tokenJaccard(govNorm.tokens, brandTokens);
    const lev = levenshteinRatio(gov.employerNameKey, brand.brandNameKey);
    const sub =
      brand.brandNameKey.length >= 4 &&
      gov.employerNameKey.startsWith(brand.brandNameKey) &&
      gov.employerNameKey.length > brand.brandNameKey.length
        ? 0.82
        : 0;
    // Cheap skip: no signal at all
    if (j < 0.35 && lev < 0.7 && sub === 0) continue;

    const confidence = Math.max(j * 0.85 + lev * 0.15, sub, j >= 0.7 ? 0.75 + j * 0.1 : 0);
    const matchMethod: MatchCandidate['matchMethod'] =
      sub >= confidence ? 'subsidiary' : j >= lev ? 'token' : 'fuzzy';

    if (!best || confidence > best.confidence) {
      best = { brand, confidence, matchMethod };
      if (confidence >= H1B_AUTO_APPROVE_CONFIDENCE) break;
    }
  }

  if (!best || best.confidence < H1B_REVIEW_CONFIDENCE) return null;
  return best;
}

/**
 * Auto-map gov employers → brands.
 * Loads lookups into memory; bulk-writes mappings; logs progress.
 */
export async function runAutoEmployerBrandMapping(opts?: {
  limit?: number;
}): Promise<{ autoApproved: number; pendingReview: number; skipped: number }> {
  const brands = await CompanyBrand.find({}).lean<ICompanyBrand[]>();
  if (!brands.length) {
    return { autoApproved: 0, pendingReview: 0, skipped: 0 };
  }
  const index = buildBrandIndex(brands as ICompanyBrand[]);
  console.log(`[h1b] brands loaded=${brands.length}`);

  const rejected = new Set(
    (await MappingRejection.find({}, { govEmployerKey: 1 }).lean()).map((r) => r.govEmployerKey)
  );

  const already = new Set(
    (
      await EmployerBrandMapping.find(
        { status: { $in: ['auto_approved', 'approved', 'rejected'] } },
        { govEmployerKey: 1 }
      ).lean()
    ).map((r) => r.govEmployerKey)
  );
  console.log(`[h1b] rejected=${rejected.size} alreadyMapped=${already.size}`);

  const limit = opts?.limit ?? Number.POSITIVE_INFINITY;
  const batchSize = 200;
  const ops: any[] = [];

  let autoApproved = 0;
  let pendingReview = 0;
  let skipped = 0;
  let processed = 0;
  let matched = 0;

  const flush = async () => {
    if (!ops.length) return;
    await EmployerBrandMapping.bulkWrite(ops, { ordered: false });
    ops.length = 0;
  };

  // Prefer high-filing employers first; lean projection keeps memory down
  const cursor = GovEmployer.find({})
    .select('employerNameKey employerNameNormalized employerNameDisplay certifiedCount')
    .sort({ certifiedCount: -1 })
    .lean()
    .cursor();

  const t0 = Date.now();
  for await (const gov of cursor) {
    if (processed >= limit) break;
    processed += 1;

    if (rejected.has(gov.employerNameKey) || already.has(gov.employerNameKey)) {
      skipped += 1;
    } else {
      const match = scoreBrandMatch(gov as IGovEmployer, index);
      if (!match) {
        skipped += 1;
      } else {
        const status =
          match.confidence >= H1B_AUTO_APPROVE_CONFIDENCE ? 'auto_approved' : 'pending_review';
        ops.push({
          updateOne: {
            filter: { govEmployerKey: gov.employerNameKey, brandId: match.brand._id },
            update: {
              $set: {
                govEmployerId: (gov as any)._id,
                govEmployerKey: gov.employerNameKey,
                brandId: match.brand._id,
                brandName: match.brand.brandName,
                confidence: Math.round(match.confidence * 1000) / 1000,
                matchMethod: match.matchMethod,
                status,
              },
            },
            upsert: true,
          },
        });
        matched += 1;
        if (status === 'auto_approved') autoApproved += 1;
        else pendingReview += 1;
        already.add(gov.employerNameKey);
      }
    }

    if (ops.length >= batchSize) await flush();

    if (processed % 500 === 0) {
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(
        `[h1b] map progress processed=${processed} matched=${matched} auto=${autoApproved} pending=${pendingReview} skipped=${skipped} (${sec}s)`
      );
    }
  }

  await flush();
  console.log(
    `[h1b] map done processed=${processed} autoApproved=${autoApproved} pendingReview=${pendingReview} skipped=${skipped}`
  );
  return { autoApproved, pendingReview, skipped };
}
