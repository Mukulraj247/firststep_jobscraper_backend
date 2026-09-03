# Job Category Tagger (Scout-X production sidecar)

Python FastAPI service used by **`scoutx-enrichment`** to assign up to **2 frozen categories** per job.

## Production layout (this folder)

```
job-tagger/
├── backend/          # FastAPI app (PM2: scoutx-job-tagger)
├── data/
│   └── category_rules_research.json
└── models/           # Optional ML artifact: job_category_ml.joblib
```

Lab UI, Docker Compose, training scripts, and test datasets were removed from this copy — Scout-X only needs the backend API.

## API (Scout-X uses these)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Health + rules version |
| `POST /api/classify-one` | Single job (production) |
| `POST /api/classify-batch` | Batch backfill |

## Install on droplet

```bash
cd job-tagger/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

PM2 starts this via `ecosystem.config.cjs` → **`scoutx-job-tagger`** on `127.0.0.1:8000`.

## Scout-X env (in main `.env`)

```
JOB_TAGGER_URL=http://127.0.0.1:8000
JOB_TAGGER_USE_ML=true
JOB_TAGGER_MAX_BADGES=2
JOB_TAGGER_ENABLED=true
```

## ML model (optional)

Rules work without ML. For ML fallback, place `models/job_category_ml.joblib` here (train locally, copy to droplet).
