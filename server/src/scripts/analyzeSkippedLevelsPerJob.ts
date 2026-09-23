/**
 * Per-job level recommendation for experience-skipped Category QA rows.
 * Uses title + description evidence only — no blanket Mid-Senior default.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import mongoose from 'mongoose';
import JobBoardListing from '../models/JobBoardListing';
import {
  extractExperienceYears,
  resolveFrozenExperience,
} from '../../../src/shared/frozenExperience';
import { sanitizeCompanyName } from '../services/jobPageParser';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function sniffSignals(title: string, description: string, badge: string) {
  const t = title.toLowerCase();
  const d = description.toLowerCase().slice(0, 8000);
  const hay = `${t}\n${d}\n${badge.toLowerCase()}`;
  const found: string[] = [];

  const checks: Array<[RegExp, string]> = [
    [/\bintern(ship)?\b/, 'intern'],
    [/\bnew\s*grad\b|\bjunior\b|\bassociate\b/, 'junior_family'],
    [/\b(entry[\s-]?level|early[\s-]?career|university\s+grad)\b/, 'entry_phrase'],
    [/\b(ii|iii|iv)\b/, 'roman_ladder'],
    [/\b(developer|engineer)\s+(\d)\b|\b(\d)\s+(developer|engineer)\b/, 'numeric_ladder'],
    [/\b(senior|sr\.?|staff|principal|lead)\b/, 'senior_family'],
    [/\b(mts|member\s+of\s+(?:the\s+)?technical\s+staff)\b/, 'mts'],
    [/\b(consultant|managing\s+consultant)\b/, 'consultant'],
    [/\b(manager|director|vp|svp|chief|head\s+of)\b/, 'manager_exec'],
    [/\b(coordinator|representative|analyst)\b/, 'soft_ic'],
    [/\b(TPM|technical\s+program\s+manager|program\s+manager)\b/i, 'tpm'],
  ];
  for (const [re, label] of checks) {
    if (re.test(hay)) found.push(label);
  }

  const yoe = extractExperienceYears(description.slice(0, 8000));
  return { found, yoe };
}

function recommend(opts: {
  title: string;
  description: string;
  badge: string;
  found: string[];
  yoe: ReturnType<typeof extractExperienceYears>;
}): { level: string; years: string[]; rationale: string; confidence: 'high' | 'medium' | 'low' } {
  const { title, description, badge, found, yoe } = opts;
  const maxY =
    yoe.years.length || yoe.ranges.length
      ? Math.max(
          ...(yoe.years.length ? yoe.years : [0]),
          ...yoe.ranges.map(([, hi]) => hi)
        )
      : 0;

  // Intern / internship badge or title
  if (found.includes('intern') || /intern/i.test(badge)) {
    return {
      level: 'Entry Level',
      years: ['0-3'],
      rationale: 'Intern title or Internship badge → Entry + 0-3',
      confidence: 'high',
    };
  }

  // Explicit junior / associate / entry
  if (found.includes('junior_family') || found.includes('entry_phrase')) {
    if (maxY >= 4) {
      return {
        level: 'Mid-Senior Level',
        years: maxY ? band(maxY) : [],
        rationale: `Junior/associate title but YOE≈${maxY} → Mid-Senior (not Entry+high YOE)`,
        confidence: 'high',
      };
    }
    return {
      level: 'Entry Level',
      years: maxY ? band(maxY) : ['0-3'],
      rationale: 'Junior/associate/entry language → Entry',
      confidence: 'high',
    };
  }

  // Exec / SVP / director
  if (/\b(svp|evp|ceo|cto|cfo|coo|chief)\b/i.test(title) || found.includes('manager_exec')) {
    if (/\b(svp|evp|ceo|cto|cfo|coo|chief|vice\s+president|\bvp\b|director|head\s+of)\b/i.test(title)) {
      return {
        level: 'Leadership Level',
        years: maxY ? band(maxY) : [],
        rationale: 'Exec/SVP/Director/Head title → Leadership',
        confidence: 'high',
      };
    }
    if (/\bmanager\b/i.test(title) && !/\b(product|project|program|technical\s+program)\s+manager\b/i.test(title)) {
      return {
        level: 'People Manager Level',
        years: maxY ? band(maxY) : [],
        rationale: 'People manager title → People Manager',
        confidence: 'medium',
      };
    }
  }

  // TPM / program manager (IC-ish)
  if (found.includes('tpm') || /\btechnical\s+program\s+manager|\bprogram\s+manager\b/i.test(title)) {
    if (maxY >= 7 || /\b(senior|principal|lead|staff)\b/i.test(title)) {
      return {
        level: 'Senior Level',
        years: maxY ? band(maxY) : [],
        rationale: 'TPM/program manager with senior signal or high YOE → Senior',
        confidence: 'medium',
      };
    }
    return {
      level: 'Mid-Senior Level',
      years: maxY ? band(maxY) : [],
      rationale: 'TPM/program manager without senior word → Mid-Senior (IC program role)',
      confidence: 'medium',
    };
  }

  // Senior family in title/desc
  if (found.includes('senior_family') || found.includes('mts') || found.includes('roman_ladder')) {
    if (/\b(principal|staff|distinguished)\b/i.test(title) || /\biii\b|\biv\b/i.test(title)) {
      return {
        level: 'Senior Level',
        years: maxY ? band(maxY) : [],
        rationale: 'Principal/Staff/III/IV → Senior',
        confidence: 'high',
      };
    }
    return {
      level: 'Mid-Senior Level',
      years: maxY ? band(maxY) : [],
      rationale: 'Senior/II/MTS signal → Mid-Senior or Senior by word strength',
      confidence: 'high',
    };
  }

  // Numeric ladder: Developer 3
  const num = title.match(/\b(?:developer|engineer|analyst)\s+(\d)\b|\b(\d)\s+(?:developer|engineer)\b/i);
  if (num) {
    const n = parseInt(num[1] || num[2] || '0', 10);
    if (n <= 1) {
      return { level: 'Entry Level', years: maxY ? band(maxY) : [], rationale: `Ladder ${n} → Entry`, confidence: 'medium' };
    }
    if (n === 2) {
      return { level: 'Mid-Senior Level', years: maxY ? band(maxY) : [], rationale: `Ladder ${n} → Mid-Senior`, confidence: 'medium' };
    }
    return { level: 'Senior Level', years: maxY ? band(maxY) : [], rationale: `Ladder ${n} (≥3) → Senior`, confidence: 'medium' };
  }

  // YOE-only evidence (title bare)
  if (maxY > 0) {
    if (maxY <= 2) {
      return { level: 'Entry Level', years: band(maxY), rationale: `Bare title + YOE≈${maxY} → Entry`, confidence: 'medium' };
    }
    if (maxY <= 5) {
      return { level: 'Mid-Senior Level', years: band(maxY), rationale: `Bare title + YOE≈${maxY} → Mid-Senior`, confidence: 'medium' };
    }
    if (maxY <= 8) {
      return { level: 'Mid-Senior Level', years: band(maxY), rationale: `Bare title + YOE≈${maxY} → Mid-Senior`, confidence: 'medium' };
    }
    return { level: 'Senior Level', years: band(maxY), rationale: `Bare title + YOE≈${maxY} → Senior`, confidence: 'medium' };
  }

  // Soft IC with substantial JD but no YOE extracted — leave empty or low-confidence Mid-Senior?
  // User asked NOT blanket mid-senior — recommend leave empty OR Entry for coordinator/sales
  if (/\b(coordinator|representative|sales)\b/i.test(title)) {
    return {
      level: '(leave empty)',
      years: [],
      rationale: 'Non-eng soft title with no YOE — should stay empty until badge/YOE exists',
      confidence: 'low',
    };
  }

  if (/\b(engineer|developer|analyst)\b/i.test(title) && description.length > 2000) {
    return {
      level: '(leave empty) — needs YOE parse improvement',
      years: [],
      rationale: `Eng IC title + long JD (${description.length} chars) but extractExperienceYears found nothing — fix YOE extraction before guessing level`,
      confidence: 'low',
    };
  }

  if (/\b(engineer|developer)\b/i.test(title) && description.length < 500) {
    return {
      level: '(leave empty)',
      years: [],
      rationale: 'Thin Accel list row — no seniority word, no JD YOE; correct to leave empty until detail enrich',
      confidence: 'high',
    };
  }

  return {
    level: '(leave empty)',
    years: [],
    rationale: 'No reliable seniority evidence',
    confidence: 'high',
  };
}

function band(maxY: number): string[] {
  if (maxY < 3) return ['0-3'];
  if (maxY < 5) return ['3-5'];
  if (maxY < 7) return ['5-7'];
  if (maxY < 10) return ['7-10'];
  if (maxY < 15) return ['10-15'];
  return ['15+'];
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URL;
  if (!uri) throw new Error('MONGODB_URI missing');
  await mongoose.connect(
    uri,
    process.env.MONGODB_DATABASE ? { dbName: process.env.MONGODB_DATABASE } : undefined
  );

  const docs = await JobBoardListing.find({
    categoryQaBatchId: 'cat-qa-2026-09',
    categoryQaPhase: { $in: ['backfilled', 'student_review'] },
    $and: [
      { $or: [{ frozenExperienceLevels: { $size: 0 } }, { frozenExperienceLevels: { $exists: false } }] },
      { $or: [{ frozenExperienceYears: { $size: 0 } }, { frozenExperienceYears: { $exists: false } }] },
    ],
  })
    .select(
      'jobTitle companyName source jobDescription seniorityLevel frozenCategories listSnapshot experienceClassification'
    )
    .lean();

  const rows = [];
  for (const d of docs as any[]) {
    const list = d.listSnapshot || {};
    const title = String(d.jobTitle || list.jobTitle || '');
    const description = String(d.jobDescription || list.jobDescription || '');
    const badge = String(d.seniorityLevel || list.seniorityLevel || '');
    const company = sanitizeCompanyName(String(d.companyName || list.companyName || ''));
    const sniff = sniffSignals(title, description, badge);
    const rec = recommend({ title, description, badge, found: sniff.found, yoe: sniff.yoe });
    const current = resolveFrozenExperience({
      title,
      description,
      seniorityLevel: badge,
      minYoe: null,
      maxYoe: null,
    });

    // Sample YOE-looking snippets from description
    const yoeSnippets: string[] = [];
    const re = /(\d+\+?\s*(?:-|–|to)?\s*\d*\+?\s*years?[^\n.!?]{0,60}(?:experience|exp\.?))/gi;
    let m: RegExpExecArray | null;
    const blob = description.slice(0, 6000);
    while ((m = re.exec(blob)) && yoeSnippets.length < 3) {
      yoeSnippets.push(m[0].replace(/\s+/g, ' ').trim());
    }

    rows.push({
      title: title.slice(0, 90),
      company: company || '(empty)',
      source: d.source || 'career',
      descLen: description.length,
      badge: badge || '(none)',
      specialty: d.frozenCategories || [],
      sniff: sniff.found,
      extractedYoe: { years: sniff.yoe.years.slice(0, 5), ranges: sniff.yoe.ranges.slice(0, 3), signals: sniff.yoe.signals.slice(0, 8) },
      yoeSnippetsInText: yoeSnippets,
      currentResolver: {
        levels: current.frozenExperienceLevels,
        years: current.frozenExperienceYears,
        method: current.method,
      },
      recommended: rec,
    });
  }

  const summary = {
    leaveEmpty: rows.filter((r) => String(r.recommended.level).startsWith('(leave')).length,
    entry: rows.filter((r) => r.recommended.level === 'Entry Level').length,
    midSenior: rows.filter((r) => r.recommended.level === 'Mid-Senior Level').length,
    senior: rows.filter((r) => r.recommended.level === 'Senior Level').length,
    leadership: rows.filter((r) => r.recommended.level === 'Leadership Level').length,
    peopleManager: rows.filter((r) => r.recommended.level === 'People Manager Level').length,
  };

  console.log(JSON.stringify({ count: rows.length, summary, rows }, null, 2));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
