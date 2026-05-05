"""PDF extraction — PyMuPDF backend (MinerU fallback path, ADR 008)."""
from __future__ import annotations
import os
from typing import Any

try:
    import magic_pdf  # noqa: F401 — attempt MinerU
    _MINERU_AVAILABLE = True
except ImportError:
    _MINERU_AVAILABLE = False

import fitz  # PyMuPDF


def extract_pdf(path: str) -> dict[str, Any]:
    """Extract text, metadata and figure refs from a PDF.

    Returns:
        {
            "markdown": str,       # full text as markdown (headings best-effort)
            "metadata": dict,      # page count, title, author, etc.
            "figures": list[dict], # list of {page, index, bbox} for images
        }
    """
    if not os.path.exists(path):
        raise FileNotFoundError(f"PDF not found: {path}")

    if _MINERU_AVAILABLE:
        return _extract_mineru(path)
    return _extract_pymupdf(path)


def _extract_pymupdf(path: str) -> dict[str, Any]:
    doc = fitz.open(path)
    pages_md: list[str] = []
    figures: list[dict] = []

    for page_num, page in enumerate(doc):
        text = page.get_text("text")
        pages_md.append(text)
        for img_index, img in enumerate(page.get_images(full=True)):
            xref = img[0]
            bbox = page.get_image_bbox(img)
            figures.append({
                "page": page_num,
                "index": img_index,
                "xref": xref,
                "bbox": list(bbox),
            })

    metadata = dict(doc.metadata) if doc.metadata else {}
    metadata["pages"] = doc.page_count
    metadata["extractor"] = "pymupdf"

    return {
        "markdown": "\n\n".join(pages_md),
        "metadata": metadata,
        "figures": figures,
    }


def _extract_mineru(path: str) -> dict[str, Any]:  # pragma: no cover
    """MinerU extraction path — only reachable if magic_pdf is installed."""
    raise NotImplementedError("MinerU wrapper not yet implemented; install magic_pdf to enable.")
