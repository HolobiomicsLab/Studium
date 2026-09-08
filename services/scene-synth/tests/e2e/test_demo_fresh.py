"""`demo-fresh.zip` — the bundle three E2E harnesses stage, and nothing used to create.

INT-STUDIUM-033/-034: A.10, C.8 and M5 all point `window.__test_bundle_path` at
`/tmp/studium-e2e/demo-fresh.zip`, and no script in the repository ever wrote that file, so
each of them could only have stopped at the library screen. `demo_fresh.bake()` writes it.

Two properties are pinned here, and the second is the load-bearing one:

1. the bake really runs the pipeline and produces a bundle the runtime can open;
2. the path the baker writes is the path the harnesses read — **discovered** from the spec
   files rather than restated, so moving the staging directory in one place and not the other
   fails here instead of in a WDIO log twenty minutes into a CI job.
"""

from __future__ import annotations

import json
import re
import zipfile
from pathlib import Path

import pytest

import demo_fresh
from scene_synth_schemas import LessonBundle

REPO_ROOT = Path(__file__).resolve().parents[4]
SPEC_DIR = REPO_ROOT / "apps" / "student-runtime" / "tests-e2e"

#: The one TypeScript file that *computes* the path instead of writing it out; every other
#: harness either imports it or spells the path literally.
DEFINITION = SPEC_DIR / "support" / "staged-bundle.ts"

#: An absolute path ending in the staged file name, as a harness spells it.
_STAGED_REF = re.compile(r"/[\w./-]*demo-fresh\.zip")

#: `${process.env.BUNDLE_DIR ?? "<dir>"}/<name>.zip` in the definition above.
_TS_DEFAULT = re.compile(
    r'process\.env\.BUNDLE_DIR\s*\?\?\s*"([^"]+)"\s*\}/([\w.\-]+\.zip)'
)


@pytest.fixture
def staged(tmp_path, monkeypatch) -> Path:
    """Bake once, into a temporary directory rather than over the machine's real staging dir."""
    monkeypatch.delenv("BUNDLE_DIR", raising=False)
    return demo_fresh.bake(tmp_path / "demo-fresh.zip")


def test_bake_writes_a_bundle_the_runtime_can_open(staged):
    assert staged.exists(), staged
    with zipfile.ZipFile(staged) as zf:
        names = set(zf.namelist())
        assert "lesson.json" in names
        assert "prov.json" in names
        bundle = LessonBundle.model_validate(json.loads(zf.read("lesson.json")))

    # The six types the harnesses walk. A bundle missing one stops A.10 mid-parcours on a
    # `[data-scene-type='…']` that never appears, which names the type but not the cause.
    assert {s.type for s in bundle.scenes} == set(demo_fresh.SCENE_TYPES)


def test_bake_leaves_exactly_one_file_at_the_destination(tmp_path, monkeypatch):
    # The orchestrator names its output `<lesson_id>-<uuid>.zip`. If the bake synthesised
    # straight into the staging directory, every run would leave another bundle behind and the
    # library screen — which lists a directory since INT-STUDIUM-034 — would grow a row per run.
    monkeypatch.delenv("BUNDLE_DIR", raising=False)
    dest = tmp_path / "staging" / "demo-fresh.zip"
    demo_fresh.bake(dest)
    demo_fresh.bake(dest)
    assert sorted(p.name for p in dest.parent.iterdir()) == ["demo-fresh.zip"]


def test_default_staged_path_follows_bundle_dir(monkeypatch, tmp_path):
    monkeypatch.delenv("BUNDLE_DIR", raising=False)
    assert demo_fresh.default_staged_path() == Path("/tmp/studium-e2e/demo-fresh.zip")
    monkeypatch.setenv("BUNDLE_DIR", str(tmp_path))
    assert demo_fresh.default_staged_path() == tmp_path / "demo-fresh.zip"


def test_the_typescript_default_is_the_path_the_baker_writes(monkeypatch):
    monkeypatch.delenv("BUNDLE_DIR", raising=False)
    assert DEFINITION.exists(), DEFINITION

    match = _TS_DEFAULT.search(DEFINITION.read_text(encoding="utf-8"))
    assert match, f"no `$BUNDLE_DIR ?? …/…zip` default found in {DEFINITION}"
    assert Path(match.group(1)) / match.group(2) == demo_fresh.default_staged_path()


def test_every_harness_reads_the_path_the_baker_writes(monkeypatch):
    monkeypatch.delenv("BUNDLE_DIR", raising=False)
    expected = str(demo_fresh.default_staged_path())

    found: dict[str, set[str]] = {}
    for path in sorted(SPEC_DIR.rglob("*.ts")):
        if path == DEFINITION:
            continue  # it computes the path; the test above checks that computation
        refs = set(_STAGED_REF.findall(path.read_text(encoding="utf-8")))
        if refs:
            found[str(path.relative_to(REPO_ROOT))] = refs

    assert found, f"no harness under {SPEC_DIR} stages {demo_fresh.STAGED_NAME} any more"
    wrong = {f: sorted(r) for f, r in found.items() if r != {expected}}
    assert not wrong, (
        f"these harnesses stage a path the baker does not write ({expected}): {wrong}"
    )
