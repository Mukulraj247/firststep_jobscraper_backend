/**
 * Stream-aggregate FY2026 LCA Excel into lean `h1b_fy2026_gov_roles`.
 * Certified filings only for title/SOC/state top-N (job-level match index).
 * Does NOT store raw filings.
 *
 * Usage:
 *   npm run h1b:aggregate-fy2026
 *
 * Env:
 *   H1B_LCA_DIR         — download dir (default: data/lca)
 *   H1B_SKIP_DOWNLOAD=1 — only aggregate already-downloaded file
 *   H1B_FY2026_SOURCE   — override label (default FY2026_Q3)
 *   H1B_MIN_CERTIFIED   — min certified to keep (default 1)
 *   H1B_FY2026_MAPPED_ONLY=1 — only upsert employers with approved brand mappings (Atlas-safe)
 */
import dotenv from 'dotenv';
import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import { employerNameNormalize } from '../services/h1b/employerNameNormalize';
import { LCA_DISCLOSURE_SOURCES } from '../services/h1b/lcaDisclosureSources';
import Fy2026GovRole from '../models/Fy2026GovRole';
import EmployerBrandMapping from '../models/EmployerBrandMapping';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

type Agg = {
  display: string;
  normalized: string;
  key: string;
  total: number;
  certified: number;
  titles: Map<string, number>;
  socs: Map<string, { title: string; n: number }>;
  states: Map<string, number>;
};

const TOP_TITLES = 20;
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

function cellStr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object' && v && 'text' in (v as object)) {
    return String((v as { text: string }).text || '').trim();
  }
  if (v instanceof Date) return String(v.getFullYear());
  return String(v).trim();
}

function isCertified(raw: string): boolean {
  const s = raw.toUpperCase();
  if (s.includes('CERTIFIED') && s.includes('WITHDRAWN')) return false;
  return s.includes('CERTIFIED');
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

async function aggregateWorkbook(filePath: string, byKey: Map<string, Agg>): Promise<number> {
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

      const employer =
        rec.EMPLOYER_NAME || rec.EMPLOYER || rec['EMPLOYER_NAME'] || rec.LEGAL_NAME || '';
      if (!employer) continue;

      const visa = (rec.VISA_CLASS || rec.VISA_TYPE || '').toUpperCase();
      if (
        visa &&
        !visa.includes('H-1B') &&
        !visa.includes('H1B') &&
        !visa.includes('E-3') &&
        !visa.includes('E3')
      ) {
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
          total: 0,
          certified: 0,
          titles: new Map(),
          socs: new Map(),
          states: new Map(),
        };
        byKey.set(norm.key, agg);
      }

      agg.total += 1;
      const certified = isCertified(rec.CASE_STATUS || rec.STATUS || '');
      if (!certified) continue;

      agg.certified += 1;

      const title = (rec.JOB_TITLE || '').slice(0, 120);
      if (title) bump(agg.titles, title.toLowerCase());

      const soc = (rec.SOC_CODE || '').replace(/\s+/g, '').slice(0, 16);
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
        console.log(`  … ${path.basename(filePath)} certifiedRows=${rows} employers=${byKey.size}`);
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

  const sourceLabel = process.env.H1B_FY2026_SOURCE || 'FY2026_Q3';
  const src =
    LCA_DISCLOSURE_SOURCES.find((s) => s.label === sourceLabel) ||
    LCA_DISCLOSURE_SOURCES.find((s) => s.fiscalYear === 2026);
  if (!src) {
    console.error(`No FY2026 source for label=${sourceLabel}`);
    process.exit(1);
  }

  const skipDownload = process.env.H1B_SKIP_DOWNLOAD === '1';
  const lcaDir = process.env.H1B_LCA_DIR || path.resolve(__dirname, '../../../data/lca');
  fs.mkdirSync(lcaDir, { recursive: true });

  const dest = path.join(lcaDir, `${src.label}.xlsx`);
  console.log(`FY2026 source: ${src.label} | ${dest}`);

  if (!skipDownload || !fs.existsSync(dest)) {
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1_000_000) {
      console.log(`Already downloaded: ${src.label} (${(fs.statSync(dest).size / 1e6).toFixed(1)} MB)`);
    } else {
      console.log(`Downloading ${src.label}…`);
      await downloadFile(src.url, dest);
      console.log(`  saved ${(fs.statSync(dest).size / 1e6).toFixed(1)} MB`);
    }
  }

  if (!fs.existsSync(dest)) {
    console.error(`Missing file: ${dest}`);
    process.exit(1);
  }

  const byKey = new Map<string, Agg>();
  console.log(`Aggregating certified FY2026 roles…`);
  const certifiedRows = await aggregateWorkbook(dest, byKey);
  console.log(`  certifiedRows=${certifiedRows} employers=${byKey.size}`);

  await mongoose.connect(uri);

  const minCertified = Math.max(1, parseInt(process.env.H1B_MIN_CERTIFIED || '1', 10) || 1);
  const mappedOnly = process.env.H1B_FY2026_MAPPED_ONLY === '1';
  let allowedKeys: Set<string> | null = null;
  if (mappedOnly) {
    const keys = await EmployerBrandMapping.distinct('govEmployerKey', {
      status: { $in: ['auto_approved', 'approved'] },
    });
    allowedKeys = new Set(keys.filter(Boolean));
    console.log(`Mapped-only filter: ${allowedKeys.size} approved govEmployerKeys`);
  }

  const dataAsOf = new Date();
  let upserted = 0;
  let skipped = 0;
  const ops: any[] = [];

  for (const agg of byKey.values()) {
    if (agg.certified < minCertified) {
      skipped += 1;
      continue;
    }
    if (allowedKeys && !allowedKeys.has(agg.key)) {
      skipped += 1;
      continue;
    }
    const topSocCodes = [...agg.socs.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, TOP_SOC)
      .map(([code, v]) => ({ code, title: v.title, n: v.n }));

    ops.push({
      updateOne: {
        filter: { govEmployerKey: agg.key },
        update: {
          $set: {
            govEmployerKey: agg.key,
            employerNameDisplay: agg.display,
            employerNameNormalized: agg.normalized,
            certifiedCount: agg.certified,
            totalFilings: agg.total,
            topJobTitles: topN(agg.titles, TOP_TITLES),
            topSocCodes,
            topStates: [...agg.states.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, TOP_STATE)
              .map(([state, n]) => ({ state, n })),
            dataAsOf,
            sourceLabel: src.label,
          },
        },
        upsert: true,
      },
    });
    upserted += 1;
    if (ops.length >= 200) {
      await Fy2026GovRole.bulkWrite(ops, { ordered: false });
      ops.length = 0;
    }
  }
  if (ops.length) await Fy2026GovRole.bulkWrite(ops, { ordered: false });

  console.log(
    JSON.stringify(
      {
        sourceLabel: src.label,
        certifiedRows,
        employersWithCertified: upserted,
        skipped,
        minCertified,
        mappedOnly,
        mappedKeyCount: allowedKeys?.size ?? null,
        dataAsOf,
      },
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
