"""Classifier and rules versioning for Scout-X-compatible responses."""
from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path

from .classifier import get_rules_path

CLASSIFIER_VERSION = "1.1.0"
LOW_CONFIDENCE_THRESHOLD = 16


@lru_cache(maxsize=1)
def rules_version(rules_path: str | None = None) -> str:
    """SHA-256 of the rules JSON file (sha256:<hex>)."""
    path = Path(rules_path) if rules_path else get_rules_path()
    if not path.exists():
        return "sha256:missing"
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return f"sha256:{digest}"


def clear_rules_version_cache() -> None:
    rules_version.cache_clear()


def version_meta() -> dict[str, str]:
    return {
        "classifier_version": CLASSIFIER_VERSION,
        "rules_version": rules_version(),
    }
