/**
 * Re-queue latest failed/dead runs for named scoutIds via runAdmission.admitRetry
 * (which already enqueues scraper-jobs).
 *
 *   npx ts-node --project server/tsconfig.json server/src/scripts/requeueFailedAutomations.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { randomUUID } from 'crypto';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const TARGETS = [
  'SX26AB32', // wells
  'SX19WB62', // empower
  'SX12UZ81', // verizon
  'SX24NR91', // salesforce
  'SX63JP73', // commonspirit
  'SX88CU13', // usaa
  'SX51JS78', // moodys
  'SX14CO98', // santander
  'SX74LG60', // intuit
  'SX41QP16', // circle
  'SX38XK46', // spglobal
  'SX52FM08', // edwardjones
  'SX90VB06', // travelers-tech
  'SX70ZR44', // travelers-software
  'SX98VY28', // zionsbank
  'SX50WQ38', // hexaware-tech
  'SX98UF84', // hexaware-data
  'SX63KZ97', // hexaware-software
  'SX99TA51', // github
  'SX46HD54', // uhs
  'SX16FA25', // ulta
  'SX01BV85', // dxc
  'SX74PX54', // wayfair-software
  'SX54FF90', // wayfair-technology
  'SX08ZB02', // wayfair-android
  'SX38YK75', // wayfair-ML
  'SX89DA80', // persistent
  'SX89OS67', // principal
  'SX89SJ98', // nationwide-tech
  'SX31YU92', // nationwide-data
  'SX43PE67', // TD
  'SX04HK42', // cognizant
  'SX49SI97', // virtusa
  'SX04TY90', // docusign
  'SX36DK21', // accenture
  'SX78KT18', // lululemon
  'SX10AO48', // icims
  'SX88MN90', // 800flowers (ADP — browser+proxy until adapter exists)
];

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URL;
  if (!uri) throw new Error('MONGODB_URI missing');
  const dbName = process.env.MONGODB_DATABASE || undefined;
  await mongoose.connect(uri, dbName ? { dbName } : undefined);

  // Register models used by runAdmission defaults
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
    })
    .toArray();

  console.log(`Matched ${robots.length}/${TARGETS.length} robots`);

  const maxQueue = Math.max(1, parseInt(process.env.REQUEUE_LIMIT || '8', 10) || 8);
  let queued = 0;
  for (const robot of robots) {
    if (queued >= maxQueue) {
      console.log(`LIMIT reached (${maxQueue}); stop queuing`);
      break;
    }
    const meta = robot.recording_meta || {};
    const robotMetaId = String(meta.id || '');
    const scoutId = String(meta.scoutId || '');
    const name = String(meta.name || '');
    const ownerId = robot.userId;

    const latest = await db
      .collection('maxun_runs')
      .find({ robotMetaId })
      .sort({ startedAt: -1, _id: -1 })
      .limit(1)
      .next();
    if (!latest?.runId) {
      console.log(`SKIP ${scoutId} ${name}: no runs`);
      continue;
    }
    const status = String(latest.status || '');
    if (!['failed', 'dead', 'aborted'].includes(status)) {
      console.log(`SKIP ${scoutId} ${name}: status=${status}`);
      continue;
    }

    const requestKey = `fix-wave:${scoutId}:${randomUUID()}`;
    try {
      const result = await runAdmission.admitRetry({
        ownerId,
        runId: String(latest.runId),
        requestKey,
      });
      if (!result.created) {
        console.log(`DUP ${scoutId} ${name}`);
        continue;
      }
      queued += 1;
      console.log(`QUEUED ${scoutId} ${name} → ${result.run.runId} (was ${status})`);
    } catch (e: any) {
      console.log(`ERR ${scoutId} ${name}: ${e?.code || ''} ${e?.message || e}`);
    }
  }

  console.log(`\nDone. Queued ${queued} retries.`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
