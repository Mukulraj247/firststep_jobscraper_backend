"""Title-weighted TF-IDF features for ML."""
from __future__ import annotations

from typing import Any

from ..classifier import canonicalize


def title_weighted_text(title: str, description: str) -> str:
    """Repeat title so title tokens weigh more in bag-of-words TF-IDF."""
    t = canonicalize(title or "")
    d = canonicalize(description or "")
    return f"{t} {t} {d}".strip()


def build_vectorizer() -> Any:
    from sklearn.feature_extraction.text import TfidfVectorizer

    return TfidfVectorizer(
        lowercase=True,
        token_pattern=r"(?u)\b[\w.]+\b",
        min_df=1,
        ngram_range=(1, 2),
        max_features=20000,
    )
