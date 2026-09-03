/**
 * HTTP client for the job-tagger sidecar (Python FastAPI on JOB_TAGGER_URL).
 *
 * Fast path:
 *   - truncate description
 *   - ui_mode + max_badges=2 (score-cap, no TF-IDF)
 *   - single-flight queue so concurrent callers do not pile up on 1 uvicorn worker
 *   - one retry on abort; cooldown only after repeated failures (not one timeout)
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
const DEFAULT_TIMEOUT_MS = 12_000;
const RULES_VERSION_TTL_MS = 5 * 60 * 1000;
/** Only engage after several consecutive transport failures. */
const FAILURE_COOLDOWN_MS = 10_000;
const FAILURES_BEFORE_COOLDOWN = 8;
const MAX_DESCRIPTION_CHARS = 2_500;

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

function cooldownEnabled(): boolean {
  const raw = (process.env.JOB_TAGGER_COOLDOWN || 'true').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'no';
}

function truncateDescription(description: string): string {
  const raw = String(description || '');
  return raw.length > MAX_DESCRIPTION_CHARS ? raw.slice(0, MAX_DESCRIPTION_CHARS) : raw;
}

function classifyOptions() {
  return {
    ui_mode: true,
    max_badges: maxBadges(),
    refine_with_tfidf: false,
    use_ml: useMl(),
  };
}

let cachedRulesVersion: string | null = null;
let cachedRulesVersionAt = 0;
let cooldownUntil = 0;
let consecutiveFailures = 0;

/** Serialize outbound classify calls — 1 uvicorn worker cannot take a stampede. */
let classifyChain: Promise<unknown> = Promise.resolve();

function withClassifyLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = classifyChain.then(fn, fn);
  classifyChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function inCooldown(): boolean {
  return cooldownEnabled() && Date.now() < cooldownUntil;
}

function noteTransportFailure(): void {
  consecutiveFailures += 1;
  if (cooldownEnabled() && consecutiveFailures >= FAILURES_BEFORE_COOLDOWN) {
    cooldownUntil = Date.now() + FAILURE_COOLDOWN_MS;
    consecutiveFailures = 0;
  }
}

function noteTransportSuccess(): void {
  consecutiveFailures = 0;
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

async function classifyOnce(
  input: ClassifyJobInput,
  title: string,
  rulesVersion: string | null
): Promise<JobCategoryTaggerResult> {
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
        description: truncateDescription(input.description),
        ...classifyOptions(),
      }),
    });

    if (!res.ok) {
      logger.log('warn', `[jobCategoryTagger] classify-one HTTP ${res.status}`);
      noteTransportFailure();
      return NO_UPDATE;
    }

    noteTransportSuccess();
    return toResult((await res.json()) as TaggerResponseBody, input.contentHash, rulesVersion);
  } finally {
    clearTimeout(timer);
  }
}

export async function classifyJobCategories(
  input: ClassifyJobInput
): Promise<JobCategoryTaggerResult> {
  if (!isTaggerEnabled() || inCooldown()) return NO_UPDATE;

  const title = String(input.title || '').trim();
  if (!title) return NO_UPDATE;

  const rulesVersion = await fetchRulesVersion();
  if (alreadyClassified(input, rulesVersion)) return NO_UPDATE;

  return withClassifyLock(async () => {
    try {
      return await classifyOnce(input, title, rulesVersion);
    } catch (err: any) {
      // One retry after a short pause — covers brief CPU spikes / uvicorn queue.
      try {
        await new Promise((r) => setTimeout(r, 150));
        return await classifyOnce(input, title, rulesVersion);
      } catch (err2: any) {
        noteTransportFailure();
        logger.log(
          'warn',
          `[jobCategoryTagger] classify-one failed after retry: ${err2?.message || err2}`
        );
        return NO_UPDATE;
      }
    }
  });
}

/**
 * Classify many jobs. Concurrency > 1 is serialized by withClassifyLock
 * (safe for 1 uvicorn worker). Prefer concurrency=1 for backfill clarity.
 */
export async function classifyJobCategoriesParallel(
  jobs: ClassifyJobInput[],
  concurrency = 1
): Promise<JobCategoryTaggerResult[]> {
  if (!isTaggerEnabled() || jobs.length === 0) {
    return jobs.map(() => ({ ...NO_UPDATE }));
  }

  const results: JobCategoryTaggerResult[] = new Array(jobs.length);
  let next = 0;
  const n = Math.min(Math.max(1, concurrency), jobs.length);

  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= jobs.length) return;
      results[i] = await classifyJobCategories(jobs[i]);
    }
  };

  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

export async function classifyJobCategoriesBatch(
  jobs: ClassifyJobInput[]
): Promise<JobCategoryTaggerResult[]> {
  const concurrency = parseInt(process.env.JOB_TAGGER_CONCURRENCY || '1', 10);
  return classifyJobCategoriesParallel(
    jobs,
    Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 1
  );
}
