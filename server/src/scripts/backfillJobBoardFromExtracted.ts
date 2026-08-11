/**
 * One-time backfill: enqueue existing `maxun_extracteddata` rows into `maxun_job_board`.
 * Dedup + completeness gate apply the same as live scraper runs.
 *
 * Usage (from repo root, with enrichment worker running separately):
 *   npx ts-node --project server/tsconfig.json server/src/scripts/backfillJobBoardFromExtracted.ts
 *
 * Optional:
 *   BACKFILL_LIMIT=5000   — max ExtractedData docs to scan (default: all)
 *   BACKFILL_OWNER_ID=…   — only robots owned by this userId
 *
 * Requires MONGODB_URI in .env. Start `npm run worker:enrichment:dev` so queued
 * URLs actually get scrape.do / ATS enrichment after enqueue.
 */
import path from 'path';
import dotenv from 'dotenv';
import { applyConfiguredDnsServers } from '../utils/dnsConfig';

dotenv.config();
dotenv.config({ path: path.join(__dirname, '../../../.env') });
applyConfiguredDnsServers();

import mongoose from 'mongoose';
import ExtractedData from '../models/ExtractedData';
import Robot from '../models/Robot';
import { enqueueJobBoardEnrichments } from '../services/jobBoardEnrichment';
import { normalizeOwnerIdForWrite, ownerIdFilter } from '../utils/ownerId';

const BATCH = 200;

async function main() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('MONGODB_URI is not set.');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log('Connected. Scanning maxun_extracteddata…');

  const ownerFilter = process.env.BACKFILL_OWNER_ID
    ? ownerIdFilter(process.env.BACKFILL_OWNER_ID)
    : null;

  const robots = await Robot.find(ownerFilter || {})
    .select('userId recording_meta.id')
    .lean();

  const ownerByRobot = new Map<string, string>();
  for (const r of robots as any[]) {
    const id = r.recording_meta?.id;
    if (!id) continue;
    ownerByRobot.set(id, normalizeOwnerIdForWrite(r.userId));
  }

  const robotIds = Array.from(ownerByRobot.keys());
  if (robotIds.length === 0) {
    console.log('No robots found for backfill.');
    await mongoose.disconnect();
    return;
  }

  const limit = parseInt(process.env.BACKFILL_LIMIT || '0', 10);
  const query: Record<string, any> = {
    robotMetaId: { $in: robotIds },
    $or: [
      { 'data.jobUrl': { $exists: true, $nin: [null, ''] } },
      { 'data.url': { $exists: true, $nin: [null, ''] } },
      { 'data.link': { $exists: true, $nin: [null, ''] } },
      { 'data.job_url': { $exists: true, $nin: [null, ''] } },
    ],
  };

  const total = await ExtractedData.countDocuments(query);
  console.log(`Extracted rows with URLs: ${total}${limit > 0 ? ` (limit ${limit})` : ''}`);

  let scanned = 0;
  let enqueuedBatches = 0;
  const totals = {
    considered: 0,
    skippedNoUrl: 0,
    skippedDedup: 0,
    skippedComplete: 0,
    queued: 0,
    readyFromList: 0,
    expiredSkipped: 0,
  };

  // Group by ownerId + robotMetaId + runId for enqueueJobBoardEnrichments
  type Bucket = { ownerId: string; robotMetaId: string; runId: string; rows: { data: any }[] };
  let bucket: Bucket | null = null;

  const flush = async () => {
    if (!bucket || bucket.rows.length === 0) return;
    const stats = await enqueueJobBoardEnrichments({
      ownerId: bucket.ownerId,
      robotMetaId: bucket.robotMetaId,
      runId: bucket.runId,
      rows: bucket.rows,
    });
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) {
      totals[k] += stats[k];
    }
    enqueuedBatches += 1;
    bucket.rows = [];
  };

  const cursor = ExtractedData.find(query)
    .select('runId robotMetaId data')
    .sort({ createdAt: 1 })
    .cursor();

  for await (const doc of cursor) {
    if (limit > 0 && scanned >= limit) break;
    scanned += 1;

    const robotMetaId = String(doc.robotMetaId || '');
    const ownerId = ownerByRobot.get(robotMetaId);
    if (!ownerId) continue;

    const runId = String(doc.runId || `backfill-${robotMetaId}`);
    const key = `${ownerId}|${robotMetaId}|${runId}`;

    if (!bucket || `${bucket.ownerId}|${bucket.robotMetaId}|${bucket.runId}` !== key) {
      await flush();
      bucket = { ownerId, robotMetaId, runId, rows: [] };
    }

    bucket.rows.push({ data: doc.data || {} });
    if (bucket.rows.length >= BATCH) {
      await flush();
      bucket = { ownerId, robotMetaId, runId, rows: [] };
    }

    if (scanned % 1000 === 0) {
      console.log(`… scanned ${scanned}/${total}`);
    }
  }

  await flush();

  console.log('\nBackfill enqueue complete:');
  console.log(`  scanned:          ${scanned}`);
  console.log(`  batches:          ${enqueuedBatches}`);
  console.log(`  considered:       ${totals.considered}`);
  console.log(`  queued (need scrape.do/ATS): ${totals.queued}`);
  console.log(`  ready from list:  ${totals.readyFromList}`);
  console.log(`  skipped dedup:    ${totals.skippedDedup}  ← already on board (unique jobUrlKey)`);
  console.log(`  skipped no URL:   ${totals.skippedNoUrl}`);
  console.log(`  expired skipped:  ${totals.expiredSkipped}`);
  console.log('\nDedup: one board card per normalized listing URL (unique index).');
  console.log('Keep `npm run worker:enrichment:dev` running to process the queued URLs.');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
