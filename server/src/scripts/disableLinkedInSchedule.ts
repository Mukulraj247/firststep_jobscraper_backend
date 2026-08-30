/**
 * Disable LinkedIn automation schedule (requires saved session cookies; cannot
 * be fixed via ATS free-board). Leaves the robot in place for manual cookie setup.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URL;
  if (!uri) throw new Error('MONGODB_URI missing');
  await mongoose.connect(uri, process.env.MONGODB_DATABASE ? { dbName: process.env.MONGODB_DATABASE } : undefined);
  const db = mongoose.connection.db!;

  const res = await db.collection('maxun_robots').updateMany(
    { 'recording_meta.scoutId': 'SX30MO14' },
    {
      $set: {
        'schedule.enabled': false,
        'recording_meta.saasConfig.schedule.enabled': false,
      },
    }
  );
  console.log(`Disabled LinkedIn schedule matched=${res.matchedCount} modified=${res.modifiedCount}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
