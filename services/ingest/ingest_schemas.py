from __future__ import annotations
from typing import Optional, Any
from pydantic import BaseModel


class CorpusRef(BaseModel):
    ref_id: str
    ref_type: str  # "local_file" | "doi" | "offline"
    title: Optional[str] = None
    doi: Optional[str] = None
    resolved: bool = False


class IngestManifest(BaseModel):
    manifest_id: str
    target: str
    pages_extracted: int
    text_preview: str
    figures_count: int
    references: list[CorpusRef]
    keywords: Optional[str] = None
    extractor: str = "pymupdf"
