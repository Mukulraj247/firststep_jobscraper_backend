/**
 * One-shot data retention against MONGODB_URI from repo .env.
 *
 * Usage:
 *   npm run retention:once              # uses RETENTION_DRY_RUN from .env
 *   npm run retention:once -- --dry-run
 *   npm run retention:once -- --live
 */
import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';
import { getRetentionSettings, runDataRetention } from '../services/dataRetention';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--dry-run')) process.env.RETENTION_DRY_RUN = 'true';
  if (args.includes('--live')) process.env.RETENTION_DRY_RUN = 'false';

  const uri = process.env.DB_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('Missing MONGODB_URI / DB_URL');
    process.exit(1);
  }

  const settings = getRetentionSettings();
  console.log('[retention:once] settings', {
    dryRun: settings.dryRun,
    successDays: settings.successDays,
    failureDays: settings.failureDays,
    extractedOrphanDays: settings.extractedOrphanDays,
    jobBoardDays: settings.jobBoardDays,
    batchSize: settings.batchSize,
  });

  await mongoose.connect(uri);
  try {
    const summary = await runDataRetention(new Date(), settings);
    console.log('[retention:once] summary', summary);

    // Probe whether Atlas accepts writes again.
    const probe = await mongoose.connection.db!.collection('scoutx_portal_users').insertOne({
      auth0Sub: `retention-probe|${Date.now()}`,
      email: `retention-probe-${Date.now()}@example.com`,
      name: 'retention-probe',
      scoutxRoles: ['ScoutX_User'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await mongoose.connection.db!.collection('scoutx_portal_users').deleteOne({ _id: probe.insertedId });
    console.log('[retention:once] write probe OK — Atlas accepts inserts');
  } catch (err: any) {
    console.error('[retention:once] failed:', err?.message || err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

void main();
