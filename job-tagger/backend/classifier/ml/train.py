"""Train OneVsRest LogisticRegression multi-label model."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..audit import FROZEN_CATEGORIES
from ..versioning import CLASSIFIER_VERSION, LOW_CONFIDENCE_THRESHOLD, rules_version
from .dataset import load_negative_jobs, load_test_jobs, load_benchmark_adversarial, training_jobs_excluding_negatives
from .features import build_vectorizer, title_weighted_text

DEFAULT_MODEL_DIR = Path(__file__).resolve().parents[3] / "models"


def _labels_matrix(jobs: list[dict[str, Any]], categories: list[str]) -> list[list[int]]:
    cat_index = {c: i for i, c in enumerate(categories)}
    y: list[list[int]] = []
    for job in jobs:
        row = [0] * len(categories)
        for lab in job.get("expected_categories") or []:
            if lab in cat_index:
                row[cat_index[lab]] = 1
        y.append(row)
    return y


def train_and_save(
    model_dir: Path | None = None,
    *,
    C: float = 2.0,
    max_iter: int = 1000,
) -> dict[str, Any]:
    from sklearn.linear_model import LogisticRegression
    from sklearn.multiclass import OneVsRestClassifier
    from sklearn.preprocessing import MultiLabelBinarizer
    import joblib

    model_dir = Path(model_dir) if model_dir else DEFAULT_MODEL_DIR
    model_dir.mkdir(parents=True, exist_ok=True)

    train_jobs = training_jobs_excluding_negatives()
    categories = list(FROZEN_CATEGORIES)
    texts = [title_weighted_text(j["title"], j.get("description", "")) for j in train_jobs]
    y_lists = [j.get("expected_categories") or [] for j in train_jobs]

    mlb = MultiLabelBinarizer(classes=categories)
    y = mlb.fit_transform(y_lists)

    vectorizer = build_vectorizer()
    x = vectorizer.fit_transform(texts)

    clf = OneVsRestClassifier(
        LogisticRegression(C=C, max_iter=max_iter, solver="liblinear", class_weight="balanced"),
        n_jobs=1,
    )
    clf.fit(x, y)

    artifact = {
        "vectorizer": vectorizer,
        "classifier": clf,
        "mlb": mlb,
        "categories": categories,
    }
    model_path = model_dir / "job_category_ml.joblib"
    joblib.dump(artifact, model_path)

    # Quick in-sample + holdout negative FP check
    from sklearn.metrics import f1_score

    y_pred = clf.predict(x)
    f1_micro = float(f1_score(y, y_pred, average="micro", zero_division=0))
    f1_macro = float(f1_score(y, y_pred, average="macro", zero_division=0))

    neg = load_negative_jobs()
    neg_texts = [title_weighted_text(j["title"], j.get("description", "")) for j in neg]
    if neg_texts:
        neg_pred = clf.predict(vectorizer.transform(neg_texts))
        neg_fp = int(neg_pred.sum())
    else:
        neg_fp = 0

    meta = {
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "classifier_version": CLASSIFIER_VERSION,
        "rules_version": rules_version(),
        "low_confidence_threshold": LOW_CONFIDENCE_THRESHOLD,
        "train_size": len(train_jobs),
        "core_size": len(load_test_jobs()),
        "adversarial_size": len(load_benchmark_adversarial()),
        "negative_holdout_size": len(neg),
        "categories": categories,
        "model_path": str(model_path),
        "metrics": {
            "train_f1_micro": round(f1_micro, 4),
            "train_f1_macro": round(f1_macro, 4),
            "negative_fp_label_count": neg_fp,
        },
        "hyperparams": {"C": C, "max_iter": max_iter, "solver": "liblinear"},
    }
    meta_path = model_dir / "ml_meta.json"
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return meta
