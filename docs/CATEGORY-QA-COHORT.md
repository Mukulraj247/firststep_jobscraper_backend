# Category QA cohort (cluster categorization testing)

Temporary Ops page to verify specialty / industry / experience / location / H-1B
without hunting the Job Board. UI: **Category QA** (`/category-qa`).

## Local UI test (preferred)

1. Start app + job-tagger (`127.0.0.1:8000`).
2. Open `/category-qa`.
3. Click **Run random 1000 sample**.

That API (`POST /api/category-qa/run-sample`):

1. Replaces the previous UI batch (`cat-qa-ui-sample`)
2. Randomly picks 100 `ready`/`partial` board jobs
3. Clears specialty / industry / experience / location / H-1B
4. Backfills classifiers
5. Lands rows on **All** / **Backfilled** / **Student review** for review

No terminal backfill required for local QA.

## Cohort rules

| Step | What |
|------|------|
| Select | Most recent **4,000** `ready`/`partial` listings with a title (`createdAt` desc) |
| Clear | Wipe frozen* + H-1B filter fields; set `categoryQaBatchId=cat-qa-2026-09`, phase `cleared` (or `student_review`) |
| Backfill | Re-classify the **older 2,000** of that cohort; newest 2,000 stay cleared for contrast |
| Student escape | Intern / student / new-grad / OPT–CPT → `studentEscape=true`, phase `student_review` |

Batch id default: `cat-qa-2026-09`.

## Droplet runbook

From the Scout-X app root (where `.env` and `server/` live). Prefer stopping scrapers if CPU is high:

```bash
pm2 stop scoutx-scraper scoutx-aggregators
```

### 1. Dry-run (no writes)

```bash
JOB_TAGGER_USE_ML=false JOB_TAGGER_COOLDOWN=false \
  npx ts-node --project server/tsconfig.json \
  server/src/scripts/categoryQaCohort.ts --dry-run --phase all
```

Optional safety cap while testing the script:

```bash
... categoryQaCohort.ts --dry-run --phase clear --limit 50
```

### 2. Clear all 4,000

```bash
JOB_TAGGER_USE_ML=false JOB_TAGGER_COOLDOWN=false \
  npx ts-node --project server/tsconfig.json \
  server/src/scripts/categoryQaCohort.ts --phase clear
```

Open **https://\<host\>/category-qa** → expect ~4k Cleared (empty pills). Student-like titles appear under **Student review**.

### 3. Backfill older 2,000

```bash
JOB_TAGGER_USE_ML=false JOB_TAGGER_COOLDOWN=false \
  npx ts-node --project server/tsconfig.json \
  server/src/scripts/categoryQaCohort.ts --phase backfill
```

On **Category QA**:

- **Backfilled** tab — spot-check specialty / industry / experience / location / H-1B
- Completeness strip — % missing per field
- **Student review** — escape cohort before treating as normal cluster filters

### 4. After you approve quality

Backfill the remaining cleared rows (same batch, still phase `cleared` / empty specialty):

```bash
JOB_TAGGER_USE_ML=false JOB_TAGGER_COOLDOWN=false \
  npx ts-node --project server/tsconfig.json \
  server/src/scripts/categoryQaCohort.ts --phase backfill --backfill-size 2000
```

Restart workers when done:

```bash
pm2 start scoutx-scraper scoutx-aggregators
```

## Live enrichment (ongoing)

List-complete enqueue ([`jobBoardEnrichment.ts`](../server/src/services/jobBoardEnrichment.ts)) and the enrichment worker ([`jobEnrichmentWorker.ts`](../server/src/workers/jobEnrichmentWorker.ts)) already stamp specialty, industry, experience, location, and H-1B. They also set `studentEscape` via [`studentEscape.ts`](../src/shared/studentEscape.ts).

Job Board filters (`GET /api/jobs`) continue to use the frozen* + H-1B fields; Category QA does not change those filters.

## Flags

| Flag | Meaning |
|------|---------|
| `--phase clear\|backfill\|all` | Which step to run |
| `--dry-run` | Classify/select only; no Mongo writes |
| `--limit N` | Cap docs touched per phase |
| `--cohort-size N` | Default 4000 |
| `--backfill-size N` | Default 2000 |
| `--batch-id STRING` | Default `cat-qa-2026-09` |
| `--batch N` | BulkWrite flush size (default 25) |

## Known Accel gaps (improved 2026-09)

Classifier fixes landed for Accel chrome company names, country-first locations
(`United States, Washington, Redmond`), Hybrid-empty → remote, broader title→industry
hints, and Engineer II / MTS / Consultant experience ladders. Re-run:

```bash
npx ts-node --project server/tsconfig.json \
  server/src/scripts/categoryQaCohort.ts --phase backfill --backfill-size 200 --force
```

H-1B `unknown/none` on small Accel employers with no DOL match is expected — not a stamp failure.
