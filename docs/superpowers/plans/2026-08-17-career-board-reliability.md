# Career Board Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore full EY board collection and make Persistent HTTP/2 navigation failures observable without introducing an unverified global browser fallback.

**Architecture:** EY is a SuccessFactors board and should use the existing server-side board adapter; its stored `maxPages: 3` is a robot-data cap, not an extractor bug. Persistent remains browser-driven, so the scraper will recognize only `ERR_HTTP2_PROTOCOL_ERROR` and attach a bounded HTTP/1.1 probe result to the run log before its existing retry path decides whether to retry.

**Tech Stack:** TypeScript, Vitest, Node `https`, Mongoose, Playwright scraper worker.

---

### Task 1: Verify and correct the EY board cap

**Files:**
- Modify: MongoDB `maxun_robots` document with `recording_meta.id=b630d895-68af-4a2b-9882-0be84736bd98`
- Verify: Existing `server/src/services/atsAdapters.test.ts`

- [ ] **Step 1: Verify the source and collection path**

Run:

```powershell
node -e "require('dotenv').config(); const mongoose=require('mongoose'); (async()=>{await mongoose.connect(process.env.MONGODB_URI); const r=await mongoose.connection.db.collection('maxun_robots').findOne({'recording_meta.id':'b630d895-68af-4a2b-9882-0be84736bd98'},{projection:{'recording_meta.name':1,'recording_meta.url':1,'recording_meta.saasConfig.listExtraction.pagination':1}}); console.log(JSON.stringify(r,null,2)); await mongoose.disconnect()})().catch(e=>{console.error(e);process.exit(1)})"
```

Expected: `EY Careers`, a `search-3?...startrow=500` URL, and `maxPages: 3`.

- [ ] **Step 2: Update only the persisted cap**

Run:

```powershell
node -e "require('dotenv').config(); const mongoose=require('mongoose'); (async()=>{await mongoose.connect(process.env.MONGODB_URI); const r=await mongoose.connection.db.collection('maxun_robots').updateOne({'recording_meta.id':'b630d895-68af-4a2b-9882-0be84736bd98'},{$set:{'recording_meta.saasConfig.listExtraction.pagination.maxPages':25}}); console.log(JSON.stringify({matched:r.matchedCount,modified:r.modifiedCount})); await mongoose.disconnect()})().catch(e=>{console.error(e);process.exit(1)})"
```

Expected: exactly one document matched and modified. Twenty-five SuccessFactors pages cover the 508-job baseline at 25 jobs per page.

- [ ] **Step 3: Verify the persisted value**

Run:

```powershell
node -e "require('dotenv').config(); const mongoose=require('mongoose'); (async()=>{await mongoose.connect(process.env.MONGODB_URI); const r=await mongoose.connection.db.collection('maxun_robots').findOne({'recording_meta.id':'b630d895-68af-4a2b-9882-0be84736bd98'},{projection:{'recording_meta.saasConfig.listExtraction.pagination.maxPages':1}}); console.log(r.recording_meta.saasConfig.listExtraction.pagination.maxPages); await mongoose.disconnect()})().catch(e=>{console.error(e);process.exit(1)})"
```

Expected: `25`.

### Task 2: Add bounded HTTP/2 failure diagnostics

**Files:**
- Create: `server/src/services/navigationDiagnostics.ts`
- Create: `server/src/services/navigationDiagnostics.test.ts`
- Modify: `server/src/workers/scraperWorker.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe('isHttp2ProtocolNavigationError', () => {
  it('recognizes Chromium HTTP/2 protocol navigation failures', () => {
    expect(isHttp2ProtocolNavigationError(
      'page.goto: net::ERR_HTTP2_PROTOCOL_ERROR at https://careers.persistent.com/explore-opportunities'
    )).toBe(true);
  });

  it('does not classify unrelated navigation failures as HTTP/2 failures', () => {
    expect(isHttp2ProtocolNavigationError('page.goto: net::ERR_TIMED_OUT')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npx vitest run server/src/services/navigationDiagnostics.test.ts
```

Expected: failure because the module does not exist.

- [ ] **Step 3: Add a single-purpose diagnostic service**

```ts
export function isHttp2ProtocolNavigationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /\bERR_HTTP2_PROTOCOL_ERROR\b/i.test(message);
}

export async function probeHttp11(url: string, timeoutMs = 10_000): Promise<string> {
  // Use Node's https transport (HTTP/1.1) and return a sanitized status/error summary.
}
```

The probe must use a 10-second timeout, consume the response body, include only hostname/status/timeout/error code in its summary, and never throw.

- [ ] **Step 4: Call the probe only for the recognized failure**

In `scraperWorker.ts`, before the existing generic retry/eviction flow:

```ts
if (isHttp2ProtocolNavigationError(error)) {
  const probe = await probeHttp11(automation.recording_meta.url);
  await appendRunLog(latestRun, `HTTP/2 navigation diagnostic: ${probe}`);
}
```

Do not change retry counts, browser launch flags, or any non-HTTP/2 behavior.

- [ ] **Step 5: Run targeted tests**

Run:

```powershell
npx vitest run server/src/services/navigationDiagnostics.test.ts server/src/workers/scrapeJobSupervisor.test.ts
```

Expected: all tests pass.

### Task 3: Validate changes without scheduling an unsafe retry

**Files:**
- Verify: `server/src/services/navigationDiagnostics.ts`
- Verify: `server/src/workers/scraperWorker.ts`
- Verify: `server/src/services/atsAdapters.test.ts`

- [ ] **Step 1: Run the relevant suite**

Run:

```powershell
npx vitest run server/src/services/navigationDiagnostics.test.ts server/src/services/atsAdapters.test.ts server/src/workers/scrapeJobSupervisor.test.ts
```

Expected: zero failures.

- [ ] **Step 2: Check edited-file diagnostics**

Run: inspect IDE diagnostics for the two production files and test file.

Expected: no newly introduced errors.

- [ ] **Step 3: Build the server**

Run:

```powershell
npm run build
```

Expected: exit code 0.

- [ ] **Step 4: Deploy separately**

Do not automatically deploy or restart PM2. On the Droplet, deploy the verified build, then run Persistent once and inspect its new `HTTP/2 navigation diagnostic` run-log entry. Only implement a host-specific fallback after that entry proves HTTP/1.1 reaches a usable response.
