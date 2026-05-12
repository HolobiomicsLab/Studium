"""Unit tests for ai_literacy_index (M5.4, ADR 011).

Formule v1 :
    index = 0.4 × ai_audit_accuracy
          + 0.3 × hint_independence_trend
          + 0.3 × critique_completion_rate

Calcul par pseudonyme, fenêtre roulante 10 sessions (configurable).

Garde-fous ADR 011 :
- usage formatif uniquement (non validé psychométriquement)
- pseudonyme obligatoire au niveau endpoint (testé en intégration)

Une "session" est définie ici comme la journée d'activité (YYYY-MM-DD
extraite de client_timestamp). Le schéma n'a pas de session_id explicite ;
on regroupe donc les events par jour pour le pseudonyme considéré.
"""

import json
from pathlib import Path

from metrics import compute_ai_literacy_index


def _base(idx=0, pseudo="hmac:learner0", ts="2026-05-12T10:00:00Z"):
    return {
        "event_id": f"01923456-7890-1234-5678-abcdef01234{idx % 10}",
        "learner_pseudonym": pseudo,
        "lesson_id": "l1",
        "bundle_version": "1.0.0",
        "client_timestamp": ts,
    }


def _audit(idx, scene_id, tp, fp, planted, missed,
           pseudo="hmac:learner0", ts="2026-05-12T10:00:00Z"):
    return {
        **_base(idx, pseudo, ts),
        "type": "ai_audit_result",
        "scene_id": scene_id,
        "true_positives": tp,
        "false_positives": fp,
        "planted_errors": planted,
        "missed": missed,
    }


def _hint(idx, scene_id, pseudo="hmac:learner0",
          ts="2026-05-12T10:00:00Z"):
    return {
        **_base(idx, pseudo, ts),
        "type": "adaptation_applied",
        "rule_id": "r1",
        "signal": "hint",
        "modulator": "M3",
        "value": 1.0,
    }


def _critique(idx, scene_id, completion_rate=1.0,
              pseudo="hmac:learner0", ts="2026-05-12T10:00:00Z"):
    return {
        **_base(idx, pseudo, ts),
        "type": "critique_submitted",
        "scene_id": scene_id,
        "llm_score": 0.8,
        "completion_rate": completion_rate,
    }


def _write_events(tmp_path: Path, course: str, events: list[dict]) -> Path:
    d = tmp_path / course
    d.mkdir(parents=True, exist_ok=True)
    f = d / "2026-05-12.jsonl"
    f.write_text("\n".join(json.dumps(e) for e in events) + "\n")
    return d.parent


def _day(n: int) -> str:
    """Helper : produit un timestamp YYYY-MM-DDTHH... pour le jour n."""
    return f"2026-05-{1 + n:02d}T10:00:00Z"


def test_ai_literacy_basic_all_components(tmp_path):
    """3 composantes toutes 0.8 (approx) → index = 0.8, degraded=false.

    Setup : 3 sessions (3 jours), même pseudonyme.
    - ai_audit_accuracy = 0.8 (TP=4, FP=0, planted=5 → 0.8 par scène)
    - critique_completion_rate = 0.8 (toutes les sessions)
    - hint_independence_trend : peu importe sa valeur exacte, on cible
      ≈ 0.5 (trend plat). Ici on teste juste la composition.
    """
    pseudo = "hmac:l1"
    events: list[dict] = []
    for i in range(3):
        ts = _day(i)
        # ai_audit : 4/5
        events.append(_audit(i, f"s_audit_{i}", tp=4, fp=0, planted=5,
                             missed=1, pseudo=pseudo, ts=ts))
        # critique 0.8
        events.append(_critique(10 + i, f"s_crit_{i}",
                                completion_rate=0.8, pseudo=pseudo, ts=ts))
        # hints constants (1 par session) → trend ~ 0.5
        events.append(_hint(20 + i, f"s_x_{i}", pseudo=pseudo, ts=ts))

    data_dir = _write_events(tmp_path, "c1", events)
    result = compute_ai_literacy_index(data_dir, "c1", pseudonyme=pseudo)

    assert result["degraded"] is False
    assert result["n_sessions"] == 3
    assert result["window"] == 10
    comps = result["components"]
    assert abs(comps["ai_audit_accuracy"] - 0.8) < 1e-9
    assert abs(comps["critique_completion_rate"] - 0.8) < 1e-9
    # hint_independence_trend : constant → 0.5
    assert abs(comps["hint_independence_trend"] - 0.5) < 1e-9
    # index = 0.4×0.8 + 0.3×0.5 + 0.3×0.8 = 0.32 + 0.15 + 0.24 = 0.71
    expected = 0.4 * 0.8 + 0.3 * 0.5 + 0.3 * 0.8
    assert abs(result["value"] - expected) < 1e-9


def test_degraded_one_missing(tmp_path):
    """ai_audit_accuracy=None + 2 autres → redistribution + degraded=true.

    Setup : pas d'event ai_audit_result. critique=0.5, hint trend=0.5
    (constant). Poids redistribués : 0.3 + 0.3 = 0.6 → chaque ×(1/0.6)
    pour normaliser. Résultat : 0.5 × (0.3/0.6) + 0.5 × (0.3/0.6) = 0.5.
    """
    pseudo = "hmac:l1"
    events: list[dict] = []
    for i in range(3):
        ts = _day(i)
        events.append(_critique(i, f"s_crit_{i}", completion_rate=0.5,
                                pseudo=pseudo, ts=ts))
        events.append(_hint(10 + i, f"s_x_{i}", pseudo=pseudo, ts=ts))

    data_dir = _write_events(tmp_path, "c1", events)
    result = compute_ai_literacy_index(data_dir, "c1", pseudonyme=pseudo)

    assert result["degraded"] is True
    assert result["components"]["ai_audit_accuracy"] is None
    assert abs(result["value"] - 0.5) < 1e-9


def test_all_components_missing(tmp_path):
    """Aucune composante calculable → value=None, degraded=false."""
    pseudo = "hmac:l1"
    # Aucun event utile (juste un scene_entered qui n'alimente aucune métrique)
    events = [{
        **_base(0, pseudo),
        "type": "scene_entered",
        "scene_id": "s1",
        "scene_type": "lecture",
    }]
    data_dir = _write_events(tmp_path, "c1", events)
    result = compute_ai_literacy_index(data_dir, "c1", pseudonyme=pseudo)

    assert result["value"] is None
    assert result["degraded"] is False
    # Le pseudonyme a 1 event (scene_entered) → 1 session active, mais
    # aucune composante n'est calculable.
    assert result["components"]["ai_audit_accuracy"] is None
    assert result["components"]["hint_independence_trend"] is None
    assert result["components"]["critique_completion_rate"] is None
    assert result["ic80"] is None


def test_window_truncation(tmp_path):
    """15 sessions disponibles, window=10 → seuls les 10 plus récents comptent.

    On vérifie que n_sessions ≤ window.
    """
    pseudo = "hmac:l1"
    events: list[dict] = []
    for i in range(15):
        ts = _day(i)
        events.append(_audit(i, f"s_audit_{i}", tp=4, fp=0, planted=5,
                             missed=1, pseudo=pseudo, ts=ts))
        events.append(_critique(20 + i, f"s_crit_{i}",
                                completion_rate=0.8, pseudo=pseudo, ts=ts))
        events.append(_hint(40 + i, f"s_x_{i}", pseudo=pseudo, ts=ts))

    data_dir = _write_events(tmp_path, "c1", events)
    result = compute_ai_literacy_index(data_dir, "c1", pseudonyme=pseudo,
                                       window=10)
    assert result["n_sessions"] == 10
    assert result["window"] == 10


def test_hint_independence_trend_decreasing_dependency(tmp_path):
    """Hints décroissants (5, 3, 1) → slope positive → trend > 0.5."""
    from metrics import compute_hint_independence_trend
    pseudo = "hmac:l1"
    events: list[dict] = []
    # session 0 : 5 hints
    for h in range(5):
        events.append(_hint(h, f"s_a_{h}", pseudo=pseudo, ts=_day(0)))
    # session 1 : 3 hints
    for h in range(3):
        events.append(_hint(10 + h, f"s_b_{h}", pseudo=pseudo, ts=_day(1)))
    # session 2 : 1 hint
    events.append(_hint(20, "s_c", pseudo=pseudo, ts=_day(2)))

    data_dir = _write_events(tmp_path, "c1", events)
    trend = compute_hint_independence_trend(data_dir, "c1", pseudonyme=pseudo)
    assert trend is not None
    # Indépendance croissante → pente positive → > 0.5
    assert trend > 0.5


def test_hint_independence_trend_constant(tmp_path):
    """Hints constants → slope=0 → trend=0.5."""
    from metrics import compute_hint_independence_trend
    pseudo = "hmac:l1"
    events: list[dict] = []
    # 4 sessions, 2 hints chacune
    for s in range(4):
        for h in range(2):
            events.append(_hint(s * 10 + h, f"s_{s}_{h}",
                                pseudo=pseudo, ts=_day(s)))
    data_dir = _write_events(tmp_path, "c1", events)
    trend = compute_hint_independence_trend(data_dir, "c1", pseudonyme=pseudo)
    assert trend is not None
    assert abs(trend - 0.5) < 1e-9


def test_hint_independence_trend_lt_3_sessions_returns_none(tmp_path):
    """< 3 sessions → None (pas assez de données pour tendance)."""
    from metrics import compute_hint_independence_trend
    pseudo = "hmac:l1"
    events = [
        _hint(0, "s_a", pseudo=pseudo, ts=_day(0)),
        _hint(1, "s_b", pseudo=pseudo, ts=_day(1)),
    ]
    data_dir = _write_events(tmp_path, "c1", events)
    trend = compute_hint_independence_trend(data_dir, "c1", pseudonyme=pseudo)
    assert trend is None


def test_ic80_bootstrap_valid_range(tmp_path):
    """≥ 5 sessions → IC80 calculé, low ≤ value ≤ high (≈)."""
    pseudo = "hmac:l1"
    events: list[dict] = []
    for i in range(6):
        ts = _day(i)
        # variation : TP varie un peu pour produire un peu de variance
        tp = 3 + (i % 2)  # alterne 3/4
        events.append(_audit(i, f"s_audit_{i}", tp=tp, fp=0, planted=5,
                             missed=5 - tp, pseudo=pseudo, ts=ts))
        events.append(_critique(20 + i, f"s_crit_{i}",
                                completion_rate=0.7, pseudo=pseudo, ts=ts))
        events.append(_hint(40 + i, f"s_x_{i}", pseudo=pseudo, ts=ts))

    data_dir = _write_events(tmp_path, "c1", events)
    result = compute_ai_literacy_index(data_dir, "c1", pseudonyme=pseudo)

    assert result["ic80"] is not None
    low, high = result["ic80"]
    assert 0.0 <= low <= 1.0
    assert 0.0 <= high <= 1.0
    assert low <= high
    # IC80 doit raisonnablement encadrer la valeur (laisse marge bootstrap)
    assert low - 0.1 <= result["value"] <= high + 0.1


def test_ic80_skip_under_5_sessions(tmp_path):
    """< 5 sessions → ic80=null."""
    pseudo = "hmac:l1"
    events: list[dict] = []
    for i in range(3):
        ts = _day(i)
        events.append(_audit(i, f"s_audit_{i}", tp=4, fp=0, planted=5,
                             missed=1, pseudo=pseudo, ts=ts))
        events.append(_critique(20 + i, f"s_crit_{i}",
                                completion_rate=0.8, pseudo=pseudo, ts=ts))
        events.append(_hint(40 + i, f"s_x_{i}", pseudo=pseudo, ts=ts))

    data_dir = _write_events(tmp_path, "c1", events)
    result = compute_ai_literacy_index(data_dir, "c1", pseudonyme=pseudo)
    assert result["ic80"] is None
    assert result["n_sessions"] == 3
