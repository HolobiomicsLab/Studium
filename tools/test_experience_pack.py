"""`experience_packet.py pack`: one distributable zip from an approved lesson folder."""
from __future__ import annotations

import json
import os
import sys
import zipfile
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parent
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

from experience_packet import check_response, main, prepare_packet  # noqa: E402

EXAMPLE = TOOLS.parent / "examples" / "literature-experience"


def _fill(value: object) -> object:
    if isinstance(value, dict):
        return {key: _fill(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_fill(item) for item in value]
    if isinstance(value, str) and (value.lstrip().startswith("TODO") or "TODO:" in value):
        return "Finished authored content grounded in the cited passage."
    return value


def _build_lesson(tmp_path: Path, *, language: str | None = None) -> Path:
    """A finished teacher lesson folder (not yet approved), built by the tool's own steps."""
    from experience_packet import build_lesson_bundle

    packet = tmp_path / "packet"
    prepare_packet(passages_path=EXAMPLE / "passages.json", output_dir=packet, title="Spectral evidence", target=None)
    course = tmp_path / "course"
    check_response(packet_dir=packet, response_path=EXAMPLE / "author-response.json", output_dir=course)
    folder = tmp_path / "lesson-folder"
    folder.mkdir()
    lesson = build_lesson_bundle(course_dir=course, output_path=folder / "lesson.json")
    bundle = _fill(json.loads(lesson.read_text()))
    if language is not None:
        bundle["metadata"]["language"] = language
    lesson.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return lesson


def _approve(lesson: Path, name: str = "Marie Curie") -> None:
    assert main(["approve", "--bundle", str(lesson), "--validated-by", name]) == 0


@pytest.fixture(autouse=True)
def _ephemeral(monkeypatch, tmp_path):
    monkeypatch.setenv("STUDIUM_EPHEMERAL", "1")
    monkeypatch.setenv("STUDIUM_HOME", str(tmp_path / "studium-home"))


@pytest.fixture
def approved(tmp_path: Path) -> Path:
    lesson = _build_lesson(tmp_path)
    assets = lesson.parent / "assets"
    (assets / "img").mkdir(parents=True)
    (assets / "b.txt").write_bytes(b"bee")
    (assets / "a.txt").write_bytes(b"ay")
    (assets / "img" / "c.bin").write_bytes(b"\x00\x01")
    (assets / ".DS_Store").write_bytes(b"junk")
    _approve(lesson)
    return lesson


def _pack(lesson: Path, out: Path, *extra: str) -> int:
    return main(["pack", "--bundle", str(lesson), "--out", str(out), *extra])


def _bundle_id(lesson: Path) -> str:
    return json.loads(lesson.read_text())["bundle_id"]


def test_archive_holds_lesson_approval_and_sorted_assets_byte_identical(approved, tmp_path, capsys):
    out = tmp_path / "out"
    out.mkdir()
    assert _pack(approved, out) == 0
    archive = out / f"{_bundle_id(approved)}.studium.zip"
    with zipfile.ZipFile(archive) as z:
        assert z.namelist() == ["lesson.json", "approval.json", "assets/a.txt", "assets/b.txt", "assets/img/c.bin"]
        assert all(info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) for info in z.infolist())
        assert z.read("lesson.json") == approved.read_bytes()
        assert z.read("approval.json") == (approved.parent / "approval.json").read_bytes()
        assert z.read("assets/a.txt") == b"ay"
        assert z.read("assets/img/c.bin") == b"\x00\x01"
    assert str(archive) in capsys.readouterr().out


def test_reviews_community_and_hidden_files_are_not_packed(approved, tmp_path):
    (approved.parent / "community").mkdir()
    (approved.parent / "community" / "note.json").write_text("{}")
    (approved.parent / ".DS_Store").write_bytes(b"x")
    assert (approved.parent / "reviews").is_dir()  # approve wrote a receipt there
    out = tmp_path / "out"
    out.mkdir()
    assert _pack(approved, out) == 0
    with zipfile.ZipFile(out / f"{_bundle_id(approved)}.studium.zip") as z:
        names = z.namelist()
    assert not any(n.startswith(("reviews", "community")) or ".DS_Store" in n for n in names)
    assert not any(n.endswith("/") for n in names)


def test_without_approval_refuses_and_writes_nothing(tmp_path, capsys):
    lesson = _build_lesson(tmp_path)
    out = tmp_path / "out"
    out.mkdir()
    assert _pack(lesson, out) == 1
    assert list(out.iterdir()) == []
    assert "approve" in capsys.readouterr().err


def test_lesson_edited_after_approval_refuses_and_writes_nothing(approved, tmp_path, capsys):
    approved.write_bytes(approved.read_bytes() + b" ")
    out = tmp_path / "out"
    out.mkdir()
    assert _pack(approved, out) == 1
    assert list(out.iterdir()) == []
    assert "approve again" in capsys.readouterr().err


def test_symlink_under_assets_refuses(approved, tmp_path, capsys):
    target = tmp_path / "secret.txt"
    target.write_text("not for the course")
    os.symlink(target, approved.parent / "assets" / "link.txt")
    out = tmp_path / "out"
    out.mkdir()
    assert _pack(approved, out) == 1
    assert list(out.iterdir()) == []
    assert "link.txt" in capsys.readouterr().err


def test_existing_output_is_kept_without_force_and_replaced_with_it(approved, tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    archive = out / f"{_bundle_id(approved)}.studium.zip"
    archive.write_bytes(b"precious")
    assert _pack(approved, out) == 1
    assert archive.read_bytes() == b"precious"
    assert _pack(approved, out, "--force") == 0
    assert zipfile.is_zipfile(archive)


def test_out_may_name_the_file_itself(approved, tmp_path):
    target = tmp_path / "chosen.studium.zip"
    assert _pack(approved, target) == 0
    assert zipfile.is_zipfile(target)


def test_bad_bundle_id_refuses(approved, tmp_path, capsys):
    bundle = json.loads(approved.read_text())
    bundle["bundle_id"] = "../evil"
    approved.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    _approve(approved)
    out = tmp_path / "out"
    out.mkdir()
    assert _pack(approved, out) == 1
    assert list(out.iterdir()) == []


def test_instruction_follows_the_lesson_language_and_the_flag(tmp_path, capsys):
    english = _build_lesson(tmp_path / "en", language="en")
    french = _build_lesson(tmp_path / "fr", language="fr")
    _approve(english)
    _approve(french)
    out = tmp_path / "out"
    out.mkdir()
    capsys.readouterr()

    assert _pack(english, out) == 0
    text = capsys.readouterr().out
    assert "Validated by Marie Curie on " in text and "Install VS Code" in text
    assert "https://marketplace.visualstudio.com/items?itemName=holobiomicslab.studium-vscode" in text
    assert "Import a lesson file" in text and "Leçon :" not in text

    assert _pack(french, out, "--force") == 0
    text = capsys.readouterr().out
    assert "Validée par Marie Curie le " in text and "Installez VS Code" in text
    assert "Importer un fichier de leçon" in text and "Lesson:" not in text

    assert _pack(english, out, "--force", "--language", "fr") == 0
    assert "Installez VS Code" in capsys.readouterr().out
    assert _pack(french, out, "--force", "--language", "en") == 0
    assert "Install VS Code" in capsys.readouterr().out


def test_json_reports_path_id_hash_reviewer_and_asset_count(approved, tmp_path, capsys):
    out = tmp_path / "out"
    out.mkdir()
    capsys.readouterr()
    assert _pack(approved, out, "--json") == 0
    report = json.loads(capsys.readouterr().out)
    approval = json.loads((approved.parent / "approval.json").read_text())
    assert report["path"] == str((out / f"{_bundle_id(approved)}.studium.zip").resolve())
    assert report["bundle_id"] == _bundle_id(approved)
    assert report["sha256"] == approval["bundle_sha256"]
    assert report["reviewer"] == "Marie Curie"
    assert report["assets"] == 3
