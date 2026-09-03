"""Load ML artifact and predict frozen categories."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..audit import FROZEN_CATEGORIES
from .features import title_weighted_text

DEFAULT_MODEL_DIR = Path(__file__).resolve().parents[3] / "models"
_CACHED: dict[str, Any] | None = None
_CACHED_PATH: str | None = None


def default_model_path() -> Path:
    return DEFAULT_MODEL_DIR / "job_category_ml.joblib"


def default_meta_path() -> Path:
    return DEFAULT_MODEL_DIR / "ml_meta.json"


def ml_model_available() -> bool:
    return default_model_path().exists()


def load_ml_meta() -> dict[str, Any] | None:
    path = default_meta_path()
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def get_artifact(force_reload: bool = False) -> dict[str, Any] | None:
    global _CACHED, _CACHED_PATH
    path = default_model_path()
    if not path.exists():
        _CACHED = None
        _CACHED_PATH = None
        return None
    key = str(path.resolve())
    if force_reload or _CACHED is None or _CACHED_PATH != key:
        import joblib

        _CACHED = joblib.load(path)
        _CACHED_PATH = key
    return _CACHED


def predict_ml(
    title: str,
    description: str,
    *,
    min_confidence: float = 0.35,
    max_labels: int = 5,
) -> list[dict[str, Any]]:
    """
    Return list of {name, ml_confidence, matched_signals, reason} constrained to frozen 33.
    """
    artifact = get_artifact()
    if artifact is None:
        return []

    vectorizer = artifact["vectorizer"]
    clf = artifact["classifier"]
    categories: list[str] = list(artifact.get("categories") or FROZEN_CATEGORIES)
    frozen = set(FROZEN_CATEGORIES)

    text = title_weighted_text(title, description)
    x = vectorizer.transform([text])

    # Prefer predict_proba when available
    scores: list[tuple[str, float]] = []
    if hasattr(clf, "predict_proba"):
        try:
            proba = clf.predict_proba(x)
            # OneVsRest returns list of arrays or 2d
            if isinstance(proba, list):
                for i, cat in enumerate(categories):
                    p = float(proba[i][0][1]) if proba[i].shape[1] > 1 else float(proba[i][0][0])
                    scores.append((cat, p))
            else:
                for i, cat in enumerate(categories):
                    scores.append((cat, float(proba[0][i])))
        except Exception:
            pred = clf.predict(x)[0]
            scores = [(cat, 1.0 if pred[i] else 0.0) for i, cat in enumerate(categories)]
    else:
        pred = clf.predict(x)[0]
        scores = [(cat, 1.0 if pred[i] else 0.0) for i, cat in enumerate(categories)]

    ranked = sorted(scores, key=lambda t: t[1], reverse=True)
    out: list[dict[str, Any]] = []
    for name, conf in ranked:
        if name not in frozen:
            continue
        if conf < min_confidence:
            continue
        out.append({
            "name": name,
            "score": round(conf * 10, 2),  # display-scale score
            "ml_confidence": round(conf, 4),
            "matched_signals": [f"ml:{name}"],
            "signal_count": 1,
            "reason": f"ML suggestion (confidence {conf:.3f})",
            "source": "ml",
            "title_matched": False,
        })
        if len(out) >= max_labels:
            break
    return out
