/**
 * One-shot: move career free-path thrash out of the active enrichment queue.
 *
 * Parks queued/failed/enriching career rows with scrape.do / free-path miss errors
 * into status=deferred (needsPaidPath=true) so scoutx-enrichment-hc can claim HC.
 *
 * Usage from /opt/scout-x:
 *   node server/src/scripts/parkCareerFreePathMissesToDeferred.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URL;
  if (!uri) throw new Error('MONGODB_URI missing');
  await mongoose.connect(uri, process.env.MONGODB_DATABASE ? { dbName: process.env.MONGODB_DATABASE } : undefined);
  const coll = mongoose.connection.db.collection('maxun_job_board');

  const careerSource = {
    $or: [{ source: '' }, { source: { $exists: false } }, { source: null }],
  };

  const filter = {
    ...careerSource,
    status: { $in: ['queued', 'failed', 'enriching', 'partial'] },
    $or: [
      {
        'enrichment.lastError': {
          $in: [
            'SCRAPE_DO_TOKEN_missing',
            'career_scrape_do_disabled',
            'career_free_path_miss',
            'career_host_skip_scrape_do',
            'daily_credit_budget_exhausted',
          ],
        },
      },
      // Still queued with attempts>0 and never became ready — often the same thrash pile.
      {
        status: 'queued',
        'enrichment.attempts': { $gte: 1 },
        'enrichment.method': { $in: ['none', 'list', null, ''] },
      },
    ],
  };

  const matched = await coll.countDocuments(filter);
  const res = await coll.updateMany(filter, {
    $set: {
      status: 'deferred',
      leaseUntil: null,
      claimedBy: null,
      'enrichment.method': 'none',
      'enrichment.lastError': 'career_free_path_miss',
      'enrichment.nextAttemptAt': null,
      'enrichment.needsPaidPath': true,
    },
  });

  console.log(
    JSON.stringify(
      {
        matched,
        modified: res.modifiedCount,
        deferredNow: await coll.countDocuments({ status: 'deferred' }),
        queuedCareer: await coll.countDocuments({
          status: 'queued',
          $or: [{ source: '' }, { source: { $exists: false } }, { source: null }],
        }),
        queuedHc: await coll.countDocuments({ status: 'queued', source: 'hiring_cafe' }),
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
