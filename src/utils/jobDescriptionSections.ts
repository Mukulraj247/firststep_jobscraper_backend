export type JobDescriptionSection = {
  id: string;
  title: string;
  body: string;
};

/** Known JD section titles across JPMC / Workday / Greenhouse / Lever / Google / Phenom pages. */
const KNOWN_HEADER_RE =
  /^(?:about(?:\s+the\s+(?:job|role|team|company|opportunity))?|job\s+(?:responsibilities|description|summary|overview)|key\s+responsibilities|responsibilities|required\s+(?:qualifications|skills|experience)|preferred\s+(?:qualifications|skills|experience)|minimum\s+qualifications|basic\s+qualifications|qualifications|requirements|skills|benefits|what\s+we\s+offer|what\s+you(?:'|’)(?:ll|will)\s+(?:do|get|bring)|who\s+you\s+are|you\s+will|our\s+team|equal\s+opportunity(?:\s+employer)?|eeo|compensation(?:\s+and\s+benefits)?|how\s+to\s+apply|application\s+process|additional\s+information|working\s+(?:here|with\s+us)|why\s+(?:join|us)|role\s+overview|position\s+summary|essential\s+functions|duties(?:\s+and\s+responsibilities)?)$/i;

function slugId(title: string, index: number): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${base || 'section'}-${index}`;
}

function isLikelyHeading(line: string): boolean {
  const t = line.trim().replace(/[:\-–—\s]+$/g, '').trim();
  if (!t || t.length < 3 || t.length > 90) return false;
  if (t.startsWith('•') || t.startsWith('-') || t.startsWith('*')) return false;
  if (/[.!?]$/.test(t) && t.length > 40) return false;
  if (KNOWN_HEADER_RE.test(t)) return true;

  // JPMC / Oracle long headers: "Required qualifications, capabilities, and skills"
  if (
    /^(?:required|preferred|minimum|basic)\s+qualifications\b/i.test(t) ||
    /^(?:job\s+)?(?:key\s+)?responsibilities\b/i.test(t) ||
    /^about\s+the\s+(?:job|role)\b/i.test(t)
  ) {
    return true;
  }

  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 4 && letters === letters.toUpperCase() && !/[.!?]$/.test(t)) {
    return true;
  }

  if (
    t.length <= 48 &&
    !/[.!?]$/.test(t) &&
    /^[A-Z][A-Za-z0-9/&'’\-\s]+$/.test(t) &&
    t.split(/\s+/).length <= 6 &&
    t.split(/\s+/).every((w) => /^[A-Z0-9]/.test(w) || /^(and|or|of|the|a|an|for|to|in|with)$/i.test(w))
  ) {
    if (KNOWN_HEADER_RE.test(t)) return true;
    const lower = t.toLowerCase();
    if (
      /\b(responsibilit|qualification|requirement|benefit|skill|overview|summary|description|compensation|opportunity)\b/.test(
        lower
      )
    ) {
      return true;
    }
  }

  return false;
}

/** Insert newlines before known inline section labels so flat ATS text can sectionize. */
function preprocessInlineHeadings(text: string): string {
  // Longer phrases first. Short labels must NOT use mid-string glue or they
  // shatter "Minimum qualifications" / "Preferred qualifications".
  const longLabels = [
    'Required qualifications, capabilities, and skills',
    'Preferred qualifications, capabilities, and skills',
    'Required qualifications',
    'Required Qualifications',
    'Preferred qualifications',
    'Preferred Qualifications',
    'Minimum qualifications',
    'Minimum Qualifications',
    'Basic Qualifications',
    'Basic qualifications',
    'Job responsibilities',
    'Job Responsibilities',
    'Key Responsibilities',
    'Duties and Responsibilities',
    'Essential Functions',
    'What We Offer',
    'What you will do',
    "What you'll do",
    "What you'll bring",
    'Compensation and Benefits',
    'Equal Opportunity',
    'About the job',
    'About the Job',
    'About the Role',
    'About Us',
    'Role Overview',
    'Position Summary',
    'Responsibilities',
    'Benefits',
    'Skills',
  ];
  const shortLabels = ['Qualifications', 'Requirements'];

  let out = text;
  const apply = (label: string, allowMid: boolean) => {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const re = new RegExp(`(^|\\n)\\s*(${esc})\\s*:?\\s*(?=\\n|•|[A-Z])`, 'gi');
    out = out.replace(re, `$1\n\n$2\n`);
    if (!allowMid) return;
    const mid = new RegExp(`([.!?•])\\s+(${esc})\\s*:?\\s*(?=•|[A-Z\\n])`, 'gi');
    out = out.replace(mid, `$1\n\n$2\n`);
    const glued = new RegExp(`([a-z0-9)])\\s+(${esc})\\s*(?=•)`, 'gi');
    out = out.replace(glued, `$1\n\n$2\n`);
  };

  for (const label of longLabels) apply(label, true);
  for (const label of shortLabels) apply(label, false);
  return out;
}

function formatBodyBlocks(body: string): string {
  return body
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Split a normalized plain-text JD into titled sections.
 * Falls back to a single "Description" section when no headings are found.
 */
export function splitJobDescriptionSections(
  text: string,
  fallbackTitle = 'Description'
): JobDescriptionSection[] {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const normalized = preprocessInlineHeadings(raw)
    .replace(/\r\n/g, '\n')
    .replace(/•/g, '\n• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const lines = normalized.split('\n').map((l) => l.trimEnd());
  const sections: JobDescriptionSection[] = [];
  let currentTitle = fallbackTitle;
  let currentBody: string[] = [];
  let foundHeading = false;

  const flush = () => {
    const body = formatBodyBlocks(currentBody.join('\n'));
    if (!body && sections.length > 0) return;
    if (!body && !foundHeading) return;
    sections.push({
      id: slugId(currentTitle, sections.length),
      title: currentTitle,
      body: body || '',
    });
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      currentBody.push('');
      continue;
    }
    if (isLikelyHeading(trimmed)) {
      foundHeading = true;
      flush();
      currentTitle = trimmed.replace(/[:\-–—\s]+$/g, '').trim();
      currentBody = [];
      continue;
    }
    currentBody.push(trimmed);
  }
  flush();

  const cleaned = sections.filter((s) => s.body.trim());
  if (cleaned.length === 0 && raw) {
    return [{ id: 'description-0', title: fallbackTitle, body: formatBodyBlocks(raw) }];
  }
  if (!foundHeading && cleaned.length === 1) {
    const body = cleaned[0].body;
    if (body.length > 500 && !body.includes('\n')) {
      const sentences = body.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [body];
      const paras: string[] = [];
      let buf = '';
      for (const s of sentences) {
        const next = `${buf}${s}`.trim();
        if (next.length > 320 && buf) {
          paras.push(buf.trim());
          buf = s;
        } else {
          buf = next;
        }
      }
      if (buf.trim()) paras.push(buf.trim());
      return [{ ...cleaned[0], body: paras.join('\n\n') }];
    }
  }
  return cleaned;
}

/** Render helpers: split section body into paragraph / bullet lines. */
export function sectionBodyLines(body: string): { type: 'bullet' | 'text'; text: string }[] {
  const parts = body
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.map((text) => ({
    type: /^[•\-\*]\s*/.test(text) ? 'bullet' : 'text',
    text: text.replace(/^[•\-\*]\s*/, ''),
  }));
}

export type JobCardHighlights = {
  minimumQualifications: string[];
  preferredQualifications: string[];
  responsibilities: string[];
  benefits: string[];
  about: string;
  skills: string[];
  experienceLabel: string;
  employmentHint: string;
  remoteHint: string;
};

const QUAL_LINE_RE =
  /\b(?:degree|bachelor|master|phd|years?\s+of\s+experience|\d+\+?\s*years|proficien|experience\s+(?:with|in)|knowledge\s+of|certification|must\s+have)\b/i;
const RESP_LINE_RE =
  /^(?:manage|build|design|lead|develop|work|ensure|complete|create|own|partner|drive|deliver|implement|support|collaborate|analyze|maintain|oversee|coordinate|provide|write|test|deploy)\b/i;
const BENEFIT_LINE_RE =
  /\b(?:benefit|401\s*\(?k\)?|health\s+insurance|dental|vision|pto|paid\s+time|parental\s+leave|wellness|bonus|equity|rsu|stock)\b/i;

function clipLine(t: string, max = 120): string {
  const clean = t.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trim()}…`;
}

function uniqueLines(lines: string[], max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const key = line.toLowerCase();
    if (seen.has(key) || line.length < 12) continue;
    seen.add(key);
    out.push(clipLine(line));
    if (out.length >= max) break;
  }
  return out;
}

/** When ATS text has no clear headings, still surface Google-like card bullets. */
function highlightsFromUnstructured(description: string): {
  minimumQualifications: string[];
  preferredQualifications: string[];
  responsibilities: string[];
  benefits: string[];
  about: string;
} {
  const withBreaks = String(description || '')
    .replace(/[•●]/g, '\n• ')
    .replace(/\r\n/g, '\n');
  const rawBullets = [...withBreaks.matchAll(/(?:^|\n)\s*[•\-–—*]\s*([^\n•]+)/g)]
    .map((m) => m[1].replace(/\s+/g, ' ').trim())
    .filter((t) => t.length > 12);

  const minQuals = uniqueLines(
    rawBullets.filter((b) => QUAL_LINE_RE.test(b)),
    3
  );
  const responsibilities = uniqueLines(
    rawBullets.filter((b) => RESP_LINE_RE.test(b) && !QUAL_LINE_RE.test(b)),
    2
  );
  const benefits = uniqueLines(
    rawBullets.filter((b) => BENEFIT_LINE_RE.test(b)),
    2
  );

  // Sentence fallback when there are almost no bullets
  if (minQuals.length + responsibilities.length < 2) {
    const sentences = withBreaks
      .replace(/\n+/g, ' ')
      .match(/[^.!?]+[.!?]+|[^.!?]+$/g)
      ?.map((s) => s.replace(/\s+/g, ' ').trim())
      .filter((s) => s.length > 40 && s.length < 220) || [];
    for (const s of sentences) {
      if (minQuals.length < 3 && QUAL_LINE_RE.test(s)) minQuals.push(clipLine(s));
      else if (responsibilities.length < 2 && RESP_LINE_RE.test(s)) responsibilities.push(clipLine(s));
      if (minQuals.length >= 3 && responsibilities.length >= 2) break;
    }
  }

  let about = '';
  const prose = withBreaks
    .split(/\n+/)
    .map((l) => l.replace(/^[•\-–—*]\s*/, '').trim())
    .filter((l) => l.length > 50 && !QUAL_LINE_RE.test(l) && !RESP_LINE_RE.test(l));
  if (prose[0]) {
    about = clipLine(prose[0], 160);
  }

  return {
    minimumQualifications: minQuals,
    preferredQualifications: [],
    responsibilities,
    benefits,
    about,
  };
}

/** Pull short card-friendly snippets from a full JD (Google-style multi-section cards). */
export function extractCardHighlights(description: string): JobCardHighlights {
  const sections = splitJobDescriptionSections(description);
  const find = (re: RegExp) => sections.find((s) => re.test(s.title));
  const bulletsFrom = (section?: JobDescriptionSection, max = 2): string[] => {
    if (!section?.body) return [];
    const lines = sectionBodyLines(section.body);
    const bullets = lines.filter((l) => l.type === 'bullet').map((l) => l.text);
    const source = bullets.length ? bullets : lines.map((l) => l.text);
    return uniqueLines(
      source.map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => t.length > 8),
      max
    );
  };

  const minQualsSec =
    find(/minimum\s+qualifications|required\s+qualifications|basic\s+qualifications/i) ||
    find(/^qualifications$|^requirements$/i);
  const prefQualsSec = find(/preferred\s+qualifications/i);
  const responsibilitiesSec = find(
    /responsibilit|what you(?:'|’)ll do|what you will do|you will|essential\s+functions|duties/i
  );
  const benefitsSec = find(/benefit|what we offer|compensation/i);
  const aboutSec = find(/about the (job|role)|overview|summary|^description$/i);
  const skillsSec = find(/^skills$/i);

  let minimumQualifications = bulletsFrom(minQualsSec, 5);
  let preferredQualifications = bulletsFrom(prefQualsSec, 2);
  let responsibilities = bulletsFrom(responsibilitiesSec, 2);
  let benefits = bulletsFrom(benefitsSec, 2);

  let aboutText = '';
  if (aboutSec?.body) {
    aboutText = clipLine(aboutSec.body.replace(/\s+/g, ' ').trim(), 160);
  }

  // Fill any empty buckets from unstructured heuristics (JPMC / Carrier / flat ATS).
  const fb = highlightsFromUnstructured(description);
  if (!minimumQualifications.length) minimumQualifications = fb.minimumQualifications;
  if (!preferredQualifications.length) preferredQualifications = fb.preferredQualifications;
  if (!responsibilities.length) responsibilities = fb.responsibilities;
  if (!benefits.length) benefits = fb.benefits;
  if (!aboutText) aboutText = fb.about;

  // Prefer preferred-qual bullets that mention preferred/master/nice-to-have when
  // section split failed and they landed in the minimum bucket.
  if (!preferredQualifications.length && minimumQualifications.length > 2) {
    const prefish = minimumQualifications.filter((l) =>
      /\b(?:master|phd|preferred|nice\s+to\s+have|plus|bonus)\b/i.test(l)
    );
    if (prefish.length) {
      preferredQualifications = prefish.slice(0, 2);
      minimumQualifications = minimumQualifications.filter((l) => !prefish.includes(l));
    }
  }
  minimumQualifications = minimumQualifications.slice(0, 3);

  // Don't steal qualification bullets into responsibilities when the JD has no
  // dedicated responsibilities section (common on Google cards).
  if (responsibilities.length === 0) {
    for (const sec of sections) {
      if (
        /eeo|equal\s+opportunity|about\s+(?:us|carrier|toyota|ford|company)|qualification|requirement/i.test(
          sec.title
        )
      ) {
        continue;
      }
      const lines = bulletsFrom(sec, 2);
      if (lines.length) {
        responsibilities = lines;
        break;
      }
    }
  } else {
    // Drop accidental qual lines from responsibilities
    responsibilities = responsibilities.filter((l) => !QUAL_LINE_RE.test(l));
  }

  const skillBits = bulletsFrom(skillsSec, 6);
  const skillCsv = skillBits
    .flatMap((s) => s.split(/[,;/|]/).map((x) => x.trim()))
    .filter((x) => x.length > 1 && x.length < 28)
    .slice(0, 5);

  const head = String(description || '').slice(0, 3500);
  const years = [...head.matchAll(/(\d+)\+?\s*years?\s+of\s+experience/gi)].map((m) =>
    parseInt(m[1], 10)
  );
  const maxYears = years.length ? Math.max(...years.filter((n) => n > 0 && n <= 30)) : 0;
  const experienceLabel = maxYears > 0 ? `${maxYears}+ years experience` : '';

  let employmentHint = '';
  if (/\bintern(ship)?\b/i.test(head)) employmentHint = 'Internship';
  else if (/\bpart[-\s]?time\b/i.test(head)) employmentHint = 'Part-time';
  else if (/\bcontract(or)?\b/i.test(head)) employmentHint = 'Contract';
  else if (/\bfull[-\s]?time\b/i.test(head)) employmentHint = 'Full-time';

  let remoteHint = '';
  if (/\bremote\b/i.test(head.slice(0, 900))) remoteHint = 'Remote';
  else if (/\bhybrid\b/i.test(head.slice(0, 900))) remoteHint = 'Hybrid';
  else if (/\bonsite|on-site|in-office\b/i.test(head.slice(0, 900))) remoteHint = 'Onsite';

  return {
    minimumQualifications,
    preferredQualifications,
    responsibilities,
    benefits,
    about: aboutText,
    skills: skillCsv,
    experienceLabel,
    employmentHint,
    remoteHint,
  };
}
