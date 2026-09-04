/**
 * Demote Hiring Cafe `ready` rows that fail the stricter board gate
 * (real apply URL + non-skills-dump JD) so enrichment can retry (max 10).
 *
 * Usage: npx ts-node server/src/scripts/demoteFalseReadyHiringCafeListings.ts
 */
require('dotenv').config();
const mongoose = require('mongoose');

function isAggregatorApplyHost(url) {
  try {
    const host = new URL(String(url || '')).hostname.toLowerCase();
    return (
      host.includes('hiring.cafe') ||
      host.includes('hiringcafe') ||
      host.includes('accel') ||
      host.includes('choppingblock') ||
      host.includes('aidevboard')
    );
  } catch {
    return false;
  }
}

function isSkillsDump(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (raw.length < 80) return false;
  const commaCount = (raw.match(/,/g) || []).length;
  if (commaCount < 8) return false;
  const sentenceEnds = (raw.match(/[.!?](\s|$)/g) || []).length;
  const hasJdProse =
    /\b(responsibilit|qualifications?|requirements?|about the (?:role|job|position)|you will|we are looking)\b/i.test(
      raw
    );
  if (sentenceEnds <= 1 && !hasJdProse) return true;
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 12) {
    const avgLen = parts.reduce((n, p) => n + p.length, 0) / parts.length;
    if (avgLen <= 28 && sentenceEnds <= 2 && !hasJdProse) return true;
  }
  return false;
}

(async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URL;
  if (!uri) throw new Error('MONGODB_URI missing');
  await mongoose.connect(uri, process.env.MONGODB_DATABASE ? { dbName: process.env.MONGODB_DATABASE } : undefined);
  const coll = mongoose.connection.db.collection('maxun_job_board');

  const readyHc = await coll
    .find({ source: 'hiring_cafe', status: 'ready' })
    .project({
      applyUrl: 1,
      jobDescription: 1,
      'listSnapshot.jobDescription': 1,
      jobTitle: 1,
      companyName: 1,
    })
    .toArray();

  const toDemote = readyHc.filter((row) => {
    const apply = String(row.applyUrl || '').trim();
    if (!apply || isAggregatorApplyHost(apply)) return true;
    const desc = String(row.jobDescription || row.listSnapshot?.jobDescription || '');
    if (isSkillsDump(desc)) return true;
    return false;
  });

  const ids = toDemote.map((r) => r._id);
  let modified = 0;
  if (ids.length) {
    const res = await coll.updateMany(
      { _id: { $in: ids } },
      {
        $set: {
          status: 'queued',
          priority: 10,
          leaseUntil: null,
          claimedBy: null,
          'enrichment.attempts': 0,
          'enrichment.method': 'none',
          'enrichment.lastError': 'demoted_false_ready_hc_gate',
          'enrichment.nextAttemptAt': null,
        },
      }
    );
    modified = res.modifiedCount;
  }

  console.log(
    JSON.stringify(
      {
        readyHiringCafe: readyHc.length,
        demoted: modified,
        queuedNow: await coll.countDocuments({ source: 'hiring_cafe', status: 'queued' }),
      },
      null,
      2
    )
  );
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
