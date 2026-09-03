/**
 * HTTP client for the job-tagger sidecar (Python FastAPI on JOB_TAGGER_URL).
 *
 * Fail-open contract: when the sidecar is disabled, unreachable, or errors, the
 * result carries `skipUpdate: true` so callers leave stored categories intact.
 * Only a real classifier response may overwrite `frozenCategories`.
 */
import logger from '../logger';

export interface CategoryClassificationMeta {
  method: 'rules' | 'rules+ml';
  rulesVersion: string;
  classifierVersion: string;
  classifiedAt: Date;
  contentHash: string;
}

export interface JobCategoryTaggerResult {
  frozenCategories: string[];
  categoryClassification: CategoryClassificationMeta | null;
  /** When true, caller must not overwrite stored classification fields. */
  skipUpdate?: boolean;
}

export interface ClassifyJobInput {
  id?: string;
  title: string;
  description: string;
  contentHash: string;
  existingClassification?: {
    contentHash?: string;
    rulesVersion?: string;
  } | null;
}

const DEFAULT_URL = 'http://127.0.0.1:8000';
const DEFAULT_TIMEOUT_MS = 3000;
const BATCH_MIN_TIMEOUT_MS = 8000;
const RULES_VERSION_TTL_MS = 5 * 60 * 1000;
/** After a transport failure, stop calling the sidecar for this long. */
const FAILURE_COOLDOWN_MS = 30 * 1000;

/** Never write categories; never clobber what is already stored. */
const NO_UPDATE: JobCategoryTaggerResult = {
  frozenCategories: [],
  categoryClassification: null,
  skipUpdate: true,
};

function taggerBaseUrl(): string {
  return (process.env.JOB_TAGGER_URL || DEFAULT_URL).replace(/\/$/, '');
}

function taggerTimeoutMs(): number {
  const n = parseInt(process.env.JOB_TAGGER_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

function useMl(): boolean {
  const raw = (process.env.JOB_TAGGER_USE_ML || 'true').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'no';
}

function maxBadges(): number {
  const n = parseInt(process.env.JOB_TAGGER_MAX_BADGES || '2', 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 30) : 2;
}

function isTaggerEnabled(): boolean {
  const raw = (process.env.JOB_TAGGER_ENABLED || 'true').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'no';
}

let cachedRulesVersion: string | null = null;
let cachedRulesVersionAt = 0;
let cooldownUntil = 0;

function inCooldown(): boolean {
  return Date.now() < cooldownUntil;
}

/**
 * Sidecar is unreachable. Skip calls briefly so enrichment does not pay the
 * timeout on every job while the process is restarting.
 */
function noteTransportFailure(): void {
  cooldownUntil = Date.now() + FAILURE_COOLDOWN_MS;
}

function noteTransportSuccess(): void {
  cooldownUntil = 0;
}

async function fetchRulesVersion(): Promise<string | null> {
  const now = Date.now();
  if (cachedRulesVersion && now - cachedRulesVersionAt < RULES_VERSION_TTL_MS) {
    return cachedRulesVersion;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(`${taggerBaseUrl()}/api/health`, { signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { rules_version?: string };
    cachedRulesVersion = body.rules_version || null;
    cachedRulesVersionAt = now;
    return cachedRulesVersion;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** True when stored classification already matches this content and rules version. */
function alreadyClassified(input: ClassifyJobInput, rulesVersion: string | null): boolean {
  if (!rulesVersion || !input.contentHash) return false;
  const existing = input.existingClassification;
  return (
    existing?.contentHash === input.contentHash && existing?.rulesVersion === rulesVersion
  );
}

interface TaggerResponseBody {
  categories?: string[];
  method?: string;
  rules_version?: string;
  classifier_version?: string;
}

function toResult(
  body: TaggerResponseBody,
  contentHash: string,
  rulesVersionFallback: string | null
): JobCategoryTaggerResult {
  return {
    frozenCategories: Array.isArray(body.categories)
      ? body.categories.map((c) => String(c || '').trim()).filter(Boolean).slice(0, maxBadges())
      : [],
    categoryClassification: {
      method: body.method === 'rules+ml' ? 'rules+ml' : 'rules',
      rulesVersion: body.rules_version || rulesVersionFallback || '',
      classifierVersion: body.classifier_version || '',
      classifiedAt: new Date(),
      contentHash,
    },
  };
}

export async function classifyJobCategories(
  input: ClassifyJobInput
): Promise<JobCategoryTaggerResult> {
  if (!isTaggerEnabled() || inCooldown()) return NO_UPDATE;

  // The sidecar rejects blank titles (min_length=1) — do not spend a request.
  const title = String(input.title || '').trim();
  if (!title) return NO_UPDATE;

  const rulesVersion = await fetchRulesVersion();
  if (alreadyClassified(input, rulesVersion)) return NO_UPDATE;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), taggerTimeoutMs());

  try {
    const res = await fetch(`${taggerBaseUrl()}/api/classify-one`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        id: input.id,
        title,
        description: String(input.description || ''),
        ui_mode: true,
        max_badges: maxBadges(),
        use_ml: useMl(),
      }),
    });

    if (!res.ok) {
      logger.log('warn', `[jobCategoryTagger] classify-one HTTP ${res.status} (keeping stored categories)`);
      return NO_UPDATE;
    }

    noteTransportSuccess();
    return toResult((await res.json()) as TaggerResponseBody, input.contentHash, rulesVersion);
  } catch (err: any) {
    noteTransportFailure();
    logger.log(
      'warn',
      `[jobCategoryTagger] classify-one failed (fail-open, ${FAILURE_COOLDOWN_MS}ms cooldown): ${err?.message || err}`
    );
    return NO_UPDATE;
  } finally {
    clearTimeout(timer);
  }
}

export async function classifyJobCategoriesBatch(
  jobs: ClassifyJobInput[]
): Promise<JobCategoryTaggerResult[]> {
  const noUpdateAll = () => jobs.map(() => ({ ...NO_UPDATE }));
  if (!isTaggerEnabled() || inCooldown() || jobs.length === 0) return noUpdateAll();

  const rulesVersion = await fetchRulesVersion();

  // Only send jobs that need work: non-blank title and stale/absent classification.
  const results: JobCategoryTaggerResult[] = jobs.map(() => ({ ...NO_UPDATE }));
  const pending: Array<{ index: number; job: ClassifyJobInput; title: string }> = [];
  jobs.forEach((job, index) => {
    const title = String(job.title || '').trim();
    if (!title) return;
    if (alreadyClassified(job, rulesVersion)) return;
    pending.push({ index, job, title });
  });

  if (pending.length === 0) return results;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(taggerTimeoutMs(), BATCH_MIN_TIMEOUT_MS));

  try {
    const res = await fetch(`${taggerBaseUrl()}/api/classify-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        jobs: pending.map(({ job, title }) => ({
          id: job.id,
          title,
          description: String(job.description || ''),
        })),
        ui_mode: true,
        max_badges: maxBadges(),
        use_ml: useMl(),
      }),
    });

    if (!res.ok) {
      logger.log('warn', `[jobCategoryTagger] classify-batch HTTP ${res.status} (keeping stored categories)`);
      return results;
    }

    const body = (await res.json()) as TaggerResponseBody[];
    if (!Array.isArray(body)) {
      logger.log('warn', '[jobCategoryTagger] classify-batch returned a non-array payload');
      return results;
    }

    noteTransportSuccess();
    pending.forEach(({ index, job }, position) => {
      const row = body[position];
      if (!row) return;
      results[index] = toResult(row, job.contentHash, rulesVersion);
    });
    return results;
  } catch (err: any) {
    noteTransportFailure();
    logger.log(
      'warn',
      `[jobCategoryTagger] classify-batch failed (fail-open, ${FAILURE_COOLDOWN_MS}ms cooldown): ${err?.message || err}`
    );
    return results;
  } finally {
    clearTimeout(timer);
  }
}
