"""analyze.py — bundle-level grounding-relevance scorecard. Pure stdlib.

``analyze_bundle`` walks a lesson bundle's intro/concept scenes that carry an
``evidence`` block and grades how topically relevant their attached citations are
to the scene content. It is the bundle-level counterpart to the auditor's
``grounding_citations`` dimension — except the auditor scores by PRESENCE while
this scores by RELEVANCE, so the two together catch presence-only grounding.
"""

from __future__ import annotations

import io
import json
import os
import zipfile
from typing import List, Optional

from eval.validity.grounding_relevance.relevance import scene_relevance

# Scenes that are expected to carry grounding evidence. Quizzes/checks do not.
_GROUNDED_SCENE_TYPES = {"intro", "concept"}

# Default lexical-overlap threshold. Calibrated against the mock-vs-ontopic
# fixtures: a ref sharing the scene's topical vocabulary clears ~0.1–0.3 Jaccard,
# while an off-topic ref (metabolomics paper on a peroxisomes lesson) sits near 0.
# 0.06 is a conservative floor that separates the two without over-flagging.
DEFAULT_THRESHOLD = 0.06

_HONEST_NOTE = (
    "Relevance is a LEXICAL (token-overlap / Jaccard) proxy, not a semantic "
    "embedding match: a ref that paraphrases the scene with disjoint vocabulary "
    "scores low even if topically apt. This tool COMPLEMENTS — does not replace "
    "— the auditor's grounding_citations presence check; it flags citations that "
    "are present but off-topic (presence-only grounding)."
)


def _scene_type(scene: dict) -> str:
    return str(scene.get("type") or scene.get("kind") or "")


def analyze_bundle(bundle: dict, threshold: float = DEFAULT_THRESHOLD) -> dict:
    """Score a lesson bundle's grounding relevance.

    Returns a scorecard dict::

        {
          "n_evidenced_scenes": int,
          "mean_best_relevance": float | None,   # None when no evidenced scenes
          "irrelevant_scenes": [ {scene_id, title, best_relevance, per_ref}, ... ],
          "relevance_grade": float,              # fraction of evidenced scenes >= threshold
          "verdict": "relevant" | "presence_only" | "no_evidence",
          "threshold": float,
          "evidenced_scenes": [ {scene_id, title, best, mean, per_ref}, ... ],
          "note": str,
        }

    Defensive: a missing/empty/malformed bundle yields a zero-evidence scorecard
    rather than raising.
    """
    scenes = []
    if isinstance(bundle, dict):
        maybe = bundle.get("scenes")
        if isinstance(maybe, list):
            scenes = [s for s in maybe if isinstance(s, dict)]

    evidenced: List[dict] = []
    for scene in scenes:
        if _scene_type(scene) not in _GROUNDED_SCENE_TYPES:
            continue
        rel = scene_relevance(scene)
        if rel is None:
            continue  # scene has no evidence / no refs — nothing to grade
        evidenced.append(
            {
                "scene_id": str(scene.get("id") or ""),
                "title": str(scene.get("title") or ""),
                "best": rel["best"],
                "mean": rel["mean"],
                "per_ref": rel["per_ref"],
            }
        )

    n = len(evidenced)
    if n == 0:
        return {
            "n_evidenced_scenes": 0,
            "mean_best_relevance": None,
            "irrelevant_scenes": [],
            "relevance_grade": 1.0,  # vacuously: no grounding claims to fail
            "verdict": "no_evidence",
            "threshold": threshold,
            "evidenced_scenes": [],
            "note": _HONEST_NOTE,
        }

    irrelevant: List[dict] = []
    n_relevant = 0
    for ev in evidenced:
        if ev["best"] >= threshold:
            n_relevant += 1
        else:
            irrelevant.append(
                {
                    "scene_id": ev["scene_id"],
                    "title": ev["title"],
                    "best_relevance": ev["best"],
                    "per_ref": ev["per_ref"],
                }
            )

    mean_best = sum(ev["best"] for ev in evidenced) / n
    relevance_grade = n_relevant / n
    verdict = "relevant" if relevance_grade >= 0.5 else "presence_only"

    return {
        "n_evidenced_scenes": n,
        "mean_best_relevance": mean_best,
        "irrelevant_scenes": irrelevant,
        "relevance_grade": relevance_grade,
        "verdict": verdict,
        "threshold": threshold,
        "evidenced_scenes": evidenced,
        "note": _HONEST_NOTE,
    }


def _read_lesson_from_zip(path: str) -> Optional[dict]:
    """Read ``lesson.json`` from anywhere inside a bundle .zip."""
    try:
        with zipfile.ZipFile(path) as zf:
            names = [n for n in zf.namelist() if os.path.basename(n) == "lesson.json"]
            if not names:
                return None
            # shallowest path wins (top-level lesson.json preferred)
            names.sort(key=lambda n: n.count("/"))
            with zf.open(names[0]) as fh:
                return json.load(io.TextIOWrapper(fh, encoding="utf-8"))
    except (OSError, zipfile.BadZipFile, ValueError):
        return None


def load_bundle(path: str) -> Optional[dict]:
    """Load a lesson bundle from either a ``.zip`` (reads lesson.json inside) or a
    direct ``lesson.json`` path. Returns the parsed dict, or ``None`` on failure.
    """
    if not isinstance(path, str) or not os.path.isfile(path):
        return None
    if zipfile.is_zipfile(path):
        return _read_lesson_from_zip(path)
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None
