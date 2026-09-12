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
    assert set(prepared[0]) <= {"kind", "title", "payload", "path", "language", "format", "provenance", "meta"}
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
      if (!good || !bad || molecule !== '') process.exit(1);
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
