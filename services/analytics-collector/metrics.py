"""Pure aggregation functions over JSONL telemetry store.

All functions are read-only — they iterate JSONL files in `data_dir/<course>/`
and compute on the fly. No pre-aggregation, no caching: simplicity first
(ACD §4.3 §3.1).
"""

import json
import random
from collections import defaultdict
from pathlib import Path
from typing import Iterator


def _iter_events(
    data_dir: Path,
    course: str,
    bundle_version: str | None = None,
) -> Iterator[dict]:
    """Yield JSON-decoded events from all JSONL files in data_dir/course/.

    M5.7 : si ``bundle_version`` est fourni, ne yield que les events dont
    le champ ``bundle_version`` matche exactement. Les events legacy sans
    champ ``bundle_version`` sont traités comme ``"unversioned"``.
    """
    course_dir = data_dir / course
    if not course_dir.exists():
        return
    for f in sorted(course_dir.glob("*.jsonl")):
        for line in f.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            if bundle_version is not None:
                ev_bv = ev.get("bundle_version", "unversioned")
                if ev_bv != bundle_version:
                    continue
            yield ev


def compute_progress(
    data_dir: Path,
    course: str,
    bundle_version: str | None = None,
) -> dict:
    """Completion rate by scene_id, with n_learners (distinct pseudonyms)."""
    completions: dict[str, list[bool]] = defaultdict(list)
    learners: dict[str, set[str]] = defaultdict(set)
    for ev in _iter_events(data_dir, course, bundle_version=bundle_version):
        if ev.get("type") != "scene_completed":
            continue
        sid = ev.get("scene_id")
        if sid is None:
            continue
        completions[sid].append(bool(ev.get("success", False)))
        pseudo = ev.get("learner_pseudonym")
        if pseudo:
            learners[sid].add(pseudo)
    return {
        "scenes": {
            sid: {
                "completion_rate": sum(1 for s in vals if s) / len(vals) if vals else 0.0,
                "n_learners": len(learners[sid]),
            }
            for sid, vals in completions.items()
        }
    }


def compute_calibration(
    data_dir: Path,
    course: str,
    learner: str | None = None,
    bundle_version: str | None = None,
) -> dict:
    """Brier score on quiz_answered events.

    Brier = mean((confidence - outcome)^2) where outcome = 1.0 if correct else 0.0.
    Lower is better-calibrated.
    """
    items = []
    for ev in _iter_events(data_dir, course, bundle_version=bundle_version):
        if ev.get("type") != "quiz_answered":
            continue
        if learner is not None and ev.get("learner_pseudonym") != learner:
            continue
        confidence = ev.get("confidence")
        correct = ev.get("correct")
        if confidence is None or correct is None:
            continue
        outcome = 1.0 if correct else 0.0
        items.append((float(confidence), outcome))
    if not items:
        return {"brier_score": None, "n_items": 0}
    brier = sum((c - o) ** 2 for c, o in items) / len(items)
    return {"brier_score": brier, "n_items": len(items)}


_REASONING_WEIGHTS: dict[str, float] = {
    "justification": 0.25,
    "hypothesis": 0.20,
    "counterexample": 0.20,
    "synthesis": 0.20,
    "question": 0.15,
}


def compute_reasoning_depth_score(
    data_dir: Path,
    course: str,
    pseudonyme: str | None = None,
    scene_id: str | None = None,
    bundle_version: str | None = None,
) -> dict:
    """Reasoning depth score (M5.2) — score [0, 1] par scène.

    Formule v1 (choix B — binarisé) :
        score = sum(weight[signal] for signal in signals_present_at_least_once)
        weights = {justification: 0.25, hypothesis: 0.20, counterexample: 0.20,
                   synthesis: 0.20, question: 0.15}

    Max théorique = 1.00 quand les 5 signaux sont présents au moins une fois
    pour la (scene_id, pseudonyme). Aucune normalisation par fréquence : la
    présence binaire suffit. Le ``breakdown`` retourné expose les proportions
    par signal pour permettre au frontend d'afficher une distribution.

    Si aucun event ``reasoning_signal`` n'a été reçu pour une scène, la scène
    n'apparaît simplement pas dans le résultat (score ne distingue pas une
    scène "pas jouée" d'une "jouée sans raisonner" côté collector — c'est au
    consommateur de croiser avec scene_entered/scene_completed s'il veut).

    Filtres optionnels : ``pseudonyme`` (1 étudiant) et ``scene_id`` (1 scène).
    """
    # counts[scene_id][signal] = count
    counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for ev in _iter_events(data_dir, course, bundle_version=bundle_version):
        if ev.get("type") != "reasoning_signal":
            continue
        sid = ev.get("scene_id")
        if not sid:
            continue
        if scene_id is not None and sid != scene_id:
            continue
        if pseudonyme is not None and ev.get("learner_pseudonym") != pseudonyme:
            continue
        signal = ev.get("signal")
        if signal not in _REASONING_WEIGHTS:
            continue
        counts[sid][signal] += 1

    scenes: dict[str, dict] = {}
    for sid, by_signal in counts.items():
        total = sum(by_signal.values())
        if total == 0:
            scenes[sid] = {"score": None, "n_signals": 0, "breakdown": {}}
            continue
        # choix B (binarisé) : un signal présent au moins une fois compte 1 × weight.
        score = sum(
            weight for sig, weight in _REASONING_WEIGHTS.items() if by_signal.get(sig, 0) > 0
        )
        # clamp défensif (les poids somment exactement à 1.0 mais le clamp protège
        # toute évolution future de la formule).
        score = max(0.0, min(1.0, score))
        breakdown = {sig: by_signal.get(sig, 0) / total for sig in _REASONING_WEIGHTS}
        scenes[sid] = {
            "score": score,
            "n_signals": total,
            "breakdown": breakdown,
        }
    return {"scenes": scenes}


def compute_ai_audit_accuracy(
    data_dir: Path,
    course: str,
    pseudonyme: str | None = None,
    bundle_version: str | None = None,
) -> dict:
    """AI audit accuracy (M5.3) — score [0, 1] par scène ai_audit / ai_critique.

    Formule par scène :
        accuracy = max(0, (true_positives - false_positives) / planted_errors)
        - planted_errors == 0 → accuracy = None (impossible à scorer)
        - false_positives > true_positives → clampé à 0
        - clamp strict [0, 1]

    Overall = moyenne arithmétique des accuracies par scène (ignore les None).
    Si aucune scène n'est scorable → overall_accuracy = None.

    Filtre optionnel : ``pseudonyme`` (1 étudiant). Si plusieurs events
    ``ai_audit_result`` ciblent la même (scene_id, pseudonyme), on agrège en
    sommant les compteurs (TP/FP/planted/missed) avant de calculer l'accuracy.
    """
    # counters[scene_id] = {tp, fp, planted, missed}
    counters: dict[str, dict[str, int]] = defaultdict(
        lambda: {"tp": 0, "fp": 0, "planted": 0, "missed": 0}
    )
    for ev in _iter_events(data_dir, course, bundle_version=bundle_version):
        if ev.get("type") != "ai_audit_result":
            continue
        sid = ev.get("scene_id")
        if not sid:
            continue
        if pseudonyme is not None and ev.get("learner_pseudonym") != pseudonyme:
            continue
        c = counters[sid]
        c["tp"] += int(ev.get("true_positives", 0))
        c["fp"] += int(ev.get("false_positives", 0))
        c["planted"] += int(ev.get("planted_errors", 0))
        c["missed"] += int(ev.get("missed", 0))

    per_scene: list[dict] = []
    scorable_accuracies: list[float] = []
    for sid, c in counters.items():
        planted = c["planted"]
        tp = c["tp"]
        fp = c["fp"]
        if planted == 0:
            accuracy: float | None = None
        else:
            raw = (tp - fp) / planted
            # clamp strict [0, 1]
            accuracy = max(0.0, min(1.0, raw))
            scorable_accuracies.append(accuracy)
        per_scene.append({
            "scene_id": sid,
            "accuracy": accuracy,
            "true_positives": tp,
            "false_positives": fp,
            "planted_errors": planted,
            "missed": c["missed"],
        })

    overall = (
        sum(scorable_accuracies) / len(scorable_accuracies)
        if scorable_accuracies
        else None
    )
    return {
        "overall_accuracy": overall,
        "n_scenes": len(per_scene),
        "per_scene": per_scene,
    }


def _session_key(ev: dict) -> str | None:
    """Définit une "session" par jour (YYYY-MM-DD du client_timestamp).

    Le schéma TelemetryEvent n'a pas de session_id ; le proxy le plus
    naturel sans état serveur est la journée d'activité. C'est le
    grain utilisé par M5.4 pour la fenêtre roulante de
    ``ai_literacy_index``.
    """
    ts = ev.get("client_timestamp")
    if not ts or len(ts) < 10:
        return None
    return ts[:10]


def _linear_slope(ys: list[float]) -> float:
    """Pente OLS sur y = slope * x + b, x = 0..n-1. Retourne 0.0 si n<2."""
    n = len(ys)
    if n < 2:
        return 0.0
    xs = list(range(n))
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    num = sum((xs[i] - mean_x) * (ys[i] - mean_y) for i in range(n))
    den = sum((xs[i] - mean_x) ** 2 for i in range(n))
    if den == 0:
        return 0.0
    return num / den


def compute_hint_independence_trend(
    data_dir: Path,
    course: str,
    pseudonyme: str | None = None,
    window: int = 10,
    bundle_version: str | None = None,
) -> float | None:
    """hint_independence_trend [0,1] (M5.4, composante de ADR 011).

    Pour chaque session de la fenêtre (les ``window`` plus récentes
    sessions disposant d'au moins un event ``adaptation_applied``
    signal=hint OU d'une autre activité du pseudonyme), on calcule :

        independence_session = 1 - min(1, mean_hint_count / 3)

    où ``mean_hint_count`` est la moyenne du nombre de hints par scène
    sur la session. Normalisation : max théorique = 3 hints/scène
    (au-delà, on clamp à 1).

    Pente OLS simple sur les ``independence_session`` (x = index de
    session ordonnée chronologiquement). Pente normalisée :
        trend = clamp(0, 1, 0.5 + slope * 0.5)
    où slope est lui-même clampé à [-1, 1] avant transformation.

    - slope = 0 (constant) → 0.5
    - slope ≈ +1 (dépendance s'effondre) → 1.0
    - slope ≈ -1 (dépendance augmente) → 0.0

    Si < 3 sessions dans la fenêtre : retourne None (signal trop court).
    """
    # Pour avoir une notion de "session", on doit lister les sessions
    # actives du pseudonyme. On considère qu'une session existe si on
    # voit n'importe quel event du pseudonyme ce jour-là, et on compte
    # les hints (et scènes distinctes pour la moyenne).
    sessions_hints: dict[str, int] = defaultdict(int)
    sessions_scenes: dict[str, set[str]] = defaultdict(set)
    sessions_active: set[str] = set()

    for ev in _iter_events(data_dir, course, bundle_version=bundle_version):
        if pseudonyme is not None and ev.get("learner_pseudonym") != pseudonyme:
            continue
        sk = _session_key(ev)
        if not sk:
            continue
        sessions_active.add(sk)
        sid = ev.get("scene_id")
        if sid:
            sessions_scenes[sk].add(sid)
        if ev.get("type") == "adaptation_applied" and ev.get("signal") == "hint":
            sessions_hints[sk] += 1

    # Tri chronologique des sessions actives, fenêtre = les `window`
    # plus récentes.
    ordered = sorted(sessions_active)[-window:]
    if len(ordered) < 3:
        return None

    independence_per_session: list[float] = []
    for sk in ordered:
        n_hints = sessions_hints.get(sk, 0)
        n_scenes = max(1, len(sessions_scenes.get(sk, set())))
        mean_hint_count = n_hints / n_scenes
        independence = 1.0 - min(1.0, mean_hint_count / 3.0)
        independence_per_session.append(independence)

    slope = _linear_slope(independence_per_session)
    slope_clamped = max(-1.0, min(1.0, slope))
    trend = 0.5 + slope_clamped * 0.5
    return max(0.0, min(1.0, trend))


def _active_sessions_for_pseudonyme(
    data_dir: Path,
    course: str,
    pseudonyme: str,
    bundle_version: str | None = None,
) -> list[str]:
    """Liste triée des journées (YYYY-MM-DD) où le pseudonyme a été actif."""
    sessions: set[str] = set()
    for ev in _iter_events(data_dir, course, bundle_version=bundle_version):
        if ev.get("learner_pseudonym") != pseudonyme:
            continue
        sk = _session_key(ev)
        if sk:
            sessions.add(sk)
    return sorted(sessions)


def _filter_events_to_sessions(
    data_dir: Path,
    course: str,
    pseudonyme: str,
    sessions: set[str],
    bundle_version: str | None = None,
) -> list[dict]:
    """Charge les events du pseudonyme qui tombent dans les sessions données."""
    out: list[dict] = []
    for ev in _iter_events(data_dir, course, bundle_version=bundle_version):
        if ev.get("learner_pseudonym") != pseudonyme:
            continue
        sk = _session_key(ev)
        if sk in sessions:
            out.append(ev)
    return out


def _compute_components_from_events(
    events: list[dict],
    data_dir: Path,
    course: str,
    pseudonyme: str,
    window_sessions: list[str],
) -> tuple[float | None, float | None, float | None]:
    """Recalcule les 3 composantes sur la fenêtre courante (in-memory).

    On garde la sémantique des fonctions existantes mais évalue
    directement à partir d'un sous-ensemble d'events. Plus simple et
    plus rapide que d'appeler récursivement les fonctions globales
    (qui re-scannent tout le disque).
    """
    # --- ai_audit_accuracy ---
    counters: dict[str, dict[str, int]] = defaultdict(
        lambda: {"tp": 0, "fp": 0, "planted": 0}
    )
    # --- critique_completion_rate ---
    n_critique = 0
    sum_completion = 0.0

    for ev in events:
        t = ev.get("type")
        if t == "ai_audit_result":
            sid = ev.get("scene_id")
            if not sid:
                continue
            c = counters[sid]
            c["tp"] += int(ev.get("true_positives", 0))
            c["fp"] += int(ev.get("false_positives", 0))
            c["planted"] += int(ev.get("planted_errors", 0))
        elif t == "critique_submitted":
            n_critique += 1
            sum_completion += float(ev.get("completion_rate", 0))

    scorable: list[float] = []
    for c in counters.values():
        if c["planted"] == 0:
            continue
        raw = (c["tp"] - c["fp"]) / c["planted"]
        scorable.append(max(0.0, min(1.0, raw)))
    ai_audit = (sum(scorable) / len(scorable)) if scorable else None

    critique_rate = (sum_completion / n_critique) if n_critique else None

    # --- hint_independence_trend ---
    # On le recalcule sur la même fenêtre (ordered sessions).
    if len(window_sessions) < 3:
        hint_trend = None
    else:
        sessions_hints: dict[str, int] = defaultdict(int)
        sessions_scenes: dict[str, set[str]] = defaultdict(set)
        for ev in events:
            sk = _session_key(ev)
            if not sk:
                continue
            sid = ev.get("scene_id")
            if sid:
                sessions_scenes[sk].add(sid)
            if ev.get("type") == "adaptation_applied" and ev.get("signal") == "hint":
                sessions_hints[sk] += 1
        independence: list[float] = []
        for sk in window_sessions:
            n_hints = sessions_hints.get(sk, 0)
            n_scenes = max(1, len(sessions_scenes.get(sk, set())))
            mean_hint = n_hints / n_scenes
            independence.append(1.0 - min(1.0, mean_hint / 3.0))
        slope = _linear_slope(independence)
        slope_c = max(-1.0, min(1.0, slope))
        hint_trend = max(0.0, min(1.0, 0.5 + slope_c * 0.5))

    return ai_audit, hint_trend, critique_rate


def _combine_components(
    ai_audit: float | None,
    hint_trend: float | None,
    critique_rate: float | None,
) -> tuple[float | None, bool]:
    """Combine les 3 composantes selon ADR 011.

    Returns (value, degraded). Si toutes manquent → (None, False).
    Sinon redistribue les poids proportionnellement aux présentes.
    """
    weights = {
        "ai_audit": (ai_audit, 0.4),
        "hint_trend": (hint_trend, 0.3),
        "critique": (critique_rate, 0.3),
    }
    present = [(v, w) for (v, w) in weights.values() if v is not None]
    if not present:
        return None, False
    total_weight = sum(w for _, w in present)
    if total_weight == 0:
        return None, False
    value = sum(v * w for v, w in present) / total_weight
    # clamp défensif
    value = max(0.0, min(1.0, value))
    degraded = len(present) < 3
    return value, degraded


def _bootstrap_ic80(
    events_by_session: dict[str, list[dict]],
    window_sessions: list[str],
    n_resamples: int = 1000,
    seed: int = 42,
) -> tuple[float, float] | None:
    """Bootstrap IC 80% sur les sessions de la fenêtre (≥ 5 requis).

    Resample avec remise des sessions, recalcule l'index, retourne
    (p10, p90) sur ``n_resamples`` répétitions.
    """
    n = len(window_sessions)
    if n < 5:
        return None
    rng = random.Random(seed)
    values: list[float] = []
    for _ in range(n_resamples):
        sample = [rng.choice(window_sessions) for _ in range(n)]
        # Sessions de l'échantillon (multiset)
        events: list[dict] = []
        for sk in sample:
            events.extend(events_by_session.get(sk, []))
        # Recalcule sur cet échantillon. Pour le trend, on lui passe
        # la séquence ordonnée des sessions distinctes (le re-sampling
        # ne change pas la pente si on garde l'ordre — choix v1 :
        # on utilise les sessions du sample triées chronologiquement).
        sample_sessions = sorted(set(sample))
        ai, hint, crit = _compute_components_from_events(
            events, Path("."), "", "", sample_sessions,
        )
        value, _ = _combine_components(ai, hint, crit)
        if value is not None:
            values.append(value)
    if len(values) < 10:
        return None
    values.sort()
    p10_idx = int(0.10 * (len(values) - 1))
    p90_idx = int(0.90 * (len(values) - 1))
    return values[p10_idx], values[p90_idx]


def compute_ai_literacy_index(
    data_dir: Path,
    course: str,
    pseudonyme: str,
    window: int = 10,
    bundle_version: str | None = None,
) -> dict:
    """ai_literacy_index (M5.4, ADR 011).

    USAGE FORMATIF UNIQUEMENT — non validé psychométriquement
    (cf. ADR 011 §Limites). Pas de comparaison inter-étudiants.

    Formule v1 :
        index = 0.4 × ai_audit_accuracy
              + 0.3 × hint_independence_trend
              + 0.3 × critique_completion_rate

    Calculé pour ``pseudonyme`` sur la fenêtre roulante des ``window``
    sessions les plus récentes (défaut 10).

    Cas dégradés :
      - 1 ou 2 composantes manquantes → redistribuer les poids
        proportionnellement aux composantes présentes, ``degraded=True``.
      - 3 composantes manquantes → ``value=None``, ``degraded=False``.

    IC 80% : bootstrap 1000 resamples si ≥ 5 sessions, sinon ``None``.

    Retour :
        {
          "value": float | None,
          "ic80": [low, high] | None,
          "n_sessions": int,
          "window": int,
          "degraded": bool,
          "components": {
            "ai_audit_accuracy": float | None,
            "hint_independence_trend": float | None,
            "critique_completion_rate": float | None,
          },
        }
    """
    # 1. Sessions actives du pseudonyme, fenêtre = `window` plus récentes
    all_sessions = _active_sessions_for_pseudonyme(
        data_dir, course, pseudonyme, bundle_version=bundle_version,
    )
    window_sessions = all_sessions[-window:] if window > 0 else []
    n_sessions = len(window_sessions)

    if n_sessions == 0:
        return {
            "value": None,
            "ic80": None,
            "n_sessions": 0,
            "window": window,
            "degraded": False,
            "components": {
                "ai_audit_accuracy": None,
                "hint_independence_trend": None,
                "critique_completion_rate": None,
            },
        }

    window_set = set(window_sessions)
    events = _filter_events_to_sessions(
        data_dir, course, pseudonyme, window_set, bundle_version=bundle_version,
    )

    ai_audit, hint_trend, critique_rate = _compute_components_from_events(
        events, data_dir, course, pseudonyme, window_sessions,
    )
    value, degraded = _combine_components(ai_audit, hint_trend, critique_rate)

    # IC80 bootstrap
    events_by_session: dict[str, list[dict]] = defaultdict(list)
    for ev in events:
        sk = _session_key(ev)
        if sk:
            events_by_session[sk].append(ev)
    ic80 = _bootstrap_ic80(events_by_session, window_sessions) if value is not None else None

    return {
        "value": value,
        "ic80": list(ic80) if ic80 is not None else None,
        "n_sessions": n_sessions,
        "window": window,
        "degraded": degraded,
        "components": {
            "ai_audit_accuracy": ai_audit,
            "hint_independence_trend": hint_trend,
            "critique_completion_rate": critique_rate,
        },
    }


def compute_journal_metrics(
    data_dir,
    course: str,
    pseudonyme: str | None = None,
    bundle_version: str | None = None,
) -> dict:
    """Journal entry counters per (course, pseudonyme?). No text — counters only (ADR 006 v1.3).

    Aggregates ``journal_entry_submitted`` events. The journal text itself
    is never received by the server (kept local in SQLCipher on the learner
    device) — only metadata counters are exposed here :

        - entries_total     : total entries submitted
        - mean_length       : average ``entry_length`` (rounded 1 decimal)
        - revision_rate     : proportion of entries flagged ``is_revision``
        - entries_by_scene  : per-scene {count, mean_length}

    Filtres : ``pseudonyme`` (1 étudiant) et ``bundle_version`` (M5.7).
    """
    entries_by_scene: dict[str, dict] = {}
    total = 0
    sum_length = 0
    revisions = 0
    for ev in _iter_events(data_dir, course, bundle_version=bundle_version):
        if ev.get("type") != "journal_entry_submitted":
            continue
        if pseudonyme and ev.get("learner_pseudonym") != pseudonyme:
            continue
        total += 1
        length = int(ev.get("entry_length", 0))
        sum_length += length
        if ev.get("is_revision"):
            revisions += 1
        sid = ev.get("scene_id", "")
        if sid:
            scene_entry = entries_by_scene.setdefault(sid, {"count": 0, "sum_length": 0})
            scene_entry["count"] += 1
            scene_entry["sum_length"] += length
    return {
        "entries_total": total,
        "mean_length": round(sum_length / total, 1) if total else 0,
        "revision_rate": round(revisions / total, 4) if total else 0,
        "entries_by_scene": {
            sid: {"count": d["count"], "mean_length": round(d["sum_length"] / d["count"], 1)}
            for sid, d in entries_by_scene.items()
        },
    }


def _convergence_quality_from_distribution(dist: list) -> float:
    """Map a Likert-5 distribution to a convergence_quality score in [0,1].

    High score = most votes concentrated on high confidence labels
    (indices 3-4). Uses a normalized weighted mean :
        score = sum(i * count[i]) / (4 * total)

    Index 0 contributes 0, index 4 contributes max — so unanimous "very
    confident" yields 1.0, unanimous "not confident" yields 0.0.
    """
    total = sum(dist)
    if total == 0:
        return 0.0
    weighted = sum(i * c for i, c in enumerate(dist))
    return weighted / (4 * total)


def compute_cooperation_metrics(
    data_dir,
    course: str,
    bundle_version: str | None = None,
) -> dict:
    """Cooperative session aggregates (F2.1, views v0.4).

    Aggregates ``cooperative_vote`` and ``cooperative_convergence`` events.
    M4 LAN runtime that emits these events is deferred — v1 operates on
    POST'ed fixtures only.

    Returns :
        - n_sessions : number of ``cooperative_convergence`` events
          (each marks the close of one cooperative session).
        - votes_per_session_mean : ``n_votes / n_sessions`` (0 if no session).
        - convergence_quality : mean of weighted-Likert convergence scores
          (None if no scorable convergence event).
        - role_coverage_mean : mean of ``role_coverage`` values (None if
          no convergence event carries one).
        - disagreement_productive_ratio : None (v1 limitation — requires
          M4 pre/post vote tracking, not yet emitted).
    """
    votes = 0
    sessions = 0
    convergence_scores: list[float] = []
    role_coverages: list[float] = []
    for ev in _iter_events(data_dir, course, bundle_version=bundle_version):
        t = ev.get("type")
        if t == "cooperative_vote":
            votes += 1
        elif t == "cooperative_convergence":
            sessions += 1
            dist = ev.get("confidence_distribution_aggregated", [])
            if isinstance(dist, list) and len(dist) == 5:
                convergence_scores.append(
                    _convergence_quality_from_distribution(dist)
                )
            rc = ev.get("role_coverage")
            if isinstance(rc, (int, float)):
                role_coverages.append(float(rc))
    return {
        "n_sessions": sessions,
        "votes_per_session_mean": (
            round(votes / sessions, 2) if sessions else 0
        ),
        "convergence_quality": (
            round(sum(convergence_scores) / len(convergence_scores), 4)
            if convergence_scores else None
        ),
        "role_coverage_mean": (
            round(sum(role_coverages) / len(role_coverages), 4)
            if role_coverages else None
        ),
        # v1 : not calculable without pre/post vote tracking — M4 v2 feature.
        "disagreement_productive_ratio": None,
    }


def compute_blueprint_score(blueprint: dict, metric_fetcher) -> dict:
    """Composite blueprint score (ADR 013).

    USAGE FORMATIF UNIQUEMENT. Pas de classement nominatif.

    Pure fonction : prend un blueprint (dict ``{dimensions: [...]}``) + une
    callable ``metric_fetcher(endpoint: str, field: str) -> float | None``.
    Aucune I/O — le routage vers les fns ``compute_*`` réelles est fait par
    l'appelant (cf. endpoint POST /metrics/blueprint).

    Composition :
      - Par dimension : score = sum(w_i * v_i) / sum(w_i) sur les métriques
        dont la valeur n'est pas None. Si toutes les métriques sont None,
        ``score = None`` et ``degraded = True``.
      - ``degraded`` vaut True si au moins une métrique a été ignorée (poids
        redistribué) — y compris quand toutes sont None.
      - Overall : moyenne pondérée des dimensions présentes (score non-None).
        ``None`` si aucune dimension scorable.

    Returns :
        {
          "dimensions": [{"id", "label", "score": float|None, "degraded": bool}],
          "overall_weighted_score": float | None,
        }
    """
    dim_results: list[dict] = []
    overall_sum = 0.0
    overall_weight = 0.0
    for dim in blueprint["dimensions"]:
        valid_metrics: list[tuple[float, float]] = []
        for m in dim["metrics"]:
            val = metric_fetcher(m["endpoint"], m["field"])
            if val is not None:
                valid_metrics.append((float(m["weight_in_dimension"]), float(val)))
        if not valid_metrics:
            dim_results.append({
                "id": dim["id"],
                "label": dim["label"],
                "score": None,
                "degraded": True,
            })
            continue
        total_weight = sum(w for w, _ in valid_metrics)
        score = sum(w * v for w, v in valid_metrics) / total_weight
        degraded = len(valid_metrics) < len(dim["metrics"])
        dim_results.append({
            "id": dim["id"],
            "label": dim["label"],
            "score": round(score, 4),
            "degraded": degraded,
        })
        overall_sum += float(dim["weight"]) * score
        overall_weight += float(dim["weight"])
    overall = round(overall_sum / overall_weight, 4) if overall_weight > 0 else None
    return {"dimensions": dim_results, "overall_weighted_score": overall}


def compute_autonomy(
    data_dir: Path,
    course: str,
    bundle_version: str | None = None,
) -> dict:
    """Anti-offloading metrics: autonomy_ratio + critique_completion_rate.

    - autonomy_ratio = n_critique_submitted / (n_critique_submitted + n_hints_applied)
    - critique_completion_rate = mean(completion_rate of critique_submitted events)
    """
    n_critique = 0
    sum_completion = 0.0
    n_hints = 0
    for ev in _iter_events(data_dir, course, bundle_version=bundle_version):
        t = ev.get("type")
        if t == "critique_submitted":
            n_critique += 1
            sum_completion += float(ev.get("completion_rate", 0))
        elif t == "adaptation_applied" and ev.get("signal") == "hint":
            n_hints += 1
    total = n_critique + n_hints
    return {
        "critique_completion_rate": (sum_completion / n_critique) if n_critique else 0.0,
        "autonomy_ratio": (n_critique / total) if total else 0.0,
        "n_critique": n_critique,
        "n_hints": n_hints,
    }


def compute_progress_metrics(bundle: dict | None = None) -> dict:
    """Compute progress metrics from a bundle, counting scenes with evidence.

    Counts:
    - scenes_total: total number of scenes in the bundle
    - scenes_with_evidence: number of scenes with non-null evidence field

    If bundle is None, returns zeros.
    """
    scenes_with_evidence = 0
    scenes_total = 0
    if bundle is not None:
        scenes = bundle.get("scenes", [])
        scenes_total = len(scenes)
        scenes_with_evidence = sum(1 for s in scenes if s.get("evidence") is not None)

    return {
        "scenes_with_evidence": scenes_with_evidence,
        "scenes_total": scenes_total,
    }
