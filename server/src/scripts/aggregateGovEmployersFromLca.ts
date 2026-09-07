/**
 * Download DOL LCA Excel files to local disk and stream-aggregate into lean
 * `h1b_gov_employers` docs. Does NOT store raw filings in Mongo (free-tier safe).
 *
 * Usage:
 *   npx ts-node --project server/tsconfig.json server/src/scripts/aggregateGovEmployersFromLca.ts
 *
 * Env:
 *   H1B_LCA_DIR          — download dir (default: data/lca under repo root)
 *   H1B_MIN_CERTIFIED    — min certified filings to keep employer (default: 3)
 *   H1B_FROM_YEAR / H1B_TO_YEAR — fiscal year window (default 2019–2026)
 *   H1B_SKIP_DOWNLOAD=1  — only aggregate already-downloaded files
 */
import dotenv from 'dotenv';
import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import { employerNameNormalize } from '../services/h1b/employerNameNormalize';
import { pickLcaSources } from '../services/h1b/lcaDisclosureSources';
import GovEmployer from '../models/GovEmployer';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

type Agg = {
  display: string;
  normalized: string;
  key: string;
  variants: Set<string>;
  total: number;
  certified: number;
  denied: number;
  withdrawn: number;
  years: Set<number>;
  titles: Map<string, number>;
  socs: Map<string, { title: string; n: number }>;
  states: Map<string, number>;
};

const TOP_N = 15;
const TOP_SOC = 10;
const TOP_STATE = 10;

function bump(map: Map<string, number>, key: string, n = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + n);
}

function topN(map: Map<string, number>, n: number): Array<{ title: string; n: number }> {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([title, count]) => ({ title, n: count }));
}

function downloadFileHttp(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const lib = url.startsWith('https') ? https : http;
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*',
      Referer: 'https://www.dol.gov/agencies/eta/foreign-labor/performance',
      'Accept-Language': 'en-US,en;q=0.9',
    };
    const req = lib.get(url, { headers }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        try {
          fs.unlinkSync(dest);
        } catch {
          /* ignore */
        }
        downloadFileHttp(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        try {
          fs.unlinkSync(dest);
        } catch {
          /* ignore */
        }
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    });
    req.on('error', (err) => {
      try {
        fs.unlinkSync(dest);
      } catch {
        /* ignore */
      }
      reject(err);
    });
  });
}

/** DOL Akamai blocks plain Node downloads (403). Playwright request context works. */
async function downloadFileBrowser(url: string, dest: string): Promise<void> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      extraHTTPHeaders: {
        Referer: 'https://www.dol.gov/agencies/eta/foreign-labor/performance',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    // Warm cookies / bot checks from the performance landing page
    const page = await context.newPage();
    await page.goto('https://www.dol.gov/agencies/eta/foreign-labor/performance', {
      waitUntil: 'domcontentloaded',
      timeout: 90_000,
    });
    await page.close();

    const response = await context.request.get(url, { timeout: 600_000 });
    if (!response.ok()) {
      throw new Error(`HTTP ${response.status()} for ${url}`);
    }
    const body = await response.body();
    if (!body || body.length < 10_000) {
      throw new Error(`Download too small (${body?.length || 0} bytes) for ${url}`);
    }
    fs.writeFileSync(dest, body);
  } finally {
    await browser.close();
  }
}

async function downloadFile(url: string, dest: string): Promise<void> {
  try {
    await downloadFileHttp(url, dest);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 10_000) return;
  } catch (e: any) {
    console.warn(`  http download failed (${e?.message || e}); trying Playwright…`);
  }
  if (fs.existsSync(dest)) {
    try {
      fs.unlinkSync(dest);
    } catch {
      /* ignore */
    }
  }
  await downloadFileBrowser(url, dest);
}

function cellStr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object' && v && 'text' in (v as object)) {
    return String((v as { text: string }).text || '').trim();
  }
  if (v instanceof Date) return String(v.getFullYear());
  return String(v).trim();
}

function statusBucket(raw: string): 'certified' | 'denied' | 'withdrawn' | 'other' {
  const s = raw.toUpperCase();
  if (s.includes('CERTIFIED') && s.includes('WITHDRAWN')) return 'withdrawn';
  if (s.includes('CERTIFIED')) return 'certified';
  if (s.includes('DENIED')) return 'denied';
  if (s.includes('WITHDRAWN')) return 'withdrawn';
  return 'other';
}

function yearFromRow(row: Record<string, string>, fiscalYear: number): number {
  const decision = row.DECISION_DATE || row.DECISION_DATE || row['Decision Date'] || '';
  const received = row.RECEIVED_DATE || row['Received Date'] || '';
  for (const d of [decision, received]) {
    const m = d.match(/(20\d{2})/);
    if (m) return parseInt(m[1], 10);
  }
  return fiscalYear;
}

async function aggregateWorkbook(
  filePath: string,
  fiscalYear: number,
  byKey: Map<string, Agg>
): Promise<number> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
    entries: 'emit',
    sharedStrings: 'cache',
    worksheets: 'emit',
  });

  let rows = 0;
  let headers: string[] = [];

  for await (const worksheetReader of workbook) {
    for await (const row of worksheetReader) {
      const values = row.values as unknown[];
      if (!values || values.length < 2) continue;

      if (row.number === 1) {
        headers = values.map((v) => cellStr(v).toUpperCase().replace(/\s+/g, '_'));
        continue;
      }

      const rec: Record<string, string> = {};
      for (let i = 1; i < headers.length; i++) {
        const h = headers[i];
        if (!h) continue;
        rec[h] = cellStr(values[i]);
      }

      // Column name variants across years
      const employer =
        rec.EMPLOYER_NAME ||
        rec.EMPLOYER ||
        rec['EMPLOYER_NAME'] ||
        rec.LEGAL_NAME ||
        '';
      if (!employer) continue;

      const visa = (rec.VISA_CLASS || rec.VISA_TYPE || '').toUpperCase();
      if (visa && !visa.includes('H-1B') && !visa.includes('H1B') && !visa.includes('E-3') && !visa.includes('E3')) {
        // Older files are H-1B-only; empty visa → keep
        if (visa.length > 0) continue;
      }

      const norm = employerNameNormalize(employer);
      if (!norm.key || norm.key.length < 3) continue;

      let agg = byKey.get(norm.key);
      if (!agg) {
        agg = {
          display: norm.display || employer,
          normalized: norm.normalized,
          key: norm.key,
          variants: new Set([employer.slice(0, 120)]),
          total: 0,
          certified: 0,
          denied: 0,
          withdrawn: 0,
          years: new Set(),
          titles: new Map(),
          socs: new Map(),
          states: new Map(),
        };
        byKey.set(norm.key, agg);
      } else {
        agg.variants.add(employer.slice(0, 120));
      }

      agg.total += 1;
      const bucket = statusBucket(rec.CASE_STATUS || rec.STATUS || '');
      if (bucket === 'certified') agg.certified += 1;
      else if (bucket === 'denied') agg.denied += 1;
      else if (bucket === 'withdrawn') agg.withdrawn += 1;

      const y = yearFromRow(rec, fiscalYear);
      if (y >= 2008 && y <= 2030) agg.years.add(y);

      const title = (rec.JOB_TITLE || rec.JOB_TITLE || '').slice(0, 120);
      if (title) bump(agg.titles, title.toLowerCase());

      const soc = (rec.SOC_CODE || rec.SOC_CODE || '').replace(/\s+/g, '').slice(0, 16);
      const socTitle = (rec.SOC_TITLE || '').slice(0, 120);
      if (soc) {
        const prev = agg.socs.get(soc) || { title: socTitle, n: 0 };
        prev.n += 1;
        if (!prev.title && socTitle) prev.title = socTitle;
        agg.socs.set(soc, prev);
      }

      const state = (rec.WORKSITE_STATE || rec.EMPLOYER_STATE || '').toUpperCase().slice(0, 2);
      if (state.length === 2) bump(agg.states, state);

      rows += 1;
      if (rows % 100000 === 0) {
        console.log(`  … ${path.basename(filePath)} rows=${rows} employers=${byKey.size}`);
      }
    }
  }

  return rows;
}

async function main() {
  const uri = process.env.DB_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('Missing MONGODB_URI');
    process.exit(1);
  }

  const fromYear = parseInt(process.env.H1B_FROM_YEAR || '2019', 10);
  const toYear = parseInt(process.env.H1B_TO_YEAR || '2026', 10);
  const minCertified = parseInt(process.env.H1B_MIN_CERTIFIED || '3', 10);
  const skipDownload = process.env.H1B_SKIP_DOWNLOAD === '1';
  const lcaDir =
    process.env.H1B_LCA_DIR || path.resolve(__dirname, '../../../data/lca');

  fs.mkdirSync(lcaDir, { recursive: true });

  const sources = pickLcaSources({ fromYear, toYear });
  console.log(`Sources: ${sources.map((s) => s.label).join(', ')}`);
  console.log(`Dir: ${lcaDir} | minCertified=${minCertified}`);

  for (const src of sources) {
    const dest = path.join(lcaDir, `${src.label}.xlsx`);
    if (skipDownload && fs.existsSync(dest)) {
      console.log(`Skip download (exists): ${src.label}`);
      continue;
    }
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1_000_000) {
      console.log(`Already downloaded: ${src.label} (${(fs.statSync(dest).size / 1e6).toFixed(1)} MB)`);
      continue;
    }
    console.log(`Downloading ${src.label}…`);
    try {
      await downloadFile(src.url, dest);
      console.log(`  saved ${(fs.statSync(dest).size / 1e6).toFixed(1)} MB`);
    } catch (e: any) {
      console.error(`  FAILED ${src.label}: ${e?.message || e}`);
    }
  }

  const byKey = new Map<string, Agg>();
  let totalRows = 0;
  for (const src of sources) {
    const dest = path.join(lcaDir, `${src.label}.xlsx`);
    if (!fs.existsSync(dest)) {
      console.warn(`Missing file, skip aggregate: ${dest}`);
      continue;
    }
    console.log(`Aggregating ${src.label}…`);
    const n = await aggregateWorkbook(dest, src.fiscalYear, byKey);
    totalRows += n;
    console.log(`  rows=${n} employers so far=${byKey.size}`);
  }

  console.log(`Connecting Mongo…`);
  await mongoose.connect(uri);

  const dataAsOf = new Date();
  let kept = 0;
  let skipped = 0;
  const ops: any[] = [];

  for (const agg of byKey.values()) {
    if (agg.certified < minCertified) {
      skipped += 1;
      continue;
    }
    kept += 1;
    const years = [...agg.years].sort((a, b) => a - b);
    const topSocCodes = [...agg.socs.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, TOP_SOC)
      .map(([code, v]) => ({ code, title: v.title, n: v.n }));

    ops.push({
      updateOne: {
        filter: { employerNameKey: agg.key },
        update: {
          $set: {
            employerNameNormalized: agg.normalized,
            employerNameKey: agg.key,
            employerNameDisplay: agg.display,
            employerNameVariants: [...agg.variants].slice(0, 20),
            totalFilings: agg.total,
            certifiedCount: agg.certified,
            deniedCount: agg.denied,
            withdrawnCount: agg.withdrawn,
            firstFilingYear: years[0] || 0,
            lastFilingYear: years[years.length - 1] || 0,
            yearsActive: years,
            topJobTitles: topN(agg.titles, TOP_N),
            topSocCodes,
            topStates: [...agg.states.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, TOP_STATE)
              .map(([state, n]) => ({ state, n })),
            dataAsOf,
          },
        },
        upsert: true,
      },
    });

    if (ops.length >= 500) {
      await GovEmployer.bulkWrite(ops, { ordered: false });
      ops.length = 0;
    }
  }
  if (ops.length) await GovEmployer.bulkWrite(ops, { ordered: false });

  console.log(
    JSON.stringify(
      {
        totalRows,
        uniqueEmployersSeen: byKey.size,
        upsertedKept: kept,
        skippedBelowMinCertified: skipped,
        minCertified,
        dataAsOf,
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
