"""
FastAPI backend for the Job Category Tagger.

Endpoints:
  POST /api/upload         — upload a JSON file with job postings (lab)
  POST /api/classify       — classify loaded jobs (lab)
  POST /api/classify-one   — classify a single title + description (Scout-X)
  POST /api/classify-batch — batch classify (Scout-X)
  GET  /api/categories     — frozen taxonomy list
  GET  /api/stats          — category distribution from last classification
  GET  /api/health         — health check with rules/ML metadata
  GET  /api/ml/status      — ML model status (lab)
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# ── Path setup ──────────────────────────────────────────────────────────────
BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BACKEND_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))

# Default rules path so the classifier finds our data file.
# setdefault (not assignment) keeps an operator/PM2-provided JOB_TAGGER_RULES_PATH authoritative.
DATA_RULES_PATH = PROJECT_DIR / "data" / "category_rules_research.json"
os.environ.setdefault("JOB_TAGGER_RULES_PATH", str(DATA_RULES_PATH))

from classifier.upload import load_jobs_from_json, classify_jobs_from_records
from classifier.classifier import get_rules_path, CATEGORY_RULES
from classifier.audit import FROZEN_CATEGORIES
from classifier.versioning import CLASSIFIER_VERSION, LOW_CONFIDENCE_THRESHOLD, rules_version
from classifier.tfidf_refinement import sklearn_available
from classifier.ml.predict import load_ml_meta, ml_model_available
from models.schemas import (
    UploadResponse,
    ClassifyRequest,
    SingleJobRequest,
    BatchClassifyRequest,
    JobResult,
    CategoryDetail,
    StatsResponse,
    HealthResponse,
    CategoriesResponse,
    MlStatusResponse,
)

# ── App ─────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Job Category Tagger",
    description="Frozen-category job classifier (rules first, optional ML fallback)",
    version=CLASSIFIER_VERSION,
)

# Scout-X calls this service server-to-server on 127.0.0.1, so no browser origin
# needs credentials. `allow_credentials=True` with a "*" origin is also rejected by
# browsers. Set JOB_TAGGER_CORS_ORIGINS (comma-separated) to serve the lab UI.
_cors_origins = [
    origin.strip()
    for origin in os.environ.get(
        "JOB_TAGGER_CORS_ORIGINS", "http://localhost:5173,http://localhost:3000"
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

# ── In-memory state (lab UI only) ───────────────────────────────────────────
_loaded_jobs: list[dict[str, Any]] = []
_uploaded_filename: str = ""
_last_results: list[dict[str, Any]] = []
_last_classify_options: ClassifyRequest | None = None


def _result_to_job_result(r: dict[str, Any]) -> JobResult:
    details = [
        CategoryDetail(
            name=d["name"],
            score=d["score"],
            matched_signals=d.get("matched_signals") or [],
            signal_count=d.get("signal_count", 0),
            reason=d.get("reason") or "",
            coverage=d.get("coverage"),
            title_matched=d.get("title_matched"),
            tfidf_score=d.get("tfidf_score"),
            ml_confidence=d.get("ml_confidence"),
            source=d.get("source"),
        )
        for d in r.get("category_details") or []
    ]
    return JobResult(
        id=r.get("id"),
        source_index=r.get("source_index", 0),
        title=r["title"],
        description=r.get("description") or "",
        categories=r.get("categories") or [],
        category_details=details,
        untagged=bool(r.get("untagged", not (r.get("categories") or []))),
        method=r.get("method") or "rules",
        rules_version=r.get("rules_version") or rules_version(),
        classifier_version=r.get("classifier_version") or CLASSIFIER_VERSION,
        refined=r.get("refined", False),
        removed_by_tfidf=r.get("removed_by_tfidf") or [],
        ml_applied=bool(r.get("ml_applied", False)),
        low_confidence=bool(r.get("low_confidence", False)),
        ml_status=r.get("ml_status") or "off",
        untagged_reason=r.get("untagged_reason"),
        note=r.get("note"),
    )


def _compute_stats(results: list[dict[str, Any]]) -> StatsResponse:
    total_jobs = len(results)
    tagged_jobs = sum(1 for r in results if r.get("categories"))
    untagged_jobs = total_jobs - tagged_jobs

    category_counts: dict[str, int] = {}
    total_categories_assigned = 0
    total_score = 0
    score_count = 0

    for r in results:
        for cat in r.get("categories") or []:
            category_counts[cat] = category_counts.get(cat, 0) + 1
            total_categories_assigned += 1
        details = r.get("category_details") or []
        if details:
            max_score = max(d.get("score", 0) for d in details)
            total_score += max_score
            score_count += 1

    return StatsResponse(
        total_jobs=total_jobs,
        tagged_jobs=tagged_jobs,
        untagged_jobs=untagged_jobs,
        category_counts=category_counts,
        avg_categories_per_job=round(total_categories_assigned / total_jobs, 2) if total_jobs else 0,
        avg_score=round(total_score / score_count, 1) if score_count else None,
    )


def _classify_with_options(
    records: list[dict[str, Any]],
    req: ClassifyRequest | BatchClassifyRequest | SingleJobRequest,
) -> list[dict[str, Any]]:
    return classify_jobs_from_records(
        records,
        max_categories=getattr(req, "max_categories", None),
        refine_with_tfidf=getattr(req, "refine_with_tfidf", False),
        min_tfidf_similarity=getattr(req, "min_tfidf_similarity", 0.08),
        ui_mode=getattr(req, "ui_mode", False),
        max_badges=getattr(req, "max_badges", 2),
        use_ml=getattr(req, "use_ml", False),
    )


# ── Endpoints ──────────────────────────────────────────────────────────────
@app.get("/api/health", response_model=HealthResponse)
def health_check() -> HealthResponse:
    rules_path = get_rules_path()
    return HealthResponse(
        status="ok",
        rules_path=str(rules_path),
        rules_exists=rules_path.exists(),
        category_count=len(CATEGORY_RULES),
        frozen_category_count=len(FROZEN_CATEGORIES),
        classifier_version=CLASSIFIER_VERSION,
        rules_version=rules_version(),
        sklearn_available=sklearn_available(),
        ml_model_loaded=ml_model_available(),
    )


@app.get("/api/categories", response_model=CategoriesResponse)
def list_categories() -> CategoriesResponse:
    return CategoriesResponse(
        categories=list(FROZEN_CATEGORIES),
        count=len(FROZEN_CATEGORIES),
        classifier_version=CLASSIFIER_VERSION,
        rules_version=rules_version(),
    )


@app.get("/api/ml/status", response_model=MlStatusResponse)
def ml_status() -> MlStatusResponse:
    meta = load_ml_meta()
    available = ml_model_available()
    return MlStatusResponse(
        available=available,
        loaded=available,
        model_path=str(PROJECT_DIR / "models" / "job_category_ml.joblib") if available else None,
        meta=meta,
        low_confidence_threshold=LOW_CONFIDENCE_THRESHOLD,
        sklearn_available=sklearn_available(),
    )


@app.post("/api/upload", response_model=UploadResponse)
async def upload_file(file: UploadFile = File(...)) -> UploadResponse:
    """Upload a JSON file with job postings (lab harness)."""
    global _loaded_jobs, _uploaded_filename, _last_results, _last_classify_options

    if not file.filename or not file.filename.endswith(".json"):
        raise HTTPException(status_code=400, detail="Only .json files are supported")

    content = await file.read()
    try:
        data = json.loads(content)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}")

    _loaded_jobs = load_jobs_from_json(data)
    _uploaded_filename = file.filename
    _last_results = []
    _last_classify_options = None

    if isinstance(data, dict) and "jobs" in data:
        fmt = "HiringCafe (wrapped)"
    else:
        fmt = "Generic list"

    return UploadResponse(
        filename=file.filename,
        total_jobs=len(_loaded_jobs),
        format_detected=fmt,
    )


@app.post("/api/classify", response_model=list[JobResult])
async def classify_jobs(req: ClassifyRequest) -> list[JobResult]:
    """Classify all loaded jobs (lab harness)."""
    global _loaded_jobs, _last_results, _last_classify_options

    if not _loaded_jobs:
        raise HTTPException(status_code=400, detail="No jobs loaded. Upload a file first.")

    results = _classify_with_options(_loaded_jobs, req)
    _last_results = results
    _last_classify_options = req

    return [_result_to_job_result(r) for r in results]


@app.post("/api/classify-one", response_model=JobResult)
async def classify_one_job(req: SingleJobRequest) -> JobResult:
    """Classify a single job — Scout-X production contract."""
    record: dict[str, Any] = {"title": req.title, "description": req.description}
    if req.id is not None:
        record["id"] = req.id
    results = _classify_with_options([record], req)
    return _result_to_job_result(results[0])


@app.post("/api/classify-batch", response_model=list[JobResult])
async def classify_batch(req: BatchClassifyRequest) -> list[JobResult]:
    """Stateless batch classify — Scout-X production contract."""
    records = [
        {"id": j.id, "title": j.title, "description": j.description}
        for j in req.jobs
    ]
    results = _classify_with_options(records, req)
    return [_result_to_job_result(r) for r in results]


@app.get("/api/stats", response_model=StatsResponse)
async def get_stats() -> StatsResponse:
    """Get category distribution stats from the last classification run.

    Returns empty zeros when nothing has been classified yet (e.g. after restart).
    """
    if not _last_results:
        return StatsResponse(
            total_jobs=0,
            tagged_jobs=0,
            untagged_jobs=0,
            category_counts={},
            avg_categories_per_job=0,
            avg_score=None,
        )
    return _compute_stats(_last_results)
