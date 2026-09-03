/**
 * Stamp needsProxy on flaky Hiring Cafe aggregators so attempt 0 attaches Decodo.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const HC = ['SX03FI86', 'SX83ZW96', 'SX50JO11', 'SX98UC04'];

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URL;
  if (!uri) throw new Error('MONGODB_URI missing');
  await mongoose.connect(uri, process.env.MONGODB_DATABASE ? { dbName: process.env.MONGODB_DATABASE } : undefined);
  const db = mongoose.connection.db!;
  const res = await db.collection('maxun_robots').updateMany(
    { 'recording_meta.scoutId': { $in: HC } },
    {
      $set: {
        'recording_meta.saasConfig.browserLocation.needsProxy': true,
        'recording_meta.saasConfig.browserLocation.needsProxyAt': new Date().toISOString(),
      },
    }
  );
  console.log(`HC needsProxy stamped matched=${res.matchedCount} modified=${res.modifiedCount}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
