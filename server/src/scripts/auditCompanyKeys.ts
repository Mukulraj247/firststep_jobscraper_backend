/**
 * Read-only company-key audit — resolve employer URLs to proposed company keys.
 * Does NOT write to MongoDB.
 *
 *   npx ts-node --project server/tsconfig.json \
 *     server/src/scripts/auditCompanyKeys.ts --limit 20000 --out tmp-company-keys.csv
 *
 * Options:
 *   --limit N        (default: 5000)
 *   --out PATH       per-listing CSV (default: company-keys-audit.csv in cwd)
 *   --summary PATH   by-key rollup (default: {out}-by-key.csv)
 *   --unresolved PATH unresolved hosts rollup (default: {out}-unresolved.csv)
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import mongoose from 'mongoose';
import JobBoardListing from '../models/JobBoardListing';
import { isAggregatorListingSource } from '../services/aggregatorIdentity';
import {
  isExcludedJobBoardHost,
  pickEmployerUrlForCompanyResolution,
  resolveCompanyKey,
} from '../services/companyIdentity';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function csvEscape(value: unknown): string {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function hostFromUrl(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

type ListingRow = {
  jobUrl: string;
  applyUrl: string;
  employerUrl: string;
  host: string;
  companyKey: string;
  tier: string;
  atsProvider: string;
  nameHint: string;
  companyName: string;
  source: string;
  confidence: string;
  unresolvedReason: string;
};

type KeySummary = {
  companyKey: string;
  jobCount: number;
  companyNames: Set<string>;
  hosts: Set<string>;
  tiers: Set<string>;
  sources: Set<string>;
};

type UnresolvedSummary = {
  host: string;
  jobCount: number;
  companyNames: Set<string>;
  sources: Set<string>;
  reasons: Set<string>;
};

async function main() {
  const limit = parsePositiveInt(argValue('--limit'), 5000);
  const outPath = path.resolve(process.cwd(), argValue('--out') || 'company-keys-audit.csv');
  const summaryPath = path.resolve(
    process.cwd(),
    argValue('--summary') || outPath.replace(/\.csv$/i, '') + '-by-key.csv'
  );
  const unresolvedPath = path.resolve(
    process.cwd(),
    argValue('--unresolved') || outPath.replace(/\.csv$/i, '') + '-unresolved.csv'
  );

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URL;
  if (!uri) throw new Error('MONGODB_URI missing');

  await mongoose.connect(
    uri,
    process.env.MONGODB_DATABASE ? { dbName: process.env.MONGODB_DATABASE } : undefined
  );

  console.log(
    `auditCompanyKeys start limit=${limit} out=${outPath} summary=${summaryPath} unresolved=${unresolvedPath}`
  );

  const cursor = JobBoardListing.find({ status: { $in: ['ready', 'partial', 'queued', 'enriching'] } })
    .select('jobUrl applyUrl companyName source listSnapshot status')
    .sort({ _id: -1 })
    .limit(limit)
    .allowDiskUse(true)
    .lean()
    .cursor();

  const listingLines: string[] = [
    [
      'jobUrl',
      'applyUrl',
      'employerUrl',
      'host',
      'companyKey',
      'tier',
      'atsProvider',
      'nameHint',
      'companyName',
      'source',
      'confidence',
      'unresolvedReason',
    ].join(','),
  ];

  const byKey = new Map<string, KeySummary>();
  const unresolvedByHost = new Map<string, UnresolvedSummary>();

  let processed = 0;
  let resolvedCount = 0;
  let unresolvedCount = 0;

  for await (const doc of cursor) {
    processed += 1;
    const list = (doc as any).listSnapshot || {};
    const jobUrl = String((doc as any).jobUrl || list.jobUrl || '').trim();
    const applyUrl = String((doc as any).applyUrl || list.applyUrl || '').trim();
    const companyName = String((doc as any).companyName || list.companyName || '').trim();
    const source = String((doc as any).source || '').trim();

    const employerUrl =
      pickEmployerUrlForCompanyResolution({ jobUrl, applyUrl }) || jobUrl || applyUrl;
    const host = hostFromUrl(employerUrl);
    const resolution = employerUrl ? resolveCompanyKey(employerUrl) : null;

    let unresolvedReason = '';
    if (!employerUrl) {
      unresolvedReason = 'no_url';
    } else if (!host) {
      unresolvedReason = 'bad_url';
    } else if (isExcludedJobBoardHost(host)) {
      unresolvedReason = isAggregatorListingSource(source) ? 'aggregator_host' : 'excluded_host';
    } else if (!resolution) {
      unresolvedReason = 'no_key';
    } else if (resolution.confidence === 'low') {
      unresolvedReason = 'low_confidence';
    }

    const row: ListingRow = {
      jobUrl,
      applyUrl,
      employerUrl,
      host,
      companyKey: resolution?.companyKey || '',
      tier: resolution?.tier || '',
      atsProvider: resolution?.atsProvider || '',
      nameHint: resolution?.nameHint || '',
      companyName,
      source,
      confidence: resolution?.confidence || '',
      unresolvedReason,
    };

    listingLines.push(
      [
        csvEscape(row.jobUrl),
        csvEscape(row.applyUrl),
        csvEscape(row.employerUrl),
        csvEscape(row.host),
        csvEscape(row.companyKey),
        csvEscape(row.tier),
        csvEscape(row.atsProvider),
        csvEscape(row.nameHint),
        csvEscape(row.companyName),
        csvEscape(row.source),
        csvEscape(row.confidence),
        csvEscape(row.unresolvedReason),
      ].join(',')
    );

    if (resolution && !unresolvedReason) {
      resolvedCount += 1;
      const key = resolution.companyKey;
      let summary = byKey.get(key);
      if (!summary) {
        summary = {
          companyKey: key,
          jobCount: 0,
          companyNames: new Set(),
          hosts: new Set(),
          tiers: new Set(),
          sources: new Set(),
        };
        byKey.set(key, summary);
      }
      summary.jobCount += 1;
      if (companyName) summary.companyNames.add(companyName);
      if (host) summary.hosts.add(host);
      summary.tiers.add(resolution.tier);
      if (source) summary.sources.add(source);
    } else {
      unresolvedCount += 1;
      const uHost = host || '(no_host)';
      let u = unresolvedByHost.get(uHost);
      if (!u) {
        u = {
          host: uHost,
          jobCount: 0,
          companyNames: new Set(),
          sources: new Set(),
          reasons: new Set(),
        };
        unresolvedByHost.set(uHost, u);
      }
      u.jobCount += 1;
      if (companyName) u.companyNames.add(companyName);
      if (source) u.sources.add(source);
      if (unresolvedReason) u.reasons.add(unresolvedReason);
    }

    if (processed % 500 === 0) {
      console.log(`progress processed=${processed} resolved=${resolvedCount} unresolved=${unresolvedCount}`);
    }
  }

  fs.writeFileSync(outPath, `${listingLines.join('\n')}\n`, 'utf8');

  const summaryLines: string[] = [
    [
      'companyKey',
      'jobCount',
      'companyNameVariants',
      'companyNameVariantCount',
      'hosts',
      'hostCount',
      'tiers',
      'sources',
    ].join(','),
  ];

  const sortedKeys = [...byKey.values()].sort((a, b) => b.jobCount - a.jobCount);
  for (const summary of sortedKeys) {
    const names = [...summary.companyNames].sort();
    const hosts = [...summary.hosts].sort();
    summaryLines.push(
      [
        csvEscape(summary.companyKey),
        csvEscape(summary.jobCount),
        csvEscape(names.join(' | ')),
        csvEscape(names.length),
        csvEscape(hosts.join(' | ')),
        csvEscape(hosts.length),
        csvEscape([...summary.tiers].join('|')),
        csvEscape([...summary.sources].sort().join('|')),
      ].join(',')
    );
  }
  fs.writeFileSync(summaryPath, `${summaryLines.join('\n')}\n`, 'utf8');

  const unresolvedLines: string[] = [
    ['host', 'jobCount', 'reasons', 'companyNameVariants', 'sources'].join(','),
  ];
  const sortedUnresolved = [...unresolvedByHost.values()].sort((a, b) => b.jobCount - a.jobCount);
  for (const u of sortedUnresolved) {
    unresolvedLines.push(
      [
        csvEscape(u.host),
        csvEscape(u.jobCount),
        csvEscape([...u.reasons].sort().join('|')),
        csvEscape([...u.companyNames].sort().join(' | ')),
        csvEscape([...u.sources].sort().join('|')),
      ].join(',')
    );
  }
  fs.writeFileSync(unresolvedPath, `${unresolvedLines.join('\n')}\n`, 'utf8');

  console.log(`done processed=${processed} resolved=${resolvedCount} unresolved=${unresolvedCount}`);
  console.log(`wrote listing=${outPath}`);
  console.log(`wrote summary=${summaryPath} keys=${sortedKeys.length}`);
  console.log(`wrote unresolved=${unresolvedPath} hosts=${sortedUnresolved.length}`);

  const multiNameKeys = sortedKeys.filter((k) => k.companyNames.size > 1).slice(0, 10);
  if (multiNameKeys.length) {
    console.log('top keys with multiple companyName variants (merge candidates):');
    for (const k of multiNameKeys) {
      console.log(
        `  ${k.companyKey} count=${k.jobCount} names=${[...k.companyNames].slice(0, 5).join(' | ')}`
      );
    }
  }

  const multiHostKeys = sortedKeys.filter((k) => k.hosts.size > 1).slice(0, 10);
  if (multiHostKeys.length) {
    console.log('top keys with multiple hosts (sibling-domain merge candidates):');
    for (const k of multiHostKeys) {
      console.log(
        `  ${k.companyKey} count=${k.jobCount} hosts=${[...k.hosts].slice(0, 5).join(' | ')}`
      );
    }
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
