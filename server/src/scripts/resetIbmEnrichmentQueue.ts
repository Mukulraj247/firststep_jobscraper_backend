/**
 * Reset stuck IBM job-board enrichments so the ibmcareers Playwright path can retry.
 * Usage: npx ts-node server/src/scripts/resetIbmEnrichmentQueue.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import JobBoardListing from '../models/JobBoardListing';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI required');
  await mongoose.connect(uri);

  const match = {
    $or: [
      { companyName: /ibm/i },
      { 'listSnapshot.companyName': /ibm/i },
      { jobUrl: /careers\.ibm\.com|ibmglobal\.avature\.net/i },
      { robotMetaIds: 'b749511a-b01c-42b1-a720-9ba9e8898c8d' },
    ],
    // Keep already-ready IBM jobs; only requeue stuck/failed enrichment.
    status: { $in: ['queued', 'enriching', 'failed'] },
  };

  const before = await JobBoardListing.aggregate([
    { $match: match },
    { $group: { _id: '$status', n: { $sum: 1 } } },
  ]);

  const res = await JobBoardListing.updateMany(match, {
    $set: {
      status: 'queued',
      leaseUntil: null,
      claimedBy: null,
      companyName: 'IBM',
      'listSnapshot.companyName': 'IBM',
      enrichment: {
        method: 'none',
        tier: 0,
        attempts: 0,
        creditsSpent: 0,
        lastError: '',
        lastEnrichedAt: null,
        nextAttemptAt: null,
      },
    },
  });

  console.log(
    JSON.stringify(
      {
        before,
        modified: res.modifiedCount,
        matched: res.matchedCount,
      },
      null,
      2
    )
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
