"""Evaluation utilities for multi-label job category classification."""

from __future__ import annotations

from typing import Any, Callable

try:
    from sklearn.metrics import f1_score, precision_score, recall_score
    from sklearn.preprocessing import MultiLabelBinarizer

    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False


def evaluate_predictions(
    test_jobs: list[dict[str, Any]],
    predictions: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Evaluate multi-label predictions against labeled test set.

    Multi-label metrics:
    - Micro: aggregate all label decisions globally (TP/FP/FN pooled)
    - Macro: compute per-label metric then average (unweighted)
    - Samples: per-job exact match ratio (subset accuracy)
    """
    y_true = [job["expected_categories"] for job in test_jobs]
    y_pred = [p["category_names"] for p in predictions]

    all_labels = sorted({lbl for labels in y_true for lbl in labels} | {lbl for labels in y_pred for lbl in labels})

    if SKLEARN_AVAILABLE:
        mlb = MultiLabelBinarizer(classes=all_labels)
        y_true_bin = mlb.fit_transform(y_true)
        y_pred_bin = mlb.transform(y_pred)

        metrics = {
            "precision_micro": float(precision_score(y_true_bin, y_pred_bin, average="micro", zero_division=0)),
            "recall_micro": float(recall_score(y_true_bin, y_pred_bin, average="micro", zero_division=0)),
            "f1_micro": float(f1_score(y_true_bin, y_pred_bin, average="micro", zero_division=0)),
            "precision_macro": float(precision_score(y_true_bin, y_pred_bin, average="macro", zero_division=0)),
            "recall_macro": float(recall_score(y_true_bin, y_pred_bin, average="macro", zero_division=0)),
            "f1_macro": float(f1_score(y_true_bin, y_pred_bin, average="macro", zero_division=0)),
            "subset_accuracy": float((y_true_bin == y_pred_bin).all(axis=1).mean()),
        }

        per_category = {}
        for i, cat in enumerate(mlb.classes_):
            tp = int(((y_true_bin[:, i] == 1) & (y_pred_bin[:, i] == 1)).sum())
            fp = int(((y_true_bin[:, i] == 0) & (y_pred_bin[:, i] == 1)).sum())
            fn = int(((y_true_bin[:, i] == 1) & (y_pred_bin[:, i] == 0)).sum())
            precision = tp / (tp + fp) if (tp + fp) else 0.0
            recall = tp / (tp + fn) if (tp + fn) else 0.0
            f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
            per_category[cat] = {
                "tp": tp, "fp": fp, "fn": fn,
                "precision": round(precision, 3),
                "recall": round(recall, 3),
                "f1": round(f1, 3),
            }
    else:
        metrics = _manual_micro_macro(y_true, y_pred, all_labels)
        per_category = _manual_per_category(y_true, y_pred, all_labels)

    errors = _collect_errors(test_jobs, predictions)
    return {"metrics": metrics, "per_category": per_category, "errors": errors, "label_count": len(all_labels)}


def evaluate_with_details(
    test_jobs: list[dict[str, Any]],
    predictions: list[dict[str, Any]],
) -> dict[str, Any]:
    """Full evaluation plus per-job FP/FN/score/evidence detail."""
    base = evaluate_predictions(test_jobs, predictions)
    per_job = []
    for job, pred in zip(test_jobs, predictions):
        expected = set(job["expected_categories"])
        predicted = set(pred["category_names"])
        per_job.append({
            "title": job["title"],
            "expected": sorted(expected),
            "predicted": sorted(predicted),
            "false_positives": sorted(predicted - expected),
            "false_negatives": sorted(expected - predicted),
            "exact_match": expected == predicted,
            "top_score": pred["categories"][0]["score"] if pred["categories"] else 0,
            "top_signals": pred["categories"][0].get("matched_signals", [])[:6] if pred["categories"] else [],
        })
    base["per_job"] = per_job
    return base


def compare_evaluations(
  before: dict[str, Any],
  after: dict[str, Any],
) -> dict[str, Any]:
    """Compare two evaluation results for regression tracking."""
    delta = {}
    for key in before.get("metrics", {}):
        if key in after.get("metrics", {}):
            delta[key] = round(after["metrics"][key] - before["metrics"][key], 4)

    fixed = []
    regressed = []
    for b, a in zip(before.get("per_job", []), after.get("per_job", [])):
        if not b["exact_match"] and a["exact_match"]:
            fixed.append(a["title"])
        elif b["exact_match"] and not a["exact_match"]:
            regressed.append(a["title"])

    return {
        "metric_delta": delta,
        "fixed_jobs": fixed,
        "regressed_jobs": regressed,
        "before_metrics": before.get("metrics"),
        "after_metrics": after.get("metrics"),
    }


def run_benchmark(
    test_jobs: list[dict[str, Any]],
    classify_fn: Callable[[str, str], dict[str, Any]],
) -> dict[str, Any]:
    """Run classifier on test set and return detailed evaluation."""
    predictions = [classify_fn(job["title"], job["description"]) for job in test_jobs]
    return evaluate_with_details(test_jobs, predictions)


def _manual_per_category(y_true, y_pred, all_labels):
    per = {}
    for cat in all_labels:
        tp = fp = fn = 0
        for true, pred in zip(y_true, y_pred):
            in_true = cat in true
            in_pred = cat in pred
            if in_true and in_pred:
                tp += 1
            elif not in_true and in_pred:
                fp += 1
            elif in_true and not in_pred:
                fn += 1
        p = tp / (tp + fp) if (tp + fp) else 0.0
        r = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = 2 * p * r / (p + r) if (p + r) else 0.0
        per[cat] = {"tp": tp, "fp": fp, "fn": fn, "precision": round(p, 3), "recall": round(r, 3), "f1": round(f1, 3)}
    return per


def _manual_micro_macro(y_true, y_pred, all_labels):
    per = _manual_per_category(y_true, y_pred, all_labels)
    tp = sum(v["tp"] for v in per.values())
    fp = sum(v["fp"] for v in per.values())
    fn = sum(v["fn"] for v in per.values())
    p_micro = tp / (tp + fp) if (tp + fp) else 0.0
    r_micro = tp / (tp + fn) if (tp + fn) else 0.0
    f1_micro = 2 * p_micro * r_micro / (p_micro + r_micro) if (p_micro + r_micro) else 0.0
    ps = [v["precision"] for v in per.values() if (v["tp"] + v["fp"] + v["fn"]) > 0]
    rs = [v["recall"] for v in per.values() if (v["tp"] + v["fp"] + v["fn"]) > 0]
    f1s = [v["f1"] for v in per.values() if (v["tp"] + v["fp"] + v["fn"]) > 0]
    subset = sum(set(t) == set(p) for t, p in zip(y_true, y_pred)) / len(y_true)
    return {
        "precision_micro": round(p_micro, 3),
        "recall_micro": round(r_micro, 3),
        "f1_micro": round(f1_micro, 3),
        "precision_macro": round(sum(ps) / len(ps), 3) if ps else 0.0,
        "recall_macro": round(sum(rs) / len(rs), 3) if rs else 0.0,
        "f1_macro": round(sum(f1s) / len(f1s), 3) if f1s else 0.0,
        "subset_accuracy": round(subset, 3),
    }


def _collect_errors(test_jobs, predictions):
    errors = {"false_positives": [], "false_negatives": [], "complete_misses": []}
    for job, pred in zip(test_jobs, predictions):
        expected = set(job["expected_categories"])
        predicted = set(pred["category_names"])
        fp = predicted - expected
        fn = expected - predicted
        if fp:
            errors["false_positives"].append({
                "title": job["title"],
                "expected": sorted(expected),
                "predicted": sorted(predicted),
                "extra": sorted(fp),
            })
        if fn:
            errors["false_negatives"].append({
                "title": job["title"],
                "expected": sorted(expected),
                "predicted": sorted(predicted),
                "missing": sorted(fn),
            })
        if not predicted and expected:
            errors["complete_misses"].append({
                "title": job["title"],
                "expected": sorted(expected),
            })
    return errors
