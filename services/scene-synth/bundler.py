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

from pydantic import TypeAdapter, ValidationError

from prov import build_prov_graph
from scene_synth_schemas import LessonBundle, Scene

# Bumped whenever the validate_scene contract (schema or custom checks) changes,
# so a recorded ``validation.validator_version`` pins which gate produced an
# ``ok`` verdict. Kept distinct from the bundle ``schema_version``.
VALIDATOR_VERSION = "validate_scene/1.0"

# Pure discriminated-union validator over the FULL Scene union — the SAME
# contract the bundle applies to each ``scenes[]`` member, so single-scene and
# full-bundle validation can never diverge.
_SceneAdapter: TypeAdapter = TypeAdapter(Scene)


def validate_scene(
    scene_dict: dict,
    *,
    course_concept_ids: list[str],
) -> dict:
    """Validate ONE scene dict against the full ``Scene`` union + custom gates.

    Runs the same ``TypeAdapter(Scene).validate_python`` contract the bundle
    applies to every ``scenes[]`` member, then two custom checks the schema
    cannot express:

    - **quiz only** — exactly one ``choices[].correct == True`` (choices are
      independent booleans in the schema, so 0-correct and 2+-correct both
      slip through Pydantic). Applies only to ``type == "quiz"``.
    - **all scene types** — every ``concept_refs`` entry must be a member of
      ``course_concept_ids`` (``concept_refs ⊆ course concepts``). An empty
      ``concept_refs`` passes vacuously.

    Parameters
    ----------
    scene_dict:
        A schema-pure scene as a plain dict (a member of the ``Scene`` union).
    course_concept_ids:
        The concept ids declared by the owning course/plan.

    Returns
    -------
    dict
        ``{"ok": bool, "errors": list[str], "validator_version": str}``. Never
        raises on validation failure — failures are reported in ``errors``.
    """
    errors: list[str] = []

    try:
        _SceneAdapter.validate_python(scene_dict)
    except ValidationError as exc:
        for err in exc.errors():
            loc = ".".join(str(p) for p in err.get("loc", ()))
            msg = err.get("msg", "invalid")
            errors.append(f"{loc}: {msg}" if loc else msg)

    # Custom checks operate on the raw dict so they still run (and report)
    # even when the schema rejected the scene — and never explode on it.
    if isinstance(scene_dict, dict):
        # quiz-only: exactly one correct choice.
        if scene_dict.get("type") == "quiz":
            choices = scene_dict.get("choices")
            if isinstance(choices, list):
                n_correct = sum(
                    1
                    for ch in choices
                    if isinstance(ch, dict) and ch.get("correct") is True
                )
                if n_correct != 1:
                    errors.append(
                        f"quiz must have exactly one correct choice, found {n_correct}"
                    )

        # all types: concept_refs ⊆ course concepts.
        concept_refs = scene_dict.get("concept_refs") or []
        if isinstance(concept_refs, list):
            allowed = set(course_concept_ids)
            for ref in concept_refs:
                if ref not in allowed:
                    errors.append(
                        f"concept_ref '{ref}' is not a course concept "
                        f"(not in {sorted(allowed)})"
                    )

    return {
        "ok": not errors,
        "errors": errors,
        "validator_version": VALIDATOR_VERSION,
    }


def _utc_now_z() -> str:
    """UTC timestamp with a trailing 'Z' (no numeric offset).

    The TS runtime loader validates ``validated_at`` with Zod
    ``z.string().datetime()``, whose default grammar REQUIRES a 'Z' suffix and
    REJECTS the ``+00:00`` offset that ``datetime.isoformat()`` emits. Emitting
    a 'Z'-suffixed timestamp lets authored bundles load in TS without any
    Z-normalization workaround. Pydantic still accepts the 'Z' form, so Python
    round-trips remain valid.
    """
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


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
        ``concepts``, ``rules``, ``learning_workflow_graph``.
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

    scene_dicts = [_scene_to_dict(s) for s in scenes]

    # Single-scene validation MUST match full-bundle validation: run the pure
    # validate_scene() gate on every scene (concept_refs ⊆ plan concepts +
    # quiz exactly-one-correct), so a bundle can never contain a scene the
    # standalone validator would reject. Raise before assembling the ZIP.
    course_concept_ids = [
        c.get("id") for c in lesson_plan.get("concepts", []) if isinstance(c, dict)
    ]
    for scene_dict in scene_dicts:
        result = validate_scene(scene_dict, course_concept_ids=course_concept_ids)
        if not result["ok"]:
            raise ValueError(
                f"scene {scene_dict.get('id', '?')!r} failed validation: "
                + "; ".join(result["errors"])
            )

    bundle_data = {
        "schema_version": "1.4",
        "bundle_id": f"bundle-{lesson_id}",
        "source_plan_id": plan_id,
        "metadata": _coerce_metadata(lesson_plan),
        "concepts": list(lesson_plan.get("concepts", [])),
        "scenes": scene_dicts,
        "rules": list(lesson_plan.get("rules", [])),
        "validated_by": prov_seed.get("validator", "scene-synth"),
        "validated_at": _utc_now_z(),
        "learning_workflow_graph": lesson_plan.get("learning_workflow_graph"),
        "universes": lesson_plan.get("universes"),
    }

    # Validation stricte (lève si le bundle ne round-trip pas).
    bundle = LessonBundle.model_validate(bundle_data)
    # `exclude_none=True`: the TS schema this bundle is read by declares its optional fields
    # `.optional()`, which accepts ABSENCE and rejects `null` — so a dump that emitted every
    # unset optional as `null` produced bundles the runtime refuses to parse. It did: every
    # `evidence.abs_asset`, `bibliographic_refs[].doi` and `[].year` this bundler ever wrote was
    # a null, which is why `fixtures/m6/demo-atomistique` sat quarantined in `tools/bundle_lint.mjs`.
    # The three fields the TS schema declares `.nullable()` instead are protected by
    # `model_serializer` on `ReferenceRun` / `ReferenceRunProvenance` — see the note there. The
    # scenes were already dumped with `exclude_none=True` at `_scene_to_dict`; re-validating into
    # `LessonBundle` put the nulls back, so the two halves disagreed.
    bundle_json = bundle.model_dump(mode="json", exclude_none=True)

    # Provenance (sidecar).
    prov_graph = build_prov_graph(scenes, lesson_plan, prov_seed)

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("lesson.json", json.dumps(bundle_json, indent=2, ensure_ascii=False))
        zf.writestr("prov.json", json.dumps(prov_graph, indent=2, ensure_ascii=False))

    return output_path.as_uri()


__all__ = ["build_bundle", "validate_scene", "VALIDATOR_VERSION"]
