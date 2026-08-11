import { createHash } from 'crypto';
import { GoogleGenAI } from '@google/genai';
import {
  ParsedJobFields,
  sanitizeCompanyName,
  decodeHtmlEntities,
  normalizeJobDescription,
  normalizeSalaryRange,
  normalizeLocation,
} from './jobPageParser';
import logger from '../logger';

export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
export const GEMINI_ENABLED = (process.env.GEMINI_ENABLED || 'true').toLowerCase() !== 'false';
export const LLM_DAILY_CALL_BUDGET = parseInt(process.env.LLM_DAILY_CALL_BUDGET || '2000', 10);
export const LLM_DAILY_TOKEN_BUDGET = parseInt(process.env.LLM_DAILY_TOKEN_BUDGET || '4000000', 10);
export const LLM_RATE_PER_MIN = parseInt(process.env.LLM_RATE_PER_MIN || '20', 10);

export interface StructuredJobSections {
  about: string;
  minimumQualifications: string[];
  preferredQualifications: string[];
  responsibilities: string[];
  benefits: string[];
  skills: string[];
}

export interface GeminiExtractResult {
  ok: boolean;
  fields: ParsedJobFields;
  structured: StructuredJobSections;
  usage: { calls: number; tokens: number };
  inputHash: string;
  model: string;
  error?: string;
}

const emptyStructured = (): StructuredJobSections => ({
  about: '',
  minimumQualifications: [],
  preferredQualifications: [],
  responsibilities: [],
  benefits: [],
  skills: [],
});

export { emptyStructured as emptyStructuredSections };

const emptyFields = (): ParsedJobFields => ({
  jobTitle: '',
  companyName: '',
  jobDescription: '',
  location: '',
  salaryRange: '',
  employmentType: '',
  remoteType: '',
  date: '',
  applyUrl: '',
  companyLogoUrl: '',
  jobCategory: '',
  source: 'none',
});

/** Simple token bucket for Gemini calls. */
class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly ratePerMin: number,
    private readonly capacity: number
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  private refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    const add = (elapsed / 60_000) * this.ratePerMin;
    this.tokens = Math.min(this.capacity, this.tokens + add);
    this.lastRefill = now;
  }

  tryTake(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  msUntilToken(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    const deficit = 1 - this.tokens;
    return Math.ceil((deficit / this.ratePerMin) * 60_000);
  }
}

class CircuitBreaker {
  private failures = 0;
  private windowStart = Date.now();
  private openUntil = 0;

  constructor(
    private readonly threshold = 6,
    private readonly windowMs = 60_000,
    private readonly coolDownMs = 60_000
  ) {}

  recordFailure() {
    const now = Date.now();
    if (now - this.windowStart > this.windowMs) {
      this.windowStart = now;
      this.failures = 0;
    }
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.openUntil = now + this.coolDownMs;
      this.failures = 0;
      this.windowStart = now;
    }
  }

  recordSuccess() {
    this.failures = Math.max(0, this.failures - 1);
  }

  isOpen(): boolean {
    return Date.now() < this.openUntil;
  }
}

const rateLimiter = new TokenBucket(LLM_RATE_PER_MIN, LLM_RATE_PER_MIN);
const circuitBreaker = new CircuitBreaker();

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI | null {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) return null;
  if (!client) client = new GoogleGenAI({ apiKey: key });
  return client;
}

export function isGeminiConfigured(): boolean {
  return GEMINI_ENABLED && Boolean((process.env.GEMINI_API_KEY || '').trim());
}

export function hashLlmInput(text: string): string {
  return createHash('sha256').update(text || '').digest('hex');
}

const SYSTEM_INSTRUCTION = `You extract structured job posting fields from page text.
Rules:
1. Use ONLY the provided page content. Never invent, infer, or fill from outside knowledge, the URL, or the domain.
2. If a field is not clearly present in the text, return null for scalars or [] for arrays. Do not guess.
3. Do not paraphrase bullets beyond light cleanup (trim whitespace). Keep the meaning of the source text.
4. Prefer short, factual values. Leave salary/employment/remote empty unless explicitly stated.
5. salaryRange MUST be a compact chip only: "$MIN – $MAX" or "$AMOUNT / year" (or hour/month). Never paste full compensation paragraphs, geographic disclaimers, or multi-sentence legal text. If several geo bands exist, return the primary US / "all locations" band unless the posting clearly states a single location band.
6. location MUST be a short place chip such as "Oklahoma City, OK" or "Charlotte, North Carolina". Never include site codes, building names, street addresses, ZIP codes, or "United States of America".
7. jobExperience should be a number of years only when the posting states years of experience; otherwise null.
8. about is a short role summary paragraph only if present; otherwise null.
9. Put qualification bullets under minimumQualifications or preferredQualifications only when the page labels them that way (or clearly required vs preferred). Otherwise leave arrays empty rather than inventing categories.
10. skills are explicit skill keywords/technologies listed as skills — not a dump of the whole JD.`;

/** OpenAPI-ish schema for Gemini responseSchema (all fields optional / nullable). */
export const GEMINI_JOB_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    jobTitle: { type: 'string', nullable: true },
    companyName: { type: 'string', nullable: true },
    location: { type: 'string', nullable: true },
    salaryRange: { type: 'string', nullable: true },
    employmentType: { type: 'string', nullable: true },
    remoteType: { type: 'string', nullable: true },
    jobExperience: { type: 'number', nullable: true },
    jobCategory: { type: 'string', nullable: true },
    datePosted: { type: 'string', nullable: true },
    about: { type: 'string', nullable: true },
    minimumQualifications: {
      type: 'array',
      nullable: true,
      items: { type: 'string' },
    },
    preferredQualifications: {
      type: 'array',
      nullable: true,
      items: { type: 'string' },
    },
    responsibilities: {
      type: 'array',
      nullable: true,
      items: { type: 'string' },
    },
    benefits: {
      type: 'array',
      nullable: true,
      items: { type: 'string' },
    },
    skills: {
      type: 'array',
      nullable: true,
      items: { type: 'string' },
    },
  },
};

function asCleanString(v: unknown): string {
  if (v == null) return '';
  return decodeHtmlEntities(String(v).trim());
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    const s = asCleanString(item);
    if (!s || s.length < 2) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function asExperience(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 40) {
    return Math.floor(v);
  }
  if (typeof v === 'string' && v.trim()) {
    const n = parseInt(v.replace(/[^\d]/g, ''), 10);
    if (!Number.isNaN(n) && n > 0 && n <= 40) return n;
  }
  return 0;
}

/** Build a canonical-headed plain JD from structured sections (for storage + fallback UI). */
export function composeCanonicalDescription(structured: StructuredJobSections, fallbackBody = ''): string {
  const parts: string[] = [];
  if (structured.about) {
    parts.push(`About the job\n${structured.about}`);
  }
  if (structured.minimumQualifications.length) {
    parts.push(
      `Minimum qualifications\n${structured.minimumQualifications.map((b) => `• ${b}`).join('\n')}`
    );
  }
  if (structured.preferredQualifications.length) {
    parts.push(
      `Preferred qualifications\n${structured.preferredQualifications.map((b) => `• ${b}`).join('\n')}`
    );
  }
  if (structured.responsibilities.length) {
    parts.push(`Responsibilities\n${structured.responsibilities.map((b) => `• ${b}`).join('\n')}`);
  }
  if (structured.benefits.length) {
    parts.push(`Benefits\n${structured.benefits.map((b) => `• ${b}`).join('\n')}`);
  }
  if (structured.skills.length) {
    parts.push(`Skills\n${structured.skills.map((b) => `• ${b}`).join('\n')}`);
  }
  if (parts.length) return parts.join('\n\n').trim();
  return normalizeJobDescription(fallbackBody);
}

export function mapGeminiJsonToResult(
  parsed: Record<string, unknown>,
  pageUrl?: string
): { fields: ParsedJobFields; structured: StructuredJobSections } {
  const structured: StructuredJobSections = {
    about: asCleanString(parsed.about),
    minimumQualifications: asStringArray(parsed.minimumQualifications),
    preferredQualifications: asStringArray(parsed.preferredQualifications),
    responsibilities: asStringArray(parsed.responsibilities),
    benefits: asStringArray(parsed.benefits),
    skills: asStringArray(parsed.skills),
  };

  const location = normalizeLocation(asCleanString(parsed.location));
  const fields: ParsedJobFields = {
    jobTitle: asCleanString(parsed.jobTitle),
    companyName: sanitizeCompanyName(asCleanString(parsed.companyName)),
    location,
    salaryRange: normalizeSalaryRange(asCleanString(parsed.salaryRange), { location }),
    employmentType: asCleanString(parsed.employmentType),
    remoteType: asCleanString(parsed.remoteType),
    date: asCleanString(parsed.datePosted),
    applyUrl: pageUrl || '',
    companyLogoUrl: '',
    jobCategory: asCleanString(parsed.jobCategory),
    jobDescription: composeCanonicalDescription(structured),
    source: 'html',
  };

  // Attach experience via a side channel on the returned object for the worker
  (fields as any)._jobExperience = asExperience(parsed.jobExperience);

  return { fields, structured };
}

/**
 * Extract job fields from cleaned page text via Gemini.
 * Failures return ok:false — caller should fall back to regex parse.
 */
export async function extractJobFieldsWithGemini(
  cleanedText: string,
  pageUrl?: string,
  opts?: { skipRateLimit?: boolean }
): Promise<GeminiExtractResult> {
  const inputHash = hashLlmInput(cleanedText);
  const model = GEMINI_MODEL;

  if (!isGeminiConfigured()) {
    return {
      ok: false,
      fields: emptyFields(),
      structured: emptyStructured(),
      usage: { calls: 0, tokens: 0 },
      inputHash,
      model,
      error: 'gemini_not_configured',
    };
  }

  if (!cleanedText.trim()) {
    return {
      ok: false,
      fields: emptyFields(),
      structured: emptyStructured(),
      usage: { calls: 0, tokens: 0 },
      inputHash,
      model,
      error: 'empty_input',
    };
  }

  if (circuitBreaker.isOpen()) {
    return {
      ok: false,
      fields: emptyFields(),
      structured: emptyStructured(),
      usage: { calls: 0, tokens: 0 },
      inputHash,
      model,
      error: 'gemini_circuit_open',
    };
  }

  if (!opts?.skipRateLimit) {
    let waited = 0;
    while (!rateLimiter.tryTake()) {
      const wait = Math.min(rateLimiter.msUntilToken(), 2000);
      await new Promise((r) => setTimeout(r, wait));
      waited += wait;
      if (waited > 30_000) {
        return {
          ok: false,
          fields: emptyFields(),
          structured: emptyStructured(),
          usage: { calls: 0, tokens: 0 },
          inputHash,
          model,
          error: 'gemini_rate_limited',
        };
      }
    }
  }

  const ai = getClient();
  if (!ai) {
    return {
      ok: false,
      fields: emptyFields(),
      structured: emptyStructured(),
      usage: { calls: 0, tokens: 0 },
      inputHash,
      model,
      error: 'gemini_not_configured',
    };
  }

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Extract job posting fields from this page text. Page URL (for applyUrl context only — do NOT infer company/title from it):\n${pageUrl || '(unknown)'}\n\n---\n${cleanedText}`,
            },
          ],
        },
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_JOB_RESPONSE_SCHEMA as any,
      },
    });

    const text = (response as any)?.text || (response as any)?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const usageMeta = (response as any)?.usageMetadata || {};
    const tokens =
      (usageMeta.totalTokenCount as number) ||
      ((usageMeta.promptTokenCount || 0) as number) + ((usageMeta.candidatesTokenCount || 0) as number) ||
      0;

    if (!text || !String(text).trim()) {
      circuitBreaker.recordFailure();
      return {
        ok: false,
        fields: emptyFields(),
        structured: emptyStructured(),
        usage: { calls: 1, tokens },
        inputHash,
        model,
        error: 'empty_gemini_response',
      };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(String(text));
    } catch {
      circuitBreaker.recordFailure();
      return {
        ok: false,
        fields: emptyFields(),
        structured: emptyStructured(),
        usage: { calls: 1, tokens },
        inputHash,
        model,
        error: 'invalid_gemini_json',
      };
    }

    const { fields, structured } = mapGeminiJsonToResult(parsed, pageUrl);
    const hasAnything =
      Boolean(fields.jobTitle) ||
      Boolean(fields.jobDescription) ||
      Boolean(structured.about) ||
      structured.minimumQualifications.length > 0 ||
      structured.responsibilities.length > 0;

    if (!hasAnything) {
      circuitBreaker.recordFailure();
      return {
        ok: false,
        fields,
        structured,
        usage: { calls: 1, tokens },
        inputHash,
        model,
        error: 'gemini_empty_extraction',
      };
    }

    circuitBreaker.recordSuccess();
    return {
      ok: true,
      fields,
      structured,
      usage: { calls: 1, tokens },
      inputHash,
      model,
    };
  } catch (err: any) {
    circuitBreaker.recordFailure();
    const msg = err?.message || String(err);
    logger.log('warn', `Gemini job extract failed: ${msg}`);
    return {
      ok: false,
      fields: emptyFields(),
      structured: emptyStructured(),
      usage: { calls: 1, tokens: 0 },
      inputHash,
      model,
      error: msg.slice(0, 200),
    };
  }
}

/** Test helper: reset singleton client (vitest). */
export function __resetGeminiClientForTests() {
  client = null;
}
