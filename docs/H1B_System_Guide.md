# H-1B Sponsorship Intelligence — Complete System Guide

**Product:** FirstStep / Scout-X  
**Audience:** Engineers, ops, and product  
**Status:** Implemented (7-year company signal + FY2026 job-level filing match)  
**Last updated:** 2026-09-05  

This document explains **everything we built**: data sources, Mongo collections, pipelines, matching logic, UI/API surfaces, how signals differ, ops commands, Atlas constraints, and **future improvements**.

For the original design checklist, see also [`H1B_Automatic_Company_Mapping_Plan.md`](./H1B_Automatic_Company_Mapping_Plan.md).

---

## 1. What this system does (in one paragraph)

We turn **public DOL LCA (Labor Condition Application) disclosure files** into two honest job-board signals:

1. **7-year company sponsor signal** — “This employer has a history of certified H-1B filings” (company + rough role affinity).
2. **FY2026 job-level filing match** — “This employer filed for a **very similar job title** in the current DOL fiscal year” (high-confidence title match only).

Neither signal means the **current posting** promises visa sponsorship. JD text that says “will not sponsor” always wins and suppresses badges.

---

## 2. Product context & UX surfaces

### 2.1 Ops shell (shipped)

Everything lives in the **Scout-X admin/ops dashboard** (same shell as Enrichment):

| Surface | Route / place | Purpose |
|---------|---------------|---------|
| **H-1B ops page** | `/h1b` sidebar tab | Company explorer + mapping exception queue (Approve / Reject) |
| **Jobs board** | Jobs tab | SoftChips, filters, detail fields for both signals |

**Approve/Reject is not for every employer.** Most mappings auto-approve. Humans only see mid-confidence exceptions.

### 2.2 What we intentionally did *not* build yet

- A separate **student-facing FirstStep “Visa” product tab**
- Apply URLs derived from LCA filings (apply always comes from the real job listing)
- Storing millions of raw LCA rows in Mongo

---

## 3. Two signals — do not conflate them

| | **7-year company / role signal** | **FY2026 filing match** |
|--|----------------------------------|-------------------------|
| **Question answered** | Has this brand sponsored historically? | Did they file for a similar title *this fiscal year*? |
| **Data window** | ~7 fiscal years of LCA | FY2026 only (e.g. `FY2026_Q3.xlsx` = year-to-date) |
| **Mongo index** | `h1b_gov_employers` → `h1b_sponsorship_profiles` | `h1b_fy2026_gov_roles` → `profile.fy2026` |
| **Job fields** | `h1bEligible`, `h1bCompanyScore`, `h1bRoleScore`, … | `h1bFy2026Match`, `h1bFy2026MatchedTitle`, … |
| **Title threshold** | High ≥0.70, Medium ≥0.40, else Low | **High-only** Jaccard ≥ **0.70** (boolean match) |
| **Jobs filter** | `h1bSponsorFriendly=true` | `h1bFy2026Match=true` |
| **UI chip copy** | H-1B sponsor / Possible H-1B sponsor | **FY2026 H-1B filing match** |
| **Honest meaning** | Historical sponsor-friendly employer | Current-year title affinity in DOL filings |

**Example:** Dell may show a 7-year company badge on many US roles, but only titles that Jaccard-match FY2026 filed titles (e.g. “Consultant, Product Management”) get the FY2026 chip.

---

## 4. End-to-end architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  LOCAL DISK (not Mongo)                                                 │
│  data/lca/*.xlsx  ← DOL OFLC disclosure Excel (Playwright may be needed │
│                     for Akamai; or set H1B_SKIP_DOWNLOAD=1)              │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ stream-aggregate (no raw rows in Mongo)
                ┌───────────────┴────────────────┐
                ▼                                ▼
     h1b_gov_employers                  h1b_fy2026_gov_roles
     (7yr lean employers)               (FY2026 lean role index)
                │                                │
                └──────────────┬─────────────────┘
                               ▼
                    h1b_company_brands
                    h1b_employer_brand_mappings
                    h1b_mapping_rejections
                               │
                               ▼
                    h1b_sponsorship_profiles
                    (7yr scores + fy2026 block)
                               │
              ┌────────────────┴────────────────┐
              ▼                                 ▼
   resolveH1bSponsorship()            resolveFy2026JobMatch()
              │                                 │
              └────────────────┬────────────────┘
                               ▼
                    JobBoardListing.h1b_* + h1bFy2026*
                    (enrichment persist + backfill)
                               │
              ┌────────────────┴────────────────┐
              ▼                                 ▼
        Jobs API + SoftChips              H-1B ops page (/h1b)
```

---

## 5. Data source (DOL LCA)

**Primary source:** [DOL OFLC Foreign Labor Performance Data](https://www.dol.gov/agencies/eta/foreign-labor/performance) — free, public, quarterly Excel/CSV. No API key.

| Item | Detail |
|------|--------|
| Visa classes used | H-1B, H-1B1, E-3 (as present in disclosure files) |
| Useful columns | EMPLOYER_NAME, JOB_TITLE, SOC_CODE / SOC_TITLE, CASE_STATUS, worksite state, wages, dates |
| Certified filter | Status contains `CERTIFIED`; exclude `CERTIFIED-WITHDRAWN` |
| Fiscal year | DOL fiscal year (Oct–Sep). `FY2026_Q3` is **partial** until Q4 lands |

**Download notes**

- Plain HTTP downloads often hit **Akamai 403**; production download may need Playwright/browser headers.
- Prefer keeping Excel on **local disk** under `data/lca/` and re-aggregate; never bulk-insert every row into Atlas.
- Env: `H1B_LCA_DIR`, `H1B_SKIP_DOWNLOAD=1`, `H1B_FY2026_SOURCE` (default `FY2026_Q3`).

**Deferred sources:** USCIS H-1B Employer Data Hub, PERM (green card) filings.

---

## 6. MongoDB collections (what we store)

Hard rule: **no `lca_filings` collection on free Atlas (~512 MB).** Only lean aggregates + mappings + denormalized job fields.

| Collection | Model | Purpose |
|------------|-------|---------|
| `h1b_gov_employers` | `GovEmployer` | One doc per legal employer over ~7 years: counts, years, top titles/SOCs/states |
| `h1b_fy2026_gov_roles` | `Fy2026GovRole` | FY2026-only lean role index per employer (keyed by `govEmployerKey`) |
| `h1b_company_brands` | `CompanyBrand` | Canonical board brand + `aliasKeys` |
| `h1b_employer_brand_mappings` | `EmployerBrandMapping` | gov legal name → brand, confidence, status |
| `h1b_mapping_rejections` | `MappingRejection` | Permanent blacklist of rejected pairs |
| `h1b_sponsorship_profiles` | `SponsorshipProfile` | Fast per-brand lookup used at job enrichment time |
| `maxun_job_board` | `JobBoardListing` | Denormalized `h1b_*` / `h1bFy2026*` fields |

### 6.1 Lean gov employer shape (7yr)

```
employerNameKey, employerNameDisplay, employerNameNormalized
totalFilings, certifiedCount, deniedCount, withdrawnCount
firstFilingYear, lastFilingYear, yearsActive[]
topJobTitles: [{ title, n }]     // typically top ~15
topSocCodes:  [{ code, title, n }]
topStates:    [{ state, n }]
dataAsOf
```

### 6.2 Lean FY2026 role shape

```
govEmployerKey, employerNameDisplay, employerNameNormalized
certifiedCount, totalFilings
topJobTitles, topSocCodes, topStates
dataAsOf, sourceLabel   // e.g. FY2026_Q3
```

### 6.3 Atlas free-tier reality (ops lessons)

- Cluster quota is **strict**: when full, **writes/updates block**; deletes often still work.
- Full 56k+ FY2026 employers will not fit next to the job board. Practical approach:
  - Prune 7yr employers with `H1B_MIN_CERTIFIED` (ops used **≥15**).
  - Aggregate FY2026 with **`H1B_FY2026_MAPPED_ONLY=1`** (only approved/auto-approved mapping keys) and `H1B_MIN_CERTIFIED=1`.
- When disk fills: prune old `maxun_runs`, trim `maxun_extracteddata`, wipe incomplete FY2026, then re-load lean mapped set.

---

## 7. Name normalization

**File:** `server/src/services/h1b/employerNameNormalize.ts`

Shared pipeline for employers **and** job titles:

1. Uppercase / trim / decode HTML entities  
2. Strip legal suffixes (`INC`, `LLC`, `CORP`, …)  
3. Remove punctuation; collapse whitespace  
4. Strip leading `THE`, DBA / ATTN / trailing state noise  
5. Emit `key`, `normalized`, `tokens`

**Why aliases matter:** `AMAZON.COM SERVICES LLC` and board name `Amazon` do **not** equal by string alone — they meet via brand aliases + mapping.

---

## 8. Brands & automatic mapping

### 8.1 Seeding brands

**Script:** `npm run h1b:seed-map` → `seedAndMapH1b.ts`  
**Services:** `seedCompanyBrands.ts` + board company seed

Sources:

1. Career HTML host directory (~490 hosts → brand names)  
2. Manual / canonicalize rules  
3. Distinct `companyName` values from the job board  

Result: `h1b_company_brands` with `brandNameKey` + `aliasKeys`.

### 8.2 Employer → brand matcher

**File:** `server/src/services/h1b/employerBrandMatcher.ts`

Ordered matching (confidence-scored):

| Step | Method | Typical confidence |
|------|--------|--------------------|
| 1 | Exact alias / brand match | ~0.95 |
| 2 | Exact normalized name | ~0.90 |
| 3 | Token Jaccard (noise tokens ignored) | ~0.50–0.85 |
| 4 | Fuzzy / Levenshtein-style | ~0.60–0.80 |
| 5 | Board company cross-ref | ~0.70–0.90 |
| 6 | Subsidiary rollup | ~0.75–0.88 |

**Thresholds (env-tunable):**

| Env | Default | Behavior |
|-----|---------|----------|
| `H1B_AUTO_APPROVE_CONFIDENCE` | **0.88** | → `auto_approved` (badges apply immediately) |
| `H1B_REVIEW_CONFIDENCE` | **0.65** | → `pending_review` (H-1B ops queue only) |
| Below review | — | **No mapping** (unknown) — not dumped into the queue |

**Statuses**

- `auto_approved` / `approved` → used for profiles + job badges  
- `pending_review` → human Approve / Reject / edit brand on `/h1b`  
- Reject → write `mapping_rejections` blacklist; never badge that pair  

---

## 9. Sponsorship profiles (fast job-time index)

**File:** `server/src/services/h1b/buildSponsorshipProfiles.ts`  
**Built by:** `h1b:seed-map` after mapping

For each brand with at least one **approved/auto_approved** mapping:

1. Load all linked `GovEmployer` docs → merge 7yr counts / titles / SOCs / states  
2. Compute `companyScore` (High / Med / Low / Unknown)  
3. Load matching `Fy2026GovRole` docs → fill `fy2026` block  
4. Upsert `SponsorshipProfile` keyed by `brandNameKey`

### 9.1 Company score rules

| Score | Criteria (approximate) |
|-------|------------------------|
| **High** | ≥3 active years + ≥5 certified + last filing within 3 years |
| **Medium** | Last filing within 5 years OR at least some certified activity |
| **Low** | Stale / weak certified history, or mostly denied/withdrawn |
| **Unknown** | No usable gov mapping |

### 9.2 Profile fields (high level)

```
brandName, brandNameKey, companyScore
filingCount7yr, certifiedCount, certifiedRate
yearsActiveCount, lastFilingYear, topJobTitles, topSocCodes
govEmployerKeys[], dataAsOf
fy2026: { certifiedCount, topJobTitles, topSocCodes, topStates, dataAsOf, sourceLabel }
```

Job enrichment **never** scans millions of LCA rows — it only reads this profile.

---

## 10. How job matching works at enrichment time

**Hook:** `jobEnrichmentWorker.ts` → `persistResult` when listing becomes `ready` / `partial`  
**Backfill:** `npm run h1b:backfill` for existing ready/partial jobs  

Both call:

1. `resolveH1bSponsorship(input)`  
2. `resolveFy2026JobMatch(input)`  

**Shared input:** `companyName`, `jobTitle`, `location`, `remoteType`, `visaSponsorship`, `jobDescription`.

### 10.1 USA gate

**File:** `resolveH1bSponsorship.ts` → `isUsJobLocation`

- Match US state codes / “United States” / USA  
- Reject clear non-US countries when no US signal  
- Empty location often treated eligible (US remote posts missing location)  
- Sets `h1bEligible`

### 10.2 JD / visa override (always wins)

`jdBlocksSponsorship`:

- `visaSponsorship === 'no'`, **or**
- Description matches phrases like “will not sponsor”, “no sponsorship”, “citizens only”, …

→ Suppress sponsorship badges / FY2026 match (eligible may still be true for US location).

### 10.3 7-year resolve path

```
companyName → normalize key
  → CompanyBrand (brandNameKey or aliasKeys)
  → EmployerBrandMapping (auto_approved | approved)
  → SponsorshipProfile
  → companyScore + role score vs profile.topJobTitles
```

**Role score (7yr):**

| Score | Jaccard vs top filed titles |
|-------|-----------------------------|
| High | ≥ 0.70 |
| Medium | ≥ 0.40 |
| Low | below 0.40 (company may still be High) |

Seniority stopwords (`senior`, `staff`, `principal`, …) are stripped before Jaccard.

### 10.4 FY2026 resolve path

**File:** `matchFy2026Role.ts`

```
same brand + approved mapping gates
  → require profile.fy2026.certifiedCount ≥ 1
  → matchFy2026Role(jobTitle, fy2026.topJobTitles)
  → matched only if Jaccard ≥ 0.70
```

Writes:

```
h1bFy2026Match
h1bFy2026TitleConfidence
h1bFy2026MatchedTitle
h1bFy2026CertifiedCount
h1bFy2026DataAsOf
```

---

## 11. Fields on `JobBoardListing`

### 7-year / company signal

| Field | Meaning |
|-------|---------|
| `h1bEligible` | US-scoped job |
| `h1bCompanyScore` | high / medium / low / unknown |
| `h1bRoleScore` | high / medium / low / unknown |
| `h1bCompanyConfidence` | Mapping confidence |
| `h1bRoleConfidence` | Title Jaccard |
| `h1bFilingCount` | Certified-ish filing volume from profile |
| `h1bLastFilingYear` | Recency |
| `h1bMatchedGovEmployer` | Display name of matched legal entity |
| `h1bCapExempt` | Reserved / stub (cap-exempt detection future) |
| `h1bDataAsOf` | Aggregate freshness |
| `h1bMappingStatus` | auto / approved / rejected / none |

### FY2026 signal

| Field | Meaning |
|-------|---------|
| `h1bFy2026Match` | Boolean high-only title match |
| `h1bFy2026TitleConfidence` | Jaccard |
| `h1bFy2026MatchedTitle` | Best DOL filed title |
| `h1bFy2026CertifiedCount` | Employer FY2026 certified volume |
| `h1bFy2026DataAsOf` | FY2026 aggregate date |

---

## 12. API & UI behavior

### 12.1 Jobs API

**File:** `server/src/api/jobs.ts`

| Query | Behavior |
|-------|----------|
| `h1bSponsorFriendly=true` | US-eligible + high company score + not rejected |
| `h1bFy2026Match=true` | `h1bFy2026Match: true` |

Listing payloads expose the denormalized `h1b_*` / `h1bFy2026*` fields for chips and drawers.

### 12.2 H-1B ops API

**File:** `server/src/api/h1b.ts` (auth required)

Typical endpoints:

- `GET /h1b/stats` — employer / brand / mapping / profile KPIs  
- `GET /h1b/employers` — company explorer search  
- Mapping review list + Approve / Reject actions  
- Rebuild profiles after manual decisions  

### 12.3 Jobs UI

**Files:** `JobBoardPage.tsx`, `jobBoardPageBehavior.ts`

- SoftChip for H-1B sponsor / possible sponsor (7yr rules)  
- SoftChip **“FY2026 H-1B filing match”** with tooltip (matched DOL title + confidence)  
- Filter checkboxes for both signals  
- Detail drawer shows evidence fields  

### 12.4 H-1B page UI

**File:** `H1bPage.tsx` + sidebar wiring (`sidebarNav.ts`, `PageWrapper`, `MainPage`)

1. **Company explorer** — search DOL employers, see filings / titles, jump to open jobs when mapped  
2. **Mapping exceptions** — pending_review only  

---

## 13. npm scripts & recommended refresh workflow

| Script | What it does |
|--------|----------------|
| `npm run h1b:aggregate` | Stream 7yr LCA Excel → upsert `h1b_gov_employers` |
| `npm run h1b:aggregate-fy2026` | Stream FY2026 Excel → upsert `h1b_fy2026_gov_roles` |
| `npm run h1b:seed-map` | Seed brands → auto-map → build sponsorship profiles (incl. `fy2026`) |
| `npm run h1b:backfill` | Stamp `h1b_*` + `h1bFy2026*` on ready/partial jobs |

### Quarterly refresh (typical)

```bash
# 1) Place new Excel under data/lca/ (or allow download)
# 2) 7yr employers (optional if only FY2026 quarter changed)
npm run h1b:aggregate

# 3) FY2026 — prefer mapped-only on free Atlas
# PowerShell:
$env:H1B_SKIP_DOWNLOAD='1'
$env:H1B_FY2026_MAPPED_ONLY='1'
$env:H1B_MIN_CERTIFIED='1'
npm run h1b:aggregate-fy2026

# 4) Remap + rebuild profiles
npm run h1b:seed-map

# 5) Re-stamp jobs
npm run h1b:backfill
```

### Useful env vars

| Env | Purpose |
|-----|---------|
| `MONGODB_URI` / `DB_URL` | Atlas connection |
| `H1B_LCA_DIR` | Excel directory |
| `H1B_SKIP_DOWNLOAD=1` | Use existing files |
| `H1B_FY2026_SOURCE` | e.g. `FY2026_Q3` |
| `H1B_FY2026_MAPPED_ONLY=1` | Only employers with approved mappings |
| `H1B_MIN_CERTIFIED` | Floor for keeping employers (also used by 7yr aggregate — set explicitly for FY2026) |
| `H1B_AUTO_APPROVE_CONFIDENCE` | Default 0.88 |
| `H1B_REVIEW_CONFIDENCE` | Default 0.65 |
| `H1B_BACKFILL_LIMIT` / `H1B_BACKFILL_BATCH` | Backfill controls |

### Other helper scripts

- `server/src/scripts/pruneGovEmployers.ts` — raise min-certified floor / drop heavy indexes  
- Unit tests: `resolveH1bSponsorship.test.ts`, `matchFy2026Role.test.ts`, `employerNameNormalize.test.ts`

---

## 14. Key source map (where to look in code)

| Area | Path |
|------|------|
| Normalize names | `server/src/services/h1b/employerNameNormalize.ts` |
| LCA source list | `server/src/services/h1b/lcaDisclosureSources.ts` |
| Brand seed | `server/src/services/h1b/seedCompanyBrands.ts` |
| Auto mapper | `server/src/services/h1b/employerBrandMatcher.ts` |
| Profiles | `server/src/services/h1b/buildSponsorshipProfiles.ts` |
| 7yr job resolve | `server/src/services/h1b/resolveH1bSponsorship.ts` |
| FY2026 job resolve | `server/src/services/h1b/matchFy2026Role.ts` |
| 7yr aggregate | `server/src/scripts/aggregateGovEmployersFromLca.ts` |
| FY2026 aggregate | `server/src/scripts/aggregateFy2026GovRoles.ts` |
| Seed/map CLI | `server/src/scripts/seedAndMapH1b.ts` |
| Backfill CLI | `server/src/scripts/backfillH1bOnJobs.ts` |
| Enrichment hook | `server/src/workers/jobEnrichmentWorker.ts` |
| Jobs API | `server/src/api/jobs.ts` |
| H-1B API | `server/src/api/h1b.ts` |
| Jobs UI | `src/components/jobs/JobBoardPage.tsx` |
| H-1B UI | `src/pages/H1bPage.tsx` |

---

## 15. Semantics & compliance (what we tell users)

| Do say | Don’t say |
|--------|-----------|
| Based on DOL LCA disclosure filings | Guaranteed visa sponsorship on this posting |
| FY2026 DOL filings to date (Q3 partial) | This job “offers H-1B” |
| Historical sponsor-friendly employer | USCIS petition approval |
| Title matched a filed LCA job title | LCA apply link / government job posting |

Always prefer **job-board apply URLs**. LCA disclosures are evidence, not applications.

Three overlapping “visa” concepts (keep separate in UI):

1. Automation catalog tags (`auth:Sponsors H-1B`) — manual on scrapers  
2. Listing `visaSponsorship` from Hiring Cafe / JD  
3. DOL-derived `h1b_*` / `h1bFy2026*` fields  

---

## 16. Known limitations (current MVP)

1. **Atlas M0 size** — aggregates must stay lean; explorer may omit tiny filers after prune.  
2. **Top-N titles only** — rare titles that never appear in an employer’s top ~15–20 won’t match.  
3. **FY2026 match is intentionally rare** — high-only ≥0.70 Jaccard (e.g. ~139 matches on ~12k ready jobs in one backfill).  
4. **Mapped-only FY2026 on free tier** — employers without approved brand mapping won’t get FY2026 roles loaded.  
5. **Cap-exempt** is largely stubbed.  
6. **Subsidiary graphs** are heuristic, not a full legal entity tree.  
7. **Empty location** US assumption can false-positive some international remote posts.  
8. **Q3 ≠ full FY2026** until later quarters are ingested.  
9. **No student Visa product shell** yet.  

---

## 17. Future improvements (roadmap ideas)

### 17.1 Data & coverage

| Improvement | Why it helps |
|-------------|--------------|
| Ingest each new FY2026 quarter (Q4 → full year) | Completeness of “current year” signal |
| Paid Atlas / S3 for raw filings subset | Per-case explorer, wage bands, city-level evidence |
| USCIS Employer Data Hub join | Cross-check petition volumes vs LCA |
| PERM / green-card filings | Longer-horizon immigration signal |
| Cap-exempt classification (universities, non-profits) | Better student advice |
| Multi-year “recency decay” score | Prefer recent sponsors over 2019-only volume |

### 17.2 Matching quality

| Improvement | Why it helps |
|-------------|--------------|
| Embedding / LLM title similarity (with cost budget) | Catch “SWE” vs “Software Development Engineer” |
| SOC-code primary match path | More stable than free-text titles |
| Learned alias table from Approve actions | Reduce pending_review queue over time |
| Conflict detection (same gov key → two brands) | Safer auto-approve |
| Stricter location geo parse (country codes) | Fewer false US-eligible flags |
| Separate remote-US vs onsite-US policies | Clearer product rules |

### 17.3 Product / UX

| Improvement | Why it helps |
|-------------|--------------|
| Student-facing FirstStep Visa experience | End-user value beyond ops |
| Company sponsorship profile page | Filings timeline, top roles, states |
| Evidence drawer with “as of” + source file label | Trust & transparency |
| Explainability: show why badge was suppressed (JD block) | Reduce confusion |
| Saved searches / alerts for FY2026 matches | Engagement |
| Export CSV of mapped sponsors | Ops / partners |

### 17.4 Pipeline & reliability

| Improvement | Why it helps |
|-------------|--------------|
| Scheduled quarterly cron + Slack/email digest | Less manual ops |
| Disk-quota guardrails (preflight `dbStats`) | Avoid mid-write Atlas failures |
| Incremental aggregate (diff only new quarter) | Faster refresh |
| Idempotent backfill (only jobs missing/stale `h1bDataAsOf`) | Cheaper re-runs |
| Metrics dashboard: match rate, pending queue age | Ops health |
| Playwright download baked into CI-safe script | Reproducible ingest |

### 17.5 Safety & honesty

| Improvement | Why it helps |
|-------------|--------------|
| Stronger disclaimer copy A/B | Legal / trust |
| Audit log for Approve/Reject | Compliance |
| Never invent sponsorship from weak medium scores in student UI | Avoid false hope |
| Rate-limit public employer search if student shell ships | Abuse control |

---

## 18. Mental model for debugging “why no jobs / no chip?”

Walk this checklist:

1. **Excel on disk?** `data/lca/FY2026_Q3.xlsx` (or configured source)  
2. **Collections non-empty?** `h1b_gov_employers`, `h1b_fy2026_gov_roles`, profiles  
3. **Atlas quota?** Writes blocked at 512 MB → prune runs/extracted/old aggregates  
4. **Mapping approved?** Brand must be `auto_approved` or `approved`  
5. **Profile has `fy2026.certifiedCount ≥ 1`?** Re-run `h1b:seed-map` after FY2026 aggregate  
6. **Job status ready/partial?** Backfill only those; board mainly shows `ready`  
7. **US location + no JD block?**  
8. **Title Jaccard ≥ 0.70 for FY2026?** High bar by design  
9. **API filter spelling?** `h1bFy2026Match=true` / `h1bSponsorFriendly=true`  
10. **UI refreshed?** Restart or hard-refresh if `start:dev` was already running during backfill  

---

## 19. Snapshot of a healthy populated environment (example)

After a successful mapped-only FY2026 load + seed-map + backfill (Sep 2026 ops run):

| Metric | Example value |
|--------|----------------|
| FY2026 gov roles (mapped) | ~647 |
| Sponsorship profiles with FY2026 | ~603 |
| Ready/partial jobs backfilled | ~12,198 |
| Jobs with `h1bFy2026Match=true` | ~139 |
| Atlas `dataSize` after cleanup | ~200 MB (under 512 MB) |

Numbers will change as the board and DOL files grow — treat this as a **shape** of health, not a permanent SLA.

---

## 20. Summary

We implemented a **free-tier-safe**, ops-integrated H-1B intelligence layer:

- Stream DOL LCA → lean Mongo aggregates  
- Auto-map legal employers → job-board brands with human exception queue  
- Enrich US jobs with **historical sponsor** and **current-year title filing** signals  
- Surface both on Jobs filters/chips and the H-1B ops page  

Next leverage comes from **better title intelligence**, **quarterly automation**, **student-facing UX**, and **richer evidence** once storage allows — without ever pretending LCA filings are the same thing as an offer of sponsorship.
