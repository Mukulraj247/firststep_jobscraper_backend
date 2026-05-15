/**
 * One-time backfill: normalize `maxun_extracteddata` documents to canonical `data` shape + jobId.
 *
 * Usage (from repo root):
 *   npx ts-node --project server/tsconfig.json server/src/scripts/migrateExtractedCanonical.ts
 *
 * Requires MONGODB_URI in .env
 */
import path from 'path';
import dotenv from 'dotenv';
import { setServers as setDnsServers } from 'dns';

/** Same as server/src/storage/db.ts — avoids `querySrv ECONNREFUSED` on some Windows/resolver setups for Atlas SRV. */
dotenv.config();
dotenv.config({ path: path.join(__dirname, '../../../.env') });
setDnsServers(['8.8.8.8', '1.1.1.1']);

import mongoose from 'mongoose';
import ExtractedData from '../models/ExtractedData';
import Robot from '../models/Robot';
import {
  applyColumnOverrides,
  getAutomationConfig,
  mergeRowContextIntoRowData,
  normalizeMisalignedJobBoardRow,
  shouldKeepExtractedJobRow,
} from '../services/automation';
import {
  applyLegacyJobAliases,
  buildCanonicalJobDataSync,
  hasCanonicalExtractedShape,
} from '../services/canonicalJobRecord';
import { reserveStructuredJobIdsForRows } from '../services/jobIdGenerator';

const BATCH = 250;

const robotCache = new Map<string, Record<string, unknown> | null>();

async function getRobotLean(robotMetaId: string): Promise<Record<string, unknown> | null> {
  if (!robotCache.has(robotMetaId)) {
    const r = await Robot.findOne({ 'recording_meta.id': robotMetaId }).lean();
    robotCache.set(robotMetaId, r as any);
  }
  return robotCache.get(robotMetaId) ?? null;
}

async function main() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('MONGODB_URI is not set (load .env from repo root or set the variable).');
    process.exit(1);
  }
  await mongoose.connect(mongoUri);
  const filter = {
    $or: [
      { 'data.job_creation_type': { $ne: 'automation' } },
      { 'data.jobId': { $exists: false } },
      { 'data.jobId': '' },
    ],
  };

  const total = await ExtractedData.countDocuments(filter);
  console.log(`Documents to migrate: ${total}`);

  let migrated = 0;
  let skipped = 0;
  let skippedJunk = 0;
  const cursor = ExtractedData.find(filter).cursor();

  let batch: any[] = [];
  for await (const doc of cursor) {
    if (hasCanonicalExtractedShape(doc.data)) {
      skipped += 1;
      continue;
    }
    // Skip non-job rows (cookie banners, pagination, privacy pages, etc.) — they
    // stay as legacy documents without `data.status`, so the downstream n8n
    // pending→jobs workflow ignores them.
    const aliased = applyLegacyJobAliases({ ...(doc.data ?? {}) });
    if (!shouldKeepExtractedJobRow(aliased)) {
      skippedJunk += 1;
      continue;
    }
    batch.push(doc);
    if (batch.length >= BATCH) {
      await flushBatch(batch);
      migrated += batch.length;
      console.log(
        `Migrated ${migrated} (already-canonical: ${skipped}, junk: ${skippedJunk})`
      );
      batch = [];
    }
  }
  if (batch.length > 0) {
    await flushBatch(batch);
    migrated += batch.length;
  }

  console.log(
    `Done. Migrated ${migrated} documents; skipped ${skipped} already-canonical; skipped ${skippedJunk} junk rows.`
  );
  await mongoose.disconnect();
}

async function flushBatch(docs: any[]) {
  const fallbackDate = new Date();
  const mergedList: Record<string, any>[] = [];
  const prevStatuses: string[] = [];

  for (const doc of docs) {
    const raw = (doc.data && typeof doc.data === 'object' ? doc.data : {}) as Record<string, unknown>;
    const prevStatus = typeof raw.status === 'string' ? raw.status.trim() : '';
    prevStatuses.push(prevStatus);

    const robot = await getRobotLean(String(doc.robotMetaId));
    const cfg = getAutomationConfig(robot);
    const merged = mergeRowContextIntoRowData(
      applyColumnOverrides(
        normalizeMisalignedJobBoardRow(applyLegacyJobAliases({ ...raw })),
        cfg.columnOverrides
      ),
      cfg.rowContext
    );
    mergedList.push(merged);
  }

  const jobIds = await reserveStructuredJobIdsForRows(
    mergedList.map((merged, i) => ({
      jobTitle: String(merged.jobTitle ?? ''),
      date: docs[i].createdAt ? new Date(docs[i].createdAt) : fallbackDate,
    }))
  );

  const bulk = docs.map((doc, i) => {
    const merged = mergedList[i]!;
    const jobId = jobIds[i]!;
    const prev = prevStatuses[i]!;
    const canonical = buildCanonicalJobDataSync(merged as Record<string, unknown>, {
      createdAt: doc.createdAt ? new Date(doc.createdAt) : fallbackDate,
      jobId,
      insertDefaults: true,
    });
    if (prev === 'active' || prev === 'started') {
      canonical.status = prev;
    }
    return {
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { data: canonical } },
      },
    };
  });

  if (bulk.length > 0) {
    await ExtractedData.bulkWrite(bulk, { ordered: false });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
