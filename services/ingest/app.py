"""Ingest service — FastAPI app."""
from __future__ import annotations
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import uuid
import tempfile
from typing import Optional

from fastapi import FastAPI, File, Form, UploadFile, HTTPException

from pdf_extractor import extract_pdf
from bibtex_parser import parse_bibtex
from doi_resolver import resolve_doi
from ingest_schemas import IngestManifest, CorpusRef

app = FastAPI(title="Studium Ingest Service", version="1.0.0")


@app.post("/ingest/corpus", response_model=IngestManifest)
async def ingest_corpus(
    pdf: UploadFile = File(..., description="PDF file to ingest"),
    bib: Optional[UploadFile] = File(default=None, description="Optional BibTeX file"),
    target: str = Form(..., description="Target audience (e.g. L3, M1)"),
    keywords: Optional[str] = Form(default=None),
    doi_mode: str = Form(default="offline", description="'real' or 'offline'"),
) -> IngestManifest:
    # Write PDF to temp file for extraction
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp_pdf:
        content = await pdf.read()
        tmp_pdf.write(content)
        tmp_pdf_path = tmp_pdf.name

    try:
        pdf_result = extract_pdf(tmp_pdf_path)
    finally:
        os.unlink(tmp_pdf_path)

    refs: list[CorpusRef] = []

    # Add PDF as a local_file ref
    refs.append(CorpusRef(
        ref_id=f"pdf-{uuid.uuid4().hex[:8]}",
        ref_type="local_file",
        title=pdf.filename or "uploaded.pdf",
        resolved=True,
    ))

    # Parse BibTeX if provided
    if bib is not None:
        with tempfile.NamedTemporaryFile(suffix=".bib", delete=False, mode="wb") as tmp_bib:
            bib_content = await bib.read()
            tmp_bib.write(bib_content)
            tmp_bib_path = tmp_bib.name
        try:
            bib_entries = parse_bibtex(tmp_bib_path)
        finally:
            os.unlink(tmp_bib_path)

        for entry in bib_entries:
            doi_val = entry.get("doi", "")
            resolved_meta = {}
            if doi_val:
                resolved_meta = resolve_doi(doi_val, mode=doi_mode)  # type: ignore[arg-type]
            refs.append(CorpusRef(
                ref_id=entry["ref_id"],
                ref_type="doi" if doi_val else "local_file",
                title=entry.get("title") or resolved_meta.get("title"),
                doi=doi_val or None,
                resolved=resolved_meta.get("status") == "ok",
            ))

    manifest = IngestManifest(
        manifest_id=str(uuid.uuid4()),
        target=target,
        pages_extracted=pdf_result["metadata"].get("pages", 0),
        text_preview=pdf_result["markdown"][:500],
        figures_count=len(pdf_result["figures"]),
        references=refs,
        keywords=keywords,
        extractor=pdf_result["metadata"].get("extractor", "pymupdf"),
    )
    return manifest
