/**
 * Analyze cat-qa-ui-sample: missing specialty/industry/experience/location
 * and whether evidence exists in the job (fixable) vs true empty (OK).
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import mongoose from 'mongoose';
import JobBoardListing from '../models/JobBoardListing';
import { resolveFrozenExperience, extractExperienceYears } from '../../../src/shared/frozenExperience';
import { resolveFrozenIndustries } from '../../../src/shared/frozenIndustries';
import { resolveIndustryFromTitle } from '../../../src/shared/roleIndustry';
import { classifyJobLocation } from '../../../src/shared/frozenLocations';
import { sanitizeCompanyName } from '../services/jobPageParser';
import { isAggregatorListingSource } from '../services/aggregatorIdentity';
import { CATEGORY_QA_UI_BATCH_ID } from '../services/categoryQaSample';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

type Bucket = 'ok_empty' | 'fixable' | 'stale_or_edge';

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URL;
  if (!uri) throw new Error('MONGODB_URI missing');
  await mongoose.connect(
    uri,
    process.env.MONGODB_DATABASE ? { dbName: process.env.MONGODB_DATABASE } : undefined
  );

  const docs = await JobBoardListing.find({ categoryQaBatchId: CATEGORY_QA_UI_BATCH_ID })
    .select(
      'jobTitle companyName source sectorIndustry location remoteType jobDescription seniorityLevel frozenCategories frozenIndustries frozenExperienceLevels frozenExperienceYears frozenStates locationIsRemote locationIsUs locationClassification industryClassification experienceClassification categoryClassification h1bEligible h1bCompanyScore h1bMappingStatus studentEscape categoryQaPhase listSnapshot'
    )
    .lean();

  const miss = {
    specialty: [] as any[],
    industry: [] as any[],
    experience: [] as any[],
    location: [] as any[],
  };

  const levelDist: Record<string, number> = {};
  let filledSpecialty = 0;
  let filledIndustry = 0;
  let filledExp = 0;
  let filledLoc = 0;

  for (const d of docs as any[]) {
    const list = d.listSnapshot || {};
    const title = String(d.jobTitle || list.jobTitle || '');
    const company = sanitizeCompanyName(String(d.companyName || list.companyName || ''));
    const description = String(d.jobDescription || list.jobDescription || '');
    const location = String(d.location || list.location || '');
    const remoteType = String(d.remoteType || list.remoteType || '');
    const sector = String(d.sectorIndustry || list.sectorIndustry || '');
    const badge = String(d.seniorityLevel || list.seniorityLevel || '');
    const cats = d.frozenCategories || [];
    const inds = d.frozenIndustries || [];
    const levels = d.frozenExperienceLevels || [];
    const years = d.frozenExperienceYears || [];
    const states = d.frozenStates || [];

    const lk = levels[0] || '(none)';
    levelDist[lk] = (levelDist[lk] || 0) + 1;

    if (cats.length) filledSpecialty += 1;
    if (inds.length) filledIndustry += 1;
    if (levels.length || years.length) filledExp += 1;
    if (states.length || d.locationIsRemote || d.locationIsUs === false) filledLoc += 1;

    const base = {
      title: title.slice(0, 85),
      company: company || '(empty)',
      source: d.source || 'career',
      descLen: description.length,
      location: location.slice(0, 60) || '(empty)',
      remoteType: remoteType || '(empty)',
      sector: sector.slice(0, 40) || '(empty)',
      badge: badge || '(none)',
      specialty: cats,
    };

    if (!cats.length) {
      // Specialty comes from tagger — empty usually means weak title/desc or tagger miss
      const looksTaggable =
        /\b(engineer|developer|analyst|manager|director|nurse|sales|architect|scientist|designer|intern)\b/i.test(
          title
        ) && (description.length > 200 || title.length > 8);
      miss.specialty.push({
        ...base,
        bucket: looksTaggable ? 'fixable' : 'ok_empty',
        why: looksTaggable
          ? 'Title looks taggable but specialty empty — tagger miss / rules gap'
          : 'Thin or non-role title — empty specialty OK',
      });
    }

    if (!inds.length) {
      const role = resolveIndustryFromTitle(title);
      const full = resolveFrozenIndustries({
        sectorIndustry: sector,
        title,
        companyName: company,
        source: String(d.source || ''),
        isAggregator: isAggregatorListingSource(String(d.source || '')),
      });
      let bucket: Bucket = 'ok_empty';
      let why = 'No sector, unknown company map, no title industry pattern — OK empty';
      if (full.frozenIndustries.length) {
        bucket = 'stale_or_edge';
        why = `Would resolve now to ${full.frozenIndustries.join(', ')} (${full.method})`;
      } else if (sector) {
        bucket = 'fixable';
        why = `Has sectorIndustry="${sector}" but did not canonicalize`;
      } else if (company && company !== '(empty)') {
        bucket = 'fixable';
        why = `Known company string "${company}" not in industry company map; title hint=${role.method || 'none'}`;
      }
      miss.industry.push({ ...base, bucket, why, wouldBe: full.frozenIndustries });
    }

    if (!levels.length && !years.length) {
      const yoe = extractExperienceYears(description.slice(0, 8000));
      const re = resolveFrozenExperience({
        title,
        description,
        seniorityLevel: badge,
        minYoe: null,
        maxYoe: Number(list.jobExperienceMax) > 0 ? Number(list.jobExperienceMax) : null,
      });
      let bucket: Bucket = 'ok_empty';
      let why = 'No seniority word, no YOE, no badge — correctly empty';
      if (re.frozenExperienceLevels.length) {
        bucket = 'stale_or_edge';
        why = `Resolver would now set ${re.frozenExperienceLevels.join(', ')} (${re.method})`;
      } else if (yoe.years.length || yoe.ranges.length) {
        bucket = 'fixable';
        why = `YOE found in text (${JSON.stringify(yoe.years.slice(0, 3))}) but level still empty — scoring gap`;
      } else if (badge) {
        bucket = 'fixable';
        why = `Has seniority badge "${badge}" but level empty`;
      }
      miss.experience.push({
        ...base,
        bucket,
        why,
        wouldBe: re.frozenExperienceLevels,
        yoeYears: yoe.years.slice(0, 4),
      });
    }

    if (!states.length && !d.locationIsRemote && d.locationIsUs !== false) {
      const loc = classifyJobLocation({
        location,
        remoteType,
        companyName: company,
      });
      let bucket: Bucket = 'ok_empty';
      let why = 'No location/remote text — correctly empty';
      if (loc.frozenStates.length || loc.locationIsRemote || loc.locationIsUs === false) {
        bucket = 'stale_or_edge';
        why = `Would resolve now states=${loc.frozenStates.join(',')} method=${loc.method}`;
      } else if (location || remoteType) {
        bucket = 'fixable';
        why = `Has location/remote text but classifier returned ${loc.method}`;
      }
      miss.location.push({
        ...base,
        bucket,
        why,
        wouldBe: { states: loc.frozenStates, method: loc.method, remote: loc.locationIsRemote },
      });
    }
  }

  const summarize = (rows: any[]) => {
    const by: Record<string, number> = { ok_empty: 0, fixable: 0, stale_or_edge: 0 };
    for (const r of rows) by[r.bucket] = (by[r.bucket] || 0) + 1;
    return {
      total: rows.length,
      byBucket: by,
      fixableSamples: rows.filter((r) => r.bucket === 'fixable').slice(0, 12),
      staleSamples: rows.filter((r) => r.bucket === 'stale_or_edge').slice(0, 8),
      okEmptySamples: rows.filter((r) => r.bucket === 'ok_empty').slice(0, 5),
    };
  };

  console.log(
    JSON.stringify(
      {
        batchId: CATEGORY_QA_UI_BATCH_ID,
        total: docs.length,
        filled: {
          specialty: filledSpecialty,
          industry: filledIndustry,
          experience: filledExp,
          location: filledLoc,
        },
        missingPct: {
          specialty: pct(docs.length - filledSpecialty, docs.length),
          industry: pct(docs.length - filledIndustry, docs.length),
          experience: pct(docs.length - filledExp, docs.length),
          location: pct(docs.length - filledLoc, docs.length),
        },
        levelDistribution: levelDist,
        specialty: summarize(miss.specialty),
        industry: summarize(miss.industry),
        experience: summarize(miss.experience),
        location: summarize(miss.location),
      },
      null,
      2
    )
  );
  await mongoose.disconnect();
}

function pct(n: number, d: number) {
  return d ? Math.round((n / d) * 1000) / 10 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
