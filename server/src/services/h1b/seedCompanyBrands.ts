import CompanyBrand from '../../models/CompanyBrand';
import { employerNameNormalize } from './employerNameNormalize';
import { DIRECTORY_CAREER_HTML_HOST_COMPANIES } from '../careerHtmlHostsDirectory';

/** Seed brands from career-host directory + hard-coded high-traffic aliases. */
const MANUAL_ALIASES: Array<{ brand: string; aliases: string[] }> = [
  { brand: 'Amazon', aliases: ['AMAZON.COM SERVICES LLC', 'Amazon.com, Inc.', 'AMAZON WEB SERVICES'] },
  { brand: 'Meta', aliases: ['META PLATFORMS INC', 'FACEBOOK INC', 'Facebook, Inc.'] },
  { brand: 'Google', aliases: ['GOOGLE LLC', 'GOOGLE INC', 'Alphabet Inc.'] },
  { brand: 'Microsoft', aliases: ['MICROSOFT CORPORATION', 'Microsoft Corp'] },
  { brand: 'Apple', aliases: ['APPLE INC', 'Apple Inc.'] },
  { brand: 'IBM', aliases: ['INTERNATIONAL BUSINESS MACHINES', 'IBM CORPORATION'] },
  { brand: 'JPMorgan Chase', aliases: ['JPMORGAN CHASE', 'JPMC', 'J.P. MORGAN'] },
  { brand: 'Oracle', aliases: ['ORACLE AMERICA INC', 'ORACLE CORPORATION'] },
  { brand: 'Salesforce', aliases: ['SALESFORCE INC', 'SALESFORCE.COM INC'] },
  { brand: 'Cisco', aliases: ['CISCO SYSTEMS INC'] },
  { brand: 'Intel', aliases: ['INTEL CORPORATION'] },
  { brand: 'NVIDIA', aliases: ['NVIDIA CORPORATION'] },
  { brand: 'Adobe', aliases: ['ADOBE INC', 'ADOBE SYSTEMS'] },
  { brand: 'Netflix', aliases: ['NETFLIX INC'] },
  { brand: 'Uber', aliases: ['UBER TECHNOLOGIES INC'] },
  { brand: 'Lyft', aliases: ['LYFT INC'] },
  { brand: 'Airbnb', aliases: ['AIRBNB INC'] },
  { brand: 'Stripe', aliases: ['STRIPE INC'] },
  { brand: 'Tesla', aliases: ['TESLA INC'] },
  { brand: 'Ford', aliases: ['FORD MOTOR COMPANY', 'FORD MOTOR'] },
  { brand: 'Toyota', aliases: ['TOYOTA MOTOR', 'TOYOTA MOTOR NORTH AMERICA', 'TMNA'] },
  { brand: 'Carrier', aliases: ['CARRIER CORPORATION', 'CARRIER GLOBAL'] },
];

function brandPayload(brandName: string, aliases: string[], source: 'seed' | 'auto' | 'admin') {
  const n = employerNameNormalize(brandName);
  const aliasList = Array.from(new Set([brandName, ...aliases].map((a) => a.trim()).filter(Boolean)));
  const aliasKeys = Array.from(
    new Set(aliasList.map((a) => employerNameNormalize(a).key).filter((k) => k.length >= 2))
  );
  return {
    brandName,
    brandNameNormalized: n.normalized,
    brandNameKey: n.key,
    aliases: aliasList,
    aliasKeys,
    source,
  };
}

export async function seedCompanyBrands(): Promise<{ upserted: number }> {
  let upserted = 0;
  const seen = new Map<string, { brand: string; aliases: Set<string> }>();

  for (const name of Object.values(DIRECTORY_CAREER_HTML_HOST_COMPANIES)) {
    const n = employerNameNormalize(name);
    if (!n.key) continue;
    const cur = seen.get(n.key) || { brand: name.replace(/\s+(Inc\.?|LLC|Corp\.?|Corporation)\.?$/i, '').trim() || name, aliases: new Set<string>() };
    cur.aliases.add(name);
    seen.set(n.key, cur);
  }

  for (const m of MANUAL_ALIASES) {
    const n = employerNameNormalize(m.brand);
    const cur = seen.get(n.key) || { brand: m.brand, aliases: new Set<string>() };
    cur.brand = m.brand;
    for (const a of m.aliases) cur.aliases.add(a);
    seen.set(n.key, cur);
  }

  const ops = [];
  for (const { brand, aliases } of seen.values()) {
    const payload = brandPayload(brand, [...aliases], 'seed');
    if (!payload.brandNameKey) continue;
    ops.push({
      updateOne: {
        filter: { brandNameKey: payload.brandNameKey },
        update: {
          $setOnInsert: {
            brandName: payload.brandName,
            brandNameNormalized: payload.brandNameNormalized,
            brandNameKey: payload.brandNameKey,
            source: 'seed',
          },
          $addToSet: {
            aliases: { $each: payload.aliases },
            aliasKeys: { $each: payload.aliasKeys },
          },
        },
        upsert: true,
      },
    });
    upserted += 1;
    if (ops.length >= 200) {
      await CompanyBrand.bulkWrite(ops as any, { ordered: false });
      ops.length = 0;
    }
  }
  if (ops.length) await CompanyBrand.bulkWrite(ops as any, { ordered: false });
  return { upserted };
}
