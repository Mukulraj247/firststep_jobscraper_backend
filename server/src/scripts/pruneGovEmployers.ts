/**
 * Free Atlas space: raise min-certified floor on h1b_gov_employers + drop text index.
 * Usage: npx ts-node --project server/tsconfig.json server/src/scripts/pruneGovEmployers.ts
 * Env: H1B_MIN_CERTIFIED (default 15)
 */
import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';
import GovEmployer from '../models/GovEmployer';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const uri = process.env.DB_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI required');
  await mongoose.connect(uri);

  const min = parseInt(process.env.H1B_MIN_CERTIFIED || '15', 10);
  const before = await GovEmployer.estimatedDocumentCount();
  const del = await GovEmployer.deleteMany({ certifiedCount: { $lt: min } });
  console.log(`[prune] before≈${before} deleted=${del.deletedCount} keepCertified>=${min}`);

  try {
    await GovEmployer.collection.dropIndex('employerNameDisplay_text_employerNameNormalized_text');
    console.log('[prune] dropped text index');
  } catch (e: any) {
    console.log('[prune] text index drop:', e?.message || e);
  }

  // Compact is Atlas-only / may need admin; try collStats
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection.db unavailable after connect');
  const stats = await db.command({ collStats: 'h1b_gov_employers' });
  console.log(
    `[prune] h1b_gov_employers count=${stats.count} sizeMB=${(stats.size / 1e6).toFixed(1)} storageMB=${(stats.storageSize / 1e6).toFixed(1)}`
  );

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
