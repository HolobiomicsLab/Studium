#!/usr/bin/env python3
"""Generate the scientific render-assets for the atomistique-L1 bundle.

DETERMINISTIC and OFFLINE — pure numpy, no network, no LLM. These are the
"programmatically generated views of orbitals / atoms / spectra" that the
notebook surface renders interactively (3Dmol.js for .cube + xyz, Vega-Lite
for spectra and trends). Re-run with `.venv/bin/python generate_assets.py`.

Provenance:
  - Orbitals: analytic hydrogenic real wavefunctions (a0 = 1 Bohr), signed ψ so
    the + and − lobes render as two isosurfaces. Not from the course PDF.
  - Balmer series: Rydberg formula, visible lines.
  - Period-2 first ionisation energies (kJ/mol) and Clementi calculated atomic
    radii (pm): standard reference values (CRC Handbook / Clementi 1967).
"""
from __future__ import annotations
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")


# ───────────────────────── orbitals → Gaussian .cube ─────────────────────────
# Pure Python (no numpy): grids are small (≤48³) so a triple loop is sub-second.

def hydrogenic(kind: str, n_grid: int, half_box: float):
    """Signed real hydrogenic wavefunction, flat list in (i,j,k) order, k fastest."""
    step = 2.0 * half_box / (n_grid - 1)
    coords = [-half_box + s * step for s in range(n_grid)]
    data = [0.0] * (n_grid ** 3)
    mx = 0.0
    p = 0
    for x in coords:
        for y in coords:
            for z in coords:
                r = math.sqrt(x * x + y * y + z * z) + 1e-9
                if kind == "2pz":        # R_21 ∝ r e^{-r/2}, Y_10 ∝ cosθ → z e^{-r/2}
                    v = z * math.exp(-r / 2.0)
                elif kind == "3dz2":     # R_32 ∝ r² e^{-r/3}, Y_20 ∝ 3cos²θ−1 → (3z²−r²) e^{-r/3}
                    v = (3.0 * z * z - r * r) * math.exp(-r / 3.0)
                else:
                    raise ValueError(kind)
                data[p] = v
                p += 1
                if abs(v) > mx:
                    mx = abs(v)
    inv = 1.0 / mx                       # normalise so max|ψ| = 1 → isoval is box-independent
    return [v * inv for v in data], step


def write_cube(path: str, data: list[float], n: int, spacing: float, half_box: float, comment: str):
    o = -half_box
    with open(path, "w") as f:
        f.write(comment + "\n")
        f.write("signed hydrogenic wavefunction; render with two isosurfaces (+/-)\n")
        f.write(f"{1:5d}{o:12.6f}{o:12.6f}{o:12.6f}\n")            # 1 atom, origin (Bohr)
        f.write(f"{n:5d}{spacing:12.6f}{0.0:12.6f}{0.0:12.6f}\n")
        f.write(f"{n:5d}{0.0:12.6f}{spacing:12.6f}{0.0:12.6f}\n")
        f.write(f"{n:5d}{0.0:12.6f}{0.0:12.6f}{spacing:12.6f}\n")
        f.write(f"{1:5d}{1.0:12.6f}{0.0:12.6f}{0.0:12.6f}{0.0:12.6f}\n")  # H nucleus at origin
        p = 0
        for _i in range(n):
            for _j in range(n):
                col = 0
                for _k in range(n):
                    f.write(f"{data[p]:13.5e}")
                    p += 1
                    col += 1
                    if col % 6 == 0:
                        f.write("\n")
                if col % 6 != 0:
                    f.write("\n")
    return os.path.getsize(path)


# ───────────────────────── spectra / trends → Vega-Lite ─────────────────────────

def balmer_spec() -> dict:
    """Visible Balmer lines via Rydberg: 1/λ = R_H (1/4 − 1/n²), n = 3..6."""
    R_H = 1.0967757e7  # m⁻¹
    rel = {3: 100, 4: 42, 5: 23, 6: 12}
    greek = {3: "α", 4: "β", 5: "γ", 6: "δ"}
    rows = []
    for n in (3, 4, 5, 6):
        lam_nm = 1.0 / (R_H * (1 / 4 - 1 / n**2)) * 1e9
        rows.append({"lambda": round(lam_nm, 1), "I": rel[n],
                     "raie": f"H{greek[n]} (n={n}→2)"})
    return {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "description": "Serie de Balmer de l'hydrogene (raies d'emission visibles)",
        "width": 360, "height": 170,
        "data": {"values": rows},
        "mark": {"type": "bar", "size": 4},
        "encoding": {
            "x": {"field": "lambda", "type": "quantitative",
                  "scale": {"domain": [395, 670]},
                  "title": "longueur d'onde λ (nm)"},
            "y": {"field": "I", "type": "quantitative", "title": "intensite relative"},
            "color": {"field": "raie", "type": "nominal", "legend": {"title": "raie"}},
            "tooltip": [{"field": "raie"}, {"field": "lambda", "title": "λ (nm)"}],
        },
    }


def trend_spec(title: str, ytitle: str, values: list[dict]) -> dict:
    return {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "description": title,
        "width": 360, "height": 170,
        "data": {"values": values},
        "layer": [
            {"mark": {"type": "line", "point": True},
             "encoding": {
                 "x": {"field": "element", "type": "nominal", "sort": None,
                       "title": "element (periode 2)"},
                 "y": {"field": "y", "type": "quantitative", "title": ytitle},
                 "tooltip": [{"field": "element"}, {"field": "y", "title": ytitle}],
             }},
        ],
    }


def molecule_xyz(name: str, atoms: list[tuple[str, float, float, float]], comment: str) -> str:
    lines = [str(len(atoms)), comment]
    for sym, x, y, z in atoms:
        lines.append(f"{sym:2s} {x:12.6f} {y:12.6f} {z:12.6f}")
    return "\n".join(lines) + "\n"


def main():
    os.makedirs(os.path.join(ASSETS, "orbitals"), exist_ok=True)
    os.makedirs(os.path.join(ASSETS, "spectra"), exist_ok=True)
    os.makedirs(os.path.join(ASSETS, "plots"), exist_ok=True)
    os.makedirs(os.path.join(ASSETS, "molecules"), exist_ok=True)
    manifest = []

    # orbitals
    data, sp = hydrogenic("2pz", 40, 8.0)
    sz = write_cube(os.path.join(ASSETS, "orbitals", "2pz.cube"), data, 40, sp, 8.0,
                    "Orbitale atomique 2p_z (hydrogenoide)")
    manifest.append({"path": "assets/orbitals/2pz.cube", "kind": "orbital", "iso": 0.18, "bytes": sz})
    data, sp = hydrogenic("3dz2", 48, 18.0)
    sz = write_cube(os.path.join(ASSETS, "orbitals", "3dz2.cube"), data, 48, sp, 18.0,
                    "Orbitale atomique 3d_z2 (hydrogenoide)")
    manifest.append({"path": "assets/orbitals/3dz2.cube", "kind": "orbital", "iso": 0.18, "bytes": sz})

    # spectrum
    spec = balmer_spec()
    with open(os.path.join(ASSETS, "spectra", "H_balmer.spectrum.json"), "w") as f:
        json.dump(spec, f, ensure_ascii=False, indent=2)
    manifest.append({"path": "assets/spectra/H_balmer.spectrum.json", "kind": "spectrum",
                     "lines": [r["lambda"] for r in spec["data"]["values"]]})

    # trends (period 2: Li B C N O F Ne)
    elems = ["Li", "Be", "B", "C", "N", "O", "F", "Ne"]
    ie = [520, 899, 801, 1086, 1402, 1314, 1681, 2081]           # 1st ionisation, kJ/mol
    radius = [167, 112, 87, 67, 56, 48, 42, 38]                  # Clementi calc. radius, pm
    s1 = trend_spec("Energie de premiere ionisation (periode 2)", "E.I.1 (kJ/mol)",
                    [{"element": e, "y": v} for e, v in zip(elems, ie)])
    s2 = trend_spec("Rayon atomique (periode 2)", "rayon (pm)",
                    [{"element": e, "y": v} for e, v in zip(elems, radius)])
    with open(os.path.join(ASSETS, "plots", "ionisation_periode2.plot.json"), "w") as f:
        json.dump(s1, f, ensure_ascii=False, indent=2)
    with open(os.path.join(ASSETS, "plots", "rayon_periode2.plot.json"), "w") as f:
        json.dump(s2, f, ensure_ascii=False, indent=2)
    manifest += [{"path": "assets/plots/ionisation_periode2.plot.json", "kind": "plot_spec"},
                 {"path": "assets/plots/rayon_periode2.plot.json", "kind": "plot_spec"}]

    # molecules (Angstrom)
    d = 1.09 / math.sqrt(3)
    ch4 = molecule_xyz("CH4", [
        ("C", 0, 0, 0), ("H", d, d, d), ("H", d, -d, -d), ("H", -d, d, -d), ("H", -d, -d, d),
    ], "Methane CH4 — geometrie tetraedrique (VSEPR / hybridation sp3)")
    half = math.radians(104.5 / 2)
    h2o = molecule_xyz("H2O", [
        ("O", 0, 0, 0),
        ("H", 0.96 * math.sin(half), 0, 0.96 * math.cos(half)),
        ("H", -0.96 * math.sin(half), 0, 0.96 * math.cos(half)),
    ], "Eau H2O — coudee 104.5 deg (VSEPR, 2 doublets non liants)")
    with open(os.path.join(ASSETS, "molecules", "CH4.xyz"), "w") as f:
        f.write(ch4)
    with open(os.path.join(ASSETS, "molecules", "H2O.xyz"), "w") as f:
        f.write(h2o)
    manifest += [{"path": "assets/molecules/CH4.xyz", "kind": "mol_3d", "format": "xyz"},
                 {"path": "assets/molecules/H2O.xyz", "kind": "mol_3d", "format": "xyz"}]

    with open(os.path.join(ASSETS, "MANIFEST.json"), "w") as f:
        json.dump({"generator": "generate_assets.py", "deterministic": True, "assets": manifest},
                  f, ensure_ascii=False, indent=2)
    for a in manifest:
        extra = a.get("bytes", "")
        print(f"  {a['kind']:13s} {a['path']}  {extra}")
    print(f"\n{len(manifest)} assets → {ASSETS}")


if __name__ == "__main__":
    main()
