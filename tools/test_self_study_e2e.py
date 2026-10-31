from __future__ import annotations

import json
import subprocess
import sys
from copy import deepcopy
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / "examples" / "self-study-durkheim"
FIXTURE = ROOT / "tools" / "fixtures" / "self-study" / "durkheim-ch1.html"
PACKET_CLI = ROOT / "tools" / "experience_packet.py"
PYTHON = Path(sys.executable)
LINT = ROOT / "tools" / "bundle_lint.mjs"
VALIDATE = ROOT / "tools" / "bundle_validate.ts"
SCENE_BASE_FIELDS = (
    "id",
    "type",
    "title",
    "objective_refs",
    "concept_refs",
    "estimated_seconds",
    "adaptation_hooks",
)


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _run(command: list[str]) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stdout + result.stderr
    return result


def _run_packet(*arguments: str) -> subprocess.CompletedProcess[str]:
    return _run([str(PYTHON), str(PACKET_CLI), *arguments])


def _capture_passages(work: Path) -> Path:
    output = work / "passages.json"
    _run_packet(
        "passages",
        "--html",
        str(FIXTURE),
        "--title",
        "Les Règles de la méthode sociologique — chapitre I",
        "--license",
        "Public-Domain",
        "--out",
        str(output),
    )
    return output


def _assert_capture_matches_example(generated_path: Path) -> None:
    generated = _load_json(generated_path)
    committed = _load_json(EXAMPLE / "passages.json")
    assert Path(generated["origin_path"]).resolve() == FIXTURE.resolve()
    assert (EXAMPLE / committed["origin_path"]).resolve() == FIXTURE.resolve()
    generated["origin_path"] = committed["origin_path"]
    assert generated == committed


def _prepare_packet(work: Path, passages: Path) -> Path:
    packet = work / "packet"
    _run_packet(
        "prepare",
        "--passages",
        str(passages),
        "--out",
        str(packet),
        "--title",
        "Comprendre le fait social chez Durkheim",
        "--target",
        "Licence 1 — étude autonome",
        "--self-study",
    )
    return packet


def _check_response(work: Path, packet: Path) -> Path:
    course = work / "course"
    result = _run_packet(
        "check",
        "--packet",
        str(packet),
        "--response",
        str(EXAMPLE / "author-response.json"),
        "--out",
        str(course),
    )
    assert "CHECK OK" in result.stdout
    assert "production=2 (scene-comparison, scene-explain)" in result.stdout
    return course


def _build_skeleton(work: Path, course: Path) -> Path:
    skeleton = work / "lesson-skeleton.json"
    _run_packet(
        "bundle",
        "--course",
        str(course),
        "--out",
        str(skeleton),
        "--self-study",
    )
    return skeleton


def _assert_scene_bases_match(skeleton: dict, committed: dict) -> None:
    assert len(skeleton["scenes"]) == len(committed["scenes"])
    for generated_scene, filled_scene in zip(
        skeleton["scenes"], committed["scenes"], strict=True
    ):
        for field in SCENE_BASE_FIELDS:
            assert generated_scene[field] == filled_scene[field]


def _apply_committed_fill(work: Path, skeleton_path: Path) -> Path:
    skeleton = _load_json(skeleton_path)
    committed = _load_json(EXAMPLE / "lesson.json")
    _assert_scene_bases_match(skeleton, committed)
    finished = deepcopy(skeleton)
    finished["scenes"] = deepcopy(committed["scenes"])
    expected = deepcopy(committed)
    expected["validated_at"] = finished["validated_at"]
    assert finished == expected
    output = work / "lesson-filled.json"
    output.write_text(json.dumps(finished, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return output


@pytest.fixture(scope="module")
def _finished_bundle(tmp_path_factory: pytest.TempPathFactory) -> Path:
    work = tmp_path_factory.mktemp("self-study-durkheim")
    passages = _capture_passages(work)
    _assert_capture_matches_example(passages)
    packet = _prepare_packet(work, passages)
    course = _check_response(work, packet)
    skeleton = _build_skeleton(work, course)
    return _apply_committed_fill(work, skeleton)


def test_committed_artifacts_build_a_finished_lint_clean_lesson(
    _finished_bundle: Path,
) -> None:
    bundle = _load_json(_finished_bundle)
    assert "TODO" not in json.dumps(bundle, ensure_ascii=False)
    assert bundle["metadata"]["authoring"] == {
        "mode": "self_study",
        "author_is_learner": True,
    }
    assert bundle["validated_by"] == "SELF-STUDY — not teacher-validated"
    lint = _run(["node", str(LINT), str(_finished_bundle)])
    assert not any(line.startswith("ERROR  ") for line in lint.stdout.splitlines())


def test_finished_lesson_passes_typescript_schema(_finished_bundle: Path) -> None:
    # The tutorial's documented runner: the tsx that apps/lesson-mcp installs.
    tsx = ROOT / "apps" / "lesson-mcp" / "node_modules" / ".bin" / "tsx"
    if not tsx.exists():
        pytest.skip("TypeScript validation unavailable: run pnpm install first (no download here).")
    command = [str(tsx), str(VALIDATE.relative_to(ROOT)), str(_finished_bundle)]
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, check=False)
    output = result.stdout + result.stderr
    assert result.returncode == 0, output
    assert result.stdout.startswith("OK ")
