"""A bundle carries `null` only where the schema it is read by asks for one.

INT-STUDIUM-004. `packages/lesson-bundle-schema` declares its optional fields `.optional()`,
which accepts ABSENCE and rejects `null`. `bundler.build_bundle` dumped with
`exclude_none=False`, so every unset optional was written as `null` — and the runtime that
reads these bundles refused to parse them. That is why `fixtures/m6/demo-atomistique` sat
quarantined in `tools/bundle_lint.mjs`: it was the first bundle whose `evidence` was ever
populated, so it was the first to show a defect every bundle this emitter wrote had.

The repair is not "exclude every None". Three fields — `landmark`, `figure_path` and
`capsule_doi` — are declared `.nullable()` and NOT `.optional()` on the TS side
(`scenes.ts:133-138`): they must be present, and a `null` there is a fact about a run that
happened and produced no landmark. Dropping them would delete a real measurement in order to
remove a meaningless one.

So both directions are pinned here, and the first test is written as a DISCOVERY over the whole
emitted document rather than a list of the fields that were wrong today: a new optional field
added tomorrow is covered without anyone remembering to add it.
"""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pytest

from bundler import build_bundle
from scene_synth_schemas import ReferenceRun, ReferenceRunProvenance

# The only paths a bundle may carry a null on: `.nullable()` and not `.optional()` in scenes.ts.
PRESENT_AND_NULL = {"landmark", "figure_path", "capsule_doi"}


def _plan() -> dict:
    return {
        "lesson_id": "null-contract-001",
        "plan_id": "plan-null-contract",
        "metadata": {
            "title": "Contrat de nullité",
            "target": "L1",
            "duration_minutes": 10,
            "language": "fr",
            "discipline": "science",
        },
        "concepts": [
            {"id": "c1", "title": "C1", "description": "d", "bloom_level_target": "understand"}
        ],
        "rules": [],
    }


def _scene_with_partial_evidence() -> dict:
    """A scene whose evidence sets some optional fields and leaves others unset.

    `doi` and `year` are omitted from the reference, and `case_studies` / `abs_asset` from the
    evidence block — exactly the shape the M6 fixture has.
    """
    return {
        "id": "s1",
        "type": "concept",
        "title": "T",
        "markdown": "M",
        "objective_refs": [],
        "concept_refs": ["c1"],
        "estimated_seconds": 60,
        "adaptation_hooks": [],
        "evidence": {
            "bibliographic_refs": [
                {
                    "perspicacite_doc_id": "d1",
                    "title": "Un titre",
                    "authors": ["A"],
                    "excerpt": "e",
                    "relevance_score": 0.5,
                    "prov_derived_from": "urn:x",
                }
            ],
            "enrichment_metadata": {
                "enricher_version": "1",
                "perspicacite_mode_used": "basic",
                "timestamp": "2026-01-01T00:00:00Z",
                "degraded": False,
            },
        },
    }


def _null_paths(node: object, path: str = "") -> list[str]:
    """Every path in a JSON document whose value is null. Discovery, not a list."""
    found: list[str] = []
    if isinstance(node, dict):
        for key, value in node.items():
            here = f"{path}.{key}" if path else key
            if value is None:
                found.append(here)
            else:
                found.extend(_null_paths(value, here))
    elif isinstance(node, list):
        for i, value in enumerate(node):
            here = f"{path}[{i}]"
            if value is None:
                found.append(here)
            else:
                found.extend(_null_paths(value, here))
    return found


def _build(tmp_path: Path, scenes: list[dict]) -> dict:
    out = tmp_path / "bundle.zip"
    build_bundle(_plan(), scenes, out, {"agent": "test", "version": "0.0.1"})
    with zipfile.ZipFile(out) as zf:
        return json.loads(zf.read("lesson.json"))


def test_an_unset_optional_is_absent_and_not_null(tmp_path: Path) -> None:
    bundle = _build(tmp_path, [_scene_with_partial_evidence()])
    offenders = [p for p in _null_paths(bundle) if p.rsplit(".", 1)[-1] not in PRESENT_AND_NULL]
    assert offenders == [], (
        "these fields were emitted as null where the reading schema expects absence: "
        + ", ".join(offenders)
    )


def test_the_fields_that_were_set_survive(tmp_path: Path) -> None:
    """The symmetric trap: removing the nulls must not remove the evidence."""
    bundle = _build(tmp_path, [_scene_with_partial_evidence()])
    evidence = bundle["scenes"][0]["evidence"]
    assert evidence["bibliographic_refs"][0]["title"] == "Un titre"
    assert evidence["enrichment_metadata"]["enricher_version"] == "1"
    assert "abs_asset" not in evidence
    assert "doi" not in evidence["bibliographic_refs"][0]


def test_an_abs_asset_that_is_set_is_still_written(tmp_path: Path) -> None:
    scene = _scene_with_partial_evidence()
    scene["evidence"]["abs_asset"] = {
        "asset_type": "spectrum_viewer_svg",
        "payload_path": "abs-capsule/assets/x.svg",
        "abs_task_card_id": "task-x",
        "prov_derived_from": "urn:abs:task-card:task-x",
    }
    bundle = _build(tmp_path, [scene])
    asset = bundle["scenes"][0]["evidence"]["abs_asset"]
    assert asset["payload_path"] == "abs-capsule/assets/x.svg"
    # its own unset optional went away with the others
    assert "payload_inline" not in asset


@pytest.mark.parametrize("field", sorted(PRESENT_AND_NULL))
def test_a_run_that_produced_nothing_still_says_so(field: str) -> None:
    """`null` here is the measurement: the run happened and produced no landmark.

    An `exclude_none` dump would delete it, and the reading schema — which declares these
    `.nullable()`, not `.optional()` — would then reject the scene for a MISSING field. The
    repair for one direction must not open the other.
    """
    run = ReferenceRun(
        ran=True,
        passed=True,
        provenance=ReferenceRunProvenance(env="py3.13", cmd=["python", "run.py"]),
    )
    dumped = run.model_dump(mode="json", exclude_none=True)
    flat = {**dumped, **dumped["provenance"]}
    assert field in flat, f"{field} was dropped; the reading schema requires it to be present"
    assert flat[field] is None
