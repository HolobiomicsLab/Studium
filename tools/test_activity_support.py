"""Tests for bounded scientific-support preparation and browser safety."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from activity_support import SupportValidationError, prepare_support


PNG_HEADER = b"\x89PNG\r\n\x1a\n"


def write_sidecar(path: Path, assets: list[dict[str, object]]) -> Path:
    """Write a support sidecar and return its path."""
    path.write_text(json.dumps({"render_assets": assets}), encoding="utf-8")
    return path


def asset_meta(alt: str, origin: str = "source") -> dict[str, str]:
    """Return the accessibility and origin metadata required by supports."""
    return {"alt": alt, "origin": origin}


def media_rights(scope: str = "course") -> dict[str, str]:
    """Return explicit authored rights claims for a media fixture."""
    return {
        "creator": "Fixture author",
        "license": "CC BY 4.0",
        "evidence_url": "urn:studium:test:rights-record",
        "scope": scope,
    }


def write_media(path: Path, kind: str) -> None:
    """Write a small signature-valid synthetic media fixture."""
    signatures = {
        "wav": b"RIFF\x00\x00\x00\x00WAVEfmt ",
        "mp3": b"ID3\x04\x00\x00\x00\x00\x00\x00",
        "mp4": b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isom",
        "webm": b"\x1a\x45\xdf\xa3\x9fB\x86\x81\x01",
    }
    path.write_bytes(signatures[kind] + b"synthetic fixture")


def test_prepare_support_inlines_image_and_preserves_canonical_shapes(tmp_path: Path) -> None:
    image = tmp_path / "figure.png"
    image.write_bytes(PNG_HEADER + b"bounded fixture")
    assets = [
        {
            "kind": "image",
            "title": "Source figure",
            "path": "figure.png",
            "provenance": "doi:10.0000/example, fig. 1",
            "meta": asset_meta("Two measured groups shown side by side."),
        },
        {
            "kind": "equation_latex",
            "title": "Response model",
            "payload": r"y = gx",
            "legend": [
                {"symbol": "y", "meaning": "response"},
                {"symbol": "g", "meaning": "gain"},
                {"symbol": "x", "meaning": "input"},
            ],
            "provenance": "Authored from the stated teaching model.",
            "meta": asset_meta("The response y equals gain g times input x."),
        },
        {
            "kind": "code",
            "title": "Reasoning map",
            "language": "mermaid",
            "payload": "flowchart LR\n evidence --> claim",
            "provenance": "Author-created diagram.",
            "meta": asset_meta("Evidence points to a bounded claim."),
        },
        {
            "kind": "mol_3d",
            "title": "Ethanol",
            "format": "smiles",
            "payload": "CCO",
            "provenance": "Author-supplied SMILES teaching input; structure rendering only.",
            "meta": asset_meta("Two-dimensional skeletal formula of ethanol."),
        },
    ]

    prepared = prepare_support(write_sidecar(tmp_path / "support.json", assets))

    assert [asset["kind"] for asset in prepared] == ["image", "equation_latex", "code", "mol_3d"]
    assert prepared[0]["path"].startswith("data:image/png;base64,")
    assert set(prepared[0]) <= {"kind", "title", "payload", "path", "language", "format", "legend", "provenance", "meta"}
    assert prepared[1]["legend"] == assets[1]["legend"]
    assert assets[0]["path"] == "figure.png"


def test_prepare_support_adds_brief_ai_image_notice(tmp_path: Path) -> None:
    image = tmp_path / "generated.png"
    image.write_bytes(PNG_HEADER + b"generated fixture")
    sidecar = write_sidecar(
        tmp_path / "support.json",
        [{
            "kind": "image",
            "path": "generated.png",
            "provenance": "Generated locally for explanation; author reviewed.",
            "meta": {
                **asset_meta("Illustrative cell membrane cross-section.", "generated"),
                "ai_disclaimer": "",
            },
        }],
    )

    [prepared] = prepare_support(sidecar)

    assert prepared["meta"]["ai_disclaimer"] == "AI-generated image; details may be inaccurate."


@pytest.mark.parametrize(
    ("asset", "match"),
    [
        ({"kind": "image", "path": "../outside.png", "provenance": "x", "meta": asset_meta("x")}, "inside"),
        ({"kind": "image", "path": "figure.svg", "provenance": "x", "meta": asset_meta("x")}, "raster"),
        ({"kind": "image", "path": "data:image/png;base64,R0lGODlh", "provenance": "x", "meta": asset_meta("x")}, "does not match"),
        ({"kind": "code", "language": "mermaid", "payload": "click A https://example.org", "provenance": "x", "meta": asset_meta("x")}, "unsafe Mermaid"),
        ({"kind": "code", "language": "mermaid", "payload": "flowchart LR\nA[<script>x</script>]", "provenance": "x", "meta": asset_meta("x")}, "unsafe Mermaid"),
        ({"kind": "mol_3d", "format": "xyz", "payload": "1\nX", "provenance": "x", "meta": asset_meta("x")}, "SMILES"),
        ({"kind": "svg", "payload": "<svg/>", "provenance": "x", "meta": asset_meta("x")}, "supported"),
        ({"kind": "equation_latex", "payload": "x", "path": "x.png", "provenance": "x", "meta": asset_meta("x")}, "exactly one"),
        ({"kind": "equation_latex", "payload": "x", "path": None, "provenance": "x", "meta": asset_meta("x")}, "path"),
        ({"kind": "equation_latex", "title": 7, "payload": "x", "provenance": "x", "meta": asset_meta("x")}, "title"),
        ({"kind": "equation_latex", "payload": "x", "legend": [], "provenance": "x", "meta": asset_meta("x")}, "legend"),
        ({"kind": "equation_latex", "payload": "x", "legend": [{"symbol": " ", "meaning": "value"}], "provenance": "x", "meta": asset_meta("x")}, "symbol"),
        ({"kind": "equation_latex", "payload": "x", "legend": [{"symbol": "x", "meaning": ""}], "provenance": "x", "meta": asset_meta("x")}, "meaning"),
        ({"kind": "code", "language": 7, "payload": "flowchart LR\nA-->B", "provenance": "x", "meta": asset_meta("x")}, "language"),
        ({"kind": "mol_3d", "format": 7, "payload": "CCO", "provenance": "x", "meta": asset_meta("x")}, "format"),
        ({"kind": "equation_latex", "payload": "x", "meta": asset_meta("x")}, "provenance"),
        ({"kind": "equation_latex", "payload": "x", "provenance": "x", "meta": {}}, "alt"),
    ],
)
def test_prepare_support_rejects_unsafe_or_ambiguous_assets(
    tmp_path: Path, asset: dict[str, object], match: str
) -> None:
    (tmp_path / "figure.svg").write_text("<svg/>", encoding="utf-8")

    with pytest.raises(SupportValidationError, match=match):
        prepare_support(write_sidecar(tmp_path / "support.json", [asset]))


def test_browser_module_rejects_active_mermaid_and_accepts_scientific_examples() -> None:
    module_path = Path(__file__).parents[1] / "ui" / "scientific-support.mjs"
    script = """
      const { isSafeMermaidSource, validateSupportAsset } = await import(process.argv[1]);
      const good = isSafeMermaidSource('mindmap\\n  root((Evidence))\\n    Claim');
      const bad = [
        'click A https://example.org',
        'flowchart LR\\nA[<svg onload=alert(1)>]',
        '%%{init: {securityLevel: \\"loose\\"}}%%\\nflowchart LR\\nA-->B'
      ].every((value) => !isSafeMermaidSource(value));
      const molecule = validateSupportAsset({
        kind:'mol_3d', format:'smiles', payload:'CCO', provenance:'Original simple teaching input.',
        meta:{alt:'Two-dimensional skeletal formula of ethanol.'}
      });
      const equation = validateSupportAsset({
        kind:'equation_latex', payload:'y=gx', legend:[{symbol:'y', meaning:'response'}], provenance:'Authored.',
        meta:{alt:'The response equals gain times input.'}
      });
      const malformedLegend = validateSupportAsset({
        kind:'equation_latex', payload:'y=gx', legend:[], provenance:'Authored.',
        meta:{alt:'The response equals gain times input.'}
      });
      if (!good || !bad || molecule !== '' || equation !== '' || malformedLegend === '') process.exit(1);
    """

    result = subprocess.run(
        ["node", "--input-type=module", "--eval", script, module_path.as_uri()],
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr


def test_prepare_support_enforces_aggregate_image_budget(tmp_path: Path) -> None:
    assets = []
    for index in range(3):
        image = tmp_path / f"figure-{index}.png"
        image.write_bytes(PNG_HEADER + b"0" * (4 * 1024 * 1024))
        assets.append({
            "kind": "image",
            "path": image.name,
            "provenance": f"Local bounded fixture {index}.",
            "meta": asset_meta(f"Fixture image {index}."),
        })

    with pytest.raises(SupportValidationError, match="aggregate"):
        prepare_support(write_sidecar(tmp_path / "support.json", assets))


def test_prepare_support_inlines_audio_video_captions_and_rights(tmp_path: Path) -> None:
    write_media(tmp_path / "voice.wav", "wav")
    write_media(tmp_path / "clip.mp4", "mp4")
    (tmp_path / "clip.vtt").write_text("WEBVTT\n\n00:00.000 --> 00:01.000\nMeasured sample.\n", encoding="utf-8")
    assets = [
        {
            "kind": "audio",
            "path": "voice.wav",
            "provenance": "Synthetic local narration fixture.",
            "meta": {
                **asset_meta("Audio explanation of the measured sample."),
                "transcript": "The measured sample is shown first.",
                "rights": {"creator": "unknown", "license": "unknown", "evidence_url": "unknown", "scope": "private"},
            },
        },
        {
            "kind": "video",
            "path": "clip.mp4",
            "provenance": "Synthetic local motion fixture.",
            "meta": {
                **asset_meta("Short video of the measured sample."),
                "transcript": "The measured sample remains still.",
                "captions_path": "clip.vtt",
                "captions_language": "en",
                "rights": media_rights(),
                "placement": "before_prediction",
            },
        },
    ]

    audio, video = prepare_support(write_sidecar(tmp_path / "support.json", assets))

    assert audio["path"].startswith("data:audio/wav;base64,")
    assert audio["meta"]["rights"]["scope"] == "private"
    assert video["path"].startswith("data:video/mp4;base64,")
    assert video["meta"]["captions_data_uri"].startswith("data:text/vtt;base64,")
    assert "captions_path" not in video["meta"]
    assert video["meta"]["rights"] == media_rights()
    assert video["meta"]["placement"] == "before_prediction"


def test_prepare_support_validates_passive_generation_prompt(tmp_path: Path) -> None:
    prompt = {
        "kind": "protocol_md",
        "format": "studium-media-prompt",
        "payload": "Create a silent, labelled close-up of the supplied teaching specimen.",
        "language": "en",
        "provenance": "Teacher-reviewed media request.",
        "meta": {
            "alt": "Generation instructions for an optional specimen video.",
            "generation": {
                "expected_output": "video",
                "expected_format": "mp4",
                "placement": "after_prediction",
                "download_filename": "specimen-video-prompt.txt",
                "output_filename": "specimen-video.mp4",
                "activity_id": "activity-1",
                "activity_sha256": "a" * 64,
                "language": "en",
                "pedagogical_goal": "Show the specimen without revealing the judgment.",
                "source_refs": ["source-1"],
                "text_fallback": "A close-up of the labelled specimen.",
                "accessibility": "Silent video with captions and transcript required.",
            },
        },
    }

    assert prepare_support(write_sidecar(tmp_path / "prompt.json", [prompt])) == [prompt]


def test_prepare_support_accepts_mp3_webm_and_fixes_generated_notices(tmp_path: Path) -> None:
    write_media(tmp_path / "voice.mp3", "mp3")
    write_media(tmp_path / "clip.webm", "webm")
    (tmp_path / "clip.vtt").write_text("WEBVTT\n\n00:00.000 --> 00:01.000\nLocal fixture.\n", encoding="utf-8")
    generated = lambda alt: {**asset_meta(alt, "generated"), "transcript": alt, "rights": media_rights(), "ai_disclaimer": "replace me"}
    assets = [
        {"kind": "audio", "path": "voice.mp3", "provenance": "Synthetic fixture.", "meta": generated("Generated voice fixture.")},
        {"kind": "video", "path": "clip.webm", "provenance": "Synthetic fixture.", "meta": {**generated("Generated video fixture."), "captions_path": "clip.vtt", "captions_language": "en"}},
    ]

    audio, video = prepare_support(write_sidecar(tmp_path / "support.json", assets))

    assert audio["path"].startswith("data:audio/mpeg;base64,")
    assert video["path"].startswith("data:video/webm;base64,")
    assert audio["meta"]["ai_disclaimer"] == "AI-generated audio; details may be inaccurate."
    assert video["meta"]["ai_disclaimer"] == "AI-generated video; details may be inaccurate."


def test_prepare_support_rejects_media_over_item_limit(tmp_path: Path) -> None:
    media = tmp_path / "voice.wav"
    with media.open("wb") as stream:
        stream.write(b"RIFF\x00\x00\x00\x00WAVE")
        stream.truncate(20 * 1024 * 1024 + 1)
    asset = {"kind": "audio", "path": media.name, "provenance": "Oversize fixture.", "meta": {**asset_meta("Oversize audio."), "transcript": "Audio transcript.", "rights": media_rights()}}

    with pytest.raises(SupportValidationError, match="size limit"):
        prepare_support(write_sidecar(tmp_path / "support.json", [asset]))


@pytest.mark.parametrize(
    ("asset", "match"),
    [
        ({"kind": "audio", "path": "../voice.wav", "provenance": "x", "meta": {**asset_meta("x"), "transcript": "x", "rights": media_rights()}}, "inside"),
        ({"kind": "audio", "path": "voice.mp3", "provenance": "x", "meta": {**asset_meta("x"), "transcript": "x", "rights": media_rights()}}, "content"),
        ({"kind": "video", "path": "clip.mp4", "provenance": "x", "meta": {**asset_meta("x"), "transcript": "x", "rights": media_rights()}}, "captions"),
        ({"kind": "video", "path": "clip.mp4", "provenance": "x", "meta": {**asset_meta("x"), "transcript": "x", "captions_path": "active.vtt", "captions_language": "en", "rights": media_rights()}}, "active"),
        ({"kind": "audio", "path": "voice.wav", "provenance": "x", "meta": {**asset_meta("x"), "transcript": "", "rights": media_rights()}}, "transcript"),
        ({"kind": "audio", "path": "voice.wav", "provenance": "x", "meta": {**asset_meta("x"), "transcript": "x", "rights": {**media_rights(), "scope": "world"}}}, "scope"),
        ({"kind": "image", "path": "figure.png", "provenance": "x", "meta": {**asset_meta("x"), "rights": {**media_rights(), "scope": "world"}}}, "scope"),
        ({"kind": "audio", "path": "voice.wav", "provenance": "x", "meta": {**asset_meta("x"), "transcript": "x", "rights": {**media_rights(), "license": "unknown"}}}, "private"),
        ({"kind": "audio", "path": "voice.wav", "provenance": "x", "meta": {**asset_meta("x"), "transcript": "x", "rights": media_rights(), "placement": "during_answer"}}, "placement"),
        ({"kind": "protocol_md", "format": "markdown", "payload": "make media", "provenance": "x", "meta": {"alt": "x"}}, "studium-media-prompt"),
    ],
)
def test_prepare_support_rejects_unsafe_media_profiles(
    tmp_path: Path, asset: dict[str, object], match: str
) -> None:
    write_media(tmp_path / "voice.wav", "wav")
    write_media(tmp_path / "voice.mp3", "wav")
    write_media(tmp_path / "clip.mp4", "mp4")
    (tmp_path / "figure.png").write_bytes(PNG_HEADER + b"fixture")
    (tmp_path / "active.vtt").write_text("WEBVTT\n\n<script>alert(1)</script>\n", encoding="utf-8")

    with pytest.raises(SupportValidationError, match=match):
        prepare_support(write_sidecar(tmp_path / "support.json", [asset]))
