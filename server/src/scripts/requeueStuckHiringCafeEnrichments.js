require('dotenv').config();
const mongoose = require('mongoose');

/**
 * Plain JS requeue for droplets (no ts-node required).
 * Usage from /opt/scout-x:
 *   node server/src/scripts/requeueStuckHiringCafeEnrichments.js
 */
(async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URL;
  if (!uri) throw new Error('MONGODB_URI missing');
  await mongoose.connect(uri, process.env.MONGODB_DATABASE ? { dbName: process.env.MONGODB_DATABASE } : undefined);
  const db = mongoose.connection.db;
  const coll = db.collection('maxun_job_board');

  const filter = {
    source: 'hiring_cafe',
    status: { $in: ['partial', 'failed', 'enriching'] },
    $or: [
      { 'enrichment.lastError': /hiring_cafe|cloudflare|slot|SCRAPE_DO|chromium/i },
      { 'enrichment.method': { $in: ['list', 'none'] } },
      { applyUrl: { $in: [null, ''] } },
      { leaseUntil: { $lt: new Date() } },
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
      'enrichment.lastError': 'requeued_for_hc_http_retry',
      'enrichment.nextAttemptAt': null,
    },
  });

  // Also clear expired enriching leases for any source (unstick Chromium waits)
  const leaseRes = await coll.updateMany(
    { status: 'enriching', leaseUntil: { $lt: new Date() } },
    {
      $set: {
        status: 'queued',
        leaseUntil: null,
        claimedBy: null,
        'enrichment.lastError': 'requeued_expired_lease',
        'enrichment.nextAttemptAt': null,
      },
    }
  );

  console.log(
    JSON.stringify(
      {
        hcMatched: before,
        hcModified: res.modifiedCount,
        expiredLeasesRequeued: leaseRes.modifiedCount,
        hcQueuedNow: await coll.countDocuments({ source: 'hiring_cafe', status: 'queued' }),
        readyHc: await coll.countDocuments({ source: 'hiring_cafe', status: 'ready' }),
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
