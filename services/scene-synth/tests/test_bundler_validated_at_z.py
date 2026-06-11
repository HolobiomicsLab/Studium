"""Author-time robustness: bundler must emit a 'Z'-suffixed UTC ``validated_at``.

Cross-language interop bug (eval-discovered): the TS runtime loader validates
``validated_at`` with Zod ``z.string().datetime()`` which, by default, REQUIRES a
trailing 'Z' (no numeric ``+00:00`` offset). Python's ``datetime.isoformat()``
emits ``...+00:00``, which Pydantic accepts but Zod REJECTS — so an authored
bundle round-trips in Python yet the TS ``LessonSession`` refuses to load it
without a Z-normalization workaround. The bundler must emit a Z-suffixed
timestamp so authored bundles load in the TS runtime WITHOUT the workaround.
"""
from __future__ import annotations

import json
import re
import zipfile
from datetime import datetime
from pathlib import Path

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from bundler import build_bundle
from scene_synth_schemas import IntroScene

# Zod's z.string().datetime() default grammar (no offset): RFC3339-ish, 'Z' required.
# Matches "2026-06-12T08:30:00Z" and optional fractional seconds "...12.345Z".
_ZOD_DATETIME = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$"
)


def _scenes() -> list:
    return [
        IntroScene(
            id="s0",
            type="intro",
            title="T",
            objective_refs=[],
            concept_refs=[],
            estimated_seconds=60,
            adaptation_hooks=[],
            markdown="hi",
        )
    ]


def _plan() -> dict:
    return {
        "lesson_id": "z-test",
        "plan_id": "plan-z-test",
        "title": "Z Test",
        "metadata": {
            "title": "Z Test",
            "target": "L3",
            "duration_minutes": 10,
            "language": "fr",
            "discipline": "test",
        },
        "concepts": [
            {
                "id": "c1",
                "title": "Concept 1",
                "description": "A concept.",
                "bloom_level_target": "understand",
            }
        ],
        "rules": [],
    }


_PROV_SEED = {"agent": "scene-synth", "version": "0.1.0", "validator": "test"}


def _read_validated_at(uri: str) -> str:
    path = Path(uri.removeprefix("file://"))
    with zipfile.ZipFile(path) as zf:
        return json.loads(zf.read("lesson.json"))["validated_at"]


def test_validated_at_ends_with_Z(tmp_path):
    uri = build_bundle(_plan(), _scenes(), tmp_path / "b.zip", _PROV_SEED)
    validated_at = _read_validated_at(uri)
    assert validated_at.endswith("Z"), validated_at
    assert "+00:00" not in validated_at


def test_validated_at_matches_zod_datetime_grammar(tmp_path):
    uri = build_bundle(_plan(), _scenes(), tmp_path / "b.zip", _PROV_SEED)
    validated_at = _read_validated_at(uri)
    assert _ZOD_DATETIME.match(validated_at), validated_at


def test_validated_at_parses_as_utc(tmp_path):
    uri = build_bundle(_plan(), _scenes(), tmp_path / "b.zip", _PROV_SEED)
    validated_at = _read_validated_at(uri)
    # Python's fromisoformat needs '+00:00' (not 'Z') prior to 3.11; normalize.
    parsed = datetime.fromisoformat(validated_at.replace("Z", "+00:00"))
    assert parsed.utcoffset() is not None
    assert parsed.utcoffset().total_seconds() == 0
