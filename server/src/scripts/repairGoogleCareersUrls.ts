/**
 * Repair broken Google Careers URLs on the job board and re-queue enrichment.
 *
 *   npx ts-node --project server/tsconfig.json server/src/scripts/repairGoogleCareersUrls.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { fixGoogleCareersJobsUrl } from '../utils/googleCareersUrl';
import { jobUrlKey, normalizeJobUrl } from '../services/jobUrlNormalize';

const BAD_PATH_RE = /\/jobs\/(?:jobs\/results|results\/jobs\/results)\//i;

async function main() {
  const uri = process.env.DB_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('DB_URL missing');
  await mongoose.connect(uri);
  const board = mongoose.connection.collection('maxun_job_board');
  const extracted = mongoose.connection.collection('maxun_extracteddata');

  const broken = await board
    .find({ jobUrl: { $regex: 'google\\.com/about/careers', $options: 'i' } })
    .toArray();

  let updated = 0;
  let deletedDup = 0;
  let requeued = 0;
  let extractedFixed = 0;

  for (const doc of broken) {
    const raw = String(doc.jobUrl || '');
    if (!BAD_PATH_RE.test(raw) && !/\/jobs\/jobs\/results\//i.test(raw)) {
      // Still requeue queued/failed Google rows with empty/short desc so enrichment retries
      const descLen = String(doc.jobDescription || doc.listSnapshot?.jobDescription || '').length;
      if (
        ['queued', 'failed', 'enriching', 'partial'].includes(String(doc.status)) ||
        descLen < 60
      ) {
        const norm = normalizeJobUrl(raw);
        const key = jobUrlKey(norm || raw);
        await board.updateOne(
          { _id: doc._id },
          {
            $set: {
              ...(norm ? { jobUrl: norm, applyUrl: norm, jobUrlKey: key } : {}),
              status: 'queued',
              leaseUntil: null,
              claimedBy: null,
              'enrichment.nextAttemptAt': new Date(),
              'enrichment.lastError': null,
              'listSnapshot.jobUrl': norm || raw,
            },
          }
        );
        requeued += 1;
      }
      continue;
    }

    const healed = fixGoogleCareersJobsUrl(raw);
    const norm = normalizeJobUrl(healed) || healed;
    const key = jobUrlKey(norm);
    if (!key) continue;

    const existing = await board.findOne({ jobUrlKey: key, _id: { $ne: doc._id } });
    if (existing) {
      await board.deleteOne({ _id: doc._id });
      deletedDup += 1;
      // Ensure survivor is queued if not ready
      if (!['ready'].includes(String(existing.status)) || String(existing.jobDescription || '').length < 60) {
        await board.updateOne(
          { _id: existing._id },
          {
            $set: {
              status: 'queued',
              leaseUntil: null,
              claimedBy: null,
              'enrichment.nextAttemptAt': new Date(),
              'enrichment.lastError': null,
            },
          }
        );
        requeued += 1;
      }
      continue;
    }

    await board.updateOne(
      { _id: doc._id },
      {
        $set: {
          jobUrl: norm,
          applyUrl: norm,
          jobUrlKey: key,
          status: 'queued',
          leaseUntil: null,
          claimedBy: null,
          'enrichment.attempts': 0,
          'enrichment.nextAttemptAt': new Date(),
          'enrichment.lastError': null,
          'listSnapshot.jobUrl': norm,
        },
      }
    );
    updated += 1;
    requeued += 1;
  }

  // Fix extracted data URLs so future backfills stay clean
  const cursor = extracted.find({
    $or: [
      { 'content.jobUrl': { $regex: 'google\\.com/about/careers/.*/jobs/.*/jobs/results', $options: 'i' } },
      { 'content.job_url': { $regex: 'google\\.com/about/careers/.*/jobs/.*/jobs/results', $options: 'i' } },
      { 'content.url': { $regex: 'google\\.com/about/careers/.*/jobs/.*/jobs/results', $options: 'i' } },
      { 'content.link': { $regex: 'google\\.com/about/careers/.*/jobs/.*/jobs/results', $options: 'i' } },
    ],
  });
  while (await cursor.hasNext()) {
    const row = await cursor.next();
    if (!row?.content || typeof row.content !== 'object') continue;
    const content = { ...row.content };
    let changed = false;
    for (const k of ['jobUrl', 'job_url', 'url', 'link', 'href', 'applyUrl']) {
      if (typeof content[k] === 'string' && BAD_PATH_RE.test(content[k])) {
        content[k] = fixGoogleCareersJobsUrl(content[k]);
        changed = true;
      }
    }
    if (changed) {
      await extracted.updateOne({ _id: row._id }, { $set: { content } });
      extractedFixed += 1;
    }
  }

  const googleBoard = await board.countDocuments({
    jobUrl: { $regex: 'google\\.com/about/careers', $options: 'i' },
  });
  const googleQueued = await board.countDocuments({
    jobUrl: { $regex: 'google\\.com/about/careers', $options: 'i' },
    status: 'queued',
  });

  console.log(
    JSON.stringify(
      { updated, deletedDup, requeued, extractedFixed, googleBoard, googleQueued },
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
