/**
 * Backfill Scout-X IDs on robots missing recording_meta.scoutId,
 * then stamp matching runs with scoutId from their robot.
 *
 * Usage:
 *   npx ts-node --project server/tsconfig.json server/src/scripts/backfillScoutIds.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';
import Robot from '../models/Robot';
import Run from '../models/Run';
import { generateUniqueScoutId, isValidScoutId } from '../utils/scoutId';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const uri = process.env.DB_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('Missing MONGODB_URI / DB_URL');
    process.exit(1);
  }

  await mongoose.connect(uri);

  const stats = {
    robotsScanned: 0,
    robotsAssigned: 0,
    robotsSkippedValid: 0,
    robotsFixedCase: 0,
    runsStamped: 0,
  };

  const robots = await Robot.find({}).select('userId recording_meta').cursor();

  for await (const robot of robots) {
    stats.robotsScanned += 1;
    const meta = robot.recording_meta || {};
    const existing = typeof meta.scoutId === 'string' ? meta.scoutId.trim() : '';

    if (existing && isValidScoutId(existing)) {
      stats.robotsSkippedValid += 1;
      continue;
    }

    if (existing && isValidScoutId(existing.toUpperCase())) {
      meta.scoutId = existing.toUpperCase();
      robot.recording_meta = meta;
      robot.markModified('recording_meta');
      await robot.save();
      stats.robotsFixedCase += 1;
      continue;
    }

    const userId = robot.userId;
    const scoutId = await generateUniqueScoutId(async (id) => {
      const hit = await Robot.findOne({
        userId,
        'recording_meta.scoutId': id,
      })
        .select('_id')
        .lean();
      return !!hit;
    });

    meta.scoutId = scoutId;
    robot.recording_meta = meta;
    robot.markModified('recording_meta');
    await robot.save();
    stats.robotsAssigned += 1;
    console.log(`Assigned ${scoutId} → ${meta.id || robot.id}`);
  }

  const withScout = await Robot.find({ 'recording_meta.scoutId': { $type: 'string' } })
    .select('recording_meta.id recording_meta.scoutId')
    .lean();

  for (const robot of withScout) {
    const metaId = robot.recording_meta?.id;
    const scoutId = robot.recording_meta?.scoutId;
    if (!metaId || !scoutId) continue;
    const result = await Run.updateMany(
      {
        robotMetaId: metaId,
        $or: [{ scoutId: null }, { scoutId: { $exists: false } }, { scoutId: '' }],
      },
      { $set: { scoutId: String(scoutId).toUpperCase() } }
    );
    stats.runsStamped += result.modifiedCount || 0;
  }

  console.log(JSON.stringify(stats, null, 2));
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
