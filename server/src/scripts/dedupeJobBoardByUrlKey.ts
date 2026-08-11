/**
 * Recompute jobUrlKey with the tightened normalizer and merge duplicates.
 *
 *   npx ts-node --project server/tsconfig.json server/src/scripts/dedupeJobBoardByUrlKey.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { jobUrlKey, normalizeJobUrl } from '../services/jobUrlNormalize';

async function main() {
  const uri = process.env.DB_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('DB_URL missing');
  await mongoose.connect(uri);
  const board = mongoose.connection.collection('maxun_job_board');

  const rows = await board
    .find({})
    .project({
      jobUrl: 1,
      applyUrl: 1,
      jobUrlKey: 1,
      status: 1,
      jobTitle: 1,
      jobDescription: 1,
      location: 1,
      enrichment: 1,
      updatedAt: 1,
      lastSeenAt: 1,
      companyLogoUrl: 1,
      employmentType: 1,
      remoteType: 1,
      jobExperience: 1,
      jobCategory: 1,
      salaryRange: 1,
    })
    .toArray();

  // Group by new canonical key
  const byKey = new Map<string, any[]>();
  let keyUpdated = 0;
  for (const row of rows) {
    const norm = normalizeJobUrl(row.jobUrl) || normalizeJobUrl(row.applyUrl);
    const key = jobUrlKey(norm || row.jobUrl);
    if (!key || !norm) continue;
    if (row.jobUrlKey !== key || row.jobUrl !== norm) {
      // Will rewrite after merge decisions
      keyUpdated += 1;
    }
    const list = byKey.get(key) || [];
    list.push({ ...row, _norm: norm, _key: key });
    byKey.set(key, list);
  }

  let mergedGroups = 0;
  let deleted = 0;
  let rewritten = 0;

  const score = (r: any): number => {
    let s = 0;
    if (r.status === 'ready') s += 100;
    else if (r.status === 'partial') s += 50;
    s += Math.min(String(r.jobDescription || '').length, 5000) / 50;
    if (r.location) s += 20;
    if (r.jobExperience > 0) s += 10;
    if (r.companyLogoUrl) s += 5;
    if (r.employmentType) s += 5;
    const t = r.updatedAt || r.lastSeenAt;
    if (t) s += Math.min(new Date(t).getTime() / 1e12, 10);
    return s;
  };

  for (const [key, group] of byKey) {
    group.sort((a, b) => score(b) - score(a));
    const winner = group[0];
    const losers = group.slice(1);

    // Merge useful fields from losers into winner when winner is missing them
    const $set: Record<string, any> = {
      jobUrl: winner._norm,
      applyUrl: winner._norm,
      jobUrlKey: key,
    };
    if (winner.jobUrl !== winner._norm || winner.jobUrlKey !== key || winner.applyUrl !== winner._norm) {
      rewritten += 1;
    }
    for (const loser of losers) {
      if (!winner.location && loser.location) $set.location = loser.location;
      if (!(winner.jobExperience > 0) && loser.jobExperience > 0) $set.jobExperience = loser.jobExperience;
      if (!winner.employmentType && loser.employmentType) $set.employmentType = loser.employmentType;
      if (!winner.remoteType && loser.remoteType) $set.remoteType = loser.remoteType;
      if (!winner.jobCategory && loser.jobCategory) $set.jobCategory = loser.jobCategory;
      if (!winner.salaryRange && loser.salaryRange) $set.salaryRange = loser.salaryRange;
      if (!winner.companyLogoUrl && loser.companyLogoUrl) $set.companyLogoUrl = loser.companyLogoUrl;
      if (
        String(loser.jobDescription || '').length > String(winner.jobDescription || '').length
      ) {
        $set.jobDescription = loser.jobDescription;
      }
    }

    await board.updateOne({ _id: winner._id }, { $set });

    if (losers.length) {
      mergedGroups += 1;
      const ids = losers.map((l) => l._id);
      const res = await board.deleteMany({ _id: { $in: ids } });
      deleted += res.deletedCount || 0;
    }
  }

  // Spot-check remaining Google path dupes
  const pathDupes = await board
    .aggregate([
      {
        $match: {
          status: { $in: ['ready', 'partial'] },
          jobUrl: { $regex: 'google\\.com/about/careers', $options: 'i' },
        },
      },
      {
        $addFields: {
          pathOnly: { $arrayElemAt: [{ $split: ['$jobUrl', '?'] }, 0] },
        },
      },
      { $group: { _id: '$pathOnly', n: { $sum: 1 } } },
      { $match: { n: { $gte: 2 } } },
      { $count: 'n' },
    ])
    .toArray();

  console.log(
    JSON.stringify(
      {
        rows: rows.length,
        uniqueKeys: byKey.size,
        keyUpdated,
        rewritten,
        mergedGroups,
        deleted,
        remainingGooglePathDupes: pathDupes[0]?.n || 0,
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
