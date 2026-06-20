# atomistique-l1 — Chapitre 1 (collaborative bundle)

A Studium lesson bundle for **L1 Sciences de la Vie — chimie atomistique, chapitre 1**,
authored from the real course `cours-L1SV-atomistique.pdf` (183 slides) + `TD-SPEB107`.
Built to be worked on with colleagues, and to exercise the **interactive scientific
render-assets** (orbitals you rotate, an emission spectrum, periodic trends, 3D molecules).

## What's here

| File | Role |
|---|---|
| `lesson.json` | the bundle — `LessonBundle` v1.4, 8 concepts / 16 scenes / 11 render-assets / a typed LWG |
| `generate_assets.py` | **deterministic, offline** generator for the scientific assets (no network, no LLM) |
| `build_bundle.py` | assembles + validates `lesson.json` from the concepts/scenes + the assets |
| `validate_bundle.mjs` | validates against the full **TS** `LessonBundleSchema` (scenes + render_assets + LWG) |
| `assets/` | generated `.cube` orbitals, Vega-Lite spectrum + trend specs, `.xyz` molecules |
| `_extract/` | local PDF extraction skeleton (`*.skeleton.json`). Raw text `*.text.txt` is **git-ignored** (private) |

## Render-asset manifest (what renders pair-by-pair with each scene)

- **orbital** ×2 — `2pz.cube`, `3dz2.cube` (signed hydrogenic ψ → two isosurfaces, rotate in 3Dmol.js)
- **spectrum** ×1 — H Balmer series (Hα 656 / Hβ 486 / Hγ 434 / Hδ 410 nm), Vega-Lite
- **plot_spec** ×2 — period-2 first-ionisation energy + atomic radius trends
- **mol_3d** ×2 — CH₄ (tetrahedral) + H₂O (bent 104.5°), `.xyz`
- **equation_latex** ×4 — A=Z+N, quantum-number ranges, E=hν, Klechkowski

## Reproduce

```bash
cd <repo root>
.venv/bin/python fixtures/atomistique-l1/generate_assets.py     # offline assets
.venv/bin/python fixtures/atomistique-l1/build_bundle.py        # author + Python-validate
node_modules/.pnpm/node_modules/.bin/tsx fixtures/atomistique-l1/validate_bundle.mjs   # full TS validate
```

## Grounding & provenance

- **Structure** is grounded in the local extraction of the course (Chapter 1 headings:
  particules → nombres quantiques → forme des OA → spectres / « reconnaître un gaz inconnu »
  → remplissage → configuration cœur/valence → ionisation & rayon → géométrie). The `s1-quiz-fer`
  (Z=26) and `s2-quiz-4f` items mirror TD1/TD2.
- **Assets** are analytic/reference (hydrogenic wavefunctions; Rydberg; CRC/Clementi values) —
  see each file's provenance and `assets/MANIFEST.json`. They are NOT lifted from the PDF.
- **Evidence enrichment** (per-scene bibliographic refs via Perspicacité) is a deliberate
  follow-up — omitted here rather than fabricating enrichment metadata.

## Privacy

The source PDFs are private (`usage démo interne`). The local raw-text extraction
(`_extract/*.text.txt`) is git-ignored and must not be committed or published. Only the
distilled skeleton and the derived assets are shareable.
