# Job Boards + Create Scraper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Job boards (`/robots`) and Create scraper (`/robots/create`) to be product-grade, fix correctness bugs, and cut list/create compute cost for near-term production load.

**Architecture:** Extract pure list-summary + create-cap helpers on the server; change `GET /storage/recordings` to return lean paginated summaries (enrich with schedule + latest run); redesign `RecordingsTable` and split `RobotCreate` into mode panels with isolated state. Keep MUI. Detail pages still use `GET /storage/recordings/:id` for full workflows.

**Tech Stack:** React + MUI + React Query (frontend), Express + Mongoose + Vitest (server), i18next locales in `public/locales/`.

**Spec:** `docs/superpowers/specs/2026-08-01-job-boards-create-scraper-design.md`

---

## File structure

| File | Responsibility |
|------|----------------|
| `server/src/constants/robotCreateLimits.ts` | Hard caps: crawl pages, search results, screenshot+crawl combo |
| `server/src/utils/robotListSummary.ts` | Pure mappers: robot → lean summary; schedule label; last-run pick |
| `server/src/utils/robotListSummary.test.ts` | Unit tests for mappers |
| `server/src/constants/robotCreateLimits.test.ts` | Unit tests for cap clamping |
| `server/src/routes/storage.ts` | Lean paginated GET `/recordings`; enforce caps on crawl/search POST |
| `src/api/storage.ts` | Typed `getStoredRecordings({ page, limit, search })` returning `{ robots, total, page, limit }` |
| `src/types/robotList.ts` | Shared frontend types for lean robot rows |
| `src/context/globalInfo.tsx` | `useCachedRecordings` query key includes page/limit; invalidate still works |
| `src/components/robot/RecordingsTable.tsx` | Redesigned table; fix row ids; remove legacy create modal; overflow actions |
| `src/components/robot/pages/RobotCreate.tsx` | Shell: title, mode switcher, warning modal |
| `src/components/robot/pages/create/ExtractCreatePanel.tsx` | Extract mode form |
| `src/components/robot/pages/create/ScrapeCreatePanel.tsx` | Scrape mode form |
| `src/components/robot/pages/create/CrawlCreatePanel.tsx` | Crawl mode form |
| `src/components/robot/pages/create/SearchCreatePanel.tsx` | Search mode form |
| `src/components/robot/pages/create/OutputFormatsField.tsx` | Shared formats select + cost hints |
| `src/components/robot/pages/create/url.ts` | `normalizeUrl` / `isValidHttpUrl` helpers |
| `src/components/robot/pages/create/url.test.ts` | Vitest for URL helpers |
| `public/locales/en.json` (+ de/es/ja/tr/zh as needed) | New list/create strings |

---

### Task 1: Robot create limits (server constants)

**Files:**
- Create: `server/src/constants/robotCreateLimits.ts`
- Create: `server/src/constants/robotCreateLimits.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from 'vitest';
import {
  MAX_CRAWL_PAGES,
  MAX_SEARCH_RESULTS,
  DEFAULT_CRAWL_PAGES,
  DEFAULT_SEARCH_RESULTS,
  clampCrawlLimit,
  clampSearchLimit,
  formatsIncludeScreenshot,
  assertCrawlFormatsAllowed,
} from './robotCreateLimits';

describe('robotCreateLimits', () => {
  it('exposes production caps', () => {
    expect(MAX_CRAWL_PAGES).toBe(200);
    expect(MAX_SEARCH_RESULTS).toBe(50);
    expect(DEFAULT_CRAWL_PAGES).toBe(50);
    expect(DEFAULT_SEARCH_RESULTS).toBe(10);
  });

  it('clamps crawl and search limits', () => {
    expect(clampCrawlLimit(undefined)).toBe(DEFAULT_CRAWL_PAGES);
    expect(clampCrawlLimit(0)).toBe(1);
    expect(clampCrawlLimit(9999)).toBe(MAX_CRAWL_PAGES);
    expect(clampSearchLimit(1000)).toBe(MAX_SEARCH_RESULTS);
  });

  it('rejects screenshot formats when crawl limit is high', () => {
    expect(formatsIncludeScreenshot(['markdown', 'screenshot-fullpage'])).toBe(true);
    expect(() => assertCrawlFormatsAllowed(['screenshot-visible'], 80)).toThrow(/screenshot/i);
    expect(() => assertCrawlFormatsAllowed(['markdown'], 80)).not.toThrow();
    expect(() => assertCrawlFormatsAllowed(['screenshot-visible'], 20)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/src/constants/robotCreateLimits.test.ts`

Expected: FAIL (module not found)

- [ ] **Step 3: Implement constants**

```typescript
export const MAX_CRAWL_PAGES = 200;
export const MAX_SEARCH_RESULTS = 50;
export const DEFAULT_CRAWL_PAGES = 50;
export const DEFAULT_SEARCH_RESULTS = 10;
/** Screenshots disallowed on crawl when page limit exceeds this. */
export const MAX_CRAWL_PAGES_WITH_SCREENSHOT = 25;

export function clampCrawlLimit(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return DEFAULT_CRAWL_PAGES;
  return Math.min(MAX_CRAWL_PAGES, Math.max(1, Math.floor(n)));
}

export function clampSearchLimit(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return DEFAULT_SEARCH_RESULTS;
  return Math.min(MAX_SEARCH_RESULTS, Math.max(1, Math.floor(n)));
}

export function formatsIncludeScreenshot(formats: string[] | undefined): boolean {
  return (formats ?? []).some((f) => String(f).startsWith('screenshot'));
}

export function assertCrawlFormatsAllowed(formats: string[] | undefined, limit: number): void {
  if (formatsIncludeScreenshot(formats) && limit > MAX_CRAWL_PAGES_WITH_SCREENSHOT) {
    throw new Error(
      `Screenshot formats require crawl limit ≤ ${MAX_CRAWL_PAGES_WITH_SCREENSHOT} (got ${limit}).`
    );
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run server/src/constants/robotCreateLimits.test.ts`

- [ ] **Step 5: Commit**

```bash
git add server/src/constants/robotCreateLimits.ts server/src/constants/robotCreateLimits.test.ts
git commit -m "feat(robots): add create-limit caps for crawl and search"
```

---

### Task 2: Lean robot list summary helpers

**Files:**
- Create: `server/src/utils/robotListSummary.ts`
- Create: `server/src/utils/robotListSummary.test.ts`
- Modify: import `resolveEffectiveScheduleState` from `server/src/services/automationScheduler.ts` (read-only use)

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from 'vitest';
import { buildRobotListSummary, pickLatestRun, formatScheduleLabel } from './robotListSummary';

describe('formatScheduleLabel', () => {
  it('returns Off when disabled or empty', () => {
    expect(formatScheduleLabel({ enabled: false, cron: '0 9 * * *' })).toBe('Off');
    expect(formatScheduleLabel({ enabled: true, cron: '' })).toBe('Off');
  });

  it('returns cron string when enabled', () => {
    expect(formatScheduleLabel({ enabled: true, cron: '0 9 * * *' })).toBe('0 9 * * *');
  });
});

describe('pickLatestRun', () => {
  it('picks newest by startedAt then _id', () => {
    const run = pickLatestRun([
      { status: 'success', startedAt: '2024-01-01T00:00:00.000Z', finishedAt: '2024-01-01T00:01:00.000Z', _id: 'a' },
      { status: 'failed', startedAt: '2024-01-02T00:00:00.000Z', finishedAt: '2024-01-02T00:01:00.000Z', _id: 'b' },
    ]);
    expect(run?.status).toBe('failed');
  });

  it('returns null for empty', () => {
    expect(pickLatestRun([])).toBeNull();
  });
});

describe('buildRobotListSummary', () => {
  it('maps meta without including workflow', () => {
    const summary = buildRobotListSummary(
      {
        recording_meta: {
          id: 'r1',
          name: 'naukri',
          type: 'scrape',
          url: 'https://example.com',
          updatedAt: '1/1/2024',
          params: [],
        },
        recording: { workflow: [{ where: {}, what: [] }] },
        schedule: { enabled: true, cron: '0 * * * *' },
      },
      { status: 'running', startedAt: 'x', finishedAt: null }
    );
    expect(summary).toEqual({
      id: 'r1',
      name: 'naukri',
      type: 'scrape',
      url: 'https://example.com',
      updatedAt: '1/1/2024',
      params: [],
      schedule: { enabled: true, label: '0 * * * *' },
      lastRun: { status: 'running', startedAt: 'x', finishedAt: null },
    });
    expect((summary as any).recording).toBeUndefined();
    expect((summary as any).workflow).toBeUndefined();
  });

  it('defaults type to extract when missing', () => {
    const summary = buildRobotListSummary(
      { recording_meta: { id: 'r2', name: 'IT', updatedAt: '', params: [] }, recording: { workflow: [] }, schedule: null },
      null
    );
    expect(summary.type).toBe('extract');
    expect(summary.schedule).toEqual({ enabled: false, label: 'Off' });
    expect(summary.lastRun).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run server/src/utils/robotListSummary.test.ts`

- [ ] **Step 3: Implement helpers**

```typescript
import { resolveEffectiveScheduleState } from '../services/automationScheduler';

export type RobotListType = 'extract' | 'scrape' | 'crawl' | 'search';

export interface RobotListSummary {
  id: string;
  name: string;
  type: RobotListType;
  url: string | null;
  updatedAt: string;
  params: string[];
  schedule: { enabled: boolean; label: string };
  lastRun: { status: string; startedAt: string | null; finishedAt: string | null } | null;
}

export function formatScheduleLabel(schedule: { enabled?: boolean; cron?: string; every?: number } | null | undefined): string {
  if (!schedule?.enabled) return 'Off';
  if (schedule.cron && String(schedule.cron).trim()) return String(schedule.cron).trim();
  if (schedule.every) return `every ${schedule.every}ms`;
  return 'Off';
}

export function pickLatestRun(
  runs: Array<{ status: string; startedAt?: string | null; finishedAt?: string | null; _id?: any }>
): { status: string; startedAt: string | null; finishedAt: string | null } | null {
  if (!runs?.length) return null;
  const sorted = [...runs].sort((a, b) => {
    const ta = Date.parse(String(a.startedAt || '')) || 0;
    const tb = Date.parse(String(b.startedAt || '')) || 0;
    if (tb !== ta) return tb - ta;
    return String(b._id || '').localeCompare(String(a._id || ''));
  });
  const top = sorted[0];
  return {
    status: top.status,
    startedAt: top.startedAt ?? null,
    finishedAt: top.finishedAt ?? null,
  };
}

function normalizeType(raw: unknown): RobotListType {
  if (raw === 'scrape' || raw === 'crawl' || raw === 'search') return raw;
  return 'extract';
}

export function buildRobotListSummary(
  robot: any,
  latestRun: { status: string; startedAt?: string | null; finishedAt?: string | null } | null
): RobotListSummary {
  const meta = robot?.recording_meta || {};
  const effective = resolveEffectiveScheduleState(robot);
  const enabled = !!effective?.enabled && !!(effective.cron || effective.every);
  return {
    id: String(meta.id || ''),
    name: String(meta.name || ''),
    type: normalizeType(meta.type),
    url: typeof meta.url === 'string' ? meta.url : null,
    updatedAt: String(meta.updatedAt || meta.createdAt || ''),
    params: Array.isArray(meta.params) ? meta.params : [],
    schedule: {
      enabled,
      label: formatScheduleLabel(enabled ? effective : { enabled: false }),
    },
    lastRun: latestRun
      ? {
          status: latestRun.status,
          startedAt: latestRun.startedAt ?? null,
          finishedAt: latestRun.finishedAt ?? null,
        }
      : null,
  };
}
```

Note: If `resolveEffectiveScheduleState` is hard to unit-test in isolation, mock it in the test file with `vi.mock('../services/automationScheduler', () => ({ resolveEffectiveScheduleState: (r: any) => r.schedule || { enabled: false } }))`.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add server/src/utils/robotListSummary.ts server/src/utils/robotListSummary.test.ts
git commit -m "feat(robots): add lean robot list summary helpers"
```

---

### Task 3: Lean paginated GET `/storage/recordings`

**Files:**
- Modify: `server/src/routes/storage.ts` (GET `/recordings` handler ~lines 74–94)
- Use: `Robot`, `Run`, `buildRobotListSummary`, `pickLatestRun`, `ownerIdFilter`, `parsePagination`

- [ ] **Step 1: Replace GET `/recordings` handler**

Behavior:
1. Always paginate (default `page=1`, `limit=DEFAULT_RECORDINGS_LIMIT` even if query omits limit — **breaking change** from “return all”).
2. Support optional `?q=` name filter (case-insensitive regex on `recording_meta.name`).
3. `select` only: `recording_meta`, `schedule`, `userId` — **never** `recording`.
4. After page of robots, batch-fetch latest runs:

```typescript
const metaIds = robots.map((r: any) => r.recording_meta?.id).filter(Boolean);
const latestRuns = await Run.aggregate([
  { $match: { robotMetaId: { $in: metaIds } } },
  { $sort: { startedAt: -1, _id: -1 } },
  { $group: { _id: '$robotMetaId', doc: { $first: '$$ROOT' } } },
]);
const runByMeta = new Map(latestRuns.map((x: any) => [x._id, x.doc]));
```

5. Response shape:

```json
{
  "robots": [ /* RobotListSummary */ ],
  "total": 123,
  "page": 1,
  "limit": 10
}
```

6. Keep `?full=1` escape hatch: if `full=1`, preserve old bare-array full documents for emergency/debug only (log a warn). Frontend will not use it.

Skeleton:

```typescript
router.get('/recordings', requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) return res.status(401).send({ error: 'Unauthorized' });

    if (String((req.query as any).full || '') === '1') {
      logger.log('warn', 'GET /recordings?full=1 is deprecated');
      const data = await Robot.find(ownerIdFilter(req.user.id)).sort({ _id: -1 }).lean();
      return res.send(data);
    }

    const { page, limit, skip } = parsePagination(
      { page: (req.query as any).page ?? '1', limit: (req.query as any).limit ?? String(10) },
      10,
      MAX_RECORDINGS_LIMIT
    );
    const q = String((req.query as any).q || '').trim();
    const filter: any = { ...ownerIdFilter(req.user.id) };
    if (q) {
      filter['recording_meta.name'] = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }

    const [total, robots] = await Promise.all([
      Robot.countDocuments(filter),
      Robot.find(filter)
        .select({ recording_meta: 1, schedule: 1, userId: 1 })
        .sort({ _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const metaIds = robots.map((r: any) => r.recording_meta?.id).filter(Boolean);
    const latestRuns = metaIds.length
      ? await Run.aggregate([
          { $match: { robotMetaId: { $in: metaIds } } },
          { $sort: { startedAt: -1, _id: -1 } },
          { $group: { _id: '$robotMetaId', doc: { $first: '$$ROOT' } } },
        ])
      : [];
    const runByMeta = new Map(latestRuns.map((x: any) => [x._id, x.doc]));

    const summaries = robots.map((r: any) =>
      buildRobotListSummary(r, pickLatestRun(runByMeta.get(r.recording_meta?.id) ? [runByMeta.get(r.recording_meta.id)] : []))
    );

    return res.send({ robots: summaries, total, page, limit });
  } catch (e) {
    logger.log('info', 'Error while reading robots');
    return res.status(500).send({ error: 'Failed to retrieve robots' });
  }
});
```

Import `Run` from `../models/Run` if not already imported.

- [ ] **Step 2: Manual smoke**

With server running and auth cookie:  
`GET /storage/recordings?page=1&limit=10` → JSON with `robots` array lacking `recording` keys; `total` number.

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/storage.ts
git commit -m "feat(robots): return lean paginated robot list summaries"
```

---

### Task 4: Frontend API + React Query for lean list

**Files:**
- Create: `src/types/robotList.ts`
- Modify: `src/api/storage.ts` (`getStoredRecordings`)
- Modify: `src/context/globalInfo.tsx` (`useCachedRecordings`, optimistic helpers)

- [ ] **Step 1: Add types**

```typescript
// src/types/robotList.ts
export type RobotListType = 'extract' | 'scrape' | 'crawl' | 'search';

export interface RobotListSummary {
  id: string;
  name: string;
  type: RobotListType;
  url: string | null;
  updatedAt: string;
  params: string[];
  schedule: { enabled: boolean; label: string };
  lastRun: { status: string; startedAt: string | null; finishedAt: string | null } | null;
}

export interface RobotListResponse {
  robots: RobotListSummary[];
  total: number;
  page: number;
  limit: number;
}
```

- [ ] **Step 2: Update `getStoredRecordings`**

```typescript
export const getStoredRecordings = async (opts?: {
  page?: number;
  limit?: number;
  q?: string;
}): Promise<RobotListResponse | null> => {
  try {
    const response = await axios.get(`${apiUrl}/storage/recordings`, {
      params: {
        page: opts?.page ?? 1,
        limit: opts?.limit ?? 10,
        q: opts?.q || undefined,
      },
      withCredentials: true,
    });
    if (response.status === 200 && response.data?.robots) {
      return response.data as RobotListResponse;
    }
    throw new Error("Couldn't retrieve stored recordings");
  } catch (error: any) {
    console.log(error);
    return null;
  }
};
```

- [ ] **Step 3: Update `useCachedRecordings`**

Accept `{ page, limit, q }` and put them in `queryKey`:

```typescript
export const useCachedRecordings = (params: { page: number; limit: number; q?: string }) => {
  return useQuery({
    queryKey: [...dataCacheKeys.recordings, params.page, params.limit, params.q || ''],
    queryFn: async () => {
      const data = await getStoredRecordings(params);
      if (!data) throw new Error('Failed to fetch recordings data');
      return data;
    },
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 2,
    placeholderData: (prev) => prev,
  });
};
```

Update `addOptimisticRobot` / `invalidateRecordings` to invalidate the `dataCacheKeys.recordings` prefix (already does if key is array prefix — ensure `invalidateQueries({ queryKey: dataCacheKeys.recordings })` still matches).

- [ ] **Step 4: Fix all call sites of `useCachedRecordings()`** — currently only `RecordingsTable.tsx`. Pass page/limit/search from that component (Task 5). Temporarily if needed:

```typescript
useCachedRecordings({ page: 1, limit: 10 })
```

- [ ] **Step 5: Commit**

```bash
git add src/types/robotList.ts src/api/storage.ts src/context/globalInfo.tsx
git commit -m "feat(robots): consume lean paginated recordings API"
```

---

### Task 5: Redesign Job boards table + fix row IDs

**Files:**
- Modify: `src/components/robot/RecordingsTable.tsx` (major)
- Modify: `public/locales/en.json` (`recordingtable` keys)
- Optionally mirror new keys in `de.json`, `es.json`, `ja.json`, `tr.json`, `zh.json` (English fallback OK short-term)

- [ ] **Step 1: Map rows from lean summaries — use `id: recording.id` never index**

```typescript
const { data, isLoading: isFetching, refetch } = useCachedRecordings({
  page: page + 1, // MUI is 0-based
  limit: rowsPerPage,
  q: debouncedSearchTerm || undefined,
});

const rows = data?.robots ?? [];
const total = data?.total ?? 0;
```

Remove client-side filter/sort over full dataset (server handles `q` + order). Keep debounce for search → resets page to 0.

- [ ] **Step 2: New columns**

| Column | Content |
|--------|---------|
| name | Typography name + caption `updatedAt` |
| type | Chip: Extract/Scrape/Crawl/Search |
| status | From `lastRun.status` → Idle if null; map running/queued/failed/success |
| schedule | `schedule.label` (+ muted if Off) |
| lastRun | Relative time from `finishedAt` or `startedAt` + short status |
| actions | `Run` IconButton/Button + `MoreHoriz` menu |

Remove dedicated Schedule/Integrate/Settings columns; move those handlers into the overflow menu (keep existing navigate handlers).

- [ ] **Step 3: Fix retrain URL**

List no longer has workflow. Before retrain:

```typescript
const detail = await getStoredRecording(id); // existing get-by-id helper in storage.ts
// extract goto URL from detail.recording.workflow OR use detail.recording_meta.url
```

Use existing `getStoredRecording` / equivalent in `src/api/storage.ts` (the GET by id function around line 126).

- [ ] **Step 4: Delete legacy create modal**

Remove `isModalOpen` modal UI and `startRecording` path from this file. Keep browser-limit warning modal used by retrain. Create CTA only `navigate('/robots/create')`.

- [ ] **Step 5: Visual redesign (MUI)**

- Page header: `t('recordingtable.heading')` → update en to `"Job board scrapers"`; add `heading_subtitle`.
- Primary CTA keep `#ff00c3` but use `Button` not oddly styled `IconButton`.
- Dense `Table` / sticky header; status chips with theme colors.
- Pagination: `count={total}`, wire `rowsPerPageOptions={[10, 25, 50]}`.

- [ ] **Step 6: Manual verify**

- List loads; Run/Delete/Edit use correct robot; search hits server; no workflow JSON in network response.

- [ ] **Step 7: Commit**

```bash
git add src/components/robot/RecordingsTable.tsx public/locales/en.json
git commit -m "feat(robots): redesign job boards list with status and lean rows"
```

---

### Task 6: URL helpers + OutputFormatsField

**Files:**
- Create: `src/components/robot/pages/create/url.ts`
- Create: `src/components/robot/pages/create/url.test.ts`
- Create: `src/components/robot/pages/create/OutputFormatsField.tsx`

- [ ] **Step 1: URL tests + impl**

```typescript
// url.test.ts
import { describe, expect, it } from 'vitest';
import { normalizeUrl, isValidHttpUrl } from './url';

describe('normalizeUrl', () => {
  it('adds https when scheme missing', () => {
    expect(normalizeUrl('careers.example.com/jobs')).toBe('https://careers.example.com/jobs');
  });
  it('preserves https', () => {
    expect(normalizeUrl('https://x.com')).toBe('https://x.com');
  });
});

describe('isValidHttpUrl', () => {
  it('accepts http(s)', () => {
    expect(isValidHttpUrl('https://example.com')).toBe(true);
    expect(isValidHttpUrl('not a url')).toBe(false);
  });
});
```

```typescript
// url.ts
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function isValidHttpUrl(input: string): boolean {
  try {
    const u = new URL(normalizeUrl(input));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
```

Run: `npx vitest run src/components/robot/pages/create/url.test.ts`

- [ ] **Step 2: `OutputFormatsField`**

MUI multi-select using `OUTPUT_FORMAT_OPTIONS` / labels from `src/constants/outputFormats.ts`.  
For each screenshot option, show helper: `Higher compute — use only if you need images.`  
For `screenshot-fullpage`, stronger helper.  
Props: `value`, `onChange`, `required`, `disabled?`.

- [ ] **Step 3: Commit**

```bash
git add src/components/robot/pages/create/url.ts src/components/robot/pages/create/url.test.ts src/components/robot/pages/create/OutputFormatsField.tsx
git commit -m "feat(robots): add create URL helpers and output format field"
```

---

### Task 7: Split RobotCreate shell + Extract panel

**Files:**
- Modify: `src/components/robot/pages/RobotCreate.tsx`
- Create: `src/components/robot/pages/create/ExtractCreatePanel.tsx`
- Modify: `public/locales/en.json`

- [ ] **Step 1: Shell layout**

`RobotCreate` keeps:
- Back button + title
- Equal mode switcher: MUI `ToggleButtonGroup` full width **or** 2×2 `Card` buttons for Extract/Scrape/Crawl/Search (equal visual weight)
- Renders one panel by `mode` state (`'extract' | 'scrape' | 'crawl' | 'search'`)
- Browser warning modal (shared with Extract)

**Remove** in-card ScoutX logos from all modes.

- [ ] **Step 2: Extract panel**

Props: `onBusyChange`, warning modal callbacks already in parent OR self-contained like current `handleStartRecording`.

Fields: Job site URL (normalize on blur), optional login checkbox if product still wants it (wire `needsLogin` session flag as today).

CTA: `Start recording` — only enabled when `isValidHttpUrl(url)`.

Keep sessionStorage + `window.open('/recording-setup?...')` + `navigate('/robots')` behavior; on failure clear loading and session keys set in this attempt.

- [ ] **Step 3: i18n keys** for mode labels/descriptions (`recordingtable.mode_extract`, etc.)

- [ ] **Step 4: Manual verify Extract** still opens recording tab

- [ ] **Step 5: Commit**

```bash
git add src/components/robot/pages/RobotCreate.tsx src/components/robot/pages/create/ExtractCreatePanel.tsx public/locales/en.json
git commit -m "feat(robots): redesign create shell and Extract panel"
```

---

### Task 8: Scrape / Crawl / Search panels + isolated state

**Files:**
- Create: `src/components/robot/pages/create/ScrapeCreatePanel.tsx`
- Create: `src/components/robot/pages/create/CrawlCreatePanel.tsx`
- Create: `src/components/robot/pages/create/SearchCreatePanel.tsx`
- Modify: `src/components/robot/pages/RobotCreate.tsx` (wire panels)
- Modify: `src/api/storage.ts` if needed to pass clamped limits
- Modify: `server/src/routes/storage.ts` crawl/search handlers to use `clampCrawlLimit` / `clampSearchLimit` / `assertCrawlFormatsAllowed`

- [ ] **Step 1: Server — enforce caps in crawl/search POST**

In crawl handler after parsing body:

```typescript
import { clampCrawlLimit, assertCrawlFormatsAllowed } from '../constants/robotCreateLimits';

const limit = clampCrawlLimit(crawlConfig?.limit);
try {
  assertCrawlFormatsAllowed(crawlFormats, limit);
} catch (err: any) {
  return res.status(400).json({ error: err.message });
}
crawlConfig = { ...crawlConfig, limit };
```

Search: `clampSearchLimit(searchConfig.limit)` similarly. Require non-empty `name` trim (400 if missing) — stop auto-naming with “Markdown Robot” for this product surface if body omits name? Spec: name required in UI; server should `400` when name empty string after trim (allow fallback only if you must keep API compat — prefer 400 when `name` key present but blank; if omitted keep hostname fallback for API clients).

- [ ] **Step 2: Scrape panel**

Local state only: `name`, `url`, `outputFormats` (default `['markdown']`).  
Validate name + URL + ≥1 format.  
On success: `invalidateRecordings()` (not `setRerenderRobots` alone), toast, `navigate('/robots')`.  
CTA label: `Create scraper`.

- [ ] **Step 3: Crawl panel**

Local state for all crawl fields. Show helper under max pages: `Max ${MAX_CRAWL_PAGES}`.  
If screenshots selected and limit > 25, show error helper and disable submit (mirror server).  
Advanced collapse unchanged functionally.

- [ ] **Step 4: Search panel**

Local state. Default mode `discover`. Time Range default `''` with label “No filter” selected.  
Formats only if mode === `scrape`.  
CTA `Create scraper`. Invalidate cache on success.

- [ ] **Step 5: Verify tab switch does not leak URL/name between modes**

- [ ] **Step 6: Commit**

```bash
git add src/components/robot/pages/create/ScrapeCreatePanel.tsx src/components/robot/pages/create/CrawlCreatePanel.tsx src/components/robot/pages/create/SearchCreatePanel.tsx src/components/robot/pages/RobotCreate.tsx server/src/routes/storage.ts
git commit -m "feat(robots): add create panels with caps and isolated state"
```

---

### Task 9: Shared polish (copy, a11y, cleanup)

**Files:**
- `public/locales/en.json` (+ other locales for new keys)
- Touch-ups in `RecordingsTable.tsx`, create panels
- Delete dead code from old `RobotCreate` after split

- [ ] **Step 1: Copy**

- Heading: “Job board scrapers”
- CTA: “Create scraper” / “Start recording”
- Remove “Create Robot” strings from this surface
- Alt text: “FirstStep” or “Scout-X” consistently (fix “Scrapper” typo where edited)
- Empty states already partly good — align with new heading

- [ ] **Step 2: A11y**

- All icon-only buttons have `aria-label`
- Mode switcher has `aria-label="Scraper type"`
- Disabled primary buttons use theme `disabled` styles (readable), not ultra-light pink wash
- Table header cells use `scope` via MUI Table defaults

- [ ] **Step 3: Ensure `RobotCreate.tsx` no longer contains duplicated form markup**

- [ ] **Step 4: Run unit tests**

Run: `npx vitest run server/src/constants/robotCreateLimits.test.ts server/src/utils/robotListSummary.test.ts src/components/robot/pages/create/url.test.ts`

Expected: all PASS

- [ ] **Step 5: Manual checklist**

- [ ] List shows type/status/schedule/last run  
- [ ] Create all 4 modes  
- [ ] Switch tabs — no leaked fields  
- [ ] Crawl limit 201 clamped / rejected  
- [ ] Screenshot + crawl 80 rejected  
- [ ] Retrain still works (detail fetch)  
- [ ] Run / schedule / integrate / settings / delete from overflow  

- [ ] **Step 6: Commit**

```bash
git add public/locales src/components/robot
git commit -m "polish(robots): copy, a11y, and create cleanup"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Lean list, no workflows | 2, 3 |
| Pagination + search | 3, 4, 5 |
| Type / status / schedule / last run columns | 5 |
| Row id bug fix | 5 |
| Overflow actions; remove icon wall | 5 |
| Remove legacy create modal | 5 |
| Full visual redesign list + create | 5, 7, 8 |
| Equal create modes | 7, 8 |
| No in-card logos | 7 |
| Isolated form state | 8 |
| Unified cache invalidation | 8 |
| Cost defaults + screenshot hints | 6, 8 |
| Server caps | 1, 8 |
| Extract hardening | 7 |
| i18n / a11y / copy | 7, 9 |
| Retrain without list workflow | 5 |
| Out of scope (billing, engines, etc.) | Not planned |

## Placeholder / consistency self-review

- Caps fixed: crawl max 200, search max 50, screenshot crawl max 25, list default page size 10.
- Response shape consistently `{ robots, total, page, limit }`.
- Type union `extract | scrape | crawl | search` used on server and client.
- No TBD steps remaining.
