/**
 * Read-only audit: cluster analysis of schedule.nextRunAt across enabled robots.
 * Usage: node scripts/audit-schedule-spread.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set');
  process.exit(1);
}

async function main() {
  await mongoose.connect(uri);
  const coll = mongoose.connection.db.collection('maxun_robots');

  const total = await coll.countDocuments({});
  const enabled = await coll.countDocuments({
    $or: [
      { 'schedule.enabled': true },
      { 'recording_meta.saasConfig.schedule.enabled': true },
    ],
  });

  const clusters = await coll
    .aggregate([
      {
        $match: {
          $or: [
            { 'schedule.enabled': true },
            { 'recording_meta.saasConfig.schedule.enabled': true },
          ],
        },
      },
      {
        $project: {
          name: '$recording_meta.name',
          nextRunAt: {
            $ifNull: ['$schedule.nextRunAt', '$recording_meta.saasConfig.schedule.nextRunAt'],
          },
          every: {
            $ifNull: ['$schedule.every', '$recording_meta.saasConfig.schedule.every'],
          },
          cron: {
            $ifNull: ['$recording_meta.saasConfig.schedule.cron', '$schedule.cron'],
          },
          lastRunAt: '$schedule.lastRunAt',
        },
      },
      {
        $group: {
          _id: '$nextRunAt',
          count: { $sum: 1 },
          names: { $push: '$name' },
          cron: { $first: '$cron' },
          every: { $first: '$every' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ])
    .toArray();

  const distinctNext = await coll
    .aggregate([
      {
        $match: {
          $or: [
            { 'schedule.enabled': true },
            { 'recording_meta.saasConfig.schedule.enabled': true },
          ],
        },
      },
      {
        $project: {
          nextRunAt: {
            $ifNull: ['$schedule.nextRunAt', '$recording_meta.saasConfig.schedule.nextRunAt'],
          },
        },
      },
      { $group: { _id: '$nextRunAt' } },
      { $count: 'distinct' },
    ])
    .toArray();

  console.log(JSON.stringify({ total, enabled, distinctNextRunAt: distinctNext[0]?.distinct ?? 0 }, null, 2));
  console.log('\nTop nextRunAt clusters:');
  for (const row of clusters) {
    console.log(
      JSON.stringify({
        nextRunAt: row._id,
        count: row.count,
        cron: row.cron,
        every: row.every,
        sampleNames: (row.names || []).slice(0, 5),
      })
    );
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
