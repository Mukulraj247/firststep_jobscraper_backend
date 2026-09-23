/**
 * Light student / intern / new-grad / OPT escape for Category QA.
 * Not full F1 scoring — flags jobs that should be reviewed before
 * treating them as normal cluster filter fodder.
 */

export type StudentEscapeInput = {
  title?: string;
  description?: string;
  seniorityLevel?: string;
};

export type StudentEscapeResult = {
  studentEscape: boolean;
  matchedSignals: string[];
};

const TITLE_INTERN = /\b(intern|internship)\b/i;
const TITLE_STUDENT = /\b(student|co-?op)\b/i;
const TITLE_NEW_GRAD =
  /\b(new[\s-]?grad(?:uate)?|new\s+college\s+grad(?:uate)?|university[\s-]?grad|campus[\s-]?hire)\b/i;
const TITLE_EARLY =
  /\b(intern|internship|co-?op|student|new[\s-]?grad|new\s+college\s+grad|entry[\s-]?level|junior)\b/i;
/** Clear senior ladder — JD OPT/CPT blurbs must not pull these into student review. */
const TITLE_CLEARLY_SENIOR =
  /\b(senior|sr\.?|staff|principal|lead|director|manager|head\s+of|vice\s+president|\bvp\b|chief)\b/i;
/** Mid/IC professional titles — JD visa blurbs alone should not force student review. */
const TITLE_PROFESSIONAL_IC =
  /\b(engineer|developer|architect|analyst|scientist|administrator|consultant)\b/i;
/** Title-only OPT/CPT (rare). Description only with explicit student-visa phrasing. */
const TITLE_OPT_CPT = /\b(stem\s*opt|opt|cpt)\b/i;
const DESC_OPT_CPT =
  /\b(stem\s*opt|on\s+opt|opt\s+eligible|cpt\s+eligible|f-?1\s+(?:visa|student)|optional\s+practical\s+training|curricular\s+practical\s+training)\b/i;

/** Title ladder that contradicts a scraped "Internship" / student seniority badge. */
const TITLE_CONTRADICTS_STUDENT_BADGE =
  /\b(senior|sr\.?|staff|principal|lead|director|manager|head\s+of|vice\s+president|\bvp\b|chief|ii|iii|iv|l\s*[2-6]|mid[\s-]?senior|mid[\s-]?level)\b/i;

/**
 * Detect student-track roles from title/seniority (primary) and OPT/CPT mentions.
 */
export function detectStudentEscape(input: StudentEscapeInput): StudentEscapeResult {
  const title = String(input.title || '').trim();
  const seniority = String(input.seniorityLevel || '').trim();
  const description = String(input.description || '').slice(0, 4000);
  const signals: string[] = [];

  // Title wins. Scraped seniority badges are often wrong (e.g. "Internship" on
  // Mid-Senior IC roles) — only trust them when the title does not contradict.
  const seniorityTrusted = !TITLE_CONTRADICTS_STUDENT_BADGE.test(title);
  if (TITLE_INTERN.test(title) || (seniorityTrusted && TITLE_INTERN.test(seniority))) {
    signals.push('intern');
  }
  if (TITLE_STUDENT.test(title) || (seniorityTrusted && TITLE_STUDENT.test(seniority))) {
    signals.push('student');
  }
  if (TITLE_NEW_GRAD.test(title)) {
    signals.push('new_grad');
  }

  const optInTitle = TITLE_OPT_CPT.test(title);
  const optInDesc = DESC_OPT_CPT.test(description);
  // JD OPT/CPT only for early-career titles — not Senior/Staff and not plain IC engineer posts.
  const allowDescOpt =
    optInDesc &&
    !TITLE_CLEARLY_SENIOR.test(title) &&
    (TITLE_EARLY.test(title) || !TITLE_PROFESSIONAL_IC.test(title));
  if (optInTitle || allowDescOpt) {
    signals.push('opt_cpt');
  }

  return { studentEscape: signals.length > 0, matchedSignals: signals };
}
