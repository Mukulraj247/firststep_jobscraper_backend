"""Merge ML suggestions into rule results without dropping title evidence."""
from __future__ import annotations

from typing import Any

from ..audit import FROZEN_CATEGORIES
from ..versioning import LOW_CONFIDENCE_THRESHOLD
from .predict import ml_model_available, predict_ml

FROZEN = set(FROZEN_CATEGORIES)


def max_rule_score(category_details: list[dict[str, Any]]) -> int | float:
    if not category_details:
        return 0
    return max(d.get("score", 0) for d in category_details)


def is_low_confidence(category_details: list[dict[str, Any]]) -> bool:
    if not category_details:
        return False
    return max_rule_score(category_details) < LOW_CONFIDENCE_THRESHOLD


def is_untagged(categories: list[str]) -> bool:
    return len(categories) == 0


def should_apply_ml(categories: list[str], category_details: list[dict[str, Any]]) -> bool:
    return is_untagged(categories) or is_low_confidence(category_details)


def _title_matched_names(category_details: list[dict[str, Any]]) -> set[str]:
    names: set[str] = set()
    for d in category_details:
        if d.get("title_matched"):
            names.add(d["name"])
            continue
        signals = d.get("matched_signals") or []
        if any(str(s).startswith("title:") for s in signals):
            names.add(d["name"])
    return names


def merge_rules_and_ml(
    title: str,
    description: str,
    rule_result: dict[str, Any],
    *,
    min_confidence: float | None = None,
) -> dict[str, Any]:
    """
    Apply ML only when untagged or low-confidence.
    Never remove rule categories that title-matched.
    Untagged path uses a higher confidence floor to limit FP on non-tech titles.
    """
    categories = list(rule_result.get("categories") or [])
    details = [dict(d) for d in (rule_result.get("category_details") or [])]
    for d in details:
        d.setdefault("source", "rules")

    low_conf = is_low_confidence(details)
    untagged = is_untagged(categories)
    result = dict(rule_result)
    result["low_confidence"] = low_conf
    result["untagged"] = untagged
    result["ml_applied"] = False
    result["method"] = "rules"
    result["ml_status"] = "off"
    result.setdefault("untagged_reason", None)

    if not should_apply_ml(categories, details):
        result["ml_status"] = "skipped_confident"
        return result
    if not ml_model_available():
        result["ml_status"] = "no_model"
        if untagged:
            result["untagged_reason"] = (
                "Rules matched no frozen category; ML was requested but the model is not loaded."
            )
        return result

    if min_confidence is None:
        min_confidence = 0.85 if untagged else 0.35

    ml_suggestions = predict_ml(title, description, min_confidence=min_confidence)
    if not ml_suggestions:
        result["ml_status"] = "no_suggestion"
        if untagged:
            result["untagged_reason"] = (
                f"Rules matched no frozen category; ML reviewed this job but no label "
                f"reached confidence ≥ {min_confidence:.0%} "
                f"(common for non-tech / out-of-taxonomy roles)."
            )
        elif low_conf:
            result["untagged_reason"] = None
            result["note"] = (
                f"Rules tags are low-confidence (max score < {LOW_CONFIDENCE_THRESHOLD}); "
                f"ML found no stronger suggestion ≥ {min_confidence:.0%}."
            )
        return result

    protected = _title_matched_names(details)
    by_name = {d["name"]: d for d in details}

    for sug in ml_suggestions:
        name = sug["name"]
        if name not in FROZEN:
            continue
        if name in by_name:
            existing = by_name[name]
            existing["ml_confidence"] = sug.get("ml_confidence")
            existing["source"] = "rules+ml"
            continue
        by_name[name] = sug

    for name in protected:
        if name in by_name and by_name[name].get("source") == "ml":
            pass

    merged_details = sorted(
        by_name.values(),
        key=lambda d: (d.get("score", 0), d.get("ml_confidence") or 0),
        reverse=True,
    )
    merged_names = [d["name"] for d in merged_details if d["name"] in FROZEN]

    result["categories"] = merged_names
    result["category_details"] = merged_details
    result["ml_applied"] = True
    result["method"] = "rules+ml"
    result["ml_status"] = "applied"
    result["untagged"] = len(merged_names) == 0
    result["low_confidence"] = is_low_confidence(merged_details) if merged_names else False
    if result["untagged"]:
        result["untagged_reason"] = (
            "ML ran but still produced no frozen category above the confidence floor."
        )
    else:
        result["untagged_reason"] = None
    return result
