"""INT-STUDIUM-035 candidate 2, côté collecteur.

Depuis la décision du propriétaire, une scène de texte libre corrigée hors ligne par
l'appariement de sous-chaînes n'affirme plus si la réponse était juste : l'événement
``scene_completed`` part SANS ``success``. Or ``compute_progress`` lisait
``bool(ev.get("success", False))`` — l'absence devenait un échec, et le taux publié disait
« cette scène est ratée par tout le monde » là où la vérité est « personne n'a corrigé ».

C'est exactement la faute déjà enregistrée ailleurs dans ce dépôt : une mesure vide rendue
comme un zéro. La réparation suit la même règle que ``keyword_graded_rate`` (v1.6) : la
valeur vaut ``None`` quand rien n'a été corrigé, et le dénominateur réellement utilisé est
publié à côté d'elle pour qu'aucun lecteur n'ait à le deviner.
"""

import json
from pathlib import Path

from metrics import compute_progress


def _write_events(tmp_path: Path, course: str, events: list[dict]) -> Path:
    d = tmp_path / course
    d.mkdir(parents=True, exist_ok=True)
    (d / "2026-09-10.jsonl").write_text("\n".join(json.dumps(e) for e in events) + "\n")
    return d.parent


def _base(idx=0):
    return {
        "event_id": f"01923456-7890-1234-5678-abcdef01234{idx}",
        "learner_pseudonym": f"hmac:learner{idx}",
        "lesson_id": "l1",
        "bundle_version": "1.0.0",
        "client_timestamp": "2026-09-10T10:00:00Z",
    }


def _completed(idx, scene="s1", **kw):
    return {**_base(idx), "type": "scene_completed", "scene_id": scene, "duration_ms": 1000, **kw}


def test_une_scene_jamais_corrigee_ne_vaut_pas_zero(tmp_path):
    data_dir = _write_events(tmp_path, "c1", [_completed(0), _completed(1)])
    scene = compute_progress(data_dir, "c1")["scenes"]["s1"]
    assert scene["completion_rate"] is None
    assert scene["n_graded"] == 0
    # la scène a bien été jouée par deux personnes : c'est la correction qui manque, pas la scène
    assert scene["n_learners"] == 2


def test_le_denominateur_est_celui_des_evenements_corriges(tmp_path):
    events = [
        _completed(0, success=True),
        _completed(1, success=False),
        _completed(2),  # non corrigé : ne compte ni au numérateur ni au dénominateur
    ]
    data_dir = _write_events(tmp_path, "c1", events)
    scene = compute_progress(data_dir, "c1")["scenes"]["s1"]
    assert scene["completion_rate"] == 0.5
    assert scene["n_graded"] == 2
    assert scene["n_ungraded"] == 1
    assert scene["n_learners"] == 3


def test_un_seul_evenement_corrige_suffit_a_publier_un_taux(tmp_path):
    data_dir = _write_events(tmp_path, "c1", [_completed(0, success=True), _completed(1)])
    scene = compute_progress(data_dir, "c1")["scenes"]["s1"]
    assert scene["completion_rate"] == 1.0
    assert scene["n_graded"] == 1
    assert scene["n_ungraded"] == 1


def test_les_cohortes_anterieures_a_la_decision_sont_inchangees(tmp_path):
    """Rétro-compatibilité : les événements déjà écrits portent tous ``success``."""
    events = [_completed(0, success=True), _completed(1, success=True), _completed(2, success=False)]
    data_dir = _write_events(tmp_path, "c1", events)
    scene = compute_progress(data_dir, "c1")["scenes"]["s1"]
    assert scene["completion_rate"] == 2 / 3
    assert scene["n_graded"] == 3
    assert scene["n_ungraded"] == 0
