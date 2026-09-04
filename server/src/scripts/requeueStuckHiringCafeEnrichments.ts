/**
 * Requeue stuck Hiring Cafe board rows that landed as partial/failed after CF,
 * so the enrichment worker can retry with HTTP→proxy→browser.
 *
 * Usage: npx ts-node server/src/scripts/requeueStuckHiringCafeEnrichments.ts
 */
import * as dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

(async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URL;
  if (!uri) throw new Error('MONGODB_URI missing');
  await mongoose.connect(uri, process.env.MONGODB_DATABASE ? { dbName: process.env.MONGODB_DATABASE } : undefined);
  const db = mongoose.connection.db!;
  const coll = db.collection('maxun_job_board');

  const filter = {
    source: 'hiring_cafe',
    status: { $in: ['partial', 'failed'] },
    $or: [
      { 'enrichment.lastError': /hiring_cafe_html_only|cloudflare|hiring_cafe_cf/i },
      { 'enrichment.method': { $in: ['list', 'none'] } },
      { applyUrl: { $in: [null, ''] } },
    ],
  };

  const before = await coll.countDocuments(filter);
  const res = await coll.updateMany(filter, {
    $set: {
      status: 'queued',
      priority: 10,
      leaseUntil: null,
      claimedBy: null,
      'enrichment.method': 'none',
      'enrichment.lastError': 'requeued_for_hc_retry',
      'enrichment.nextAttemptAt': null,
      // keep attempts so we don't infinite-loop forever; worker still has max attempts
    },
  });

  console.log(
    JSON.stringify(
      {
        matched: before,
        modified: res.modifiedCount,
        queuedNow: await coll.countDocuments({ source: 'hiring_cafe', status: 'queued' }),
        partialLeft: await coll.countDocuments({ source: 'hiring_cafe', status: 'partial' }),
      },
      null,
      2
    )
  );
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
