/**
 * Recover stalled Hiring Cafe enrichment:
 * 1) Poison rows (Mongo path conflict / attempts >= 50)
 * 2) partial stuck at old max attempts (4+)
 * 3) Optional: demote ready without employer apply URL
 *
 * Usage: node server/src/scripts/recoverHiringCafeEnrichmentQueue.js
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
  const raw = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (raw.length < 80) return false;
  const commaCount = (raw.match(/,/g) || []).length;
  if (commaCount < 8) return false;
  const sentenceEnds = (raw.match(/[.!?](\s|$)/g) || []).length;
  const hasJdProse =
    /\b(responsibilit|qualifications?|requirements?|about the (?:role|job|position)|you will|we are looking)\b/i.test(
      raw
    );
  if (sentenceEnds <= 1 && !hasJdProse) return true;
  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 12) {
    const avgLen = parts.reduce((n, p) => n + p.length, 0) / parts.length;
    if (avgLen <= 28 && sentenceEnds <= 2 && !hasJdProse) return true;
  }
  return false;
}

const requeueSet = {
  status: 'queued',
  priority: 10,
  leaseUntil: null,
  claimedBy: null,
  'enrichment.attempts': 0,
  'enrichment.method': 'none',
  'enrichment.nextAttemptAt': null,
};

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI missing');
  await mongoose.connect(uri, process.env.MONGODB_DATABASE ? { dbName: process.env.MONGODB_DATABASE } : undefined);
  const board = mongoose.connection.db.collection('maxun_job_board');
  const robots = mongoose.connection.db.collection('maxun_robots');

  // Enable Scrape.do on HC robots missing saasConfig (use env token).
  const token = String(process.env.SCRAPE_DO_TOKEN || '').trim();
  let robotsPatched = 0;
  if (token) {
    const hcRobots = await robots
      .find({ 'recording_meta.name': /^HC-/i })
      .project({ 'recording_meta.name': 1, 'recording_meta.saasConfig': 1 })
      .toArray();
    for (const r of hcRobots) {
      const hc = r.recording_meta?.saasConfig?.hiringCafeEnrichment;
      if (hc?.scrapeDoEnabled && hc?.scrapeDoToken) continue;
      const res = await robots.updateOne(
        { _id: r._id },
        {
          $set: {
            'recording_meta.saasConfig.hiringCafeEnrichment': {
              scrapeDoEnabled: true,
              scrapeDoMaxTier: 2,
              scrapeDoToken: token,
            },
          },
        }
      );
      robotsPatched += res.modifiedCount;
    }
  }

  const poisonFilter = {
    source: 'hiring_cafe',
    status: { $in: ['queued', 'partial', 'failed', 'enriching'] },
    $or: [
      { 'enrichment.lastError': /would create a conflict/i },
      { 'enrichment.attempts': { $gte: 50 } },
    ],
  };
  const poisonBefore = await board.countDocuments(poisonFilter);
  const poisonRes = await board.updateMany(poisonFilter, {
    $set: {
      ...requeueSet,
      'enrichment.lastError': 'requeued_poison_conflict_or_high_attempts',
    },
  });

  const stuckPartialFilter = {
    source: 'hiring_cafe',
    status: 'partial',
    $or: [
      { 'enrichment.attempts': { $gte: 4 } },
      { 'enrichment.lastError': /hiring_cafe_html_only|hiring_cafe_enrichment_exhausted|hiring_cafe_http_cf/i },
    ],
  };
  const stuckBefore = await board.countDocuments(stuckPartialFilter);
  const stuckRes = await board.updateMany(stuckPartialFilter, {
    $set: {
      ...requeueSet,
      'enrichment.lastError': 'requeued_stuck_partial_for_retry',
    },
  });

  // Demote false ready (no employer apply / skills dump)
  const readyHc = await board
    .find({ source: 'hiring_cafe', status: 'ready' })
    .project({
      applyUrl: 1,
      jobDescription: 1,
      'listSnapshot.jobDescription': 1,
    })
    .toArray();
  const demoteIds = readyHc
    .filter((row) => {
      const apply = String(row.applyUrl || '').trim();
      if (!apply || isAggregatorApplyHost(apply)) return true;
      const desc = String(row.jobDescription || row.listSnapshot?.jobDescription || '');
      return isSkillsDump(desc);
    })
    .map((r) => r._id);

  let demoted = 0;
  if (demoteIds.length) {
    const demoteRes = await board.updateMany(
      { _id: { $in: demoteIds } },
      {
        $set: {
          ...requeueSet,
          'enrichment.lastError': 'demoted_false_ready_hc_gate',
        },
      }
    );
    demoted = demoteRes.modifiedCount;
  }

  console.log(
    JSON.stringify(
      {
        robotsPatched,
        poison: { matched: poisonBefore, modified: poisonRes.modifiedCount },
        stuckPartial: { matched: stuckBefore, modified: stuckRes.modifiedCount },
        demotedFalseReady: demoted,
        inventory: {
          queued: await board.countDocuments({ source: 'hiring_cafe', status: 'queued' }),
          ready: await board.countDocuments({ source: 'hiring_cafe', status: 'ready' }),
          partial: await board.countDocuments({ source: 'hiring_cafe', status: 'partial' }),
          enriching: await board.countDocuments({ source: 'hiring_cafe', status: 'enriching' }),
          conflictLeft: await board.countDocuments({
            source: 'hiring_cafe',
            'enrichment.lastError': /would create a conflict/i,
          }),
        },
        scrapeDo: {
          tokenSet: Boolean(token),
          hcEnvEnabled: process.env.HIRING_CAFE_SCRAPE_DO_ENABLED,
        },
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
