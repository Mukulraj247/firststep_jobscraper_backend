# Company Identity Resolution

**What this is:** A system that identifies *which company a job belongs to* using the job’s final career/apply URL — not the free-text company name typed by scrapers or aggregators.

**Why it matters:** The same employer can show up as “Dell”, “Dell Technologies”, or “Delltech” depending on who found the job. Matching on those strings drops jobs and creates duplicate scrapers. Matching on the domain (e.g. `dell.com`) does not.

---

## 1. The problem (in plain English)

Before this work, every job and every automation only stored a **company name** as text:

- Our automation might say **Dell**
- Hiring Cafe might say **Dell Technologies**
- Someone else might type **Delltech**

When we built **clusters** (groups of jobs for clients), we filtered by that text. Names did not match → jobs were dropped or mis-grouped.

A second problem: if two people ask for scrapers on the same company (e.g. CVS Health for software engineers vs data engineers), we risked creating **two scrapers** for the same career site when one scrape plus filters would do.

**The insight from product:**  
Regardless of where a job came from (our automation, Hiring Cafe, Accel, etc.), once we have the **final employer apply/career URL**, that URL’s domain is stable.  
Example: `jobs.apple.com/...` always maps to Apple.  
`enterpriseplatform.dell.com/...` always maps to Dell.

So:

- **Identity** = domain-derived key (stable)
- **Display name** = human label hanging off that key (can vary; we pick the best one)

---



## 2. The approach (how we think about it)



### 2.1 Three tiers of URL resolution

Every job URL goes through this pipeline:

```
Final employer job/apply URL
        │
        ▼
┌───────────────────────────────┐
│ Tier 0 — Excluded hosts?      │  Hiring Cafe, LinkedIn, Indeed, …
│ → No company (leave blank)    │
└───────────────────────────────┘
        │ no
        ▼
┌───────────────────────────────┐
│ Tier 1 — Shared ATS vendor?   │  Workday, iCIMS, Greenhouse, …
│ → Key = provider:tenant       │  e.g. workday:hpe, icims:cvshealth
└───────────────────────────────┘
        │ no
        ▼
┌───────────────────────────────┐
│ Tier 2 — Employer-owned site  │  apple.com, dell.com, …
│ → Key = registrable domain    │  (eTLD+1 via public suffix list)
└───────────────────────────────┘
        │
        ▼
Look up / create row in scoutx_companies
Stamp companyId + companyKey + companyResolvedName on the job
```

**Why Tier 1 exists:**  
Hosts like `myworkdayjobs.com` or `icims.com` are **not** companies. They are ATS platforms.  
HPE lives at `hpe.wd5.myworkdayjobs.com` → we key it as `workday:hpe`, not `myworkdayjobs.com`.  
That is the edge case called out in the design session (Workday, iCIMS, ApplicantPro, etc.).

**Why Tier 2 uses eTLD+1:**  
`jobs.apple.com` and `www.apple.com/careers` both collapse to `apple.com`.  
We use the `tldts` library so `.co.uk` / `.com.au` style domains are handled correctly.

### 2.2 Opaque company IDs (`CX-…`)

Automations already use Scout-X IDs like `SX47KX19`.  
Companies get a **different** prefix so they are never confused:


| Entity     | Format          | Example       |
| ---------- | --------------- | ------------- |
| Automation | `SX` + pattern  | `SX47KX19`    |
| Company    | `CX-` + 8 chars | `CX-A1B2C3D4` |


Internally we still use a stable `companyKey` (`apple.com`, `workday:hpe`) for lookups.  
`companyId` is what we expose as a clean public identifier.

### 2.3 Name precedence (who wins when names disagree)

When we already know a company, we **do not overwrite** its display name with a weaker source.


| Priority | Source       | Meaning                                |
| -------- | ------------ | -------------------------------------- |
| 5        | `ops`        | Manual correction by ops (always wins) |
| 4        | `automation` | Name typed when creating an automation |
| 3        | `ats_hint`   | Hint from ATS detection                |
| 2        | `aggregator` | Name from Hiring Cafe / Accel / etc.   |
| 1        | `derived`    | Title-cased from domain (last resort)  |


**Practical result:**

1. First time we see `dell.com` from Hiring Cafe → store “Dell Technologies”.
2. Later our automation is created as “Dell” → **automation wins**; name becomes “Dell”.
3. Another aggregator says “Delltech” → **ignored for display**; may be stored as an alias.
4. Ops can always force a correction with `ops` precedence.



### 2.4 Sibling domains (manual merge later)

Some employers use vanity domains that are *not* the same string:

- `capitalonecareers.com` vs `capitalone.com`
- `usaajobs.com` vs `usaa.com`
- `wellsfargojobs.com` vs `wellsfargo.com`

We do **not** auto-guess merges. The registry has a `mergedInto` field for ops to point one key at another after reviewing audit output. Fuzzy auto-merging would be too risky.

### 2.5 What stays on the job board vs what drives clustering


| Field                 | Purpose                                      |
| --------------------- | -------------------------------------------- |
| `companyName`         | Original scraped text (job board display)    |
| `companyResolvedName` | Canonical name from registry (filters/UI)    |
| `companyKey`          | Stable identity key                          |
| `companyId`           | Opaque `CX-…` ID for joins / cluster filters |


Scraped name stays for the board. Clustering and portal filters prefer the resolved name / company ID.

---



## 3. What we built (Phase 1 then Phase 2)



### Phase 1 — Prove the rules (read-only)

Built and verified **before** writing any company IDs to production data:

1. **Resolver module** — pure functions, no DB writes
2. **Unit tests** — session URLs (Apple, Dell, JPMC, Workday HPE/EA, iCIMS, aggregators, …)
3. **Audit script** — scan existing `maxun_job_board` rows and emit CSVs for review

Gate: review audit CSVs, then proceed to Phase 2.

### Phase 2 — Persist and use the identity

1. Company registry collection
2. Stamp jobs on ingest and soft-gate rekey
3. Stamp automations on create
4. Cluster filters by `companyIds`
5. Extension pre-fill / lock company field
6. Backfill existing data

---



## 4. Implementation detail (file by file)



### 4.1 Resolver — `server/src/services/companyIdentity.ts`

**Role:** Given a URL, return `{ companyKey, tier, atsProvider, nameHint, confidence }` or `null`.


| Helper                                                      | What it does                                                          |
| ----------------------------------------------------------- | --------------------------------------------------------------------- |
| `resolveCompanyKey(url)`                                    | Main entry: Tier 0 → 1 → 2                                            |
| `pickEmployerUrlForCompanyResolution({ jobUrl, applyUrl })` | Prefer job URL; fall back to apply URL; skip aggregator hosts         |
| `isExcludedJobBoardHost(host)`                              | Aggregators + LinkedIn/Indeed/Glassdoor/etc.                          |
| `VENDOR_ATS_REGISTRABLE_DOMAINS`                            | Workday, iCIMS, Greenhouse, Lever, ApplicantPro, Jobvite, BambooHR, … |


**Tier 1 examples:**


| URL                                            | companyKey             |
| ---------------------------------------------- | ---------------------- |
| `https://hpe.wd5.myworkdayjobs.com/...`        | `workday:hpe`          |
| `https://careers-cvshealth.icims.com/jobs/...` | `icims:cvshealth`      |
| `https://boards.greenhouse.io/ramp/jobs/123`   | `greenhouse:ramp`      |
| `https://mantech.applicantpro.com/jobs/...`    | `applicantpro:mantech` |


**Tier 2 examples:**


| URL                                       | companyKey          |
| ----------------------------------------- | ------------------- |
| `https://jobs.apple.com/...`              | `apple.com`         |
| `https://enterpriseplatform.dell.com/...` | `dell.com`          |
| `https://careers.jpmorganchase.com/...`   | `jpmorganchase.com` |


**Dependency:** `tldts` for public-suffix-aware registrable domains.

**Tests:** `server/src/services/companyIdentity.test.ts` (27 cases).

---



### 4.2 Audit script — `server/src/scripts/auditCompanyKeys.ts`

**Role:** Read-only review of how keys would look on real data. **Does not write to Mongo.**

```bash
npx ts-node --project server/tsconfig.json \
  server/src/scripts/auditCompanyKeys.ts --limit 20000 --out tmp-company-keys.csv
```

**Outputs:**


| File                   | Contents                                                             |
| ---------------------- | -------------------------------------------------------------------- |
| `tmp-company-keys.csv` | One row per listing (URL, host, key, tier, existing name, source, …) |
| `*-by-key.csv`         | Rollup per `companyKey` (job count, name variants, hosts)            |
| `*-unresolved.csv`     | Hosts that could not be resolved (usually aggregator soft-gates)     |


**What the first audit showed (sample of 5k rows):**

- ~31% resolved cleanly to employer keys  
- ~69% unresolved — almost all still on `hiringcafe.com` (soft-gated stubs before apply URL exists)  
- Top keys looked correct: `apple.com`, `google.com`, `workday:cvshealth`, `eightfold:paypal`, …

That soft-gate behavior is expected: we only mint a company from a **real employer URL**.

---



### 4.3 Company ID generator — `server/src/utils/companyId.ts`

Same pattern as Scout IDs:

- Pattern: `CX-[A-Z0-9]{8}`
- `generateCompanyId()` / `generateUniqueCompanyId(existsCheck)`
- Collision retries against the registry

---



### 4.4 Registry model — `server/src/models/Company.ts`

**Collection:** `scoutx_companies`


| Field                        | Meaning                                                  |
| ---------------------------- | -------------------------------------------------------- |
| `companyId`                  | Public ID (`CX-…`), unique                               |
| `companyKey`                 | Stable key (`apple.com` / `workday:hpe`), unique         |
| `displayName`                | Canonical name shown to clients / filters                |
| `nameSource`                 | Which source set the display name                        |
| `namePrecedence`             | Numeric precedence (1–5)                                 |
| `aliases`                    | Other names we have seen                                 |
| `hosts`                      | Hostnames observed for this company                      |
| `atsProviders`               | e.g. `workday`, `icims`                                  |
| `mergedInto`                 | Optional pointer to another `companyKey` (sibling merge) |
| `jobCount`                   | Rough sighting counter                                   |
| `firstSeenAt` / `lastSeenAt` | Lifecycle                                                |


---



### 4.5 Registry service — `server/src/services/companyRegistry.ts`

**Role:** Bridge resolver ↔ Mongo registry.


| Function                       | Behavior                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `upsertCompany(...)`           | Create or update by `companyKey`; only upgrade name if new precedence is **strictly higher**; follow `mergedInto` |
| `resolveAndUpsertCompany(...)` | URL → resolve key → upsert → return stamp `{ companyId, companyKey, companyResolvedName }`                        |
| `lookupCompanyForUrl(url)`     | Read-only for extension: if registry hit → `locked: true`; else hint only → `locked: false`                       |
| `inferNameSource(...)`         | Map listing source / automation flag → precedence source                                                          |


Fail-open: if resolution fails, jobs still ingest; company fields stay empty until a later pass.

---



### 4.6 Job board schema — `server/src/models/JobBoardListing.ts`

New fields on `maxun_job_board`:

- `companyId`
- `companyKey`
- `companyResolvedName`

Indexed for cluster queries.

---



### 4.7 Stamping jobs — `server/src/services/jobBoardEnrichment.ts`

**When:**

1. `enqueueJobBoardEnrichments` — every time a scrape run pushes rows to the board
  - Resolve once per unique URL key in the batch  
  - Write stamp into both “ready from list” and “queued for enrichment” upserts
2. `rekeySoftGateListingToEmployer` — when a Hiring Cafe (etc.) stub finally gets a real employer apply URL
  - Soft-gate rows start on aggregator URLs → **no company**  
  - After rekey → resolve and stamp on the employer URL  
  - Same for merge-into-existing-employer-row path

**Important:** Raw `companyName` from the scraper is **not** overwritten. Only the identity fields are set.

---



### 4.8 Stamping automations — `server/src/api/automations.ts`

**On** `POST /automations` **(create):**

1. Require `companyName` (unchanged)
2. Resolve company from `startUrl` with `nameSource: 'automation'`
3. Store on `recording_meta` (and saasConfig): `companyId`, `companyKey`, `companyResolvedName`

**On** `GET /automations/lookup`**:**

Returns automation match **plus**:

```json
{
  "company": {
    "companyId": "CX-…",
    "companyKey": "apple.com",
    "displayName": "Apple",
    "locked": true
  }
}
```

- `locked: true` → we already have this company in the registry (pre-fill and lock in the extension)  
- `locked: false` → only a hint from the URL (user can edit freely)

`mapAutomation` also exposes `companyId` / `companyKey` when present.

---



### 4.9 Clusters — filters and feed

**Model** (`server/src/models/Cluster.ts`):

- `filter.companyIds[]`
- `sourceBinding.companyIds[]`  
(alongside existing `companyNames[]` for back-compat)

**Query** (`server/src/services/jobBoardQuery.ts` → `applyFrozenClusterFilters`):

- `companyIds` → `$in` on `companyId` (preferred, exact)  
- `companyNames` → still supported via regex on `companyName` / snapshot / `companyResolvedName`

**Feed** (`server/src/services/clusterFeed.ts`):

- Cluster membership can use company IDs  
- Portal job cards prefer `companyResolvedName` over scraped `companyName`  
- Company preview / distinct lists prefer resolved names when available

**Jobs API** (`server/src/api/jobs.ts`):

- `mapListingToJob` includes `companyId`, `companyKey`, `companyResolvedName`  
- Company search also matches `companyResolvedName`

---



### 4.10 Chrome extension pre-fill

**Files:**

- `chrome-extension/src/background/backendApi.ts` — lookup result type includes `company`  
- `chrome-extension/src/sidepanel/components/list/ListExtractorTool.tsx` — Send to Scout-X modal

**Behavior when opening “Send to Scout-X”:**

1. Call lookup with the preview URL
2. If company known → pre-fill name and **lock** the field
3. Ops can click **Change** to unlock and override (misreads / edge cases)

This prevents someone typing a random label for a company we already know, which would otherwise fight the registry’s “no overwrite from weaker sources” rule at create time (automation precedence is strong — locking avoids accidental new display names).

---



### 4.11 Backfill — `server/src/scripts/backfillCompanyIds.ts`

**Role:** Stamp historical board rows and robots that were created before Phase 2.

```bash
# Dry-run (no writes)
npx ts-node --project server/tsconfig.json \
  server/src/scripts/backfillCompanyIds.ts --limit 500 --dry-run

# Full write
npx ts-node --project server/tsconfig.json \
  server/src/scripts/backfillCompanyIds.ts
```

**Options:** `--limit`, `--dry-run`, `--board-only`, `--robots-only`

**Actual full backfill run (production DB):**


|           | Scanned | Stamped | Unresolved |
| --------- | ------- | ------- | ---------- |
| Job board | 27,588  | 17,555  | 10,033     |
| Robots    | 214     | 195     | 19         |


Unresolved board rows are overwhelmingly soft-gated aggregator listings without an employer URL yet. They will get stamped when enrichment rekeys them.

---



## 5. End-to-end flows (how to explain it)



### Flow A — Our own company automation

1. Ops/user records a career page in the extension
2. Lookup pre-fills company if domain is known (locked)
3. User confirms name → `POST /automations`
4. Server resolves domain → upserts `scoutx_companies` with **automation** precedence
5. Scrape runs → jobs enqueue → each employer URL stamped with same `companyKey` / `companyId`
6. Clusters can filter by that `companyId` even if scraped names differ



### Flow B — Aggregator finds the same company

1. Hiring Cafe lists a Dell job (name: “Dell Technologies”)
2. Soft-gate row may sit on `hiringcafe.com` temporarily → **no company yet**
3. Enrichment finds apply URL `enterpriseplatform.dell.com/...`
4. Soft-gate rekey → resolve → `companyKey = dell.com`
5. If registry already has Dell from our automation → **reuse** that `companyId` and display name (no overwrite from aggregator)
6. Cluster that includes Dell by `companyId` now sees both automation and aggregator jobs



### Flow C — Two scrape requests for the same employer

1. Request 1: CVS Health / Software Engineer
2. Request 2: CVS Health / Data Engineer
3. Both career URLs resolve to the same key (e.g. `workday:cvshealth`)
4. Product intent: **one scrape**, filter by role in the cluster — not two full scrapers
5. Company identity is the join key that makes that possible

---



## 6. What this does *not* do (boundaries)

- Does **not** replace scraped `companyName` on the ops job board UI (by design)  
- Does **not** auto-merge sibling vanity domains (`capitalonecareers.com` ↔ `capitalone.com`) — use `mergedInto` after review  
- Does **not** invent companies from aggregator listing URLs alone  
- Does **not** change Scout-X automation ID format (`SX…` stays for scrapers)  
- Path-segment heuristics after `.com/` were **not** added globally; vendor ATS tenant extraction covers the Workday/iCIMS-style cases from the design session. Audit unresolved list is the place to spot if a new rule is needed

---



## 7. How to operate / verify


| Check         | How                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| Unit tests    | `npm test -- server/src/services/companyIdentity.test.ts server/src/services/companyRegistry.test.ts` |
| Re-audit keys | Run `auditCompanyKeys.ts`, open `*-by-key.csv`                                                        |
| Backfill gaps | Re-run `backfillCompanyIds.ts` after soft-gate rekeys catch up                                        |
| Extension     | Open Send to Scout-X on a known career URL → company should pre-fill and lock                         |
| Cluster       | Prefer `companyIds` in cluster definition for exact membership                                        |


---



## 8. One-paragraph summary

We stopped treating free-text company names as the identity of an employer. Every job’s final career/apply URL is mapped to a stable company key (domain for employer sites, `provider:tenant` for shared ATS platforms like Workday/iCIMS). That key lives in a new `scoutx_companies` registry with opaque IDs (`CX-…`) and a clear rule for which display name wins when sources disagree. Jobs and automations are stamped at write time; clusters can filter by company ID so aggregator and automation jobs for the same employer stay together; the Chrome extension pre-fills and locks the company when we already know the domain. Soft-gated Hiring Cafe rows stay unresolved until we have a real employer URL, which is intentional. Historical data was backfilled (~17.5k board rows and ~195 automations stamped on the first full run).

---



## 9. Key files (quick index)


| Path                                          | Purpose                               |
| --------------------------------------------- | ------------------------------------- |
| `server/src/services/companyIdentity.ts`      | URL → companyKey (Tier 0/1/2)         |
| `server/src/services/companyIdentity.test.ts` | Resolver unit tests                   |
| `server/src/utils/companyId.ts`               | `CX-XXXXXXXX` generator               |
| `server/src/models/Company.ts`                | `scoutx_companies` schema             |
| `server/src/services/companyRegistry.ts`      | Upsert + lookup + precedence          |
| `server/src/services/companyRegistry.test.ts` | ID + precedence tests                 |
| `server/src/scripts/auditCompanyKeys.ts`      | Read-only audit CSVs                  |
| `server/src/scripts/backfillCompanyIds.ts`    | Historical stamp                      |
| `server/src/services/jobBoardEnrichment.ts`   | Stamp on enqueue + soft-gate rekey    |
| `server/src/api/automations.ts`               | Stamp on create + lookup company      |
| `server/src/models/Cluster.ts`                | `companyIds` on filters               |
| `server/src/services/jobBoardQuery.ts`        | Query by `companyIds` / resolved name |
| `server/src/services/clusterFeed.ts`          | Feed uses resolved company names      |
| `server/src/api/jobs.ts`                      | Board mapping exposes identity fields |
| `chrome-extension/.../ListExtractorTool.tsx`  | Pre-fill + lock company field         |
| `chrome-extension/.../backendApi.ts`          | Lookup types include `company`        |


