"""
TF-IDF refinement layer for job category tagging.
Ranks and caps rule-qualified categories using bag-of-words + TF-IDF cosine similarity.
No trained classifier — deterministic given fixed category profiles.

Requires scikit-learn (optional). On Python 3.14+ wheels may be unavailable;
core rule classification still works without this module.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

PROFILE_TERM_KEYS = (
    "strong_title_terms",
    "strong_terms",
    "technology_terms",
    "supporting_terms",
)

_SKLEARN_ERROR = (
    "scikit-learn is not installed. TF-IDF refinement requires it. "
    "Core rule tagging still works. On Python 3.13 or earlier: pip install scikit-learn. "
    "On Python 3.14+, use Python 3.12/3.13 until sklearn ships wheels."
)


def sklearn_available() -> bool:
    try:
        import sklearn  # noqa: F401
        return True
    except ImportError:
        return False


def _require_sklearn() -> tuple[Any, Any]:
    try:
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.metrics.pairwise import cosine_similarity
        return TfidfVectorizer, cosine_similarity
    except ImportError as exc:
        raise ImportError(_SKLEARN_ERROR) from exc


@dataclass
class TfidfIndex:
    """Pre-built TF-IDF index over static category profile documents."""

    vectorizer: Any
    category_names: list[str]
    profile_matrix: Any


def build_category_profiles(rules: dict[str, dict[str, Any]]) -> dict[str, str]:
    """Build one text document per category from rule dictionary terms."""
    profiles: dict[str, str] = {}
    for category, config in rules.items():
        terms: list[str] = []
        for key in PROFILE_TERM_KEYS:
            terms.extend(config.get(key, []))
        for combo_terms, _bonus in config.get("combinations", []):
            terms.extend(combo_terms)
        terms.extend(config.get("strong_title_terms", []))
        terms.extend(config.get("strong_terms", []))
        profiles[category] = " ".join(terms)
    return profiles


def build_tfidf_index(profiles: dict[str, str]) -> TfidfIndex:
    """Fit TF-IDF vectorizer on static category profile documents."""
    TfidfVectorizer, _ = _require_sklearn()
    category_names = sorted(profiles.keys())
    documents = [profiles[name] for name in category_names]
    vectorizer = TfidfVectorizer(
        lowercase=True,
        token_pattern=r"(?u)\b[\w.]+\b",
        min_df=1,
    )
    profile_matrix = vectorizer.fit_transform(documents)
    return TfidfIndex(
        vectorizer=vectorizer,
        category_names=category_names,
        profile_matrix=profile_matrix,
    )


def tfidf_similarity(
    job_text: str,
    candidate_names: list[str],
    index: TfidfIndex,
) -> dict[str, float]:
    """Compute cosine similarity between job text and candidate category profiles."""
    _, cosine_similarity = _require_sklearn()
    if not candidate_names or not job_text.strip():
        return {name: 0.0 for name in candidate_names}

    job_vector = index.vectorizer.transform([job_text])
    name_to_row = {name: i for i, name in enumerate(index.category_names)}

    scores: dict[str, float] = {}
    for name in candidate_names:
        row = name_to_row.get(name)
        if row is None:
            scores[name] = 0.0
            continue
        profile_vector = index.profile_matrix[row]
        sim = cosine_similarity(job_vector, profile_vector)[0][0]
        scores[name] = float(sim)
    return scores


def refine_categories(
    rule_result: dict[str, Any],
    job_text: str,
    index: TfidfIndex,
    max_categories: int = 3,
    min_similarity: float = 0.08,
) -> dict[str, Any]:
    """
    Rank rule-qualified categories by TF-IDF similarity and keep top-K above threshold.

    Preserves rule scores/signals; adds tfidf_score and refinement_reason.
    """
    categories = rule_result.get("categories", [])
    if not categories or len(categories) <= max_categories:
        return rule_result

    candidate_names = [c["name"] for c in categories]
    sim_scores = tfidf_similarity(job_text, candidate_names, index)

    ranked = sorted(
        categories,
        key=lambda c: (sim_scores.get(c["name"], 0.0), c["score"]),
        reverse=True,
    )

    kept = []
    for rank, cat in enumerate(ranked, start=1):
        if len(kept) >= max_categories:
            break
        sim = sim_scores.get(cat["name"], 0.0)
        if sim < min_similarity and len(kept) >= 1:
            continue
        refined = dict(cat)
        refined["tfidf_score"] = round(sim, 4)
        refined["refinement_reason"] = (
            f"TF-IDF rank {rank}/{len(candidate_names)} candidates; "
            f"similarity {sim:.3f}"
        )
        kept.append(refined)

    if not kept and ranked:
        top = dict(ranked[0])
        sim = sim_scores.get(top["name"], 0.0)
        top["tfidf_score"] = round(sim, 4)
        top["refinement_reason"] = f"TF-IDF fallback; similarity {sim:.3f}"
        kept = [top]

    removed = [c["name"] for c in categories if c["name"] not in {k["name"] for k in kept}]

    return {
        "categories": kept,
        "category_names": [c["name"] for c in kept],
        "refined": True,
        "removed_by_tfidf": removed,
        "rule_category_count": len(categories),
    }


def cap_by_score(
    rule_result: dict[str, Any],
    max_categories: int,
) -> dict[str, Any]:
    """Fallback when sklearn is unavailable: keep top-K by rule score."""
    categories = rule_result.get("categories", [])
    if not categories or len(categories) <= max_categories:
        return rule_result
    ranked = sorted(categories, key=lambda c: c["score"], reverse=True)
    kept = ranked[:max_categories]
    removed = [c["name"] for c in ranked[max_categories:]]
    return {
        "categories": kept,
        "category_names": [c["name"] for c in kept],
        "refined": True,
        "removed_by_tfidf": removed,
        "rule_category_count": len(categories),
        "refinement_note": "score_cap_no_sklearn",
    }


_CACHED_INDEX: TfidfIndex | None = None
_CACHED_RULES_ID: int | None = None


def get_tfidf_index(rules: dict[str, dict[str, Any]]) -> TfidfIndex:
    """Return cached TF-IDF index, rebuilding only if rules dict changes."""
    global _CACHED_INDEX, _CACHED_RULES_ID
    rules_id = id(rules)
    if _CACHED_INDEX is None or _CACHED_RULES_ID != rules_id:
        profiles = build_category_profiles(rules)
        _CACHED_INDEX = build_tfidf_index(profiles)
        _CACHED_RULES_ID = rules_id
    return _CACHED_INDEX
