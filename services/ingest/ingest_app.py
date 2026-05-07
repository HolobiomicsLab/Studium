"""Ingest service — FastAPI app."""
from __future__ import annotations
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import uuid
import tempfile
from typing import Optional

from fastapi import FastAPI, HTTPException

from pydantic import BaseModel
try:
    from fastapi import File, Form, UploadFile
    from pdf_extractor import extract_pdf
    from bibtex_parser import parse_bibtex
    from doi_resolver import resolve_doi
    _CORPUS_INGEST_AVAILABLE = True
except (ImportError, RuntimeError):
    _CORPUS_INGEST_AVAILABLE = False
from ingest_schemas import IngestManifest, CorpusRef
from abs_reader import ABSCapsuleReader

app = FastAPI(title="Studium Ingest Service", version="1.0.0")


if _CORPUS_INGEST_AVAILABLE:
    @app.post("/ingest/corpus", response_model=IngestManifest)
    async def ingest_corpus(
        pdf: UploadFile = File(..., description="PDF file to ingest"),  # type: ignore[name-defined]
        bib: Optional[UploadFile] = File(default=None, description="Optional BibTeX file"),  # type: ignore[name-defined]
        target: str = Form(..., description="Target audience (e.g. L3, M1)"),  # type: ignore[name-defined]
        keywords: Optional[str] = Form(default=None),  # type: ignore[name-defined]
        doi_mode: str = Form(default="offline", description="'real' or 'offline'"),  # type: ignore[name-defined]
    ) -> IngestManifest:
        # Write PDF to temp file for extraction
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp_pdf:
            content = await pdf.read()
            tmp_pdf.write(content)
            tmp_pdf_path = tmp_pdf.name

        try:
            pdf_result = extract_pdf(tmp_pdf_path)  # type: ignore[name-defined]
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
                bib_entries = parse_bibtex(tmp_bib_path)  # type: ignore[name-defined]
            finally:
                os.unlink(tmp_bib_path)

            for entry in bib_entries:
                doi_val = entry.get("doi", "")
                resolved_meta = {}
                if doi_val:
                    resolved_meta = resolve_doi(doi_val, mode=doi_mode)  # type: ignore[name-defined,arg-type]
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
            pages_extracted=pdf_result["metadata"].get("pages", 0),  # type: ignore[name-defined]
            text_preview=pdf_result["markdown"][:500],  # type: ignore[name-defined]
            figures_count=len(pdf_result["figures"]),  # type: ignore[name-defined]
            references=refs,
            keywords=keywords,
            extractor=pdf_result["metadata"].get("extractor", "pymupdf"),  # type: ignore[name-defined]
        )
        return manifest


class ABSCapsuleRequest(BaseModel):
    capsule_path: str
    task_card_ids: Optional[list[str]] = None


@app.post("/ingest/abs-capsule")
def ingest_abs_capsule(request: ABSCapsuleRequest):
    """Ingère une capsule ABS et retourne un CorpusManifest."""
    reader = ABSCapsuleReader()
    capsule_data = reader.read(request.capsule_path, request.task_card_ids)

    refs = []
    # Référence principale : la capsule elle-même
    refs.append({
        "ref_id": f"abs-{uuid.uuid4().hex[:6]}",
        "ref_type": "abs_capsule",
        "title": f"ABS capsule: {request.capsule_path}",
        "abs_capsule_path": request.capsule_path,
        "prov_entity_uri": capsule_data.ro_crate_entity_uri,
        "resolved": True,
    })
    # Référence DOI si disponible
    if capsule_data.doi:
        refs.append({
            "ref_id": f"doi-{uuid.uuid4().hex[:6]}",
            "ref_type": "doi",
            "doi": capsule_data.doi,
            "prov_entity_uri": f"doi:{capsule_data.doi}",
            "resolved": True,
        })

    preview_parts = []
    for card in capsule_data.task_cards[:2]:
        preview_parts.append(card.task_description[:150])

    return {
        "manifest_id": f"abs-manifest-{uuid.uuid4().hex[:8]}",
        "target": "L3",
        "pages_extracted": len(capsule_data.task_cards),
        "text_preview": " ".join(preview_parts)[:500],
        "figures_count": 0,
        "references": refs,
        "corpus_refs": refs,
        "keywords": " ".join(s.name for s in capsule_data.skills[:5]),
        "extractor": "abs_capsule_reader",
    }
