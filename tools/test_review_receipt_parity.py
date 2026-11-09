"""Python/TypeScript parity of the review fingerprints (INT-STUDIUM-058, task 6.2).

`review_lesson` (TypeScript) compares its scene fingerprints with the ones `experience_packet.py`
writes into a review receipt. If the two canonical JSON forms differ by one byte, every scene reads
as `changed` forever. This gate runs `packages/lesson-session-host/scripts/fingerprint_dump.ts`
on a fixture of tricky values and on the real lessons under `fixtures/`, and compares byte for byte.
Like test_contract_parity.py, it skips nothing: without `tsx` it fails and says to run pnpm install.

Run: .venv/bin/python -m pytest tools/test_review_receipt_parity.py -q
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parent
REPO_ROOT = TOOLS.parent
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

from experience_packet import _canonical_json, _js_number, _scene_fingerprint  # noqa: E402

DUMP_SCRIPT = REPO_ROOT / "packages" / "lesson-session-host" / "scripts" / "fingerprint_dump.ts"
TRICKY = TOOLS / "fixtures" / "review-receipt" / "tricky-scenes.json"
REAL_LESSONS = sorted(
    p.relative_to(REPO_ROOT).as_posix()
    for p in (REPO_ROOT / "fixtures").glob("**/lesson.json")
)
TSX_CANDIDATES = (
    REPO_ROOT / "node_modules/.pnpm/node_modules/.bin/tsx",
    REPO_ROOT / "node_modules/.bin/tsx",
)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (1.0, "1"),
        (0.5, "0.5"),
        (1e-7, "1e-7"),
        (1e-6, "0.000001"),
        (1e21, "1e+21"),
        (1e20, "100000000000000000000"),
        (123.456, "123.456"),
        (1.5e-10, "1.5e-10"),
        (float(2**53 + 2), "9007199254740994"),
        (-0.0, "0"),
        (0.0, "0"),
        (0.1 + 0.2, "0.30000000000000004"),
        (-2.5, "-2.5"),
        (1e16, "10000000000000000"),
        (-1.25e-7, "-1.25e-7"),
        (1.7976931348623157e308, "1.7976931348623157e+308"),
        (5e-324, "5e-324"),
        (42, "42"),
        (-7, "-7"),
        (2**53 + 3, "9007199254740996"),  # an int beyond 2**53 is a double in JavaScript
        (True, "true"),
        (False, "false"),
    ],
)
def test_js_number_follows_ecmascript_number_to_string(value, expected):
    assert _js_number(value) == expected


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_js_number_refuses_what_json_cannot_hold(value):
    with pytest.raises(ValueError):
        _js_number(value)


def test_canonical_json_sorts_keys_by_code_point_and_keeps_non_ascii():
    value = {"z": 1, "é": [1.0, None, True], "Z": {"b": {}, "a": []}, "𝑥": "∆ é"}
    assert _canonical_json(value) == '{"Z":{"a":[],"b":{}},"z":1,"é":[1,null,true],"𝑥":"∆ é"}'


def _tsx() -> Path:
    for path in TSX_CANDIDATES:
        if path.exists():
            return path
    raise AssertionError(
        "tsx not found: run `pnpm install` at the repository root. This gate compares the "
        "TypeScript and Python fingerprints, so it cannot run without the TypeScript side."
    )


def _typescript_dump(lesson: Path) -> list[dict[str, str]]:
    proc = subprocess.run(
        [str(_tsx()), str(DUMP_SCRIPT), str(lesson)],
        capture_output=True, timeout=120, cwd=str(REPO_ROOT),
    )
    assert proc.returncode == 0, f"fingerprint_dump.ts failed: {proc.stderr.decode('utf-8', 'replace')[:800]}"
    return json.loads(proc.stdout.decode("utf-8"))


def _assert_parity(lesson: Path) -> int:
    scenes = json.loads(lesson.read_text(encoding="utf-8"))["scenes"]
    ts = _typescript_dump(lesson)
    assert len(ts) == len(scenes)
    for index, (scene, expected) in enumerate(zip(scenes, ts)):
        canonical = _canonical_json(scene)
        assert canonical == expected["canonical"], f"scene {index}: canonical JSON differs"
        assert hashlib.sha256(canonical.encode("utf-8")).hexdigest() == expected["sha256"]
        assert _scene_fingerprint(scene) == expected["sha256"], f"scene {index}: fingerprint differs"
    return len(scenes)


def test_tricky_fixture_fingerprints_match_typescript():
    assert _assert_parity(TRICKY) >= 4


@pytest.mark.parametrize("lesson", REAL_LESSONS)
def test_real_lesson_fingerprints_match_typescript(lesson):
    assert _assert_parity(REPO_ROOT / lesson) > 0


def test_the_real_lessons_are_found():
    # A glob that silently matches nothing would turn the parametrized gate into zero tests.
    assert "fixtures/atomistique-l1/lesson.json" in REAL_LESSONS
    assert len(REAL_LESSONS) >= 5
