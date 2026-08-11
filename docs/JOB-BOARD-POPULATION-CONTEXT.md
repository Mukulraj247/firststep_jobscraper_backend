# Job Board Population — Context for Changes

> Last verified: 2026-08-08. Use this as the shared mental model before changing scrape → board → card UI.

## One-sentence truth

**List scrape (or ATS board API) produces thin rows → they land in `maxun_extracteddata` and stubs in `maxun_job_board` → an enrichment worker fills the JD (ATS JSON, or scrape.do HTML → Gemini LLM / regex parser) → `GET /api/jobs` maps listings (including dedicated structured section fields when present) → the React card prefers stored sections and falls back to client-side sectionizing of `jobDescription`.**

For **non-ATS** pages, Gemini extracts **all** job-board fields it can find from the page HTML and stores them as dedicated columns — **only when present** (never fabricated). Empty fields stay empty and the card hides them.

---

## Pipeline (ordered)

```
Scraper run (Agenda / scraperWorker)
        │
        ├─ Path A: ATS board JSON (Greenhouse / Lever / Ashby / SmartRecruiters)
        │          detectAtsBoard → fetchAtsBoardJobs
        │
        └─ Path B: Browser list scrape (Playwright / Camoufox)
                   listExtractor (CSS selectors from robot saasConfig)
        │
        ▼
finalizeExtractedListRows  (scraperWorker.ts)
        │  run.serializableOutput.scrapeList['Configured List Extraction']
        ▼
persistExtractedDataForRun  (automation.ts)
        │  aliases → normalize → overrides → rowContext → canonical keys + jobId
        │  INSERT maxun_extracteddata
        ▼
enqueueJobBoardEnrichments  (jobBoardEnrichment.ts)
        │  normalize URL → jobUrlKey (dedupe)
        │  if title+company+location+desc≥400 → status ready, method=list (skip enrich)
        │  else upsert stub → status queued + listSnapshot
        ▼
enrichmentWorker / jobEnrichmentWorker
        │  claim queued → enriching
        │  Tier 0: fetchAtsJob (ATS detail JSON / Google Careers HTML) → method=ats
        │  Else: scrape.do → HTML
        │        ├─ Gemini (non-ATS, when enabled + budget) → structured fields → method=llm
        │        └─ fallback: parseJobPageHtml (JSON-LD / meta / cheerio) → method=scrape.do
        │  merge with listSnapshot → ready | partial | failed | expired
        ▼
GET /api/jobs  (server/src/api/jobs.ts)
        │  filter ready|partial + method ats|scrape.do|list|llm + desc≥60
        │  mapListingToJob (scalars + about/quals/responsibilities/benefits/skills when present)
        ▼
JobBoardPage  (src/components/jobs/JobBoardPage.tsx)
        │  prefer stored structured fields; else extractCardHighlights(jobDescription)
        │  → MINIMUM QUALS / PREFERRED / RESPONSIBILITIES / BENEFITS / skills chips
        ▼
Job board UI cards
```

---

## Critical misconception (HTML)

**After the list scrape, you usually do not yet have the job detail HTML.**

| Stage | What you get |
|-------|----------------|
| List scrape / ATS board | Card/list fields: title, URL, maybe location, sometimes a teaser description |
| Enrichment (later, async) | For each `jobUrl`: ATS detail API **or** scrape.do returns **full page HTML** |
| Parser / LLM | HTML → plain fields + optional structured sections. Raw HTML is **not** stored long-term |
| UI | Prefers stored section arrays; falls back to parsing plain `jobDescription` |

So: scraping a **job URL for enrichment** does return HTML (via scrape.do or Google Careers path). The **initial list scrape** is usually selectors / ATS list JSON, not a full JD page.

---

## Two Mongo stores

| Collection | Model | Role |
|------------|-------|------|
| `maxun_extracteddata` | `ExtractedData` | Per-run audit / automation destinations. Canonical row shape. |
| `maxun_job_board` | `JobBoardListing` | Deduped board of record for UI. Status lifecycle + enrichment metadata + structured sections. |

Board dedupe key: **`jobUrlKey`** (normalized URL hash), not `jobId`.

---

## Status / method lifecycle (`JobBoardListing`)

**Status:** `queued` → `enriching` → `ready` | `partial` | `failed` | `expired`

**enrichment.method:**

| Method | Meaning |
|--------|---------|
| `list` | List row already “complete” (title+company+location+desc ≥ `JOB_BOARD_MIN_DESC_CHARS`, default 400). No detail fetch. |
| `ats` | Detail filled from ATS adapter JSON (or Google Careers HTML mapped) |
| `scrape.do` | Detail filled by scrape.do HTML + deterministic `parseJobPageHtml` (Gemini unavailable/failed/budget) |
| `llm` | Detail filled by scrape.do HTML → Gemini structured extraction |
| `none` | Stub / not enriched yet |

API only shows rows with `status ∈ {ready, partial}` and `method ∈ {ats, scrape.do, list, llm}` and description length ≥ 60.

---

## What happens to HTML (enrichment)

1. **ATS detail** (`atsAdapters.fetchAtsJob`): structured JSON; HTML fragments in `content` / `descriptionHtml` → `stripHtmlTags` → plain JD.
2. **Google Careers**: page HTML → cheerio section map (`mapGoogleCareersHtml`).
3. **scrape.do** (`scrapeDoClient.scrapeJobPage`): HTML bytes available on the result.
4. **Gemini (non-ATS)** when `GEMINI_ENABLED` + `GEMINI_API_KEY` + daily LLM budget allow:
   - `htmlToPlainText(html)` → cleaned text (chrome stripped, length capped)
   - `extractJobFieldsWithGemini` (`@google/genai`, `gemini-2.5-flash`, `temperature: 0`, JSON `responseSchema`)
   - Strict prompt: only use page content; omit anything not present; never invent
   - Writes scalars + `about` / `minimumQualifications[]` / `preferredQualifications[]` / `responsibilities[]` / `benefits[]` / `skills[]` **only when non-empty**
   - Caches via `enrichment.llmInputHash` so unchanged pages are not re-sent
5. **Fallback**: `parseJobPageHtml` (JSON-LD → meta → cheerio) if Gemini is off / over budget / fails
6. Merge with `listSnapshot` via `mergeParsedFields` / `pickBestDescription`
7. Persist fields + snippet; **do not keep full HTML**

Relevant env: `SCRAPE_DO_TOKEN`, `SCRAPE_DO_DAILY_CREDIT_BUDGET`, `JOB_ENRICHMENT_*`, `JOB_BOARD_MIN_DESC_CHARS`, `JOB_BOARD_STALE_DAYS`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_ENABLED`, `LLM_DAILY_CALL_BUDGET`, `LLM_DAILY_TOKEN_BUDGET`, `LLM_RATE_PER_MIN`, `GEMINI_MAX_INPUT_CHARS`.

Key files: `server/src/services/geminiJobExtractor.ts`, `server/src/models/LlmUsageBudget.ts`, `server/src/workers/jobEnrichmentWorker.ts`.

---

## Field mapping: storage vs card UI

### Stored on `JobBoardListing` (and API `data`)

| Field | Typical sources |
|-------|-----------------|
| `jobTitle` | list / ATS / JSON-LD / Gemini / h1; may be overridden by URL slug via `preferJobUrlTitle` |
| `companyName` | list / ATS / og / Gemini / hostname; `sanitizeCompanyName` |
| `location` / `salaryRange` / `employmentType` / `remoteType` / `jobCategory` / `date` | list / ATS / JSON-LD / Gemini |
| `jobExperience` | list / Gemini / regex years in JD |
| `jobDescription` | plain text blob (Gemini also composes canonical-headed text from sections) |
| `about` | Gemini (dedicated); empty if absent |
| `minimumQualifications[]` | Gemini (dedicated); empty if absent |
| `preferredQualifications[]` | Gemini (dedicated); empty if absent |
| `responsibilities[]` | Gemini (dedicated); empty if absent |
| `benefits[]` | Gemini (dedicated); empty if absent |
| `skills[]` | Gemini (dedicated); empty if absent |
| `sectorIndustry` / `f500` | usually robot `rowContext` / overrides — **not** parsers |
| `applyUrl` / `jobUrl` | ATS absolute URL / page URL |

**Only-if-present rule:** enrichment never overwrites a good stored structured field with an empty Gemini array/string.

### Card rendering

| Card label | How produced |
|------------|----------------|
| MINIMUM QUALS / PREFERRED / RESPONSIBILITIES / BENEFITS / skills | Prefer **stored arrays**; else `extractCardHighlights(jobDescription)` |
| About blurb | Prefer stored `about`; else sectionizer |
| Experience / employment / remote chips | Stored scalars or derived from JD |
| “AI-parsed” chip | When `enrichmentMethod === 'llm'` |

---

## Key files (change impact map)

| If you change… | Touch… |
|----------------|--------|
| List vs ATS scrape orchestration | `server/src/workers/scraperWorker.ts`, `atsAdapters.ts`, `listExtractor.ts` |
| Canonical field names / aliases | `canonicalJobRecord.ts`, `automation.ts` |
| When rows become board stubs / skip enrich | `jobBoardEnrichment.ts` |
| Detail HTML → fields (regex) | `jobPageParser.ts`, `scrapeDoClient.ts` |
| Detail HTML → fields (LLM) | `geminiJobExtractor.ts`, `jobEnrichmentWorker.ts`, `LlmUsageBudget.ts` |
| Board schema / indexes | `models/JobBoardListing.ts` |
| What the API returns | `server/src/api/jobs.ts` |
| Card section labels / bullets | `JobBoardPage.tsx`, `src/utils/jobDescriptionSections.ts` (fallback only) |
| Enrichment process entry | `server/src/enrichmentWorker.ts` |

---

## Quick debug checklist

1. Run finished? Rows in `maxun_extracteddata` for that `runId`?
2. Board stubs? `maxun_job_board` with `status: queued`?
3. Enrichment process up? (`npm run worker:enrichment:dev`)
4. Non-ATS still thin? Is `GEMINI_API_KEY` set? Check `llm_budget_paused` / daily call+token budgets.
5. Ready but not in UI? Method not in `{ats,scrape.do,list,llm}`? Desc &lt; 60? Failed quality gate?
6. Card sections empty but JD exists? Prefer checking stored structured fields; else heading labels vs `extractCardHighlights`.

---

## Invariants to preserve when changing

1. Board UI reads **`JobBoardListing`**, not raw `ExtractedData`.
2. Dedup by **`jobUrlKey`**.
3. Enrichment is **async** and budget-gated (scrape.do **and** LLM).
4. **Do not** assume HTML is retained after parse.
5. Structured sections are first-class when Gemini succeeds; client sectionizer is **fallback**.
6. Never invent fields: empty means absent; never blank good data with empty LLM output.
7. Prefer extending `ParsedJobFields` / Gemini schema + `mergeParsedFields` over one-off UI string hacks for new sources.
