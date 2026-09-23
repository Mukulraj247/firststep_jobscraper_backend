/**
 * Full Category-QA audit: 1000 jobs in batches of 100.
 * Recomputes industry / experience / location / student / specialty gate
 * from stored ATS scrape fields and compares to frozen tags.
 *
 *   npx ts-node --transpile-only server/src/scripts/auditCategoryQaBatches.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import JobBoardListing from '../models/JobBoardListing';
import {
  resolveFrozenExperience,
  EXPERIENCE_RULES_VERSION,
} from '../../../src/shared/frozenExperience';
import {
  classifyJobLocation,
  LOCATION_RULES_VERSION,
} from '../../../src/shared/frozenLocations';
import {
  resolveFrozenIndustries,
  INDUSTRY_RULES_VERSION,
} from '../../../src/shared/frozenIndustries';
import {
  applySpecialtyTitleOverrides,
  specialtyLacksTitleEvidence,
  SPECIALTY_OVERRIDE_VERSION,
} from '../../../src/shared/specialtyTitleOverrides';
import { detectStudentEscape } from '../../../src/shared/studentEscape';
import { sanitizeCompanyName } from '../services/jobPageParser';
import { isAggregatorListingSource } from '../services/aggregatorIdentity';

const BATCH_ID = 'cat-qa-ui-sample';
const CHUNK = 100;

type Issue = {
  batch: number;
  id: string;
  title: string;
  field: string;
  kind: string;
  detail: string;
  ats?: string;
  stored?: string;
  expected?: string;
};

function eqArr(a: string[], b: string[]) {
  const aa = [...(a || [])].map(String).sort();
  const bb = [...(b || [])].map(String).sort();
  return aa.length === bb.length && aa.every((x, i) => x === bb[i]);
}

function locKey(r: {
  frozenStates?: string[];
  locationIsRemote?: boolean;
  locationIsUs?: boolean | null;
}) {
  return JSON.stringify({
    states: [...(r.frozenStates || [])].map(String).sort(),
    remote: !!r.locationIsRemote,
    us: r.locationIsUs !== false,
  });
}

function techish(title: string): boolean {
  return /\b(software|engineer|developer|programmer|devops|sre|fullstack|full[\s-]?stack|frontend|backend|data\s+(engineer|scientist|analyst)|machine\s+learning|ml\s+engineer|ai\s+(engineer|research)|cyber|security\s+engineer|cloud|platform\s+engineer|embedded|firmware|fpga|asic|qa\s+engineer|sdet|product\s+manager|architect|salesforce|sap\b|network\s+engineer|sysadmin|site\s+reliability|ios|android|react|blockchain|ux|ui\/ux|systems?\s+analyst|applications?\s+engineer|infrastructure|rtos|hypervisor|it\s+developer|sw\s+developer)\b/i.test(
    title
  );
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URL;
  if (!uri) throw new Error('No Mongo URI');
  await mongoose.connect(
    uri,
    process.env.MONGODB_DATABASE ? { dbName: process.env.MONGODB_DATABASE } : undefined
  );

  const docs = (await JobBoardListing.find({ categoryQaBatchId: BATCH_ID })
    .sort({ _id: 1 })
    .lean()) as any[];

  const versions = {
    specialtyOverride: SPECIALTY_OVERRIDE_VERSION,
    industryCode: INDUSTRY_RULES_VERSION,
    experienceCode: EXPERIENCE_RULES_VERSION,
    locationCode: LOCATION_RULES_VERSION,
    storedIndustry: new Set<string>(),
    storedExperience: new Set<string>(),
    storedLocation: new Set<string>(),
  };

  const fill = {
    specialty: 0,
    industry: 0,
    experience: 0,
    location: 0,
    company: 0,
    studentTrue: 0,
    h1bTrue: 0,
  };

  const issues: Issue[] = [];
  const batchSummaries: Array<Record<string, unknown>> = [];
  const issueCounts = new Map<string, number>();

  const bump = (k: string) => issueCounts.set(k, (issueCounts.get(k) || 0) + 1);

  for (let start = 0; start < docs.length; start += CHUNK) {
    const chunk = docs.slice(start, start + CHUNK);
    const batchNum = Math.floor(start / CHUNK) + 1;
    const batchIssues: Issue[] = [];

    for (const d of chunk) {
      const list = d.listSnapshot || {};
      const title = String(d.jobTitle || list.jobTitle || '').trim();
      const description = String(d.jobDescription || list.jobDescription || '');
      const companyName = sanitizeCompanyName(
        String(d.companyName || list.companyName || '')
      );
      const sectorIndustry = String(d.sectorIndustry || list.sectorIndustry || '').trim();
      const location = String(d.location || list.location || '').trim();
      const source = String(d.source || list.source || '');
      const seniorityLevel = String(d.seniorityLevel || list.seniorityLevel || '');
      const visaSponsorship = String(d.visaSponsorship || list.visaSponsorship || '');
      const remoteType = String(d.remoteType || list.remoteType || '');
      const quals = [
        ...(d.minimumQualifications || list.minimumQualifications || []),
        ...(d.preferredQualifications || list.preferredQualifications || []),
      ]
        .map((x: unknown) => String(x || '').trim())
        .filter(Boolean);

      if (d.industryClassification?.rulesVersion) {
        versions.storedIndustry.add(d.industryClassification.rulesVersion);
      }
      if (d.experienceClassification?.rulesVersion) {
        versions.storedExperience.add(d.experienceClassification.rulesVersion);
      }
      if (d.locationClassification?.rulesVersion) {
        versions.storedLocation.add(d.locationClassification.rulesVersion);
      }

      const storedSpec: string[] = d.frozenCategories || [];
      const storedInd: string[] = d.frozenIndustries || [];
      const storedExp: string[] = d.frozenExperienceLevels || [];
      const storedStates: string[] = d.frozenStates || [];
      if (storedSpec.length) fill.specialty++;
      if (storedInd.length) fill.industry++;
      if (storedExp.length) fill.experience++;
      if (storedStates.length || d.locationIsRemote || d.locationIsUs === false) fill.location++;
      if (companyName) fill.company++;
      if (d.studentEscape) fill.studentTrue++;
      if (d.h1bEligible) fill.h1bTrue++;

      const push = (field: string, kind: string, detail: string, extra?: Partial<Issue>) => {
        const issue: Issue = {
          batch: batchNum,
          id: String(d._id),
          title: title.slice(0, 100),
          field,
          kind,
          detail,
          ...extra,
        };
        batchIssues.push(issue);
        issues.push(issue);
        bump(`${field}:${kind}`);
      };

      // --- Specialty vs ATS title ---
      for (const c of storedSpec) {
        if (specialtyLacksTitleEvidence(title, c)) {
          push(
            'specialty',
            'wrong_chip_no_title_evidence',
            `stored "${c}" not supported by title`,
            { ats: title, stored: storedSpec.join('|') }
          );
        }
      }
      const gated = applySpecialtyTitleOverrides(title, storedSpec).categories;
      if (!eqArr(gated, storedSpec)) {
        push(
          'specialty',
          'override_drift',
          `stored≠current overrides (${SPECIALTY_OVERRIDE_VERSION})`,
          {
            ats: title,
            stored: storedSpec.join('|') || '(empty)',
            expected: gated.join('|') || '(empty)',
          }
        );
      }
      if (!storedSpec.length && techish(title)) {
        const forced = applySpecialtyTitleOverrides(title, []).categories;
        if (forced.length) {
          push(
            'specialty',
            'tech_miss_should_fill',
            `tech title empty but force would yield ${forced.join('|')}`,
            { ats: title, expected: forced.join('|') }
          );
        } else {
          push(
            'specialty',
            'tech_empty_no_taxonomy_match',
            'tech-ish title with no specialty evidence (may be OK if out of 30)',
            { ats: title }
          );
        }
      }

      // --- Industry vs ATS sector/title/company ---
      const ind = resolveFrozenIndustries({
        sectorIndustry,
        title,
        companyName,
        source,
        isAggregator: isAggregatorListingSource(source),
      });
      if (!eqArr(ind.frozenIndustries, storedInd)) {
        push(
          'industry',
          'recompute_drift',
          `method=${ind.method}`,
          {
            ats: `sector="${sectorIndustry}" company="${companyName}"`,
            stored: storedInd.join('|') || '(empty)',
            expected: ind.frozenIndustries.join('|') || '(empty)',
          }
        );
      }

      // --- Experience vs ATS title/desc/quals/seniority ---
      const maxYoe = Number(list.jobExperienceMax) || 0;
      const exp = resolveFrozenExperience({
        title,
        description,
        qualifications: quals,
        seniorityLevel,
        minYoe: null,
        maxYoe: maxYoe > 0 ? maxYoe : null,
        isAggregator: isAggregatorListingSource(source),
      });
      if (!eqArr(exp.frozenExperienceLevels, storedExp)) {
        push(
          'experience',
          'recompute_drift',
          `signals=${(exp.matchedSignals || []).slice(0, 4).join(',')}`,
          {
            ats: `seniority="${seniorityLevel}"`,
            stored: storedExp.join('|') || '(empty)',
            expected: exp.frozenExperienceLevels.join('|') || '(empty)',
          }
        );
      }

      // --- Location vs ATS location/remote ---
      const loc = classifyJobLocation({
        location,
        remoteType,
        companyName,
      });
      const storedLoc = {
        frozenStates: storedStates,
        locationIsRemote: !!d.locationIsRemote,
        locationIsUs: d.locationIsUs,
      };
      if (locKey(loc) !== locKey(storedLoc)) {
        const storedMethod = String(d.locationClassification?.method || '');
        // Audit does not inject companyHistoricalStates — company_history diffs are soft.
        const kind =
          storedMethod === 'company_history' || storedMethod === 'company_hq'
            ? 'history_context_diff'
            : 'recompute_drift';
        push(
          'location',
          kind,
          `method=${loc.method || ''} storedMethod=${storedMethod}`,
          {
            ats: `location="${location}" remote="${remoteType}"`,
            stored: locKey(storedLoc),
            expected: locKey(loc),
          }
        );
      }

      // --- Student escape vs ATS title/seniority/desc ---
      const student = detectStudentEscape({
        title,
        description,
        seniorityLevel,
      });
      if (Boolean(d.studentEscape) !== student.studentEscape) {
        push(
          'student',
          'recompute_drift',
          `signals=${student.matchedSignals.join(',')}`,
          {
            ats: `title + seniority="${seniorityLevel}"`,
            stored: String(!!d.studentEscape),
            expected: String(student.studentEscape),
          }
        );
      }

      // --- H-1B vs locationIsUs gate (ATS-linked) ---
      if (d.locationIsUs === false && d.h1bEligible) {
        push(
          'h1b',
          'non_us_but_eligible',
          'H-1B true while locationIsUs=false',
          { ats: location, stored: 'true' }
        );
      }

      // --- Company sanitize vs ATS ---
      const sanitized = sanitizeCompanyName(companyName) || '';
      const storedCompany = String(d.companyName || '').trim();
      if (sanitized && storedCompany && sanitized !== storedCompany) {
        // Only flag when sanitize would change a portal-ish name we keep dirty
        const lower = storedCompany.toLowerCase();
        if (
          /\b(professional|early career|paradox|greenhouse|lever|workday)\b/i.test(lower) ||
          sanitized.length < storedCompany.length * 0.6
        ) {
          push(
            'company',
            'sanitize_drift',
            'companyName should be cleaned',
            { ats: companyName, stored: storedCompany, expected: sanitized }
          );
        }
      }

      // Soft ATS consistency: sector present but industry empty after recompute & stored
      if (sectorIndustry && !storedInd.length && !ind.frozenIndustries.length) {
        push(
          'industry',
          'sector_unmapped',
          'ATS sector present but no frozen industry mapping',
          { ats: sectorIndustry }
        );
      }
    }

    batchSummaries.push({
      batch: batchNum,
      range: `${start + 1}-${start + chunk.length}`,
      jobs: chunk.length,
      issueCount: batchIssues.length,
      byField: Object.fromEntries(
        [...issueCounts.entries()]
          .filter(() => true)
          .reduce((m, [k, v]) => m, new Map<string, number>())
      ),
      topKinds: Object.fromEntries(
        [...batchIssues.reduce((m, i) => {
          const k = `${i.field}:${i.kind}`;
          m.set(k, (m.get(k) || 0) + 1);
          return m;
        }, new Map<string, number>())].sort((a, b) => b[1] - a[1]).slice(0, 12)
      ),
      sampleIssues: batchIssues.slice(0, 8).map((i) => ({
        field: i.field,
        kind: i.kind,
        title: i.title,
        stored: i.stored,
        expected: i.expected,
        ats: i.ats?.slice(0, 120),
      })),
    });

    // Fix per-batch byField in summary (recompute from this batch only)
    const local = new Map<string, number>();
    for (const i of batchIssues) {
      const k = `${i.field}:${i.kind}`;
      local.set(k, (local.get(k) || 0) + 1);
    }
    batchSummaries[batchSummaries.length - 1].byField = Object.fromEntries(
      [...local.entries()].sort((a, b) => b[1] - a[1])
    );

    console.log(
      `Batch ${batchNum}/10 (${start + 1}-${start + chunk.length}): ${batchIssues.length} issues`
    );
  }

  const hardKinds = new Set([
    'wrong_chip_no_title_evidence',
    'recompute_drift',
    'tech_miss_should_fill',
    'non_us_but_eligible',
    'override_drift',
    'sanitize_drift',
  ]);
  const hard = issues.filter((i) => hardKinds.has(i.kind));
  const soft = issues.filter((i) => !hardKinds.has(i.kind));

  const report = {
    at: new Date().toISOString(),
    n: docs.length,
    chunkSize: CHUNK,
    batches: batchSummaries.length,
    versions: {
      specialtyOverrideCode: versions.specialtyOverride,
      industryCode: versions.industryCode,
      experienceCode: versions.experienceCode,
      locationCode: versions.locationCode,
      storedIndustryVersions: [...versions.storedIndustry],
      storedExperienceVersions: [...versions.storedExperience],
      storedLocationVersions: [...versions.storedLocation],
    },
    fillPct: {
      specialty: +((fill.specialty / docs.length) * 100).toFixed(1),
      industry: +((fill.industry / docs.length) * 100).toFixed(1),
      experience: +((fill.experience / docs.length) * 100).toFixed(1),
      location: +((fill.location / docs.length) * 100).toFixed(1),
      company: +((fill.company / docs.length) * 100).toFixed(1),
      studentTrue: fill.studentTrue,
      h1bTrue: fill.h1bTrue,
    },
    issueTotals: {
      all: issues.length,
      hard: hard.length,
      soft: soft.length,
      byKind: Object.fromEntries([...issueCounts.entries()].sort((a, b) => b[1] - a[1])),
    },
    batchSummaries,
    hardSamples: hard.slice(0, 80),
  };

  const outPath = path.resolve(
    process.cwd(),
    'server/src/scripts/_categoryQaBatchAudit.json'
  );
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log('\n=== OVERALL ===');
  console.log(JSON.stringify({
    n: report.n,
    fillPct: report.fillPct,
    versions: report.versions,
    issueTotals: report.issueTotals,
    hardSampleCount: report.hardSamples.length,
    outPath,
  }, null, 2));

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
