import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../logger', () => ({
  default: { log: vi.fn() },
}));

const HEALTH_BODY = { rules_version: 'rules-v1' };

type FetchHandler = (url: string, init?: RequestInit) => unknown;

/** Route fetch by path; health always answers unless overridden. */
function installFetch(handler: FetchHandler) {
  const calls: string[] = [];
  const impl = vi.fn(async (input: any, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const result = handler(url, init);
    if (result instanceof Error) throw result;
    const { status = 200, body = {} } = (result || {}) as { status?: number; body?: unknown };
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as any;
  });
  vi.stubGlobal('fetch', impl);
  return { calls, impl };
}

/** Fresh import so module-level caches (rules version, cooldown) start clean. */
async function loadTagger() {
  vi.resetModules();
  return import('./jobCategoryTagger');
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.JOB_TAGGER_URL = 'http://127.0.0.1:8000';
  process.env.JOB_TAGGER_ENABLED = 'true';
  process.env.JOB_TAGGER_MAX_BADGES = '2';
  delete process.env.JOB_TAGGER_TIMEOUT_MS;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe('classifyJobCategories fail-open contract', () => {
  it('never clobbers stored categories when the sidecar is unreachable', async () => {
    installFetch(() => new Error('ECONNREFUSED'));
    const { classifyJobCategories } = await loadTagger();

    const result = await classifyJobCategories({
      title: 'Senior Backend Engineer',
      description: 'Go, Kubernetes, Postgres',
      contentHash: 'hash-a',
    });

    expect(result.skipUpdate).toBe(true);
    expect(result.categoryClassification).toBeNull();
  });

  it('skips updates on a non-2xx classify response', async () => {
    installFetch((url) =>
      url.includes('/api/health') ? { body: HEALTH_BODY } : { status: 500, body: {} }
    );
    const { classifyJobCategories } = await loadTagger();

    const result = await classifyJobCategories({
      title: 'Data Engineer',
      description: 'Airflow',
      contentHash: 'hash-b',
    });

    expect(result.skipUpdate).toBe(true);
  });

  it('skips updates (and makes no request) when disabled or the title is blank', async () => {
    const { calls } = installFetch(() => ({ body: HEALTH_BODY }));
    const { classifyJobCategories } = await loadTagger();

    process.env.JOB_TAGGER_ENABLED = 'false';
    expect(
      (await classifyJobCategories({ title: 'QA Lead', description: '', contentHash: 'h' }))
        .skipUpdate
    ).toBe(true);

    process.env.JOB_TAGGER_ENABLED = 'true';
    expect(
      (await classifyJobCategories({ title: '   ', description: 'x', contentHash: 'h' })).skipUpdate
    ).toBe(true);

    expect(calls).toHaveLength(0);
  });

  it('stops calling the sidecar for a cooldown window after a transport failure', async () => {
    const { calls } = installFetch((url) =>
      url.includes('/api/health') ? { body: HEALTH_BODY } : new Error('socket hang up')
    );
    const { classifyJobCategories } = await loadTagger();

    const input = { title: 'SRE', description: 'oncall', contentHash: 'hash-c' };
    await classifyJobCategories(input);
    const afterFirst = calls.length;

    const second = await classifyJobCategories(input);
    expect(second.skipUpdate).toBe(true);
    expect(calls.length).toBe(afterFirst);
  });
});

describe('classifyJobCategories success path', () => {
  it('returns capped categories with classification metadata', async () => {
    installFetch((url) =>
      url.includes('/api/health')
        ? { body: HEALTH_BODY }
        : {
            body: {
              categories: ['Backend Development', 'Cloud Engineering', 'DevOps'],
              method: 'rules+ml',
              rules_version: 'rules-v1',
              classifier_version: 'clf-2.0',
            },
          }
    );
    const { classifyJobCategories } = await loadTagger();

    const result = await classifyJobCategories({
      title: 'Platform Engineer',
      description: 'Terraform, AWS',
      contentHash: 'hash-d',
    });

    expect(result.skipUpdate).toBeUndefined();
    expect(result.frozenCategories).toEqual(['Backend Development', 'Cloud Engineering']);
    expect(result.categoryClassification).toMatchObject({
      method: 'rules+ml',
      rulesVersion: 'rules-v1',
      classifierVersion: 'clf-2.0',
      contentHash: 'hash-d',
    });
  });

  it('writes an empty category list when the classifier finds nothing (legitimate untagged)', async () => {
    installFetch((url) =>
      url.includes('/api/health') ? { body: HEALTH_BODY } : { body: { categories: [] } }
    );
    const { classifyJobCategories } = await loadTagger();

    const result = await classifyJobCategories({
      title: 'Barista',
      description: 'coffee',
      contentHash: 'hash-e',
    });

    expect(result.skipUpdate).toBeUndefined();
    expect(result.frozenCategories).toEqual([]);
    expect(result.categoryClassification?.contentHash).toBe('hash-e');
  });

  it('does not re-classify when content hash and rules version already match', async () => {
    const { calls } = installFetch((url) =>
      url.includes('/api/health') ? { body: HEALTH_BODY } : { body: { categories: ['DevOps'] } }
    );
    const { classifyJobCategories } = await loadTagger();

    const result = await classifyJobCategories({
      title: 'DevOps Engineer',
      description: 'CI/CD',
      contentHash: 'hash-f',
      existingClassification: { contentHash: 'hash-f', rulesVersion: 'rules-v1' },
    });

    expect(result.skipUpdate).toBe(true);
    expect(calls.some((c) => c.includes('/api/classify-one'))).toBe(false);
  });

  it('re-classifies when the rules version moved on', async () => {
    installFetch((url) =>
      url.includes('/api/health')
        ? { body: { rules_version: 'rules-v2' } }
        : { body: { categories: ['AI Engineer'], rules_version: 'rules-v2' } }
    );
    const { classifyJobCategories } = await loadTagger();

    const result = await classifyJobCategories({
      title: 'ML Engineer',
      description: 'pytorch',
      contentHash: 'hash-g',
      existingClassification: { contentHash: 'hash-g', rulesVersion: 'rules-v1' },
    });

    expect(result.skipUpdate).toBeUndefined();
    expect(result.frozenCategories).toEqual(['AI Engineer']);
  });
});

describe('classifyJobCategoriesBatch', () => {
  it('only sends work that is needed and maps results back to original indices', async () => {
    let sentTitles: string[] = [];
    installFetch((url, init) => {
      if (url.includes('/api/health')) return { body: HEALTH_BODY };
      const payload = JSON.parse(String(init?.body || '{}'));
      sentTitles = payload.jobs.map((j: any) => j.title);
      return { body: payload.jobs.map((j: any) => ({ categories: [`cat:${j.title}`] })) };
    });
    const { classifyJobCategoriesBatch } = await loadTagger();

    const results = await classifyJobCategoriesBatch([
      { title: '  ', description: '', contentHash: 'h0' },
      { title: 'Needs work', description: '', contentHash: 'h1' },
      {
        title: 'Up to date',
        description: '',
        contentHash: 'h2',
        existingClassification: { contentHash: 'h2', rulesVersion: 'rules-v1' },
      },
      { title: 'Also needs work', description: '', contentHash: 'h3' },
    ]);

    expect(sentTitles).toEqual(['Needs work', 'Also needs work']);
    expect(results[0].skipUpdate).toBe(true);
    expect(results[2].skipUpdate).toBe(true);
    expect(results[1].frozenCategories).toEqual(['cat:Needs work']);
    expect(results[3].frozenCategories).toEqual(['cat:Also needs work']);
    expect(results[1].categoryClassification?.contentHash).toBe('h1');
    expect(results[3].categoryClassification?.contentHash).toBe('h3');
  });

  it('does not POST an empty batch (the sidecar rejects jobs=[])', async () => {
    const { calls } = installFetch((url) =>
      url.includes('/api/health') ? { body: HEALTH_BODY } : { body: [] }
    );
    const { classifyJobCategoriesBatch } = await loadTagger();

    const results = await classifyJobCategoriesBatch([
      { title: '', description: '', contentHash: 'h0' },
    ]);

    expect(results[0].skipUpdate).toBe(true);
    expect(calls.some((c) => c.includes('/api/classify-batch'))).toBe(false);
  });

  it('keeps stored categories for every row when the batch call fails', async () => {
    installFetch((url) =>
      url.includes('/api/health') ? { body: HEALTH_BODY } : new Error('timeout')
    );
    const { classifyJobCategoriesBatch } = await loadTagger();

    const results = await classifyJobCategoriesBatch([
      { title: 'A', description: '', contentHash: 'h1' },
      { title: 'B', description: '', contentHash: 'h2' },
    ]);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.skipUpdate === true)).toBe(true);
  });
});
