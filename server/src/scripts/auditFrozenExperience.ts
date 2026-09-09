/**
 * Read-only experience tag audit — classify a sample and write CSV for review.
 * Does NOT write to MongoDB.
 *
 *   npx ts-node --project server/tsconfig.json \
 *     server/src/scripts/auditFrozenExperience.ts --limit 1000 --out tmp-exp-audit.csv
 *
 * Options:
 *   --limit N
 *   --out PATH   (default: frozen-experience-audit.csv in cwd)
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import mongoose from 'mongoose';
import JobBoardListing from '../models/JobBoardListing';
import { isAggregatorListingSource } from '../services/aggregatorIdentity';
import {
  EXPERIENCE_RULES_VERSION,
  experienceContentHashParts,
  resolveFrozenExperience,
} from '../../../src/shared/frozenExperience';

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

/** Prevent Excel from turning "7-10" into 7-Oct / Oct-15. */
function csvEscapeYearsBand(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!s) return '';
  // Excel formula that evaluates to the literal text band string.
  return `="${s.replace(/"/g, '""')}"`;
}

async function main() {
  const limit = parsePositiveInt(argValue('--limit'), 1000);
  const outPath = path.resolve(
    process.cwd(),
    argValue('--out') || 'frozen-experience-audit.csv'
  );

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URL;
  if (!uri) throw new Error('MONGODB_URI missing');

  await mongoose.connect(
    uri,
    process.env.MONGODB_DATABASE ? { dbName: process.env.MONGODB_DATABASE } : undefined
  );

  console.log(
    `auditFrozenExperience start limit=${limit} rules=${EXPERIENCE_RULES_VERSION} out=${outPath}`
  );

  const cursor = JobBoardListing.find({ status: { $in: ['ready', 'partial'] } })
    .select(
      'jobTitle jobDescription seniorityLevel jobExperience minimumQualifications preferredQualifications source listSnapshot'
    )
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean()
    .cursor();

  const lines: string[] = [
    [
      'title',
      'levels',
      'years',
      'method',
      'jobExperience',
      'titleScore',
      'yearsScore',
      'seniorityLevel',
      'signals',
      'contentHash',
    ].join(','),
  ];

  let processed = 0;
  const methodCounts = new Map<string, number>();

  for await (const doc of cursor) {
    processed += 1;
    const list = (doc as any).listSnapshot || {};
    const quals = [
      ...((doc as any).minimumQualifications || list.minimumQualifications || []),
      ...((doc as any).preferredQualifications || list.preferredQualifications || []),
    ]
      .map((x: unknown) => String(x || '').trim())
      .filter(Boolean);
    const minYoe = Number((doc as any).jobExperience) || Number(list.jobExperience) || 0;
    const maxYoe = Number(list.jobExperienceMax) || 0;
    const expInput = {
      title: String((doc as any).jobTitle || list.jobTitle || ''),
      description: String((doc as any).jobDescription || list.jobDescription || ''),
      qualifications: quals,
      seniorityLevel: String((doc as any).seniorityLevel || list.seniorityLevel || ''),
      minYoe: minYoe > 0 ? minYoe : null,
      maxYoe: maxYoe > 0 ? maxYoe : null,
      isAggregator: isAggregatorListingSource(String((doc as any).source || '').trim()),
    };
    const result = resolveFrozenExperience(expInput);
    const hash = createHash('sha1')
      .update(experienceContentHashParts(expInput))
      .digest('hex')
      .slice(0, 16);
    methodCounts.set(result.method, (methodCounts.get(result.method) || 0) + 1);

    lines.push(
      [
        csvEscape(expInput.title),
        csvEscape(result.frozenExperienceLevels.join('|')),
        csvEscapeYearsBand(result.frozenExperienceYears.join('|')),
        csvEscape(result.method),
        csvEscape(result.jobExperience),
        csvEscape(result.titleScore),
        csvEscape(result.yearsScore),
        csvEscape(expInput.seniorityLevel),
        csvEscape(result.matchedSignals.slice(0, 20).join(';')),
        csvEscape(hash),
      ].join(',')
    );

    if (processed % 200 === 0) {
      console.log(`progress processed=${processed}`);
    }
  }

  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`done processed=${processed} wrote=${outPath}`);
  console.log(
    'methods:',
    [...methodCounts.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
