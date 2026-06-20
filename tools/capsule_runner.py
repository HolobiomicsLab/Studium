#!/usr/bin/env python3
"""capsule_runner.py — execute an ASB reproduction capsule and capture its artifacts.

This is the execution backend the Studium `reproduction` scene type needs: today the
reproduction grader is a no-op (`ackGrader`), so a Mode-B course *describes* a reproduction
but never runs it. This runner loads an ASB capsule (RO-Crate dir with `task_card.json` +
`scripts/`), runs its `executable` contract in an **isolated venv**, captures the figures /
outputs / artifacts it produces, grades them against the capsule's `evaluation_strategy`, and
emits a `reproduction_result.json` plus Studium scene assets (an `image_path` figure and a
`data_csv` `abs_asset`) with provenance.

TIER-AWARE + SAFE-BY-DEFAULT: only `compute_tier == light` AND an executable reproducibility
tier auto-run locally. A `heavy` capsule (e.g. bwa-meth on GEO FASTQ) is **deferred** — it
should be offloaded to the cluster, not run on a laptop. Execution is sandboxed only at a
first-order level (fresh venv + fixed cwd + timeout); running *untrusted* capsules needs real
isolation (container/seccomp, no-network default, resource limits) — see the design note.

Usage:
  python tools/capsule_runner.py <capsule_dir> [--out DIR] [--allow-heavy] [--no-network]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

_LIGHT_TIERS = {"light"}
_EXECUTABLE_REPRO = {"executable", "run-verified", "reproduced"}


def _load_card(capsule: Path) -> dict:
    tc = capsule / "task_card.json"
    if not tc.exists():
        tc = next(capsule.glob("task_card*.json"), None)
    if not tc or not tc.exists():
        raise FileNotFoundError(f"no task_card.json in {capsule}")
    return json.loads(tc.read_text(encoding="utf-8"))


def _file_exists_checks(card: dict) -> list[str]:
    """Pull 'verify file exists: <path>' targets out of evaluation_strategy.direct_checks."""
    out = []
    for c in (card.get("evaluation_strategy") or {}).get("direct_checks", []):
        m = re.match(r"verify file exists:\s*(\S+)", str(c))
        if m:
            out.append(m.group(1))
    return out


def run_capsule(capsule_dir: str | Path, out_dir: str | Path | None = None,
                allow_heavy: bool = False, allow_network: bool = True) -> dict:
    capsule = Path(capsule_dir).resolve()
    card = _load_card(capsule)
    tier = (card.get("execution_profile") or {}).get("compute_tier", "unknown")
    repro = card.get("reproducibility_tier", "unknown")
    execu = card.get("executable") or {}
    doi = card.get("crossref_doi")

    base = {"task_id": card.get("task_id"), "title": card.get("title"),
            "compute_tier": tier, "reproducibility_tier": repro, "doi": doi}

    # --- tier gate (safe by default) ---
    if not execu.get("cmd"):
        return {**base, "status": "no-executable",
                "reason": "task_card has no executable.cmd; this capsule is type-checked only."}
    if (tier not in _LIGHT_TIERS or repro not in _EXECUTABLE_REPRO) and not allow_heavy:
        return {**base, "status": "deferred",
                "reason": (f"compute_tier={tier!r}, reproducibility_tier={repro!r}: auto-run only for "
                           "light + executable. Offload heavy/uncertain capsules to the cluster "
                           "(Azzurra) or keep them type-checked. Use --allow-heavy to override.")}

    # --- isolated run dir (copy the capsule so we never write into the source) ---
    run_dir = Path(tempfile.mkdtemp(prefix=f"caps-{card.get('task_id', 'x')}-"))
    for item in ("scripts", "inputs", "data", "requirements.txt"):
        src = capsule / item
        if src.exists():
            (shutil.copytree if src.is_dir() else shutil.copy2)(src, run_dir / item)
    work = run_dir / execu["working_dir"] if execu.get("working_dir") else run_dir

    # --- fresh venv (first-order sandbox) ---
    venv = run_dir / ".venv"
    log: list[str] = []
    try:
        subprocess.run(["uv", "venv", "--python", "3.13", str(venv)], check=True,
                       capture_output=True, text=True)
        req = run_dir / "requirements.txt"
        if req.exists():
            subprocess.run(["uv", "pip", "install", "--python", str(venv / "bin" / "python"),
                            "-r", str(req)], check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        return {**base, "status": "env-error", "reason": (e.stderr or str(e))[:400], "run_dir": str(run_dir)}

    # --- run the executable contract in the sandbox ---
    env = {**os.environ, "PATH": f"{venv / 'bin'}{os.pathsep}{os.environ.get('PATH', '')}"}
    if not allow_network:
        env["no_proxy"] = "*"  # advisory only; real network isolation needs a sandbox (see design note)
    timeout = float(execu.get("timeout_s") or card.get("run_timeout_seconds") or 120)
    try:
        proc = subprocess.run(execu["cmd"], cwd=str(work), env=env, capture_output=True,
                              text=True, timeout=timeout)
        exit_code, stdout, stderr = proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired:
        return {**base, "status": "timeout", "timeout_s": timeout, "run_dir": str(run_dir)}

    # --- capture produced artifacts ---
    figures = sorted(str(p.relative_to(work)) for p in work.glob("figures/*")
                     if p.suffix.lower() in (".png", ".svg", ".jpg", ".pdf"))
    outputs = sorted(str(p.relative_to(work)) for p in work.glob("outputs/*") if p.is_file())
    landmark = next((ln for ln in stdout.splitlines() if ln.startswith("LANDMARK")), None)

    # --- grade against the capsule's own evaluation_strategy ---
    checks = []
    for rel in _file_exists_checks(card):
        ok = (work / rel).exists()
        checks.append({"check": f"file exists: {rel}", "passed": ok})
    exp_art = card.get("expected_artifact_name")
    if exp_art:
        found = bool(list(work.rglob(exp_art)))
        checks.append({"check": f"expected artifact: {exp_art}", "passed": found})
    passed = exit_code == 0 and all(c["passed"] for c in checks)

    # --- emit Studium reproduction-scene assets (copy out of the temp run dir) ---
    out = Path(out_dir).resolve() if out_dir else (capsule.parent / f"{capsule.name}__run")
    out.mkdir(parents=True, exist_ok=True)
    scene_assets: dict = {}
    if figures:
        dst = out / Path(figures[0]).name
        shutil.copy2(work / figures[0], dst)
        scene_assets["image_path"] = str(dst)  # -> ConceptScene.image_path
    csvs = [o for o in outputs if o.endswith(".csv")]
    if csvs:
        dst = out / Path(csvs[0]).name
        shutil.copy2(work / csvs[0], dst)
        scene_assets["abs_asset"] = {  # -> Evidence.abs_asset on the reproduction scene
            "asset_type": "data_csv", "payload_path": str(dst),
            "prov_derived_from": f"capsule:{card.get('task_id')}",
        }

    result = {
        **base, "status": "ran", "exit_code": exit_code, "passed": passed,
        "checks": checks, "landmark": landmark, "figures": figures, "outputs": outputs,
        "scene_assets": scene_assets,
        "provenance": {"capsule_dir": str(capsule), "doi": doi, "cmd": execu["cmd"],
                       "python": "3.13 (isolated uv venv)", "timeout_s": timeout,
                       "stderr_tail": stderr[-300:] if stderr else ""},
        "run_dir": str(run_dir),
    }
    (out / "reproduction_result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="run an ASB reproduction capsule, capture artifacts")
    ap.add_argument("capsule_dir")
    ap.add_argument("--out", default=None)
    ap.add_argument("--allow-heavy", action="store_true", help="override the light-tier gate (DANGER)")
    ap.add_argument("--no-network", action="store_true")
    args = ap.parse_args(argv)
    res = run_capsule(args.capsule_dir, args.out, args.allow_heavy, not args.no_network)
    print(json.dumps({k: v for k, v in res.items() if k != "provenance"}, indent=2))
    return 0 if res.get("status") in ("ran", "deferred", "no-executable") else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
