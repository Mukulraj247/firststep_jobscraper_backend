"""Enrich classify results with Scout-X envelope fields + optional ML merge."""
from __future__ import annotations

from typing import Any

from .audit import FROZEN_CATEGORIES
from .classifier import classify_job, classify_job_for_ui
from .ml.merge import is_low_confidence, merge_rules_and_ml
from .versioning import version_meta

FROZEN = set(FROZEN_CATEGORIES)


def _filter_frozen(details: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [d for d in details if d.get("name") in FROZEN]


def _rules_untagged_reason(title: str, description: str) -> str:
    title = (title or "").strip()
    description = (description or "").strip()
    if not title:
        return "No job title extracted from the upload."
    if not description:
        return (
            "Rules matched no frozen category; job description was empty "
            "(thin scrape) so evidence was insufficient."
        )
    if len(description) < 40:
        return (
            "Rules matched no frozen category; description is very short, "
            "so the role is likely out of the 30 frozen tech categories or lacks evidence."
        )
    return (
        "Rules matched no frozen category — role is outside the 30 frozen tech families "
        "or signals were too weak (by design for non-tech / niche titles like GIS, ops, fashion)."
    )


def enrich_prediction(
    title: str,
    description: str,
    prediction: dict[str, Any],
    *,
    use_ml: bool = False,
    job_id: str | None = None,
    source_index: int = 0,
) -> dict[str, Any]:
    details = _filter_frozen(list(prediction.get("categories") or []))
    normalized: list[dict[str, Any]] = []
    for d in details:
        normalized.append({
            "name": d["name"],
            "score": d.get("score", 0),
            "matched_signals": d.get("matched_signals") or [],
            "signal_count": d.get("signal_count", 0),
            "reason": d.get("reason") or "",
            "coverage": d.get("coverage"),
            "title_matched": d.get("title_matched"),
            "tfidf_score": d.get("tfidf_score"),
            "source": d.get("source") or "rules",
            "ml_confidence": d.get("ml_confidence"),
        })
        if normalized[-1]["title_matched"] is None:
            normalized[-1]["title_matched"] = any(
                str(s).startswith("title:") for s in normalized[-1]["matched_signals"]
            )

    names = [d["name"] for d in normalized]
    untagged = len(names) == 0
    result: dict[str, Any] = {
        "id": job_id,
        "source_index": source_index,
        "title": title,
        "description": description,
        "categories": names,
        "category_details": normalized,
        "untagged": untagged,
        "method": "rules",
        "refined": prediction.get("refined", False),
        "removed_by_tfidf": prediction.get("removed_by_tfidf") or [],
        "ml_applied": False,
        "ml_status": "off",
        "low_confidence": is_low_confidence(normalized),
        "untagged_reason": _rules_untagged_reason(title, description) if untagged else None,
        "note": None,
        **version_meta(),
    }

    if use_ml:
        result = merge_rules_and_ml(title, description, result)
        result.update(version_meta())
        result["id"] = job_id
        result["source_index"] = source_index
        result["title"] = title
        result["description"] = description
        result["refined"] = prediction.get("refined", False)
        result["removed_by_tfidf"] = prediction.get("removed_by_tfidf") or []
        # If still untagged and reason missing, keep rules reason
        if result.get("untagged") and not result.get("untagged_reason"):
            result["untagged_reason"] = _rules_untagged_reason(title, description)
    elif untagged:
        result["untagged_reason"] = (
            _rules_untagged_reason(title, description)
            + " ML fallback was off for this run."
        )
        result["ml_status"] = "off"

    return result


def classify_one_enriched(
    title: str,
    description: str,
    *,
    use_ml: bool = False,
    job_id: str | None = None,
    source_index: int = 0,
    max_categories: int | None = None,
    refine_with_tfidf: bool = False,
    min_tfidf_similarity: float = 0.08,
    ui_mode: bool = False,
    max_badges: int = 2,
) -> dict[str, Any]:
    if ui_mode:
        prediction = classify_job_for_ui(
            title,
            description,
            max_badges=max_badges,
            min_tfidf_similarity=min_tfidf_similarity,
        )
    else:
        prediction = classify_job(
            title,
            description,
            max_categories=max_categories,
            refine_with_tfidf=refine_with_tfidf,
            min_tfidf_similarity=min_tfidf_similarity,
        )
    return enrich_prediction(
        title,
        description,
        prediction,
        use_ml=use_ml,
        job_id=job_id,
        source_index=source_index,
    )
