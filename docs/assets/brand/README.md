# Studium identity assets

An **S-shaped path through three nodes** is the Studium mark. Its filled geometry
stays readable at 24 px; the colour version gives the central node an ochre accent.
Georgia carries the name, with Avenir Next for supporting text. The hero extends
the same path into a quiet abstract graph. These are identity motifs, not a real
course, learner record, assessment result or mastery encoding.

The geometry is original to this project. All colours and font stacks come from
[`design/tokens.json`](../../../design/tokens.json); there are no embedded fonts,
third-party icons, raster images or external references inside the SVGs.

| Asset | Use |
| --- | --- |
| `studium-mark.svg` | Colour mark, transparent, 24 × 24 viewBox; intended for a light canvas |
| `studium-mark-mono.svg` | Activity-bar mark, transparent, 24 × 24 viewBox; three filled `currentColor` paths |
| `studium-wordmark-light.svg`, `studium-wordmark-dark.svg` | Transparent 380 × 100 compositions; suffix names the intended canvas |
| `studium-icon.svg`, `studium-icon.png` | Editable icon and real 256 × 256 RGB PNG for VSIX packaging; paper canvas with generous clear space |
| `../hero-light.svg`, `../hero-dark.svg` | 1280 × 420 headers, with real SVG text and a decorative graph |
| `render-check.svg`, `render-check.png` | Inspection sheet: marks at 24 and 96 px, plus both wordmark colour treatments |
| `hero-light-880.png`, `hero-dark-880.png` | 880 × 289 inspection renders at a typical GitHub content width |

The hero reads **“Adaptive lessons, grounded in knowledge.”** Its audience line is
“For teachers, students and self-learners.” All graph edges in the hero are
decorative and carry no data claim.

Rebuild the vector sources from the repository root:

```sh
.venv/bin/python docs/assets/brand/generate-assets.py
```

Rebuild the PNGs using the existing local PyMuPDF installation:

```sh
.venv/bin/python docs/assets/brand/render-assets.py
```

The generator owns only the listed SVGs. The rendering script checks PNG header
dimensions and requires the VSIX icon to be exactly 256 × 256. System-font
appearance varies by host; MuPDF may substitute fonts in the inspection PNGs.
The public wordmarks and heroes retain the exact token font stacks as SVG text.

Validation on 2026-10-30:

- `command -v rsvg-convert`: exit 1; renderer unavailable.
- `qlmanage -t -s 256 -o docs/assets/brand docs/assets/brand/studium-icon.svg`:
  exit 255; sandbox initialization failed with a path-filter type error.
- `.venv/bin/python docs/assets/brand/generate-assets.py`: exit 0.
- `.venv/bin/python docs/assets/brand/render-assets.py`: exit 0, using
  **PyMuPDF / MuPDF 1.27.2.3**, already installed in the project virtualenv.
- `xmllint --noout` on all eight generated SVGs: exit 0.
- Python XML/PNG inspection: exit 0; every fill/stroke is a token colour or
  `currentColor`/`none`; no external href, script, image, use or foreignObject;
  wordmarks are transparent and contain real `Studium` text. The PNG is opaque
  RGB, 256 × 256, and its corner pixel matches `light.canvas` (`#f5f2eb`).
- Visually inspected the icon, the 24 px/96 px contact sheet and both heroes at
  880 px. No overlaps or clipping appeared. Native browser font rendering was
  not independently inspected during this asset task.

On the hero canvases, text contrast is 12.79:1 (light) / 14.04:1 (dark), secondary
text 5.53:1 / 8.74:1, and teal 5.68:1 / 9.34:1. The ochre node has 3.24:1 / 9.45:1
contrast and is decorative; the mark remains complete in monochrome.
