"""Loader pour les capsules ABS (RO-Crate) consommées par ``ReproductionAgent``.

Une capsule ABS minimale stocke ses ``task_cards`` sous l'une des deux formes :

1. en tant qu'entités du ``@graph`` du ``ro-crate-metadata.json`` (champ
   ``@id`` ou ``identifier`` correspondant au ``task_card_id`` recherché) ;
2. dans un fichier sibling ``task_card.json`` (cas de la fixture
   ``fixtures/m2/abs_capsule_minimal/`` qui expose ``task_id: "task_001"``).

``load_task_card`` essaie les deux formes ; renvoie ``None`` si aucune
correspondance n'est trouvée (ou si la capsule est absente / illisible).
"""

from __future__ import annotations

import json
from pathlib import Path


def load_task_card(capsule_root: Path, task_card_id: str) -> dict | None:
    """Localise une entité ``task_card`` par identifiant dans une capsule ABS.

    Recherche :

    1. dans ``ro-crate-metadata.json`` : entité du ``@graph`` dont ``@id``,
       ``identifier`` ou ``task_id`` correspond à ``task_card_id`` ;
    2. à défaut, dans un fichier sibling ``task_card.json`` dont le champ
       ``task_id`` (ou ``identifier`` / ``@id``) correspond.

    Renvoie ``None`` si rien ne correspond ou si la capsule est invalide.
    """

    # 1. ro-crate-metadata.json @graph lookup
    metadata_path = capsule_root / "ro-crate-metadata.json"
    if metadata_path.exists():
        try:
            data = json.loads(metadata_path.read_text())
        except json.JSONDecodeError:
            data = None
        if isinstance(data, dict):
            for entity in data.get("@graph", []):
                if not isinstance(entity, dict):
                    continue
                if any(
                    entity.get(field) == task_card_id
                    for field in ("@id", "identifier", "task_id")
                ):
                    return entity

    # 2. Sibling task_card.json fallback (fixture-style minimal capsule)
    task_card_path = capsule_root / "task_card.json"
    if task_card_path.exists():
        try:
            card = json.loads(task_card_path.read_text())
        except json.JSONDecodeError:
            return None
        if isinstance(card, dict) and any(
            card.get(field) == task_card_id
            for field in ("task_id", "identifier", "@id")
        ):
            return card

    return None


__all__ = ["load_task_card"]
