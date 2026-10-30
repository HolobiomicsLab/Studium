"""Rebuild Studium's vector identity from the shared design tokens.

Run from the repository root with `.venv/bin/python
docs/assets/brand/generate-assets.py`. Only the assets owned by this generator
are rewritten. Raster rendering is a separate, platform-specific step.
"""

from html import escape
import json
from pathlib import Path


BRAND = Path(__file__).resolve().parent
ASSETS = BRAND.parent
ROOT = BRAND.parents[2]
TOKENS = json.loads((ROOT / "design/tokens.json").read_text())
FONTS = TOKENS["typography"]["font"]

# A 2.25-unit-wide route joins three nodes in a 24-unit square. Expanded
# geometry, rather than a stroke, keeps the activity-bar asset self-contained.
ROUTE = (
    "M18 3.875H9a4.625 4.625 0 0 0 0 9.25h6"
    "a2.375 2.375 0 0 1 0 4.75H6v2.25h9"
    "a4.625 4.625 0 0 0 0-9.25H9"
    "a2.375 2.375 0 0 1 0-4.75h9Z"
)
TERMINALS = (
    "M20.5 5a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0Z"
    "M8.5 19a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0Z"
)
CENTRE = "M14.25 12a2.25 2.25 0 1 1-4.5 0a2.25 2.25 0 1 1 4.5 0Z"


def svg_document(width: int, height: int, title: str, description: str, body: str) -> str:
    """Wrap accessible, dependency-free vector artwork."""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">\n'
        f'  <title id="title">{escape(title)}</title>\n'
        f'  <desc id="desc">{escape(description)}</desc>\n'
        f"{body}\n</svg>\n"
    )


def mark(ink: str, centre: str | None = None, transform: str | None = None) -> str:
    """Return the same filled mark for every scale and colour treatment."""
    placement = f' transform="{transform}"' if transform else ""
    return (
        f'  <g{placement}>\n'
        f'    <path fill="{ink}" d="{ROUTE}"/>\n'
        f'    <path fill="{ink}" d="{TERMINALS}"/>\n'
        f'    <path fill="{centre or ink}" d="{CENTRE}"/>\n'
        "  </g>"
    )


def wordmark(theme: str) -> str:
    colors = TOKENS["color"][theme]
    body = mark(colors["accent"], colors["brand-ochre"], "translate(0 10) scale(3.25)")
    body += (
        f'\n  <text x="99" y="74" fill="{colors["text"]}" '
        f'font-family="{escape(FONTS["display"], quote=True)}" '
        'font-size="72" font-weight="400" letter-spacing="-2.5">Studium</text>'
    )
    return svg_document(
        380, 100, "Studium", f"Studium wordmark for a {theme} canvas. An S-shaped path joins three nodes.", body
    )


def hero(theme: str) -> str:
    colors = TOKENS["color"][theme]
    display = escape(FONTS["display"], quote=True)
    text = escape(FONTS["text"], quote=True)
    body = f'  <rect width="1280" height="420" fill="{colors["canvas"]}"/>\n'
    body += mark(colors["accent"], colors["brand-ochre"], "translate(60 89) scale(4.5)")
    body += (
        f'\n  <text x="190" y="181" fill="{colors["text"]}" font-family="{display}" '
        'font-size="104" font-weight="400" letter-spacing="-3.64">Studium</text>\n'
        f'  <text x="76" y="264" fill="{colors["text"]}" font-family="{text}" '
        'font-size="30" font-weight="500">Adaptive lessons, grounded in knowledge.</text>\n'
        f'  <text x="76" y="310" fill="{colors["muted"]}" font-family="{text}" '
        'font-size="22" font-weight="400">For teachers, students and self-learners.</text>\n'
        # The right-hand network is a brand motif, not a course or measured data.
        '  <g aria-hidden="true">\n'
        f'    <path d="M1118 94H1010a52 52 0 0 0 0 104h94a52 52 0 0 1 0 104h-106" '
        f'fill="none" stroke="{colors["border"]}" stroke-width="2"/>\n'
        f'    <path d="M1010 94V58M1010 198h-86M1104 302v50M1156 250h50" '
        f'fill="none" stroke="{colors["border"]}" stroke-width="2"/>\n'
        f'    <path d="M1010 94a52 52 0 0 0 0 104h94" '
        f'fill="none" stroke="{colors["accent"]}" stroke-width="3"/>\n'
        f'    <circle cx="1118" cy="94" r="10" fill="{colors["canvas"]}" '
        f'stroke="{colors["accent"]}" stroke-width="2"/>\n'
        f'    <circle cx="1010" cy="94" r="10" fill="{colors["accent"]}"/>\n'
        f'    <circle cx="1010" cy="198" r="10" fill="{colors["accent"]}"/>\n'
        f'    <circle cx="1104" cy="198" r="10" fill="{colors["brand-ochre"]}"/>\n'
        f'    <circle cx="1104" cy="302" r="10" fill="{colors["canvas"]}" '
        f'stroke="{colors["border-strong"]}" stroke-width="2"/>\n'
        f'    <circle cx="998" cy="302" r="10" fill="{colors["canvas"]}" '
        f'stroke="{colors["border-strong"]}" stroke-width="2"/>\n'
        f'    <circle cx="1010" cy="58" r="3" fill="{colors["border-strong"]}"/>\n'
        f'    <circle cx="924" cy="198" r="3" fill="{colors["border-strong"]}"/>\n'
        f'    <circle cx="1104" cy="352" r="3" fill="{colors["border-strong"]}"/>\n'
        f'    <circle cx="1206" cy="250" r="3" fill="{colors["border-strong"]}"/>\n'
        '  </g>'
    )
    return svg_document(
        1280,
        420,
        "Studium — adaptive lessons, grounded in knowledge",
        "For teachers, students and self-learners. An abstract learning-path motif echoes the Studium S; it does not depict a real course or learner data.",
        body,
    )


def render_check() -> str:
    """Show the marks at their activity-bar size and the wordmarks on both canvases."""
    body = ""
    for offset, theme in ((0, "light"), (440, "dark")):
        colors = TOKENS["color"][theme]
        text = escape(FONTS["text"], quote=True)
        body += (
            f'  <rect x="{offset}" width="440" height="360" fill="{colors["canvas"]}"/>\n'
            f'  <text x="{offset + 32}" y="31" fill="{colors["muted"]}" '
            f'font-family="{text}" font-size="14">24 px / activity bar</text>\n'
        )
        body += mark(colors["text"], transform=f"translate({offset + 36} 50)") + "\n"
        body += mark(colors["accent"], colors["brand-ochre"], f"translate({offset + 92} 50)") + "\n"
        body += mark(colors["text"], transform=f"translate({offset + 20} 108) scale(4)") + "\n"
        body += mark(colors["accent"], colors["brand-ochre"], f"translate({offset + 148} 108) scale(4)") + "\n"
        body += mark(colors["accent"], colors["brand-ochre"], f"translate({offset + 20} 252) scale(3.25)")
        body += (
            f'\n  <text x="{offset + 119}" y="316" fill="{colors["text"]}" '
            f'font-family="{escape(FONTS["display"], quote=True)}" '
            'font-size="72" font-weight="400" letter-spacing="-2.5">Studium</text>\n'
        )
    return svg_document(
        880, 360, "Studium brand rendering check",
        "Both canvas themes, with monochrome and colour marks at 24 and 96 pixels, and wordmark compositions.",
        body.rstrip(),
    )


def main() -> None:
    """Generate the public assets and the icon's editable vector source."""
    light = TOKENS["color"]["light"]
    assets = {
        BRAND / "studium-mark.svg": svg_document(
            24, 24, "Studium", "An S-shaped path connects three nodes.",
            mark(light["accent"], light["brand-ochre"]),
        ),
        BRAND / "studium-mark-mono.svg": svg_document(
            24, 24, "Studium", "An S-shaped path connects three nodes.", mark("currentColor"),
        ),
        BRAND / "studium-wordmark-light.svg": wordmark("light"),
        BRAND / "studium-wordmark-dark.svg": wordmark("dark"),
        BRAND / "studium-icon.svg": svg_document(
            256, 256, "Studium", "Studium app icon on a warm paper canvas.",
            f'  <rect width="256" height="256" fill="{light["canvas"]}"/>\n'
            + mark(light["accent"], light["brand-ochre"], "translate(32 32) scale(8)"),
        ),
        ASSETS / "hero-light.svg": hero("light"),
        ASSETS / "hero-dark.svg": hero("dark"),
        BRAND / "render-check.svg": render_check(),
    }
    for path, contents in assets.items():
        path.write_text(contents)
        print(f"{path.relative_to(ROOT)}: {len(contents.encode())} bytes")


if __name__ == "__main__":
    main()
