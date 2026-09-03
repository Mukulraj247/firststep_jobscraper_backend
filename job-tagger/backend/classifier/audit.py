"""Audit utilities for the 30-category job classifier."""

from __future__ import annotations

from typing import Any

# Frozen taxonomy — exactly 30 categories; do not add or remove without explicit approval.
FROZEN_CATEGORIES: tuple[str, ...] = (
    "Software Engineering",
    "Frontend Development",
    "Backend Development",
    "Full Stack Development",
    "Mobile Application Development",
    "DevOps",
    "Site Reliability Engineering",
    "Cloud Engineering",
    "Platform Engineering",
    "Data Engineering",
    "Data Analyst",
    "Data Science",
    "Machine Learning Engineer",
    "AI Engineer",
    "QA / Testing",
    "Cybersecurity",
    "Network Engineering",
    "Product Management",
    "Project Management",
    "UI/UX Design",
    "Technical Support",
    "SAP",
    "Salesforce",
    "ERP",
    "Blockchain / Web3",
    "Embedded Systems",
    "Electrical Engineering",
    "Game Development",
    "System Administration",
    "Solution Architecture",
)

EXPECTED_CATEGORY_COUNT = 30


def validate_category_taxonomy(rules: dict[str, dict[str, Any]]) -> None:
    """Raise ValueError if rules deviate from the frozen 30-category taxonomy."""
    names = set(rules.keys())
    frozen = set(FROZEN_CATEGORIES)
    if len(names) != EXPECTED_CATEGORY_COUNT:
        raise ValueError(
            f"Category count mismatch: expected {EXPECTED_CATEGORY_COUNT}, got {len(names)}"
        )
    missing = frozen - names
    extra = names - frozen
    if missing or extra:
        raise ValueError(
            f"Category taxonomy drift — missing: {sorted(missing)}; extra: {sorted(extra)}"
        )


def category_rule_stats(rules: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Per-category rule statistics for audit reports."""
    validate_category_taxonomy(rules)
    stats: dict[str, dict[str, Any]] = {}
    for name, config in sorted(rules.items()):
        stats[name] = {
            "strong_title_terms": len(config.get("strong_title_terms", [])),
            "strong_terms": len(config.get("strong_terms", [])),
            "technology_terms": len(config.get("technology_terms", [])),
            "supporting_terms": len(config.get("supporting_terms", [])),
            "combinations": len(config.get("combinations", [])),
            "threshold": config.get("threshold", 5),
            "min_signals": config.get("min_signals", 2),
            "priority": config.get("priority", 1),
            "excluded_if_category": config.get("excluded_if_category", []),
            "has_evidence_gates": bool(config.get("evidence_gates")),
        }
    return stats


def audit_summary(rules: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """High-level audit snapshot."""
    validate_category_taxonomy(rules)
    per_cat = category_rule_stats(rules)
    total_terms = sum(
        s["strong_title_terms"] + s["strong_terms"] + s["technology_terms"] + s["supporting_terms"]
        for s in per_cat.values()
    )
    gated = sum(1 for s in per_cat.values() if s["has_evidence_gates"])
    return {
        "category_count": len(rules),
        "total_signal_terms": total_terms,
        "categories_with_gates": gated,
        "per_category": per_cat,
    }


def print_audit_report(rules: dict[str, dict[str, Any]]) -> None:
    """Print human-readable audit summary to stdout."""
    summary = audit_summary(rules)
    print(f"=== Category Audit ({summary['category_count']} categories) ===")
    print(f"Total signal terms: {summary['total_signal_terms']}")
    print(f"Categories with evidence gates: {summary['categories_with_gates']}")
    print()
    print(f"{'Category':<35} {'Title':>5} {'Strong':>6} {'Tech':>5} {'Supp':>5} {'Comb':>4} {'Thr':>3} {'Gate':>4}")
    print("-" * 80)
    for name, s in summary["per_category"].items():
        gate = "yes" if s["has_evidence_gates"] else "no"
        print(
            f"{name:<35} {s['strong_title_terms']:>5} {s['strong_terms']:>6} "
            f"{s['technology_terms']:>5} {s['supporting_terms']:>5} {s['combinations']:>4} "
            f"{s['threshold']:>3} {gate:>4}"
        )
