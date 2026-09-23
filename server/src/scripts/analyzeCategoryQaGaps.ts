/**
 * Deep-dive: why experience level / industry were skipped on Category QA cohort.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import mongoose from 'mongoose';
import JobBoardListing from '../models/JobBoardListing';
import { resolveFrozenExperience } from '../../../src/shared/frozenExperience';
import { resolveFrozenIndustries } from '../../../src/shared/frozenIndustries';
import { resolveIndustryFromTitle } from '../../../src/shared/roleIndustry';
import { isAggregatorListingSource } from '../services/aggregatorIdentity';
import { sanitizeCompanyName } from '../services/jobPageParser';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URL;
  if (!uri) throw new Error('MONGODB_URI missing');
  await mongoose.connect(
    uri,
    process.env.MONGODB_DATABASE ? { dbName: process.env.MONGODB_DATABASE } : undefined
  );

  const batchId = 'cat-qa-2026-09';
  const docs = await JobBoardListing.find({
    categoryQaBatchId: batchId,
    categoryQaPhase: { $in: ['backfilled', 'student_review'] },
  })
    .select(
      'jobTitle companyName source sectorIndustry location jobDescription seniorityLevel frozenCategories frozenIndustries frozenExperienceLevels frozenExperienceYears experienceClassification industryClassification categoryClassification listSnapshot studentEscape'
    )
    .lean();

  const levelDist: Record<string, number> = {};
  const yearsDist: Record<string, number> = {};
  const expNone: any[] = [];
  const industryNone: any[] = [];

  for (const d of docs as any[]) {
    const levels = d.frozenExperienceLevels || [];
    const years = d.frozenExperienceYears || [];
    const key = levels.length ? levels.join('|') : '(none)';
    levelDist[key] = (levelDist[key] || 0) + 1;
    const yk = years.length ? years.join('|') : '(none)';
    yearsDist[yk] = (yearsDist[yk] || 0) + 1;

    const list = d.listSnapshot || {};
    const title = String(d.jobTitle || list.jobTitle || '');
    const company = sanitizeCompanyName(String(d.companyName || list.companyName || ''));
    const description = String(d.jobDescription || list.jobDescription || '');
    const quals = [
      ...(d.minimumQualifications || list.minimumQualifications || []),
      ...(d.preferredQualifications || list.preferredQualifications || []),
    ]
      .map((x: unknown) => String(x || '').trim())
      .filter(Boolean);

    if (!levels.length && !years.length) {
      const re = resolveFrozenExperience({
        title,
        description: description.slice(0, 3000),
        qualifications: quals,
        seniorityLevel: String(d.seniorityLevel || list.seniorityLevel || ''),
        minYoe: null,
        maxYoe: Number(list.jobExperienceMax) > 0 ? Number(list.jobExperienceMax) : null,
        isAggregator: isAggregatorListingSource(String(d.source || '')),
      });
      expNone.push({
        title: title.slice(0, 80),
        company: company.slice(0, 40),
        source: d.source || 'career',
        descLen: description.length,
        seniorityBadge: d.seniorityLevel || list.seniorityLevel || '',
        specialty: d.frozenCategories || [],
        storedMethod: d.experienceClassification?.method || 'none',
        storedSignals: (d.experienceClassification?.matchedSignals || []).slice(0, 12),
        reResolve: {
          levels: re.frozenExperienceLevels,
          years: re.frozenExperienceYears,
          method: re.method,
          signals: re.matchedSignals.slice(0, 15),
        },
        why:
          re.method === 'none'
            ? 'no title seniority word, no YOE in text, no badge'
            : 'resolver would now fill — stale row or edge',
      });
    }

    if (!(d.frozenIndustries || []).length) {
      const sector = String(d.sectorIndustry || list.sectorIndustry || '');
      const role = resolveIndustryFromTitle(title);
      const full = resolveFrozenIndustries({
        sectorIndustry: sector,
        title,
        companyName: company,
        source: String(d.source || ''),
        isAggregator: isAggregatorListingSource(String(d.source || '')),
      });
      industryNone.push({
        title: title.slice(0, 80),
        company: company.slice(0, 40) || '(empty)',
        source: d.source || 'career',
        sector: sector.slice(0, 40) || '(empty)',
        specialty: d.frozenCategories || [],
        specialtyOk: (d.frozenCategories || []).length > 0,
        roleHint: role,
        fullResolve: { industries: full.frozenIndustries, method: full.method },
        why:
          !company && !sector && !role.method
            ? 'no sector, empty/unknown company, title has no industry pattern'
            : !full.frozenIndustries.length
              ? 'title/company not in industry maps'
              : 'would resolve now',
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        total: docs.length,
        taxonomyNote:
          'Controlled levels are ONLY: Entry Level, Mid-Senior Level, Senior Level, People Manager Level, Leadership Level. There is NO Mid-Entry Level label.',
        levelDistribution: levelDist,
        yearsDistribution: yearsDist,
        experienceSkipped: { count: expNone.length, rows: expNone },
        industrySkipped: { count: industryNone.length, rows: industryNone },
      },
      null,
      2
    )
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
