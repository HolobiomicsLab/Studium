"""End-to-end test : ingest → plan → critic → export JSON valide.

Simule la démo CLI décrite dans le handoff unité 11.
Ne requiert aucun serveur en cours : utilise les modules directement.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../planner"))

import json
import pytest

FIXTURE_PDF = os.path.join(os.path.dirname(__file__), "../../../fixtures/m1/sample-corpus/sample.pdf")
FIXTURE_BIB = os.path.join(os.path.dirname(__file__), "../../../fixtures/m1/sample-corpus/sample.bib")
DOI_FILE = os.path.join(os.path.dirname(__file__), "../../../fixtures/m1/sample-corpus/doi.txt")


def test_e2e_ingest_to_plan_to_export(tmp_path):
    """Full pipeline: PDF + BibTeX → IngestManifest → LessonPlan → validated JSON."""
    from pdf_extractor import extract_pdf
    from bibtex_parser import parse_bibtex
    from doi_resolver import resolve_doi
    from mimosa_wrapper import generate
    from critic import review

    # Step 1: Ingest
    pdf_result = extract_pdf(FIXTURE_PDF)
    assert pdf_result["metadata"]["pages"] >= 1

    bib_entries = parse_bibtex(FIXTURE_BIB)
    assert len(bib_entries) >= 1

    corpus_refs = []
    for entry in bib_entries:
        doi = entry.get("doi", "")
        meta = resolve_doi(doi, mode="offline") if doi else {}
        corpus_refs.append({
            "ref_id": entry["ref_id"],
            "ref_type": "doi" if doi else "local_file",
            "doi": doi or None,
            "resolved": meta.get("status") == "ok",
        })

    manifest = {
        "manifest_id": "e2e-001",
        "target": "L3",
        "duration_minutes": 45,
        "language": "fr",
        "corpus_refs": corpus_refs,
        "text_preview": pdf_result["markdown"][:300],
    }

    # Step 2: Generate plan
    plan = generate(manifest, target="L3")
    assert plan.target == "L3"
    assert len(plan.learning_objectives) >= 1
    assert len(plan.scene_outlines) >= 1

    # Step 3: Critic
    critic_result = review(plan)
    assert 0.0 <= critic_result["score"] <= 1.0

    # Step 4: Export (simulate human validation)
    plan.critic_score = critic_result["score"]
    plan.critic_annotations = critic_result["annotations"]
    from schemas import PlanStatus
    plan.status = PlanStatus.approved
    plan.validated_by = "prof.test"

    export_path = tmp_path / f"lesson_plan_{plan.id}.json"
    export_data = plan.model_dump(mode="json")
    export_path.write_text(json.dumps(export_data, ensure_ascii=False, indent=2))

    # Validate exported JSON against Pydantic schema
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../../packages/lesson-plan-schema/python"))
    from lesson_plan_schema import LessonPlan
    loaded = LessonPlan(**json.loads(export_path.read_text()))
    assert loaded.status.value == "approved"
    assert loaded.validated_by == "prof.test"
    assert loaded.id == plan.id


def test_e2e_doi_from_fixture():
    """DOI in doi.txt should be resolvable (offline mode → status=offline is acceptable)."""
    with open(DOI_FILE) as f:
        doi = f.read().strip()
    from doi_resolver import resolve_doi
    result = resolve_doi(doi, mode="offline")
    assert result["doi"] == doi
    assert result["status"] in ("ok", "offline")


def test_e2e_plan_schema_conformance():
    """Generated plan must pass JSON Schema validation (lesson-plan-schema v1)."""
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../planner"))
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../../packages/lesson-plan-schema/python"))
    import json as _json

    from mimosa_wrapper import generate

    manifest = {
        "manifest_id": "schema-check",
        "target": "M1",
        "duration_minutes": 60,
        "language": "fr",
        "corpus_refs": [{"ref_id": "r1", "ref_type": "doi", "doi": "10.1073/x", "resolved": False}],
        "text_preview": "Test",
    }
    plan = generate(manifest, target="M1")
    plan_dict = plan.model_dump(mode="json")

    # Validate against JSON Schema via Pydantic re-parsing
    from lesson_plan_schema import LessonPlan as LPSchema
    validated = LPSchema(**plan_dict)
    assert validated.schema_version == "1.0"
