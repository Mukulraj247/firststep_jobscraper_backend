"""
Pydantic models for the Job Tagger API.
"""
from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Any, Literal


class UploadResponse(BaseModel):
    """Response after file upload — confirms jobs loaded."""
    filename: str
    total_jobs: int
    format_detected: str


class ClassifyRequest(BaseModel):
    """Request to classify loaded jobs (lab UI)."""
    max_categories: int | None = Field(default=None, ge=1, le=30)
    refine_with_tfidf: bool = Field(default=False)
    min_tfidf_similarity: float = Field(default=0.08, ge=0.0, le=1.0)
    ui_mode: bool = Field(default=False)
    max_badges: int = Field(default=2, ge=1, le=30)
    use_ml: bool = Field(default=False)


class SingleJobRequest(BaseModel):
    """Request to classify one job by title and description."""
    id: str | None = Field(default=None, description="Optional caller id (echoed back)")
    title: str = Field(min_length=1)
    description: str = Field(default="")
    max_categories: int | None = Field(default=None, ge=1, le=30)
    refine_with_tfidf: bool = Field(default=False)
    min_tfidf_similarity: float = Field(default=0.08, ge=0.0, le=1.0)
    ui_mode: bool = Field(default=False)
    max_badges: int = Field(default=2, ge=1, le=30)
    use_ml: bool = Field(default=False)


class BatchJobItem(BaseModel):
    """One job in a batch classify request."""
    id: str | None = None
    title: str = Field(min_length=1)
    description: str = Field(default="")


class BatchClassifyRequest(BaseModel):
    """Stateless batch classify — Scout-X production contract."""
    jobs: list[BatchJobItem] = Field(min_length=1)
    use_ml: bool = Field(default=False)
    max_categories: int | None = Field(default=None, ge=1, le=30)
    refine_with_tfidf: bool = Field(default=False)
    min_tfidf_similarity: float = Field(default=0.08, ge=0.0, le=1.0)
    ui_mode: bool = Field(default=False)
    max_badges: int = Field(default=2, ge=1, le=30)


class HealthResponse(BaseModel):
    """Health check with rules metadata."""
    status: str
    rules_path: str
    rules_exists: bool
    category_count: int
    frozen_category_count: int
    classifier_version: str
    rules_version: str
    sklearn_available: bool = False
    ml_model_loaded: bool = False


class CategoriesResponse(BaseModel):
    """Frozen taxonomy list for Scout-X filters."""
    categories: list[str]
    count: int
    classifier_version: str
    rules_version: str


class CategoryDetail(BaseModel):
    """Detailed category result for a single job."""
    name: str
    score: int | float
    matched_signals: list[str]
    signal_count: int
    reason: str
    coverage: float | None = None
    title_matched: bool | None = None
    tfidf_score: float | None = None
    ml_confidence: float | None = None
    source: Literal["rules", "ml", "rules+ml"] | None = None


class JobResult(BaseModel):
    """Classification result for a single job (Scout-X envelope)."""
    id: str | None = None
    source_index: int = 0
    title: str
    description: str
    categories: list[str]
    category_details: list[CategoryDetail]
    untagged: bool = False
    method: Literal["rules", "rules+ml"] = "rules"
    rules_version: str = ""
    classifier_version: str = ""
    refined: bool = False
    removed_by_tfidf: list[str] = []
    ml_applied: bool = False
    low_confidence: bool = False
    ml_status: str = "off"
    untagged_reason: str | None = None
    note: str | None = None


class StatsResponse(BaseModel):
    """Category distribution stats."""
    total_jobs: int
    tagged_jobs: int
    untagged_jobs: int
    category_counts: dict[str, int]
    avg_categories_per_job: float
    avg_score: float | None = None


class MlStatusResponse(BaseModel):
    """ML model status for lab UI."""
    available: bool
    loaded: bool
    model_path: str | None = None
    meta: dict[str, Any] | None = None
    low_confidence_threshold: int = 16
    sklearn_available: bool = False
