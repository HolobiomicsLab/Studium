"""Render identity assets with the already installed PyMuPDF package.

The public SVGs remain the source for typography; MuPDF may substitute local
fonts when rendering text. The icon has only filled vector paths and a canvas.
"""

import json
from pathlib import Path
import struct

import fitz


BRAND = Path(__file__).resolve().parent


def render(source: Path, output: Path, scale: float = 1.0) -> dict[str, object]:
    """Write a PNG and confirm its dimensions from the actual PNG header."""
    with fitz.open(source) as document:
        pixmap = document[0].get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        pixmap.save(output)
    header = output.read_bytes()[:24]
    if header[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{output} is not a PNG")
    width, height = struct.unpack(">II", header[16:24])
    return {
        "file": output.name,
        "width": width,
        "height": height,
        "bytes": output.stat().st_size,
    }


def main() -> None:
    outputs = [render(BRAND / "studium-icon.svg", BRAND / "studium-icon.png")]
    if (outputs[0]["width"], outputs[0]["height"]) != (256, 256):
        raise ValueError("VSIX icon must be exactly 256 by 256 pixels")
    for theme in ("light", "dark"):
        outputs.append(render(
            BRAND.parent / f"hero-{theme}.svg", BRAND / f"hero-{theme}-880.png", 880 / 1280
        ))
    outputs.append(render(BRAND / "render-check.svg", BRAND / "render-check.png"))
    print(json.dumps({"renderer": "PyMuPDF / MuPDF", "version": fitz.VersionBind, "outputs": outputs}, indent=2))


if __name__ == "__main__":
    main()
