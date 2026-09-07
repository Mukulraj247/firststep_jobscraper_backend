import CompanyBrand from '../../models/CompanyBrand';
import EmployerBrandMapping from '../../models/EmployerBrandMapping';
import Fy2026GovRole, { IFy2026GovRole } from '../../models/Fy2026GovRole';
import GovEmployer, { IGovEmployer } from '../../models/GovEmployer';
import SponsorshipProfile, { H1bCompanyScore } from '../../models/SponsorshipProfile';

function mergeTopTitles(
  lists: Array<Array<{ title: string; n: number }>>,
  limit = 15
): Array<{ title: string; n: number }> {
  const map = new Map<string, number>();
  for (const list of lists) {
    for (const row of list || []) {
      const title = String(row.title || '').trim();
      if (!title) continue;
      map.set(title, (map.get(title) || 0) + (row.n || 0));
    }
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([title, n]) => ({ title, n }));
}

function mergeTopSocs(
  lists: Array<Array<{ code: string; title: string; n: number }>>,
  limit = 10
): Array<{ code: string; title: string; n: number }> {
  const map = new Map<string, { title: string; n: number }>();
  for (const list of lists) {
    for (const row of list || []) {
      const code = String(row.code || '').trim();
      if (!code) continue;
      const cur = map.get(code) || { title: row.title || '', n: 0 };
      cur.n += row.n || 0;
      if (!cur.title && row.title) cur.title = row.title;
      map.set(code, cur);
    }
  }
  return [...map.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, limit)
    .map(([code, v]) => ({ code, title: v.title, n: v.n }));
}

function mergeTopStates(
  lists: Array<Array<{ state: string; n: number }>>,
  limit = 10
): Array<{ state: string; n: number }> {
  const map = new Map<string, number>();
  for (const list of lists) {
    for (const row of list || []) {
      const state = String(row.state || '').trim().toUpperCase();
      if (!state) continue;
      map.set(state, (map.get(state) || 0) + (row.n || 0));
    }
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([state, n]) => ({ state, n }));
}

/**
 * Approximate High/Med/Low without per-year certified breakdown (lean aggregates only).
 * High: ≥3 active years + ≥5 certified + last filing within 3 years.
 */
export function computeCompanyScore(gov: {
  certifiedCount: number;
  yearsActive: number[];
  lastFilingYear: number;
  deniedCount?: number;
  withdrawnCount?: number;
}): H1bCompanyScore {
  const nowYear = new Date().getUTCFullYear();
  const years = Array.isArray(gov.yearsActive) ? gov.yearsActive.filter(Boolean) : [];
  const certified = gov.certifiedCount || 0;
  const last = gov.lastFilingYear || 0;

  if (certified <= 0) {
    if ((gov.deniedCount || 0) + (gov.withdrawnCount || 0) > 0) return 'low';
    return 'unknown';
  }

  if (years.length >= 3 && certified >= 5 && last >= nowYear - 3) return 'high';
  if (last >= nowYear - 5 || years.length >= 1) return 'medium';
  return 'low';
}

export async function buildSponsorshipProfiles(): Promise<{ upserted: number }> {
  const mappings = await EmployerBrandMapping.find({
    status: { $in: ['auto_approved', 'approved'] },
  }).lean();

  const byBrand = new Map<
    string,
    {
      brandId: any;
      brandName: string;
      brandNameKey: string;
      govKeys: string[];
    }
  >();

  for (const m of mappings) {
    const brand = await CompanyBrand.findById(m.brandId).lean();
    if (!brand) continue;
    const key = brand.brandNameKey;
    const cur = byBrand.get(key) || {
      brandId: brand._id,
      brandName: brand.brandName,
      brandNameKey: key,
      govKeys: [] as string[],
    };
    if (!cur.govKeys.includes(m.govEmployerKey)) cur.govKeys.push(m.govEmployerKey);
    byBrand.set(key, cur);
  }

  let upserted = 0;
  for (const entry of byBrand.values()) {
    const govs = (await GovEmployer.find({
      employerNameKey: { $in: entry.govKeys },
    }).lean()) as IGovEmployer[];

    if (!govs.length) continue;

    const certifiedCount = govs.reduce((s, g) => s + (g.certifiedCount || 0), 0);
    const filingCount7yr = govs.reduce((s, g) => s + (g.totalFilings || 0), 0);
    const deniedCount = govs.reduce((s, g) => s + (g.deniedCount || 0), 0);
    const withdrawnCount = govs.reduce((s, g) => s + (g.withdrawnCount || 0), 0);
    const yearsSet = new Set<number>();
    for (const g of govs) for (const y of g.yearsActive || []) yearsSet.add(y);
    const yearsActive = [...yearsSet].sort((a, b) => a - b);
    const lastFilingYear = Math.max(0, ...govs.map((g) => g.lastFilingYear || 0));
    const dataAsOf =
      govs
        .map((g) => g.dataAsOf)
        .filter(Boolean)
        .sort((a, b) => new Date(b as Date).getTime() - new Date(a as Date).getTime())[0] || null;

    const totalDecided = certifiedCount + deniedCount;
    const certifiedRate = totalDecided > 0 ? certifiedCount / totalDecided : 0;

    const companyScore = computeCompanyScore({
      certifiedCount,
      yearsActive,
      lastFilingYear,
      deniedCount,
      withdrawnCount,
    });

    const fyRoles = (await Fy2026GovRole.find({
      govEmployerKey: { $in: entry.govKeys },
    }).lean()) as IFy2026GovRole[];

    const fyCertified = fyRoles.reduce((s, r) => s + (r.certifiedCount || 0), 0);
    const fyDataAsOf =
      fyRoles
        .map((r) => r.dataAsOf)
        .filter(Boolean)
        .sort((a, b) => new Date(b as Date).getTime() - new Date(a as Date).getTime())[0] || null;
    const fySource =
      fyRoles.map((r) => r.sourceLabel).find((s) => s && String(s).trim()) || 'FY2026_Q3';

    await SponsorshipProfile.findOneAndUpdate(
      { brandNameKey: entry.brandNameKey },
      {
        $set: {
          brandId: entry.brandId,
          brandName: entry.brandName,
          brandNameKey: entry.brandNameKey,
          companyScore,
          filingCount7yr,
          certifiedCount,
          certifiedRate: Math.round(certifiedRate * 1000) / 1000,
          yearsActiveCount: yearsActive.length,
          lastFilingYear,
          capExempt: false,
          topSocCodes: mergeTopSocs(govs.map((g) => g.topSocCodes || [])),
          topJobTitles: mergeTopTitles(govs.map((g) => g.topJobTitles || [])),
          govEmployerKeys: entry.govKeys,
          dataAsOf,
          fy2026: {
            certifiedCount: fyCertified,
            topJobTitles: mergeTopTitles(
              fyRoles.map((r) => r.topJobTitles || []),
              20
            ),
            topSocCodes: mergeTopSocs(fyRoles.map((r) => r.topSocCodes || [])),
            topStates: mergeTopStates(fyRoles.map((r) => r.topStates || [])),
            dataAsOf: fyDataAsOf,
            sourceLabel: fySource,
          },
        },
      },
      { upsert: true }
    );
    upserted += 1;
  }

  return { upserted };
}
