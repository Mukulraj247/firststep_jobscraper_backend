/**
 * Seed company brands → auto-map gov employers → build sponsorship profiles.
 *
 * Usage:
 *   npx ts-node --project server/tsconfig.json server/src/scripts/seedAndMapH1b.ts
 *
 * Env:
 *   H1B_MAP_LIMIT — optional cap on gov employers processed (for dry runs)
 */
import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';
import { seedCompanyBrands } from '../services/h1b/seedCompanyBrands';
import { runAutoEmployerBrandMapping } from '../services/h1b/employerBrandMatcher';
import { buildSponsorshipProfiles } from '../services/h1b/buildSponsorshipProfiles';
import JobBoardListing from '../models/JobBoardListing';
import CompanyBrand from '../models/CompanyBrand';
import { employerNameNormalize } from '../services/h1b/employerNameNormalize';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function seedBrandsFromBoard(): Promise<number> {
  const rows = await JobBoardListing.aggregate([
    { $match: { companyName: { $exists: true, $ne: '' } } },
    { $group: { _id: '$companyName', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: 2000 },
  ]);

  let upserted = 0;
  const ops: any[] = [];
  for (const row of rows) {
    const brandName = String(row._id || '').trim();
    if (!brandName) continue;
    const n = employerNameNormalize(brandName);
    if (!n.key || n.key.length < 2) continue;
    ops.push({
      updateOne: {
        filter: { brandNameKey: n.key },
        update: {
          $setOnInsert: {
            brandName,
            brandNameNormalized: n.normalized,
            brandNameKey: n.key,
            source: 'auto',
          },
          $addToSet: {
            aliases: brandName,
            aliasKeys: n.key,
          },
        },
        upsert: true,
      },
    });
    upserted += 1;
    if (ops.length >= 200) {
      await CompanyBrand.bulkWrite(ops, { ordered: false });
      ops.length = 0;
    }
  }
  if (ops.length) await CompanyBrand.bulkWrite(ops, { ordered: false });
  return upserted;
}

async function main() {
  const uri = process.env.DB_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('DB_URL / MONGODB_URI required');
  await mongoose.connect(uri);
  console.log('[h1b] connected');

  const seed = await seedCompanyBrands();
  console.log(`[h1b] seed brands (hosts/manual): ${seed.upserted}`);

  const board = await seedBrandsFromBoard();
  console.log(`[h1b] seed brands (board companies): ${board}`);

  const limitEnv = process.env.H1B_MAP_LIMIT;
  const limit = limitEnv ? parseInt(limitEnv, 10) : undefined;
  const mapped = await runAutoEmployerBrandMapping({
    limit: Number.isFinite(limit as number) ? (limit as number) : undefined,
  });
  console.log(
    `[h1b] auto-map: autoApproved=${mapped.autoApproved} pendingReview=${mapped.pendingReview} skipped=${mapped.skipped}`
  );

  const profiles = await buildSponsorshipProfiles();
  console.log(`[h1b] sponsorship profiles: ${profiles.upserted}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
