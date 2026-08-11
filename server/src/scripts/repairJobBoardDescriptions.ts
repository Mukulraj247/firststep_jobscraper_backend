/**
 * Repair junk scrape.do descriptions on the job board:
 * - Prefer listSnapshot description when detail text is site chrome
 * - Re-queue rows that still lack a usable description
 *
 * Usage: npx ts-node --project server/tsconfig.json server/src/scripts/repairJobBoardDescriptions.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import JobBoardListing from '../models/JobBoardListing';
import {
  decodeHtmlEntities,
  isJunkDescription,
  makeDescriptionSnippet,
  pickBestDescription,
  sanitizeCompanyName,
} from '../services/jobPageParser';

async function main() {
  const uri = process.env.DB_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('Missing DB_URL / MONGODB_URI');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('Connected. Scanning job board for junk descriptions…');

  const cursor = JobBoardListing.find({
    status: { $in: ['ready', 'partial'] },
  })
    .select(
      'jobTitle companyName jobDescription listSnapshot enrichment status descriptionSnippet location jobCategory companyLogoUrl'
    )
    .cursor();

  let scanned = 0;
  let repaired = 0;
  let requeued = 0;
  let titlesFixed = 0;

  for await (const doc of cursor) {
    scanned += 1;
    const list = (doc as any).listSnapshot || {};
    const currentDesc = String(doc.jobDescription || '');
    const listDesc = String(list.jobDescription || '');
    const best = pickBestDescription(currentDesc, listDesc);
    const title = decodeHtmlEntities(doc.jobTitle || list.jobTitle || '');
    const company =
      sanitizeCompanyName(doc.companyName || '') ||
      sanitizeCompanyName(list.companyName || '') ||
      '';

    const $set: Record<string, any> = {};
    let changed = false;

    if (title && title !== doc.jobTitle) {
      $set.jobTitle = title;
      titlesFixed += 1;
      changed = true;
    }
    if (company !== (doc.companyName || '')) {
      $set.companyName = company;
      changed = true;
    }

    if (best !== currentDesc) {
      $set.jobDescription = best;
      $set.descriptionSnippet = makeDescriptionSnippet(best);
      repaired += 1;
      changed = true;
    }

    const stillJunk = isJunkDescription(best);
    if (stillJunk || !best) {
      $set.status = 'queued';
      $set.leaseUntil = null;
      $set.claimedBy = null;
      $set['enrichment.nextAttemptAt'] = new Date();
      $set['enrichment.lastError'] = 'requeued: junk or empty description';
      // Avoid path conflict: set enrichment fields individually only if not replacing whole object
      requeued += 1;
      changed = true;
    }

    if (list.jobCategory && !doc.jobCategory) {
      $set.jobCategory = decodeHtmlEntities(list.jobCategory);
      changed = true;
    }
    if (list.location && !doc.location) {
      $set.location = decodeHtmlEntities(list.location);
      changed = true;
    }

    if (changed) {
      await JobBoardListing.updateOne({ _id: doc._id }, { $set });
    }

    if (scanned % 200 === 0) {
      console.log(`… scanned ${scanned}`);
    }
  }

  console.log('\nRepair complete:');
  console.log(`  scanned:       ${scanned}`);
  console.log(`  desc repaired: ${repaired}`);
  console.log(`  titles fixed:  ${titlesFixed}`);
  console.log(`  requeued:      ${requeued}`);
  console.log('Keep `npm run worker:enrichment:dev` running to re-enrich queued rows.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
