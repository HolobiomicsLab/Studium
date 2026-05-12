"""JSONL append-only event store, partitioned by course token + UTC date.

Inclut également les snapshots quotidiens de maîtrise par concept
(M5.1, ADR 006 amendment v1.1) : latest-wins par jour pour chaque
couple ``(pseudonyme, concept_id)``, stockés dans
``{course}/{YYYY-MM-DD}/concept_mastery.jsonl`` (read-modify-rewrite simple).
Agrégation à la lecture comme les autres metrics (pas de pré-agrégat).
"""

import json
import os
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Optional

from pydantic import BaseModel


def _data_dir() -> Path:
    return Path(os.environ.get("ANALYTICS_DATA_DIR", "data"))


def append_events(course_token: str, events: list[BaseModel]) -> int:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    target = _data_dir() / course_token / f"{today}.jsonl"
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("a", encoding="utf-8") as f:
        for ev in events:
            f.write(ev.model_dump_json() + "\n")
    return len(events)


def read_events_for_course(
    data_dir: Path,
    course: str,
    bundle_version: Optional[str] = None,
) -> list[dict]:
    """Lit tous les events d'un course (M5.7).

    Si ``bundle_version`` est fourni, ne retourne que les events dont le
    champ ``bundle_version`` matche exactement. Les events legacy sans
    champ ``bundle_version`` sont traités comme ``"unversioned"``.
    """
    course_dir = data_dir / course
    if not course_dir.exists():
        return []
    out: list[dict] = []
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
            out.append(ev)
    return out


# ----------------------------------------------------------------------------
# concept_mastery_history (M5.1)
# ----------------------------------------------------------------------------

_MASTERY_FILENAME = "concept_mastery.jsonl"
_MASTERY_TRIGGER_EVENTS = frozenset({"lesson_completed", "scene_completed"})


def _mastery_path(data_dir: Path, course: str, day: date) -> Path:
    return data_dir / course / day.isoformat() / _MASTERY_FILENAME


def _mastery_key(row: dict) -> tuple[str, str]:
    return (row.get("pseudonyme", ""), row.get("concept_id", ""))


def record_concept_mastery_snapshot(
    data_dir: Path,
    course: str,
    day: date,
    pseudonyme: str,
    concept_id: str,
    alpha: float,
    beta: float,
    n_attempts: int,
) -> None:
    """Écrit une ligne snapshot (latest-wins par jour pour (pseudonyme, concept_id)).

    Stratégie : read-modify-rewrite. Suffisant pour le prototype (volume faible,
    pas de concurrence cross-process attendue côté collector).
    """
    path = _mastery_path(data_dir, course, day)
    path.parent.mkdir(parents=True, exist_ok=True)

    denom = alpha + beta
    mastery = (alpha / denom) if denom > 0 else 0.0
    new_row = {
        "pseudonyme": pseudonyme,
        "concept_id": concept_id,
        "alpha": float(alpha),
        "beta": float(beta),
        "n_attempts": int(n_attempts),
        "mastery": mastery,
    }

    existing: list[dict] = []
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                existing.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    target_key = (pseudonyme, concept_id)
    replaced = False
    out_rows: list[dict] = []
    for row in existing:
        if _mastery_key(row) == target_key:
            if not replaced:
                out_rows.append(new_row)
                replaced = True
            # else: drop duplicate lines for same key (defensive)
        else:
            out_rows.append(row)
    if not replaced:
        out_rows.append(new_row)

    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        for row in out_rows:
            f.write(json.dumps(row, sort_keys=True) + "\n")
    tmp.replace(path)


def read_concept_mastery_history(
    data_dir: Path,
    course: str,
    pseudonyme: Optional[str] = None,
    since: Optional[date] = None,
    concept_id: Optional[str] = None,
) -> dict[str, list[dict]]:
    """Retourne ``{concept_id: [{date, pseudonyme, alpha, beta, mastery, n_attempts}, ...]}``.

    Trié par date croissante. Filtres optionnels appliqués au moment de la lecture.
    """
    course_dir = data_dir / course
    if not course_dir.exists():
        return {}

    out: dict[str, list[dict]] = {}
    for day_dir in sorted(p for p in course_dir.iterdir() if p.is_dir()):
        # day_dir name is a YYYY-MM-DD string
        try:
            d = date.fromisoformat(day_dir.name)
        except ValueError:
            continue
        if since is not None and d < since:
            continue
        path = day_dir / _MASTERY_FILENAME
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if pseudonyme is not None and row.get("pseudonyme") != pseudonyme:
                continue
            cid = row.get("concept_id")
            if cid is None:
                continue
            if concept_id is not None and cid != concept_id:
                continue
            out.setdefault(cid, []).append({
                "date": d.isoformat(),
                "pseudonyme": row.get("pseudonyme"),
                "alpha": row.get("alpha"),
                "beta": row.get("beta"),
                "mastery": row.get("mastery"),
                "n_attempts": row.get("n_attempts"),
            })
    # Tri par date croissante (les jours étaient déjà parcourus dans l'ordre,
    # mais on reste défensif si plusieurs sessions ont écrit dans le même jour).
    for cid in out:
        out[cid].sort(key=lambda r: r["date"])
    return out


def _parse_event_day(event: dict) -> date:
    ts = event.get("client_timestamp")
    if isinstance(ts, str):
        try:
            # Supporte le suffixe Z (UTC) en remplaçant par +00:00 pour fromisoformat
            normalized = ts.replace("Z", "+00:00")
            return datetime.fromisoformat(normalized).date()
        except ValueError:
            pass
    return datetime.now(timezone.utc).date()


def process_event_for_mastery(data_dir: Path, course: str, event: dict) -> int:
    """Si l'event est ``lesson_completed`` ou ``scene_completed`` et contient
    ``concept_states``, écrit un snapshot de maîtrise par concept.

    Retourne le nombre de snapshots écrits (0 si l'event est ignoré).
    """
    if not isinstance(event, dict):
        return 0
    if event.get("type") not in _MASTERY_TRIGGER_EVENTS:
        return 0
    concept_states = event.get("concept_states")
    if not isinstance(concept_states, dict) or not concept_states:
        return 0
    pseudonyme = event.get("learner_pseudonym")
    if not isinstance(pseudonyme, str) or not pseudonyme:
        return 0
    day = _parse_event_day(event)

    n_written = 0
    for cid, state in concept_states.items():
        if not isinstance(state, dict):
            continue
        try:
            alpha = float(state.get("alpha"))
            beta = float(state.get("beta"))
        except (TypeError, ValueError):
            continue
        n_attempts = int(state.get("n_attempts", 0) or 0)
        record_concept_mastery_snapshot(
            data_dir, course, day, pseudonyme, str(cid),
            alpha=alpha, beta=beta, n_attempts=n_attempts,
        )
        n_written += 1
    return n_written
