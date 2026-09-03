/**
 * Re-queue all Hiring Cafe aggregator scouts for a fresh run after flow changes.
 *
 *   npx tsx server/src/scripts/requeueHiringCafeAggregators.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { randomUUID } from 'crypto';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const HC_SCOUTS = [
  'SX89DB16',
  'SX08OB79',
  'SX97ZO56',
  'SX03FI86',
  'SX83ZW96',
  'SX50JO11',
  'SX98UC04',
];

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URL;
  if (!uri) throw new Error('MONGODB_URI missing');
  await mongoose.connect(uri, process.env.MONGODB_DATABASE ? { dbName: process.env.MONGODB_DATABASE } : undefined);

  await import('../models/Run');
  await import('../models/Robot');
  const { runAdmission } = await import('../services/runAdmission');

  const db = mongoose.connection.db!;
  const robots = await db
    .collection('maxun_robots')
    .find({ 'recording_meta.scoutId': { $in: HC_SCOUTS } })
    .project({
      userId: 1,
      'recording_meta.id': 1,
      'recording_meta.name': 1,
      'recording_meta.scoutId': 1,
      schedule: 1,
    })
    .toArray();

  const byScout = new Map(robots.map((r) => [String(r.recording_meta?.scoutId || ''), r]));
  let queued = 0;

  for (const scoutId of HC_SCOUTS) {
    const robot = byScout.get(scoutId);
    if (!robot) {
      console.log(`skip ${scoutId}: not found`);
      continue;
    }
    if (robot.schedule?.enabled === false) {
      console.log(`skip ${scoutId}: schedule disabled`);
      continue;
    }
    const meta = robot.recording_meta || {};
    const robotMetaId = String(meta.id || '');
    const latest = await db
      .collection('maxun_runs')
      .find({ robotMetaId })
      .sort({ startedAt: -1, _id: -1 })
      .limit(1)
      .next();
    if (!latest) {
      console.log(`skip ${scoutId}: no prior run`);
      continue;
    }
    const status = String(latest.status || '');
    if (['queued', 'running', 'pending', 'scheduled'].includes(status)) {
      console.log(`skip ${scoutId}: in-flight (${status})`);
      continue;
    }
    const sourceRunId = String(latest.runId || '');
    if (!sourceRunId) {
      console.log(`skip ${scoutId}: missing runId`);
      continue;
    }
    try {
      const result = await runAdmission.admitRetry({
        ownerId: String(robot.userId),
        runId: sourceRunId,
        requestKey: `hc-direct-first-${scoutId}-${randomUUID()}`,
      });
      console.log(
        `queued ${scoutId} ${meta.name} from ${status}/${latest.rowsExtracted ?? 0} =>`,
        result?.created
      );
      queued += 1;
    } catch (err: any) {
      console.log(`fail ${scoutId}:`, err?.message || err);
    }
  }

  await mongoose.disconnect();
  console.log(`Done. Queued ${queued}/${HC_SCOUTS.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
