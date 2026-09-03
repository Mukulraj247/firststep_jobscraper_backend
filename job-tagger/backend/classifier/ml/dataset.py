"""Load labeled datasets for ML train/eval."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

# Prefer in-package copies; fall back to nootbook via path hack when developing.
_PKG_DATA = Path(__file__).resolve().parents[3] / "data" / "datasets"
_NOOTBOOK = Path(__file__).resolve().parents[4] / "nootbook"


def _load_module_jobs(module_path: Path, attr: str) -> list[dict[str, Any]]:
    import importlib.util

    spec = importlib.util.spec_from_file_location(module_path.stem, module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load {module_path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return list(getattr(mod, attr))


def load_test_jobs() -> list[dict[str, Any]]:
    jsonl = _PKG_DATA / "test_jobs.jsonl"
    if jsonl.exists():
        return _read_jsonl(jsonl)
    pkg = Path(__file__).resolve().parents[1] / "test_data.py"
    if pkg.exists():
        return _load_module_jobs(pkg, "TEST_JOBS")
    src = _NOOTBOOK / "job_category_test_data.py"
    return _load_module_jobs(src, "TEST_JOBS")


def load_benchmark_adversarial() -> list[dict[str, Any]]:
    jsonl = _PKG_DATA / "benchmark_adversarial.jsonl"
    if jsonl.exists():
        return _read_jsonl(jsonl)
    pkg = Path(__file__).resolve().parents[1] / "benchmark_adversarial.py"
    if pkg.exists():
        return _load_module_jobs(pkg, "BENCHMARK_ADVERSARIAL")
    src = _NOOTBOOK / "job_category_benchmark_adversarial.py"
    return _load_module_jobs(src, "BENCHMARK_ADVERSARIAL")


def load_negative_jobs() -> list[dict[str, Any]]:
    jsonl = _PKG_DATA / "negative_jobs.jsonl"
    if jsonl.exists():
        return _read_jsonl(jsonl)
    pkg = Path(__file__).resolve().parents[1] / "benchmark_adversarial.py"
    if pkg.exists():
        return _load_module_jobs(pkg, "NEGATIVE_JOBS")
    src = _NOOTBOOK / "job_category_benchmark_adversarial.py"
    return _load_module_jobs(src, "NEGATIVE_JOBS")


def load_all_labeled() -> list[dict[str, Any]]:
    """TEST_JOBS + BENCHMARK_ADVERSARIAL (includes negatives/conflicts)."""
    return list(load_test_jobs()) + list(load_benchmark_adversarial())


def training_jobs_excluding_negatives() -> list[dict[str, Any]]:
    """All labeled jobs except NEGATIVE_JOBS titles (held out for FP monitor)."""
    neg_titles = {j["title"] for j in load_negative_jobs()}
    return [j for j in load_all_labeled() if j["title"] not in neg_titles]


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
