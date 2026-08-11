/**
 * Cleanup job board quality issues:
 * - Canonicalize company names (Carrier*, Meta*, Ford, Toyota, Sia)
 * - Delete non-job Phenom hub/landing URLs
 * - Fix Ford marketing titles from URL slugs; clear junk Remote/descriptions
 * - Requeue Ford / Toyota / remaining Carrier for enrichment
 *
 * Usage:
 *   npx ts-node --project server/tsconfig.json server/src/scripts/cleanupJobBoardQuality.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';
import {
  canonicalizeCompanyName,
  isCareersJobDetailUrl,
  isGenericJobTitle,
  isJunkDescription,
  isKnownPhenomCareersHost,
  preferJobUrlTitle,
  titleFromJobUrl,
} from '../services/jobPageParser';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const uri = process.env.DB_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('Missing MONGODB_URI');
    process.exit(1);
  }
  await mongoose.connect(uri);
  const board = mongoose.connection.collection('maxun_job_board');

  const stats = {
    scanned: 0,
    companyUpdated: 0,
    titleFixed: 0,
    remoteCleared: 0,
    descCleared: 0,
    deleted: 0,
    requeued: 0,
    expired: 0,
  };

  const cursor = board.find({});
  const toDelete: any[] = [];
  const requeueIds: any[] = [];

  while (await cursor.hasNext()) {
    const doc: any = await cursor.next();
    if (!doc) break;
    stats.scanned += 1;

    const jobUrl = String(doc.jobUrl || doc.applyUrl || '');
    const company = String(doc.companyName || '');
    const canon = canonicalizeCompanyName(company);
    const title = String(doc.jobTitle || '');
    const desc = String(doc.jobDescription || '');
    const $set: Record<string, any> = {};
    let touch = false;

    if (canon && canon !== company) {
      $set.companyName = canon;
      stats.companyUpdated += 1;
      touch = true;
    }

    // Non-job careers host URLs → delete
    if (jobUrl && isKnownPhenomCareersHost(jobUrl) && !isCareersJobDetailUrl(jobUrl)) {
      toDelete.push(doc._id);
      continue;
    }

    // Privacy / legal hosts already partially filtered; also drop privacy-notice titles
    if (isGenericJobTitle(title) && !(jobUrl && isCareersJobDetailUrl(jobUrl))) {
      toDelete.push(doc._id);
      continue;
    }

    if (jobUrl && isCareersJobDetailUrl(jobUrl)) {
      const slug = preferJobUrlTitle(title, jobUrl);
      if (slug && slug !== title) {
        $set.jobTitle = slug;
        stats.titleFixed += 1;
        touch = true;
      }
    }

    if (isJunkDescription(desc)) {
      $set.jobDescription = '';
      $set.descriptionSnippet = '';
      stats.descCleared += 1;
      touch = true;
      if (String(doc.remoteType || '').toLowerCase() === 'remote') {
        $set.remoteType = '';
        stats.remoteCleared += 1;
      }
    } else if (
      String(doc.remoteType || '').toLowerCase() === 'remote' &&
      /search\s+jobs|keyword\(s\)|radius/i.test(desc)
    ) {
      $set.remoteType = '';
      stats.remoteCleared += 1;
      touch = true;
    }

    const companyFinal = ($set.companyName || canon || company).toLowerCase();
    const needsRequeue =
      /^(ford|toyota|carrier)$/.test(companyFinal) ||
      /ford|toyota|carrier/i.test(jobUrl);

    if (touch) {
      if (needsRequeue || isJunkDescription(desc) || isGenericJobTitle(title)) {
        $set.status = 'queued';
        $set.leaseUntil = null;
        $set.claimedBy = null;
        $set['enrichment.nextAttemptAt'] = new Date();
        $set['enrichment.lastError'] = 'quality_cleanup_requeue';
        requeueIds.push(doc._id);
        stats.requeued += 1;
      }
      await board.updateOne({ _id: doc._id }, { $set });
    } else if (needsRequeue && (isJunkDescription(desc) || isGenericJobTitle(title) || !desc)) {
      await board.updateOne(
        { _id: doc._id },
        {
          $set: {
            status: 'queued',
            leaseUntil: null,
            claimedBy: null,
            'enrichment.nextAttemptAt': new Date(),
            'enrichment.lastError': 'quality_cleanup_requeue',
          },
        }
      );
      stats.requeued += 1;
    }
  }

  if (toDelete.length) {
    const res = await board.deleteMany({ _id: { $in: toDelete } });
    stats.deleted = res.deletedCount || 0;
  }

  const cos = await board
    .aggregate([{ $group: { _id: '$companyName', n: { $sum: 1 } } }, { $sort: { n: -1 } }])
    .toArray();

  console.log(JSON.stringify({ stats, companies: cos }, null, 2));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
