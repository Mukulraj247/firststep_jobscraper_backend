/**
 * Coverage report for frozen taxonomies (categories / industries / experience).
 *
 *   npx ts-node --project server/tsconfig.json \
 *     server/src/scripts/countFrozenTags.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import mongoose from 'mongoose';
import JobBoardListing from '../models/JobBoardListing';
import { INDUSTRY_RULES_VERSION } from '../../../src/shared/frozenIndustries';
import { EXPERIENCE_RULES_VERSION } from '../../../src/shared/frozenExperience';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const BOARD = { status: { $in: ['ready', 'partial'] } };

async function methodBreakdown(field: string) {
  return JobBoardListing.aggregate([
    { $match: BOARD },
    { $group: { _id: `$${field}`, n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URL;
  if (!uri) throw new Error('MONGODB_URI missing');
  await mongoose.connect(
    uri,
    process.env.MONGODB_DATABASE ? { dbName: process.env.MONGODB_DATABASE } : undefined
  );

  const ready = await JobBoardListing.countDocuments(BOARD);

  const [
    withCategories,
    withIndustries,
    industryStamped,
    withExperienceLevel,
    withExperienceYears,
    experienceStamped,
  ] = await Promise.all([
    JobBoardListing.countDocuments({ ...BOARD, frozenCategories: { $nin: [null, []] } }),
    JobBoardListing.countDocuments({ ...BOARD, frozenIndustries: { $nin: [null, []] } }),
    JobBoardListing.countDocuments({
      ...BOARD,
      'industryClassification.rulesVersion': INDUSTRY_RULES_VERSION,
    }),
    JobBoardListing.countDocuments({ ...BOARD, frozenExperienceLevels: { $nin: [null, []] } }),
    JobBoardListing.countDocuments({ ...BOARD, frozenExperienceYears: { $nin: [null, []] } }),
    JobBoardListing.countDocuments({
      ...BOARD,
      'experienceClassification.rulesVersion': EXPERIENCE_RULES_VERSION,
    }),
  ]);

  const [industryMethods, experienceMethods] = await Promise.all([
    methodBreakdown('industryClassification.method'),
    methodBreakdown('experienceClassification.method'),
  ]);

  console.log(
    JSON.stringify(
      {
        ready,
        categories: { tagged: withCategories },
        industries: {
          tagged: withIndustries,
          stamped: industryStamped,
          unstamped: ready - industryStamped,
          rules: INDUSTRY_RULES_VERSION,
          methods: industryMethods,
        },
        experience: {
          levels: withExperienceLevel,
          years: withExperienceYears,
          stamped: experienceStamped,
          unstamped: ready - experienceStamped,
          rules: EXPERIENCE_RULES_VERSION,
          methods: experienceMethods,
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
