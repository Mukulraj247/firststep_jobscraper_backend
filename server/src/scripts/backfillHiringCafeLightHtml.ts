/**
 * Backfill existing Hiring Cafe job-board rows via light HTTP HTML.
 * Resolves lost HC /job/{slug} URLs from maxun_extracteddata (applyUrl match),
 * then GETs only Hiring Cafe HTML — never employer pages.
 *
 * Usage:
 *   npx ts-node --project server/tsconfig.json server/src/scripts/backfillHiringCafeLightHtml.ts
 *   LIMIT=50 DRY_RUN=1 DELAY_MS=200 npx ts-node ...
 */
import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';
import { isHiringCafeUrl } from '../services/aggregatorIdentity';
import { isHiringCafeJobPostingUrl } from '../services/hiringCafeDetail';
import {
  enrichHiringCafeRowFromHtml,
  fetchHiringCafePostingHtml,
  isHiringCafeHtmlJobPage,
} from '../services/hiringCafeHtmlLight';
import { makeDescriptionSnippet, normalizeJobDescription } from '../services/jobPageParser';
import { buildListSnapshot } from '../services/jobBoardEnrichment';
import { normalizeJobUrl } from '../services/jobUrlNormalize';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

function pickHcPostingUrl(doc: any, applyToHc: Map<string, string>): string {
  const candidates = [
    doc.aggregatorPostingUrl,
    doc.listSnapshot?.aggregatorPostingUrl,
    doc.jobUrl,
    doc.listSnapshot?.jobUrl,
  ];
  for (const raw of candidates) {
    const url = String(raw || '').trim();
    if (url && isHiringCafeUrl(url) && isHiringCafeJobPostingUrl(url)) return url;
  }

  for (const raw of [doc.applyUrl, doc.jobUrl, doc.listSnapshot?.applyUrl]) {
    const key = normalizeJobUrl(raw);
    if (key && applyToHc.has(key)) return applyToHc.get(key)!;
  }
  return '';
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadApplyUrlToHcMap(
  db: mongoose.mongo.Db
): Promise<Map<string, string>> {
  const extracted = db.collection('maxun_extracteddata');
  const cursor = extracted.find(
    {
      $or: [
        { 'data.jobUrl': /hiring\.?cafe\.com\/job\//i },
        { 'data.url': /hiring\.?cafe\.com\/job\//i },
      ],
    },
    {
      projection: {
        'data.jobUrl': 1,
        'data.url': 1,
        'data.applyUrl': 1,
        'data.apply_url': 1,
      },
    }
  );

  const map = new Map<string, string>();
  for await (const row of cursor) {
    const data = row.data || {};
    const hc = String(data.jobUrl || data.url || '').trim();
    if (!hc || !isHiringCafeUrl(hc) || !isHiringCafeJobPostingUrl(hc)) continue;
    const apply = normalizeJobUrl(data.applyUrl || data.apply_url);
    if (apply && !isHiringCafeUrl(apply) && !map.has(apply)) {
      map.set(apply, hc);
    }
  }
  return map;
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.DB_URL || process.env.MONGO_URI;
  if (!uri) {
    console.error('Missing MONGODB_URI');
    process.exit(1);
  }

  const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
  const limit = Math.max(0, parseInt(process.env.LIMIT || '0', 10) || 0);
  const delayMs = Math.max(0, parseInt(process.env.DELAY_MS || '200', 10) || 200);
  const retry429 = Math.max(0, parseInt(process.env.RETRY_429 || '4', 10) || 4);
  const dbName = process.env.MONGODB_DATABASE || undefined;

  await mongoose.connect(uri, dbName ? { dbName } : undefined);
  const db = mongoose.connection.db!;
  const board = db.collection('maxun_job_board');
  console.log(`Connected${dbName ? ` (db=${dbName})` : ''}. dryRun=${dryRun} limit=${limit || 'all'}`);

  console.log('Building applyUrl → Hiring Cafe posting map from extracted data…');
  const applyToHc = await loadApplyUrlToHcMap(db);
  console.log(`Mapped ${applyToHc.size} employer apply URLs → HC postings`);

  const filter: Record<string, unknown> = {
    $or: [
      { source: 'hiring_cafe' },
      { jobUrl: /hiring\.?cafe\.com\/job\//i },
      { aggregatorPostingUrl: /hiring\.?cafe/i },
      { 'listSnapshot.aggregatorPostingUrl': /hiring\.?cafe/i },
    ],
  };

  // Retry mode: only rows that still lack a stored HC posting URL from a prior backfill.
  if (process.env.ONLY_MISSING === '1' || process.env.ONLY_MISSING === 'true') {
    filter.$and = [
      {
        $or: [
          { aggregatorPostingUrl: { $exists: false } },
          { aggregatorPostingUrl: '' },
          { aggregatorPostingUrl: null },
        ],
      },
    ];
  }

  const total = await board.countDocuments(filter);
  console.log(`Hiring Cafe board rows matched: ${total}`);

  const query = board.find(filter, {
    projection: {
      jobUrl: 1,
      applyUrl: 1,
      aggregatorPostingUrl: 1,
      listSnapshot: 1,
      jobTitle: 1,
      companyName: 1,
      jobDescription: 1,
      status: 1,
      source: 1,
    },
  });
  if (limit > 0) query.limit(limit);
  const rows = await query.toArray();
  console.log(`Loaded ${rows.length} row(s) to process`);

  const stats = {
    scanned: 0,
    noHcUrl: 0,
    fetchFail: 0,
    updated: 0,
    errors: 0,
  };

  for (const doc of rows) {
    stats.scanned += 1;
    const postingUrl = pickHcPostingUrl(doc, applyToHc);
    if (!postingUrl) {
      stats.noHcUrl += 1;
      if (stats.noHcUrl <= 8) {
        console.log(`  no HC posting URL _id=${doc._id} jobUrl=${doc.jobUrl || ''}`);
      }
      continue;
    }

    process.stdout.write(`  [${stats.scanned}/${rows.length}] ${postingUrl.slice(0, 78)}… `);

    try {
      let light = await fetchHiringCafePostingHtml(postingUrl);
      let attempt = 0;
      while (
        (!light.ok || /429/.test(String(light.error || ''))) &&
        attempt < retry429
      ) {
        attempt += 1;
        const wait = Math.min(30_000, 1500 * Math.pow(2, attempt));
        console.log(`429/backoff ${wait}ms…`);
        await sleep(wait);
        light = await fetchHiringCafePostingHtml(postingUrl);
      }
      if (!light.ok || !light.html || !isHiringCafeHtmlJobPage(light.html)) {
        stats.fetchFail += 1;
        console.log(`FAIL ${light.error || 'no next_data'}`);
        if (delayMs) await sleep(delayMs);
        continue;
      }

      // Empty list row so HC Full View fields replace stale board values (e.g. ticker-as-company).
      const merged = enrichHiringCafeRowFromHtml({}, light.html, postingUrl);
      if (!merged.applyUrl && doc.applyUrl && !isHiringCafeUrl(String(doc.applyUrl))) {
        merged.applyUrl = doc.applyUrl;
      }

      const desc = normalizeJobDescription(String(merged.jobDescription || ''));
      const snapshot = buildListSnapshot({ ...merged, aggregatorPostingUrl: postingUrl });
      const prevLen = String(doc.jobDescription || '').length;

      const $set: Record<string, unknown> = {
        source: 'hiring_cafe',
        aggregatorPostingUrl: postingUrl,
        listSnapshot: { ...(doc.listSnapshot || {}), ...snapshot, aggregatorPostingUrl: postingUrl },
        jobTitle: snapshot.jobTitle || doc.jobTitle || '',
        companyName: snapshot.companyName || doc.companyName || '',
        jobDescription: desc,
        descriptionSnippet: makeDescriptionSnippet(desc),
        location: snapshot.location || '',
        salaryRange: snapshot.salaryRange || '',
        employmentType: snapshot.employmentType || '',
        remoteType: snapshot.remoteType || '',
        jobCategory: snapshot.jobCategory || '',
        jobExperience: snapshot.jobExperience || 0,
        sectorIndustry: snapshot.sectorIndustry || '',
        f500: snapshot.f500 || '',
        about: snapshot.about || '',
        companyLogoUrl: snapshot.companyLogoUrl || '',
        companyWebsite: snapshot.companyWebsite || '',
        companyEmployeeCount: snapshot.companyEmployeeCount || 0,
        companyFoundedYear: snapshot.companyFoundedYear || 0,
        skills: snapshot.skills || [],
        responsibilities: snapshot.responsibilities || [],
        minimumQualifications: snapshot.minimumQualifications || [],
        preferredQualifications: snapshot.preferredQualifications || [],
        benefits: snapshot.benefits || [],
        certifications: snapshot.certifications || [],
        seniorityLevel: snapshot.seniorityLevel || '',
        roleType: snapshot.roleType || '',
        educationRequirement: snapshot.educationRequirement || '',
        visaSponsorship: snapshot.visaSponsorship || '',
        'enrichment.method': 'list',
        'enrichment.lastError': 'backfill_hiring_cafe_light_html',
        'enrichment.lastEnrichedAt': new Date(),
      };

      if (snapshot.date) $set.date = snapshot.date;
      if (merged.applyUrl && !isHiringCafeUrl(String(merged.applyUrl))) {
        $set.applyUrl = String(merged.applyUrl);
      }
      if (desc.length >= 60 && snapshot.jobTitle && snapshot.companyName) {
        $set.status = 'ready';
      }

      if (!dryRun) {
        await board.updateOne({ _id: doc._id }, { $set });
      }
      stats.updated += 1;
      console.log(
        `${dryRun ? 'DRY ' : ''}OK desc ${prevLen}→${desc.length} | ${snapshot.companyName} / ${snapshot.jobTitle}`
      );
    } catch (err: any) {
      stats.errors += 1;
      console.log(`ERR ${err?.message || err}`);
    }

    if (delayMs) await sleep(delayMs);
  }

  console.log(JSON.stringify(stats, null, 2));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
