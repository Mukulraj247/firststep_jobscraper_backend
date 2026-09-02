/**
 * Re-queue latest terminal runs for named scoutIds via runAdmission.admitRetry.
 * Processes TARGETS in order; stops at REQUEUE_LIMIT successes.
 *
 *   REQUEUE_LIMIT=8 npx tsx server/src/scripts/requeueFailedAutomations.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { randomUUID } from 'crypto';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const TARGETS = [
  // HC flaky (proxy) + Travelers regression
  'SX89DB16',
  'SX08OB79',
  'SX97ZO56',
  'SX83ZW96',
  'SX50JO11',
  'SX70ZR44',
  // Remaining / weak (do not include hard-disabled: SX87GN40, SX22HT46, SX84JF46, SX88MN90)
  'SX18PK93',
  'SX56SV68',
  'SX23RB71',
  'SX54FF90',
  'SX39UK68',
  // Aggregators first
  'SX38OI10',
  'SX22TD45',
  'SX53DX88',
  'SX03FI86',
  'SX98UC04',
  // Wave 0 ATS
  'SX90VB06',
  'SX52FM08',
  'SX01BV85',
  'SX04TY90',
  'SX99TA51',
  'SX16FA25',
  'SX46HD54',
  'SX38XK46',
  'SX89OS67',
  'SX10AO48',
  'SX74PX54',
  'SX08ZB02',
  'SX38YK75',
  'SX49SI97',
  'SX78KT18',
  // Phenom healthcare
  'SX36UZ32',
  // Greenfield
  'SX76CU57',
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
    .find({ 'recording_meta.scoutId': { $in: TARGETS } })
    .project({
      userId: 1,
      'recording_meta.id': 1,
      'recording_meta.name': 1,
      'recording_meta.scoutId': 1,
      'schedule.enabled': 1,
      'recording_meta.saasConfig.schedule.enabled': 1,
      'recording_meta.saasConfig.disableReason': 1,
    })
    .toArray();

  const byScout = new Map(robots.map((r) => [String(r.recording_meta?.scoutId || ''), r]));
  const maxQueue = Math.max(1, parseInt(process.env.REQUEUE_LIMIT || '8', 10) || 8);
  let queued = 0;

  for (const scoutId of TARGETS) {
    if (queued >= maxQueue) break;
    const robot = byScout.get(scoutId);
    if (!robot) {
      console.log(`skip ${scoutId}: not found`);
      continue;
    }
    const scheduleOn =
      robot.schedule?.enabled !== false &&
      (robot as any).recording_meta?.saasConfig?.schedule?.enabled !== false;
    if (!scheduleOn) {
      console.log(
        `skip ${scoutId}: schedule disabled (${(robot as any).recording_meta?.saasConfig?.disableReason || 'no reason'})`
      );
      continue;
    }
    const meta = robot.recording_meta || {};
    const robotMetaId = String(meta.id || '');
    const ownerId = String(robot.userId || '');
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
    const rows = Number(latest.rowsExtracted || 0);
    if (['queued', 'running', 'pending', 'scheduled'].includes(status)) {
      console.log(`skip ${scoutId}: in-flight (${status})`);
      continue;
    }
    if (status === 'completed' && rows >= 5) {
      console.log(`skip ${scoutId}: healthy (${rows} rows)`);
      continue;
    }
    const sourceRunId = String(latest.runId || '');
    if (!sourceRunId) {
      console.log(`skip ${scoutId}: missing runId`);
      continue;
    }
    try {
      const result = await runAdmission.admitRetry({
        ownerId,
        runId: sourceRunId,
        requestKey: `requeue-24h-${scoutId}-${randomUUID()}`,
      });
      console.log(`queued ${scoutId} ${meta.name} from ${status}/${rows} =>`, result?.created);
      queued += 1;
    } catch (err: any) {
      console.log(`fail ${scoutId}:`, err?.message || err);
      if (/active-run limit/i.test(String(err?.message || ''))) break;
    }
  }

  await mongoose.disconnect();
  console.log(`Done. Queued ${queued}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
