/**
 * One-shot: normalize long prose salaryRange values on maxun_job_board.
 *
 *   npx ts-node --project server/tsconfig.json server/src/scripts/normalizeJobBoardSalaries.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { normalizeSalaryRange } from '../services/jobPageParser';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI required');
  await mongoose.connect(uri);
  const board = mongoose.connection.collection('maxun_job_board');

  const cursor = board.find(
    { salaryRange: { $exists: true, $type: 'string', $ne: '' } },
    { projection: { salaryRange: 1, location: 1 } }
  );

  let scanned = 0;
  let updated = 0;
  const ops: any[] = [];

  for await (const doc of cursor) {
    scanned += 1;
    const next = normalizeSalaryRange(doc.salaryRange, { location: doc.location || '' });
    if (next !== doc.salaryRange) {
      updated += 1;
      ops.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { salaryRange: next } },
        },
      });
    }
    if (ops.length >= 200) {
      await board.bulkWrite(ops.splice(0, ops.length), { ordered: false });
    }
  }
  if (ops.length) await board.bulkWrite(ops, { ordered: false });

  console.log(JSON.stringify({ scanned, updated }));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
