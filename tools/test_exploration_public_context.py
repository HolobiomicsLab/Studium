"""The public-context whitelist accepts what the real host returns and nothing private.

The fixtures under tools/fixtures/operator-context/ are `get_operator_context` replies saved from the
real lesson-mcp server (synthetic learner, shipped fixtures), not hand-written look-alikes.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from exploration_public_context import validate_public_fields

FIXTURES = Path(__file__).parent / "fixtures" / "operator-context"
FILES = sorted(FIXTURES.glob("*.json"))


def _load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def test_the_fixture_set_covers_quiz_capsule_run_and_approval() -> None:
    contexts = [json.loads(path.read_text(encoding="utf-8")) for path in FILES]
    assert any(c["scene"]["type"] == "quiz" for c in contexts)
    assert any(c["run_manifest"] for c in contexts)
    assert any(c["notation"] for c in contexts)
    assert any(c["authoring"]["approval"]["recorded"] for c in contexts)


@pytest.mark.parametrize("path", FILES, ids=lambda p: p.name)
def test_every_real_host_reply_is_accepted(path: Path) -> None:
    validate_public_fields(json.loads(path.read_text(encoding="utf-8")))


@pytest.mark.parametrize("where", [
    lambda c: c.update(answer_key="PRIVATE"),
    lambda c: c["scene"].update(answer_key="PRIVATE"),
    lambda c: c["scene"]["choices"][0].update(correct=True),
    lambda c: c["authoring"].update(secret="PRIVATE"),
    lambda c: c["authoring"]["approval"].update(bundle_sha256="x"),
    lambda c: c["exploration"]["journal"].update(learner_notes="PRIVATE"),
    lambda c: c["notation"][0].update(answer="PRIVATE"),
    lambda c: c["notation"].append({"symbol": "x", "meaning": {"nested": "PRIVATE"}}),
    lambda c: c["authoring"].update(notice={"fr": "nested"}),
])
def test_private_or_nested_fields_stay_rejected(where) -> None:
    context = copy.deepcopy(_load("atomistique-quiz.json"))
    where(context)
    with pytest.raises(ValueError):
        validate_public_fields(context)
