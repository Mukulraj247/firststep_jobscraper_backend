/**
 * One-time / maintenance: re-spread all enabled automation schedules in MongoDB + Agenda.
 *
 * Usage:
 *   npm run repack:schedules
 *   npm run repack:schedules -- --dry-run   (audit only, no writes)
 */
import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';
import { connectDB } from '../storage/db';
import { getAgenda, drainAndCloseAgenda } from '../queue/scraperQueue';
import { repackAllSchedulesGlobally } from '../services/automationScheduler';
import Robot from '../models/Robot';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function auditSpread(): Promise<void> {
  const coll = mongoose.connection.db!.collection('maxun_robots');
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
          nextRunAt: {
            $ifNull: ['$schedule.nextRunAt', '$recording_meta.saasConfig.schedule.nextRunAt'],
          },
        },
      },
      { $group: { _id: '$nextRunAt', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ])
    .toArray();

  const distinct = await coll
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

  console.log('Before repack audit:', {
    enabled: await Robot.countDocuments({
      $or: [
        { 'schedule.enabled': true },
        { 'recording_meta.saasConfig.schedule.enabled': true },
      ],
    }),
    distinctNextRunAt: distinct[0]?.distinct ?? 0,
    topClusters: clusters,
  });
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  await connectDB();
  if (!mongoose.connection.db) {
    throw new Error('MongoDB not connected');
  }

  await auditSpread();

  if (dryRun) {
    console.log('Dry run — no schedules modified.');
    await mongoose.connection.close();
    return;
  }

  await getAgenda();
  const result = await repackAllSchedulesGlobally();
  console.log('Repack complete:', result);

  await auditSpread();

  await drainAndCloseAgenda({ drainMs: 5_000 });
  await mongoose.connection.close();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await drainAndCloseAgenda({ drainMs: 2_000 });
    await mongoose.connection.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
