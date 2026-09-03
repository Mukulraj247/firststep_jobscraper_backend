"""
Deterministic Job Category Tagging System — core module.
Standalone rule-based classifier (no ML).
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .audit import FROZEN_CATEGORIES, validate_category_taxonomy
from .tfidf_refinement import (
    cap_by_score,
    get_tfidf_index,
    refine_categories,
    sklearn_available,
)

# ---------------------------------------------------------------------------
# Scoring weights (per SCORING_CONTRACT.md)
# ---------------------------------------------------------------------------
WEIGHTS = {
    "strong_title": 16,
    "strong_phrase": 5,
    "technology": 2,
    "supporting": 1,
}

DEFAULT_THRESHOLD = 5
DEFAULT_MIN_SIGNALS = 2
TITLE_OVERRIDE_SCORE = 16

_RULES_DIR = Path(__file__).resolve().parent if "__file__" in globals() else Path.cwd()


def _resolve_rules_path() -> Path:
    """Find category_rules_research.json via env, project data/, or fallbacks."""
    seen: set[str] = set()
    candidates: list[Path] = []

    def _add(path: Path) -> None:
        key = str(path.resolve()) if path.is_absolute() else str(path)
        if key not in seen:
            seen.add(key)
            candidates.append(path)

    env_path = os.environ.get("JOB_TAGGER_RULES_PATH")
    if env_path:
        _add(Path(env_path))

    # job-tagger layout: backend/classifier -> ../../data/
    _add(_RULES_DIR.parent.parent / "data" / "category_rules_research.json")
    _add(_RULES_DIR / "category_rules_research.json")
    _add(Path.cwd() / "category_rules_research.json")
    _add(Path.cwd() / "data" / "category_rules_research.json")
    _add(Path.cwd() / "nootbook" / "category_rules_research.json")
    _add(Path("/content/category_rules_research.json"))  # Colab Files panel default

    for parent in list(Path.cwd().parents)[:4]:
        _add(parent / "category_rules_research.json")
        _add(parent / "data" / "category_rules_research.json")
        _add(parent / "nootbook" / "category_rules_research.json")

    for path in candidates:
        if path.exists():
            return path
    return candidates[0] if candidates else Path("category_rules_research.json")


_RULES_PATH = _resolve_rules_path()


def get_rules_path() -> Path:
    """Return the resolved path to category_rules_research.json."""
    return _RULES_PATH


def _load_category_rules() -> dict[str, dict[str, Any]]:
    if _RULES_PATH.exists():
        rules = json.loads(_RULES_PATH.read_text(encoding="utf-8"))
        validate_category_taxonomy(rules)
        return rules
    # Fallback: build from v2 base + research expansions (local dev only)
    import importlib.util

    build_script = _RULES_DIR / "build_category_rules_research.py"
    if not build_script.exists():
        build_script = Path.cwd() / "nootbook" / "build_category_rules_research.py"
    spec = importlib.util.spec_from_file_location("build_rules_mod", build_script)
    if spec and spec.loader:
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        rules = mod.build_rules()
        validate_category_taxonomy(rules)
        return rules
    raise FileNotFoundError(
        f"Rules file not found: {_RULES_PATH}\n"
        "Upload category_rules_research.json to Colab (Files panel) or place it "
        "next to this notebook, then re-run this cell."
    )


CATEGORY_RULES: dict[str, dict[str, Any]] = _load_category_rules()

# ---------------------------------------------------------------------------
# Text preprocessing — shared canonicalize pipeline
# ---------------------------------------------------------------------------
ABBREVIATION_MAP = {
    r"\bml\b": "machine learning",
    r"\bai\b": "artificial intelligence",
    r"\bbi\b": "business intelligence",
    r"\betl\b": "etl",
    r"\bqa\b": "quality assurance",
    r"\bsre\b": "site reliability engineer",
    r"\bdevops\b": "devops",
    r"\bc/i\b": "ci cd",
    r"\bui/ux\b": "ui ux",
    r"\bf/e\b": "frontend",
    r"\bb/e\b": "backend",
    r"\btpm\b": "technical program manager",
    r"\bsdet\b": "software development engineer in test",
    r"\bswe\b": "software engineer",
    r"\biac\b": "infrastructure as code",
    r"\bmlops\b": "mlops",
    r"\biam\b": "identity and access management",
    r"\bnoc\b": "network operations center",
    r"\bapm\b": "application performance monitoring",
    r"\bl5\b": "level 5",
    r"\bl4\b": "level 4",
    r"\bl3\b": "level 3",
    r"\bllm\b": "large language model",
    r"\bnlp\b": "natural language processing",
}

DOTTED_PLACEHOLDERS = {
    "node.js": "NODEJS",
    "vue.js": "VUEJS",
    "react.js": "REACTJS",
    "next.js": "NEXTJS",
    "nuxt.js": "NUXTJS",
    "express.js": "EXPRESSJS",
    "three.js": "THREEJS",
    "d3.js": "D3JS",
    "chart.js": "CHARTJS",
    "web3.js": "WEB3JS",
    "ethers.js": "ETHERSJS",
}

# Suppress generic SWE only when these specialized title-matched categories win
GENERIC_SUPPRESS_WHEN_TITLE = {"SAP", "Salesforce", "ERP"}


def canonicalize(text: str) -> str:
    """Single normalization pipeline for job text AND rule terms."""
    if not text:
        return ""
    text = text.lower()
    text = text.replace("c#", "csharp").replace(".net", "dotnet")
    for term, placeholder in DOTTED_PLACEHOLDERS.items():
        text = text.replace(term, placeholder.lower())
    text = re.sub(r"[/\-_]", " ", text)
    text = re.sub(r"[^\w\s+#]", " ", text)
    text = text.replace("#", "sharp ")
    reverse_placeholders = {v.lower(): k for k, v in DOTTED_PLACEHOLDERS.items()}
    for placeholder, term in reverse_placeholders.items():
        text = text.replace(placeholder, term)
    for pattern, replacement in ABBREVIATION_MAP.items():
        text = re.sub(pattern, replacement, text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_text(text: str) -> str:
    """Alias for canonicalize — backward compatible."""
    return canonicalize(text)


def term_matches(text: str, term: str) -> bool:
    """Match canonicalized term in canonicalized text with word boundaries."""
    text_canon = canonicalize(text) if text != canonicalize(text) else text
    term_canon = canonicalize(term)
    if not term_canon:
        return False
    if " " in term_canon or "." in term_canon:
        return term_canon in text_canon
    pattern = r"(?<!\w)" + re.escape(term_canon) + r"(?!\w)"
    return bool(re.search(pattern, text_canon))


# ---------------------------------------------------------------------------
# Rule engine
# ---------------------------------------------------------------------------
@dataclass
class CategoryScore:
    name: str
    score: int
    matched_signals: list[str] = field(default_factory=list)
    signal_count: int = 0
    title_matched: bool = False
    reason: str = ""
    coverage: float = 0.0
    gate_failed: bool = False


def _count_distinct_signals(signals: list[str]) -> int:
    return len(set(signals))


def _expected_signals(config: dict[str, Any]) -> int:
    return (
        len(config.get("strong_title_terms", []))
        + len(config.get("strong_terms", []))
        + len(config.get("technology_terms", []))
        + len(config.get("supporting_terms", []))
    )


def _filter_ambiguous_title_matches(title_norm: str, matched: list[str]) -> list[str]:
    """Drop generic platform titles when ML-platform context is present."""
    if "ml platform" in title_norm or "machine learning platform" in title_norm:
        blocked = {"platform engineer", "platform developer", "internal platform engineer"}
        matched = [t for t in matched if t not in blocked]
    return matched


def _best_title_match(title_norm: str, terms: list[str]) -> tuple[str | None, list[str]]:
    """Return longest matching title term (dominant title) and all matched aliases."""
    matched = [t for t in terms if term_matches(title_norm, t)]
    matched = _filter_ambiguous_title_matches(title_norm, matched)
    if not matched:
        return None, []
    best = max(matched, key=len)
    return best, matched


def score_category(
    category: str,
    title_norm: str,
    full_norm: str,
    rules: dict[str, dict[str, Any]] | None = None,
) -> CategoryScore:
    rules = rules or CATEGORY_RULES
    config = rules[category]
    score = 0
    signals: list[str] = []
    title_matched = False
    has_combo = False
    has_strong_phrase = False
    tech_hits: list[str] = []

    best_title, all_titles = _best_title_match(title_norm, config.get("strong_title_terms", []))
    if best_title:
        score += WEIGHTS["strong_title"]
        title_matched = True
        for t in all_titles:
            signals.append(f"title:{t}")

    for term in config.get("strong_terms", []):
        if term_matches(full_norm, term):
            score += WEIGHTS["strong_phrase"]
            signals.append(term)
            has_strong_phrase = True

    for term in config.get("technology_terms", []):
        if term_matches(full_norm, term):
            score += WEIGHTS["technology"]
            signals.append(term)
            tech_hits.append(term)

    for term in config.get("supporting_terms", []):
        if term_matches(full_norm, term):
            score += WEIGHTS["supporting"]
            signals.append(term)

    for combo_terms, bonus in config.get("combinations", []):
        if all(term_matches(full_norm, t) for t in combo_terms):
            score += bonus
            signals.append(f"combo:{'+'.join(combo_terms)}")
            has_combo = True

    signal_count = _count_distinct_signals(signals)
    expected = _expected_signals(config)
    coverage = round(signal_count / expected, 3) if expected else 0.0

    result = CategoryScore(
        name=category,
        score=score,
        matched_signals=signals,
        signal_count=signal_count,
        title_matched=title_matched,
        coverage=coverage,
    )

    gates = config.get("evidence_gates", {})
    if gates and not _passes_evidence_gates(
        gates, title_matched, has_strong_phrase, has_combo, tech_hits, full_norm, signals
    ):
        result.gate_failed = True

    return result


def _passes_evidence_gates(
    gates: dict[str, Any],
    title_matched: bool,
    has_strong_phrase: bool,
    has_combo: bool,
    tech_hits: list[str],
    full_norm: str,
    signals: list[str],
) -> bool:
    strict_strong = gates.get("require_any_strong_strict", [])
    if strict_strong and not any(term_matches(full_norm, t) for t in strict_strong):
        if not title_matched:
            return False

    require_any_strong = gates.get("require_any_strong", [])
    if require_any_strong:
        if not any(term_matches(full_norm, t) for t in require_any_strong):
            if not title_matched and not has_strong_phrase:
                return False

    block_only_tech = gates.get("block_if_only_technology", [])
    if block_only_tech and tech_hits:
        blocked_hits = [t for t in tech_hits if any(term_matches(t, b) or term_matches(b, t) for b in block_only_tech)]
        if blocked_hits and not title_matched and not has_strong_phrase and not has_combo:
            non_blocked = [s for s in signals if not any(term_matches(s, b) for b in block_only_tech)]
            if len(non_blocked) <= len(blocked_hits):
                return False

    if gates.get("require_title_or_combo") and not title_matched and not has_combo:
        return False

    require_min_tech = gates.get("require_min_technology", 0)
    if require_min_tech and not title_matched and len(tech_hits) < require_min_tech:
        return False

    return True


def _passes_threshold(result: CategoryScore, config: dict[str, Any]) -> bool:
    if result.gate_failed:
        return False
    threshold = config.get("threshold", DEFAULT_THRESHOLD)
    min_signals = config.get("min_signals", DEFAULT_MIN_SIGNALS)

    if result.title_matched and result.score >= TITLE_OVERRIDE_SCORE:
        return True
    if result.score >= threshold and result.signal_count >= min_signals:
        return True
    return False


def _apply_exclusions(
    qualified: dict[str, CategoryScore],
    rules: dict[str, dict[str, Any]],
) -> dict[str, CategoryScore]:
    """Suppress categories when higher-priority specialized categories win."""
    if not qualified:
        return qualified

    priority_map = {cat: rules[cat].get("priority", 1) for cat in qualified}
    sorted_cats = sorted(
        qualified.keys(),
        key=lambda c: (priority_map[c], qualified[c].score),
        reverse=True,
    )

    final: dict[str, CategoryScore] = {}

    for cat in sorted_cats:
        config = rules[cat]
        excluded_by = config.get("excluded_if_category", [])
        # Only exclude if the blocking category actually title-matched the job
        blockers_with_title_match = [
            ex for ex in excluded_by
            if ex in final and final[ex].title_matched
        ]
        if blockers_with_title_match:
            continue
        final[cat] = qualified[cat]

    # Suppress generic SWE when specialized categories title-match
    specialized_title_winners = [
        c for c in final
        if c != "Software Engineering"
        and final[c].title_matched
        and rules[c].get("priority", 1) > 1
    ]
    if specialized_title_winners and "Software Engineering" in final:
        swe = final["Software Engineering"]
        if not swe.title_matched:
            del final["Software Engineering"]

    return final


def classify_job(
    title: str,
    description: str,
    rules: dict[str, dict[str, Any]] | None = None,
    *,
    max_categories: int | None = None,
    refine_with_tfidf: bool = False,
    min_tfidf_similarity: float = 0.08,
) -> dict[str, Any]:
    """
    Classify a job posting into category badges using deterministic rules.

    Default: exhaustive — returns all rule-qualified categories.
    Set max_categories + refine_with_tfidf=True for UI capping (see classify_job_for_ui).
    """
    rules = rules or CATEGORY_RULES
    title_norm = canonicalize(title or "")
    desc_norm = canonicalize(description or "")
    full_norm = f"{title_norm} {desc_norm}".strip()

    raw_scores: dict[str, CategoryScore] = {}
    for category in rules:
        result = score_category(category, title_norm, full_norm, rules)
        config = rules[category]
        if _passes_threshold(result, config):
            gate_note = "; gates passed" if config.get("evidence_gates") else ""
            result.reason = (
                f"Score {result.score} >= threshold {config.get('threshold', DEFAULT_THRESHOLD)} "
                f"with {result.signal_count} signals"
                + ("; strong title match" if result.title_matched else "")
                + gate_note
            )
            raw_scores[category] = result

    final_scores = _apply_exclusions(raw_scores, rules)

    categories = sorted(
        final_scores.values(),
        key=lambda x: x.score,
        reverse=True,
    )

    result = {
        "categories": [
            {
                "name": c.name,
                "score": c.score,
                "matched_signals": c.matched_signals,
                "signal_count": c.signal_count,
                "reason": c.reason,
                "coverage": c.coverage,
            }
            for c in categories
        ],
        "category_names": [c.name for c in categories],
        "refined": False,
    }

    if (
        max_categories is not None
        and refine_with_tfidf
        and len(result["categories"]) > max_categories
    ):
        if sklearn_available():
            index = get_tfidf_index(rules)
            result = refine_categories(
                result,
                full_norm,
                index,
                max_categories=max_categories,
                min_similarity=min_tfidf_similarity,
            )
        else:
            # Python 3.14+ often lacks sklearn wheels; cap by rule score instead
            result = cap_by_score(result, max_categories)

    return result


def classify_job_for_ui(
    title: str,
    description: str,
    *,
    max_badges: int = 2,
    min_tfidf_similarity: float = 0.08,
    rules: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Exhaustive rule classify, then TF-IDF rank/cap for display."""
    exhaustive = classify_job(title, description, rules=rules)
    if len(exhaustive["categories"]) <= max_badges:
        return exhaustive
    return classify_job(
        title,
        description,
        rules=rules,
        max_categories=max_badges,
        refine_with_tfidf=True,
        min_tfidf_similarity=min_tfidf_similarity,
    )


def get_all_categories() -> list[str]:
    return sorted(CATEGORY_RULES.keys())


def reload_rules() -> dict[str, dict[str, Any]]:
    """Reload rules from JSON (e.g. after regeneration)."""
    global CATEGORY_RULES
    CATEGORY_RULES = _load_category_rules()
    return CATEGORY_RULES
