/**
 * Collapse Hiring Cafe (and other aggregator) soft-gate board rows that still
 * use the aggregator posting URL as jobUrl while applyUrl already points at an
 * employer/ATS page — merges into the employer-keyed twin when present.
 *
 *   npx ts-node --project server/tsconfig.json server/src/scripts/repairSoftGateEmployerDupes.ts
 *   DRY_RUN=1 npx ts-node --project server/tsconfig.json server/src/scripts/repairSoftGateEmployerDupes.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { isAggregatorJobPostingUrl, isAggregatorHostUrl } from '../services/aggregatorIdentity';
import { rekeySoftGateListingToEmployer } from '../services/jobBoardEnrichment';
import { normalizeJobUrl } from '../services/jobUrlNormalize';

async function main() {
  const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
  const uri = process.env.DB_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / DB_URL missing');
  await mongoose.connect(uri);
  const board = mongoose.connection.collection('maxun_job_board');

  const cursor = board.find({
    status: { $in: ['ready', 'partial', 'queued', 'enriching', 'failed'] },
    applyUrl: { $exists: true, $nin: [null, ''] },
  });

  let scanned = 0;
  let softGateCandidates = 0;
  let rekeyed = 0;
  let merged = 0;
  let noop = 0;
  let errors = 0;

  for await (const row of cursor) {
    scanned += 1;
    const jobUrl = String(row.jobUrl || '');
    const applyUrl = String(row.applyUrl || '');
    if (!isAggregatorJobPostingUrl(jobUrl)) continue;
    const employer = normalizeJobUrl(applyUrl);
    if (!employer || isAggregatorHostUrl(employer)) continue;
    softGateCandidates += 1;

    if (dryRun) {
      console.log(
        `[dry-run] would rekey ${row._id} jobUrl=${jobUrl.slice(0, 70)} → apply=${employer.slice(0, 70)}`
      );
      continue;
    }

    try {
      const result = await rekeySoftGateListingToEmployer({
        doc: row as any,
        employerUrl: employer,
        aggregatorPostingUrl: String(row.aggregatorPostingUrl || jobUrl),
      });
      if (result.action === 'rekeyed') rekeyed += 1;
      else if (result.action === 'merged_into') merged += 1;
      else noop += 1;
    } catch (err: any) {
      errors += 1;
      console.error(`failed ${row._id}: ${err?.message || err}`);
    }
  }

  console.log(
    JSON.stringify(
      { dryRun, scanned, softGateCandidates, rekeyed, merged, noop, errors },
      null,
      2
    )
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
