"""Extraction asset ABS depuis ABSCapsuleData vers ABSAsset Evidence."""
from __future__ import annotations
from typing import Any, Optional
from lesson_plan_schema import SceneType, ABSAsset


# Mapping asset_type → fichier prioritaire par scene_type
_PRIORITY_BY_TYPE: dict[SceneType, list[tuple[str, str]]] = {
    SceneType.simulation: [
        ("spectrum.svg", "spectrum_viewer_svg"),
        ("script.py", "code_snippet"),
        ("data.csv", "data_csv"),
    ],
    SceneType.reproduction: [
        ("protocol.md", "protocol_card_md"),
        ("script.py", "script_snippet"),
    ],
}

_PAYLOAD_INLINE_LIMIT_BYTES = 100 * 1024  # 100 KB


def extract_asset(
    scene_type: SceneType,
    abs_task_card_id: Optional[str],
    capsule: Any,
) -> Optional[ABSAsset]:
    """Extrait un ABSAsset depuis la capsule pour le task_id donné.

    Retourne None si :
    - abs_task_card_id est None (pas d'attache)
    - scene_type non concerné par ABS (intro/concept = biblio-only)
    - aucun fichier asset prioritaire trouvé pour ce type
    """
    if abs_task_card_id is None:
        return None

    priorities = _PRIORITY_BY_TYPE.get(scene_type)
    if priorities is None:
        return None  # intro/concept/autres → biblio-only

    assets = getattr(capsule, "assets_by_task", {}).get(abs_task_card_id, {})
    rocrate_uri = getattr(capsule, "rocrate_uri", f"urn:abs:rocrate:{abs_task_card_id}")

    for filename, asset_type in priorities:
        if filename in assets:
            payload = assets[filename]
            inline: Optional[str] = None
            path: Optional[str] = None
            if len(payload.encode("utf-8")) <= _PAYLOAD_INLINE_LIMIT_BYTES:
                inline = payload
            else:
                path = f"assets/{abs_task_card_id}/{filename}"
            return ABSAsset(
                asset_type=asset_type,
                payload_inline=inline,
                payload_path=path,
                abs_task_card_id=abs_task_card_id,
                prov_derived_from=rocrate_uri,
            )

    return None
