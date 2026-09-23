/**
 * One-shot analysis of Category QA backfilled cohort.
 * Run: npx ts-node --project server/tsconfig.json server/src/scripts/analyzeCategoryQaCohort.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import mongoose from 'mongoose';
import JobBoardListing from '../models/JobBoardListing';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URL;
  if (!uri) throw new Error('MONGODB_URI missing');
  await mongoose.connect(
    uri,
    process.env.MONGODB_DATABASE ? { dbName: process.env.MONGODB_DATABASE } : undefined
  );

  const batchId = String(process.argv[2] || 'cat-qa-2026-09');
  const docs = await JobBoardListing.find({
    categoryQaBatchId: batchId,
    categoryQaPhase: { $in: ['backfilled', 'student_review'] },
  })
    .select(
      'jobTitle companyName source sectorIndustry location remoteType frozenCategories frozenIndustries frozenExperienceLevels frozenExperienceYears frozenStates locationIsRemote locationIsUs locationClassification industryClassification experienceClassification categoryClassification h1bEligible h1bCompanyScore h1bMappingStatus h1bFy2026Match studentEscape categoryQaPhase listSnapshot'
    )
    .lean();

  const n = docs.length;
  const miss = {
    specialty: [] as any[],
    industry: [] as any[],
    experience: [] as any[],
    location: [] as any[],
    h1b: [] as any[],
  };
  const industryMethods: Record<string, number> = {};
  const locMethods: Record<string, number> = {};
  const expMethods: Record<string, number> = {};
  const catMethods: Record<string, number> = {};
  const h1bScore: Record<string, number> = {};
  const h1bMap: Record<string, number> = {};
  let students = 0;
  let h1bSponsorFriendly = 0;
  let h1bEligible = 0;

  for (const d of docs as any[]) {
    if (d.studentEscape) students += 1;
    const cats = d.frozenCategories || [];
    const inds = d.frozenIndustries || [];
    const levels = d.frozenExperienceLevels || [];
    const years = d.frozenExperienceYears || [];
    const states = d.frozenStates || [];
    const im = d.industryClassification?.method || 'none';
    const lm = d.locationClassification?.method || 'none';
    const em = d.experienceClassification?.method || 'none';
    const cm = d.categoryClassification?.method || (cats.length ? 'tagged' : 'empty');
    industryMethods[im] = (industryMethods[im] || 0) + 1;
    locMethods[lm] = (locMethods[lm] || 0) + 1;
    expMethods[em] = (expMethods[em] || 0) + 1;
    catMethods[cm] = (catMethods[cm] || 0) + 1;

    const score = d.h1bCompanyScore || 'unknown';
    const map = d.h1bMappingStatus || 'none';
    h1bScore[score] = (h1bScore[score] || 0) + 1;
    h1bMap[map] = (h1bMap[map] || 0) + 1;
    if (d.h1bEligible) h1bEligible += 1;
    if (
      d.h1bEligible &&
      score === 'high' &&
      (map === 'auto' || map === 'approved')
    ) {
      h1bSponsorFriendly += 1;
    }

    const row = {
      title: String(d.jobTitle || '').slice(0, 70),
      company: String(d.companyName || '').slice(0, 40),
      source: d.source || 'career',
      sector: String(d.sectorIndustry || d.listSnapshot?.sectorIndustry || '').slice(0, 50),
      loc: String(d.location || '').slice(0, 60),
      remote: d.remoteType || '',
      im,
      lm,
      em,
      h1b: `${d.h1bEligible}/${score}/${map}`,
    };
    if (!cats.length) miss.specialty.push(row);
    if (!inds.length) miss.industry.push(row);
    if (!levels.length && !years.length) miss.experience.push(row);
    if (!states.length && !d.locationIsRemote && d.locationIsUs !== false) {
      miss.location.push(row);
    }
    if (score === 'unknown' || map === 'none') {
      miss.h1b.push({ ...row, eligible: Boolean(d.h1bEligible) });
    }
  }

  const pct = (x: number) => (n ? Math.round((x / n) * 1000) / 10 : 0);
  console.log(
    JSON.stringify(
      {
        total: n,
        students,
        h1bEligible,
        h1bSponsorFriendly,
        missingCounts: {
          specialty: miss.specialty.length,
          industry: miss.industry.length,
          experience: miss.experience.length,
          location: miss.location.length,
          h1bStampIncomplete: miss.h1b.length,
        },
        missingPct: {
          specialty: pct(miss.specialty.length),
          industry: pct(miss.industry.length),
          experience: pct(miss.experience.length),
          location: pct(miss.location.length),
          h1bStampIncomplete: pct(miss.h1b.length),
        },
        methods: {
          category: catMethods,
          industry: industryMethods,
          experience: expMethods,
          location: locMethods,
          h1bScore,
          h1bMap,
        },
        samples: {
          specialty: miss.specialty.slice(0, 15),
          industry: miss.industry.slice(0, 15),
          experience: miss.experience.slice(0, 10),
          location: miss.location.slice(0, 15),
          h1b: miss.h1b.slice(0, 10),
        },
      },
      null,
      2
    )
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
