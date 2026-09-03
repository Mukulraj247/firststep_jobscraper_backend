"""
Load job postings from JSON uploads and classify using title + description only.
Supports HiringCafe scrape format and generic {title, description} objects.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .envelope import classify_one_enriched

# HiringCafe export field mapping (scraped column names → semantic meaning)
HIRINGCAFE_TITLE_FIELD = "w_full"
HIRINGCAFE_DESCRIPTION_FIELDS = (
    "line_clamp_6",   # duties / requirements
    "line_clamp_5",   # requirements (alternate)
    "line_clamp_2_1", # skills / tools mentioned
)

# Generic fallbacks if keys differ
GENERIC_TITLE_KEYS = ("title", "job_title", "w_full", "name")
GENERIC_DESCRIPTION_KEYS = (
    "description",
    "job_description",
    "jd",
    "line_clamp_6",
    "line_clamp_5",
    "line_clamp_2_1",
)


def _first_non_empty(record: dict[str, Any], keys: tuple[str, ...]) -> str:
    for key in keys:
        value = record.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def extract_title_and_description(record: dict[str, Any]) -> tuple[str, str]:
    """
    Extract only title and job description from a record.
    Ignores location, salary, company, URL, and all other metadata.
    """
    title = _first_non_empty(record, GENERIC_TITLE_KEYS)

    parts: list[str] = []
    for key in GENERIC_DESCRIPTION_KEYS:
        value = record.get(key)
        if value is not None and str(value).strip():
            text = str(value).strip()
            if text not in parts:
                parts.append(text)

    description = " ".join(parts)
    return title, description


def load_jobs_from_json(source: str | Path | list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Load jobs from a JSON file path or already-parsed list.
    Returns list of {title, description, source_index, id, raw} dicts.
    """
    if isinstance(source, list):
        records = source
    else:
        path = Path(source)
        with path.open(encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and "jobs" in data:
            records = data["jobs"]
        elif isinstance(data, list):
            records = data
        else:
            raise ValueError("JSON must be a list of job objects or {jobs: [...]}")

    jobs = []
    for i, record in enumerate(records):
        if not isinstance(record, dict):
            continue
        title, description = extract_title_and_description(record)
        job_id = record.get("id")
        if job_id is not None:
            job_id = str(job_id)
        jobs.append({
            "title": title,
            "description": description,
            "source_index": i,
            "id": job_id,
            "raw": record,
        })
    return jobs


def classify_jobs_from_records(
    records: list[dict[str, Any]],
    *,
    max_categories: int | None = None,
    refine_with_tfidf: bool = False,
    min_tfidf_similarity: float = 0.08,
    ui_mode: bool = False,
    max_badges: int = 5,
    use_ml: bool = False,
) -> list[dict[str, Any]]:
    """Classify a list of raw JSON job records. Uses title + description only."""
    loaded = load_jobs_from_json(records)
    results = []
    for job in loaded:
        results.append(
            classify_one_enriched(
                job["title"],
                job["description"],
                use_ml=use_ml,
                job_id=job.get("id"),
                source_index=job["source_index"],
                max_categories=max_categories,
                refine_with_tfidf=refine_with_tfidf,
                min_tfidf_similarity=min_tfidf_similarity,
                ui_mode=ui_mode,
                max_badges=max_badges,
            )
        )
    return results


def classify_jobs_from_file(
    file_path: str | Path,
    **kwargs: Any,
) -> list[dict[str, Any]]:
    """Load JSON file and classify all jobs."""
    path = Path(file_path)
    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict) and "jobs" in data:
        records = data["jobs"]
    elif isinstance(data, list):
        records = data
    else:
        raise ValueError("JSON must be a list of job objects or {jobs: [...]}")
    return classify_jobs_from_records(records, **kwargs)
