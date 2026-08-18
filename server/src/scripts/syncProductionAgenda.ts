/**
 * Sync production Agenda (`agendaJobs`) nextRunAt from robot.schedule in MongoDB.
 * Writes directly to MongoDB (does not start Agenda processing) so running
 * schedulers cannot race the sync.
 *
 * Usage:
 *   npm run sync:agenda:production
 */
import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';
import { connectDB } from '../storage/db';
import {
  resolveEffectiveScheduleState,
  readRobotScheduleTimestamps,
} from '../services/automationScheduler';
import {
  humanIntervalFromMs,
  intervalMsFromCron,
} from '../utils/schedule';
import Robot from '../models/Robot';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const PRODUCTION_COLLECTION = 'agendaJobs';

async function main(): Promise<void> {
  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB not connected');

  const agendaColl = db.collection(PRODUCTION_COLLECTION);

  const robots: any[] = await Robot.find({
    $or: [
      { 'schedule.enabled': true },
      { 'recording_meta.saasConfig.schedule.enabled': true },
    ],
  }).sort({ _id: 1 });

  let synced = 0;
  let missing = 0;
  let skipped = 0;

  for (const robot of robots) {
    const effective = resolveEffectiveScheduleState(robot);
    if (!effective.enabled || (!effective.cron && !effective.every)) {
      skipped += 1;
      continue;
    }

    const automationId = robot.recording_meta?.id;
    if (!automationId) {
      skipped += 1;
      continue;
    }

    const { nextRunAt } = readRobotScheduleTimestamps(robot, effective);
    if (!nextRunAt || Number.isNaN(nextRunAt.getTime())) {
      skipped += 1;
      continue;
    }

    const everyMs =
      (typeof effective.every === 'number' && effective.every > 0 ? effective.every : null) ??
      intervalMsFromCron(effective.cron || '');
    const humanInterval = everyMs ? humanIntervalFromMs(everyMs) : null;

    const result = await agendaColl.updateOne(
      { name: 'schedule-triggers', 'data.automationId': automationId },
      {
        $set: {
          nextRunAt: new Date(nextRunAt),
          ...(humanInterval ? { repeatInterval: humanInterval } : {}),
          type: 'normal',
        },
      }
    );

    if (result.matchedCount === 0) {
      missing += 1;
      console.warn(`No agendaJobs entry for ${robot.recording_meta?.name} (${automationId})`);
    } else {
      synced += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        collection: PRODUCTION_COLLECTION,
        synced,
        missing,
        skipped,
        total: robots.length,
      },
      null,
      2
    )
  );

  await mongoose.connection.close();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.connection.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
