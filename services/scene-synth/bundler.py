"""Bundler scene-synth (A.6) : assemble lesson.json + prov.json en ZIP.

Format du ZIP attendu par le runtime étudiant M3 :
- ``lesson.json`` à la racine — instance valide ``LessonBundle``
- ``prov.json``    à la racine — graphe PROV-O JSON-LD (sidecar)
- (futur) ``assets/`` — médias référencés par les scènes

Choix d'implémentation pour la provenance : **sidecar** ``prov.json``.
Le schéma ``LessonBundle`` est strict (pas de champ libre, pas
d'``extra='allow'``) ; l'embarquer dans le bundle violerait la validation.
Le sidecar est zéro-disruption pour la spec A.1 et reste consommable par
n'importe quel lecteur de ZIP.
"""

from __future__ import annotations

import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from prov import build_prov_graph
from scene_synth_schemas import LessonBundle


def _coerce_metadata(lesson_plan: dict) -> dict:
    """Construit un BundleMetadata depuis le plan, avec fallbacks raisonnables."""
    md = lesson_plan.get("metadata") or {}
    return {
        "title": md.get("title") or lesson_plan.get("title", "Untitled"),
        "target": md.get("target", "L3"),
        "duration_minutes": int(md.get("duration_minutes", 30)),
        "language": md.get("language", "fr"),
        "discipline": md.get("discipline", "general"),
    }


def _scene_to_dict(scene: Any) -> dict:
    """Sérialise une scène (Pydantic ou dict) en dict prêt pour LessonBundle."""
    if hasattr(scene, "model_dump"):
        return scene.model_dump(exclude_none=True)
    if isinstance(scene, dict):
        return scene
    raise TypeError(f"scene must be Pydantic model or dict, got {type(scene)!r}")


def build_bundle(
    lesson_plan: dict,
    scenes: list,
    output_path: Path,
    prov_seed: dict,
) -> str:
    """Assemble un ZIP ``lesson.json`` + ``prov.json`` à ``output_path``.

    Parameters
    ----------
    lesson_plan:
        Plan d'entrée (cf. fixtures M3). Champs lus :
        ``lesson_id`` (requis), ``plan_id``, ``title``, ``metadata``,
        ``concepts``, ``rules``.
    scenes:
        Liste de scènes synthétisées (instances ``Scene`` Pydantic ou dicts).
    output_path:
        Chemin de sortie du ZIP. Les répertoires parents sont créés.
    prov_seed:
        ``{"agent": "<label>", "version": "<x.y.z>"}`` — métadonnées de
        l'agent émetteur, propagées dans le graphe PROV-O.

    Returns
    -------
    str
        URI ``file://`` du ZIP produit.
    """
    lesson_id = lesson_plan["lesson_id"]
    plan_id = lesson_plan.get("plan_id", lesson_id)

    bundle_data = {
        "schema_version": "1.0",
        "bundle_id": f"bundle-{lesson_id}",
        "source_plan_id": plan_id,
        "metadata": _coerce_metadata(lesson_plan),
        "concepts": list(lesson_plan.get("concepts", [])),
        "scenes": [_scene_to_dict(s) for s in scenes],
        "rules": list(lesson_plan.get("rules", [])),
        "validated_by": prov_seed.get("validator", "scene-synth"),
        "validated_at": datetime.now(timezone.utc).isoformat(),
    }

    # Validation stricte (lève si le bundle ne round-trip pas).
    bundle = LessonBundle.model_validate(bundle_data)
    bundle_json = bundle.model_dump(mode="json", exclude_none=False)

    # Provenance (sidecar).
    prov_graph = build_prov_graph(scenes, lesson_plan, prov_seed)

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("lesson.json", json.dumps(bundle_json, indent=2, ensure_ascii=False))
        zf.writestr("prov.json", json.dumps(prov_graph, indent=2, ensure_ascii=False))

    return output_path.as_uri()


__all__ = ["build_bundle"]
