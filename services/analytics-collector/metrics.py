"""Pure aggregation functions over JSONL telemetry store.

All functions are read-only — they iterate JSONL files in `data_dir/<course>/`
and compute on the fly. No pre-aggregation, no caching: simplicity first
(ACD §4.3 §3.1).
"""

import json
import os
import random
from collections import defaultdict
from pathlib import Path
from typing import Iterator

#: The smallest cohort a class-level number may be computed over. Its value is the product
#: owner's (RGPD), and it lives here — the deepest module both the live collector and the
#: offline `tools/class_report.py` already share — so there is exactly one definition
#: (INT-STUDIUM-005). `class_report.MIN_LEARNERS_DEFAULT` and the Observatory's
#: `min_learners` are this object.
#:
#: It is a RESTRAINT ON SINGLING OUT, not a guarantee of anonymity: k-anonymity protects
#: against a reader who does not know the population, and the teacher of a class does know it
#: (INT-STUDIUM-030). What it delivers is that this instrument does not become a per-student
#: report by accident, by drill-down, or by patient reading over time.
MIN_LEARNERS = 5

#: Server-side override, read per request like `ANALYTICS_DATA_DIR`. Deliberately NOT a query
#: parameter: the floor restrains the reader, so the reader must not be able to lift it.
ENV_MIN_LEARNERS = "ANALYTICS_MIN_LEARNERS"


def min_learners() -> int:
    raw = (os.environ.get(ENV_MIN_LEARNERS) or "").strip()
    try:
        return int(raw) if raw else MIN_LEARNERS
    except ValueError:
        return MIN_LEARNERS


#: Where a judgement cohort's band changes. A band is what a judgement metric publishes about
#: its population INSTEAD of an exact size: an exact count moves once per contributor, and each
#: move is an event a reader holding the roster can time against it (INT-STUDIUM-030, R1).
BAND_EDGES = (10, 20)

#: The sentence every judgement metric carries, wherever it is published. It lives here, with
#: the floor, because three surfaces publish these metrics — the Observatory operator page, the
#: live endpoints, and `tools/class_report.py` — and a sentence copied three times is a sentence
#: that will say three different things (the TS/Py `over_distrust` drift is the precedent).
NON_ATTRIBUTION = (
    "class-level reading over the contributors this family names, and not a statement about "
    "any student: it describes how a group judged, and no control on this surface narrows it "
    "to a person")


def cohort_band(size: int, floor: int | None = None) -> str:
    """A judgement cohort's size as a band: `5-9`, `10-19`, `20+` at the default floor of 5.

    The lowest band starts at the floor, because a cohort under the floor was never published,
    and each later band starts at its edge. What the reader gains is the order of magnitude
    that makes a judgement metric interpretable; what they lose is the per-read increment.
    """
    floor = min_learners() if floor is None else floor
    lower = floor
    for edge in BAND_EDGES:
        if size < edge:
            return f"{lower}\u2013{edge - 1}"
        lower = max(edge, floor)
    return f"{lower}+"


class Population:
    """The population a number was ACTUALLY computed over, accumulated where it is computed.

    R1 requires every published number to name its population, that the population be counted
    by exactly one rule, and that the rule operate inside one lesson. This class is that rule,
    used at the point of accumulation rather than re-derived afterwards from a second predicate
    — a second predicate is a second definition, and it drifts.

    The member of a population is a `(lesson, identity)` pair because a pseudonym is
    `HMAC(learnerId:lessonId)`: within ONE lesson those identities are people, and across
    lessons the same human holds one per lesson, so a union counts learner-lesson pairs. The
    payload says which of the two it is rather than calling both "learners".
    """

    def __init__(self) -> None:
        self._per_lesson: dict[str, set[str]] = defaultdict(set)
        self.unknown_identity = False

    def add(self, lesson: object, identity: object) -> None:
        """Count one contributor. Either half missing makes the population unestablished:
        an event that cannot be attributed to a person within a lesson cannot be counted by
        the one rule, and silently dropping it would report a cohort smaller than the one the
        number was computed over — the wrong side of a privacy floor to be wrong on."""
        if not isinstance(lesson, str) or not lesson or not isinstance(identity, str) or not identity:
            self.unknown_identity = True
            return
        self._per_lesson[lesson].add(identity)

    def add_event(self, ev: dict) -> None:
        """`add` for a telemetry event, using the ADR-006 identity fields."""
        self.add(ev.get("lesson_id"), ev.get("learner_pseudonym"))

    def merge(self, other: "Population") -> None:
        """Absorb another population — for a number aggregated from parts, whose own
        population is the union of the parts that fed it and never the whole store."""
        for lesson, ids in other._per_lesson.items():
            self._per_lesson[lesson] |= ids
        self.unknown_identity = self.unknown_identity or other.unknown_identity

    @property
    def n_lessons(self) -> int:
        return len(self._per_lesson)

    @property
    def size(self) -> int:
        """Members across every lesson: people when `n_lessons <= 1`, learner-lesson pairs
        otherwise. `counts_note` is what says which, and travels with the number."""
        return sum(len(ids) for ids in self._per_lesson.values())

    @property
    def counts_note(self) -> str:
        return ("distinct learners within one lesson" if self.n_lessons <= 1
                else "learner-lesson pairs across the lessons in scope")

    def below_floor(self, floor: int | None = None) -> bool:
        """True when ANY lesson that contributed is under the floor. Per lesson, because a
        union across lessons counts pairs and cannot lift one lesson over the floor."""
        floor = min_learners() if floor is None else floor
        if self.unknown_identity or not self._per_lesson:
            return True
        return any(len(ids) < floor for ids in self._per_lesson.values())

    def judgement(self, floor: int | None = None) -> dict:
        """What a judgement metric publishes about its own population: the band, the unit the
        band counts, and what the number is not. `cohort_band` is `None` — never a placeholder
        size — when no population could be established."""
        if self.unknown_identity:
            return {"cohort_band": None,
                    "cohort_counts": ("no population: at least one counted event carries no "
                                      "learner_pseudonym or no lesson_id"),
                    "non_attribution": NON_ATTRIBUTION}
        if not self._per_lesson:
            # Distinct from the line above, and the distinction is the whole point: nobody
            # contributed, versus contributors who could not be counted by the one rule. One
            # is an empty store, the other is a defect in the events; reading the second
            # message on the first sends the reader looking for a fault that is not there.
            return {"cohort_band": None,
                    "cohort_counts": "no contributors: this number was computed over nobody",
                    "non_attribution": NON_ATTRIBUTION}
        return {"cohort_band": cohort_band(self.size, floor),
                "cohort_counts": self.counts_note,
                "non_attribution": NON_ATTRIBUTION}


def cohort_state(
    data_dir: Path,
    course: str,
    bundle_version: str | None = None,
    floor: int | None = None,
) -> dict | None:
    """`None` when every lesson on this course clears the floor; otherwise the payload an
    aggregate endpoint returns INSTEAD of its numbers.

    The unit is the LESSON, because a pseudonym is HMAC(learnerId:lessonId): a union across
    lessons counts learner-lesson pairs and cannot lift any one lesson over the floor. The
    Observatory applies the same rule to the same store (`_cohort_state`); this is that rule
    where the numbers are actually served.

    The payload states the floor and never the cohort. Publishing the count would invert the
    floor — the only cohorts named exactly would be the ones it exists to protect.

    A course with NO events passes through, and its endpoint returns its own empty aggregate:
    there is nobody to protect, an empty aggregate already says so unambiguously, and turning
    "no data" into "suppressed" would tell an operator with a wrong course token that they had
    found a class too small to report on.

    The unit is the course cohort, which is coarser than the Observatory's per-family floor
    (`_family_state` there floors each metric family over its own contributors). That is
    deliberate here: this is the last check before the wire, and a conservative floor at the
    boundary is the right way round to be wrong.
    """
    floor = min_learners() if floor is None else floor
    participants: dict[str, set[str]] = defaultdict(set)
    unknown_identity = False
    seen = False
    for ev in _iter_events(data_dir, course, bundle_version=bundle_version):
        seen = True
        pseudo, lesson = ev.get("learner_pseudonym"), ev.get("lesson_id")
        if not isinstance(pseudo, str) or not pseudo or not isinstance(lesson, str) or not lesson:
            unknown_identity = True
            continue
        participants[lesson].add(pseudo)

    if not seen:
        return None
    if unknown_identity:
        return {"status": "suppressed", "min_learners": floor,
                "reason": "unknown identity: at least one event carries no learner_pseudonym "
                          "or no lesson_id, so no cohort can be established. A pseudonym is "
                          "HMAC(learnerId:lessonId) — a person within ONE lesson."}
    if not participants:
        return None
    if any(len(ids) < floor for ids in participants.values()):
        return {"status": "suppressed", "min_learners": floor,
                "reason": f"k-anonymity floor: every lesson needs at least {floor} distinct "
                          f"learners and at least one lesson on this course has fewer. Because "
                          f"a pseudonym is salted per lesson, a union across lessons counts "
                          f"learner-lesson pairs and cannot lift a lesson over the floor. "
                          f"Exact counts are withheld."}
    return None


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


# ADR 006 amendment v1.4 (RC-2) — anti-offloading scope.
# `critique_submitted` is reused by three active-learning scene types. The
# autonomy / AI-literacy aggregates are defined as an AI-CRITIQUE signal, so we
# count ai_critique and its auditor variant spot_the_flaw (learner-as-auditor of
# deliberately-flawed AI content — same anti-offloading construct), but NOT
# explain_back (teach-back is a comprehension signal, not AI-critique). Legacy
# untagged events predate the discriminator → treated as ai_critique (back-compat).
_AUTONOMY_CRITIQUE_SCENE_TYPES = frozenset({"ai_critique", "spot_the_flaw"})


def _is_autonomy_critique(ev: dict) -> bool:
    """True if a ``critique_submitted`` event counts toward the anti-offloading
    (autonomy / AI-literacy) aggregates. Untagged legacy events → ai_critique."""
    scene_type = ev.get("scene_type")
    if scene_type is None:
        return True  # back-compat: pre-v1.4 events bucket as ai_critique
    return scene_type in _AUTONOMY_CRITIQUE_SCENE_TYPES


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


def compute_course_completion(
    data_dir: Path,
    course: str,
    bundle_version: str | None = None,
) -> dict:
    """Class-level course-spine funnel: distinct completers per lesson.

    For each lesson_id seen in ``lesson_completed`` telemetry (lesson_id ==
    bundle_id, stamped on every event), count the DISTINCT ``learner_pseudonym``
    that completed it. The dashboard overlays the CourseSchema spine (order +
    prerequisites) on top of these counts.

    HONESTY BOUNDARY: the telemetry ``learner_pseudonym`` is salted by bundle_id,
    so the SAME human has a DIFFERENT pseudonym in each lesson. Distinct counts
    are therefore valid WITHIN a lesson, but per-individual cross-lesson paths
    (did the learner who finished A go on to finish B?) are NOT recoverable from
    telemetry by design — that identity lives only in the cross-lesson profile
    store. This funnel makes no per-individual cross-lesson claim.

    Returns::
        {
          "lessons": { lesson_id: { "n_completed": <distinct pseudonyms> } },
          "total_completions": <count of lesson_completed events>,
        }
    """
    by_lesson: dict[str, set[str]] = defaultdict(set)
    total = 0
    for ev in _iter_events(data_dir, course, bundle_version=bundle_version):
        if ev.get("type") != "lesson_completed":
            continue
        lesson_id = ev.get("lesson_id")
        if not lesson_id:
            continue
        total += 1
        pseudo = ev.get("learner_pseudonym")
        if pseudo:
            by_lesson[lesson_id].add(pseudo)
        else:
            by_lesson[lesson_id]  # touch so a pseudonym-less completion still registers the lesson
    return {
        "lessons": {lid: {"n_completed": len(ps)} for lid, ps in by_lesson.items()},
        "total_completions": total,
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
    # R1: the population is accumulated HERE, on the events actually scored, not re-derived
    # afterwards from a second predicate that would drift from this one.
    population = Population()
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
        population.add_event(ev)
    if not items:
        return {"brier_score": None, "n_items": 0, "judgement": population.judgement()}
    brier = sum((c - o) ** 2 for c, o in items) / len(items)
    return {"brier_score": brier, "n_items": len(items), "judgement": population.judgement()}


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
    floor: int | None = None,
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

    R1 (INT-STUDIUM-030 stage 2) — une scène est une population à elle seule, plus étroite que
    la cohorte du cours que l'endpoint contrôle : un score de raisonnement sur une scène jouée
    par une seule personne est le score de cette personne sous un autre nom. Chaque scène porte
    donc sa propre population, en bande, et une scène sous le plancher n'est pas publiée — le
    payload dit qu'il y en a eu, jamais combien. ``floor=0`` lit la formule brute ; la valeur
    par défaut est celle qui se publie, pour qu'un appelant qui oublie l'argument retienne
    plutôt qu'il ne divulgue.
    """
    # counts[scene_id][signal] = count
    counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    scene_population: dict[str, Population] = defaultdict(Population)
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
        scene_population[sid].add_event(ev)

    scenes: dict[str, dict] = {}
    for sid, by_signal in counts.items():
        total = sum(by_signal.values())
        if total == 0:
            scenes[sid] = {"score": None, "n_signals": 0, "breakdown": {},
                           **scene_population[sid].judgement(floor)}
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
            **scene_population[sid].judgement(floor),
        }
    floor = min_learners() if floor is None else floor
    withheld = [sid for sid in scenes if scene_population[sid].below_floor(floor)]
    if floor > 0 and withheld:
        scenes = {sid: row for sid, row in scenes.items() if sid not in withheld}
    population = Population()
    for sid in scenes:
        population.merge(scene_population[sid])
    # A payload of judgement rows carries the judgement block too: the sentence saying what
    # these numbers are not belongs on the surface that publishes them, not only in the rows.
    return {"scenes": scenes, "withheld_below_floor": bool(floor > 0 and withheld),
            "judgement": population.judgement(floor)}


def compute_ai_audit_accuracy(
    data_dir: Path,
    course: str,
    pseudonyme: str | None = None,
    bundle_version: str | None = None,
    floor: int | None = None,
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

    R1 (INT-STUDIUM-030 stage 2) — même population, même plancher que
    ``compute_trust_calibration``, et pour la même raison : ces deux surfaces lisent les mêmes
    ``ai_audit_result``, et une accuracy par scène auditée par une seule personne est
    l'accuracy de cette personne. Traiter l'une et pas l'autre laisserait la divulgation
    intacte à un endpoint de distance.
    """
    # counters[scene_id] = {tp, fp, planted, missed}
    counters: dict[str, dict[str, int]] = defaultdict(
        lambda: {"tp": 0, "fp": 0, "planted": 0, "missed": 0}
    )
    scene_population: dict[str, Population] = defaultdict(Population)
    for ev in _iter_events(data_dir, course, bundle_version=bundle_version):
        if ev.get("type") != "ai_audit_result":
            continue
        sid = ev.get("scene_id")
        if not sid:
            continue
        if pseudonyme is not None and ev.get("learner_pseudonym") != pseudonyme:
            continue
        scene_population[sid].add_event(ev)
        c = counters[sid]
        c["tp"] += int(ev.get("true_positives", 0))
        c["fp"] += int(ev.get("false_positives", 0))
        c["planted"] += int(ev.get("planted_errors", 0))
        c["missed"] += int(ev.get("missed", 0))

    floor = min_learners() if floor is None else floor
    withheld = False
    population = Population()

    per_scene: list[dict] = []
    scorable_accuracies: list[float] = []
    for sid, c in counters.items():
        if floor > 0 and scene_population[sid].below_floor(floor):
            withheld = True
            continue
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
        population.merge(scene_population[sid])
        per_scene.append({
            "scene_id": sid,
            "accuracy": accuracy,
            "true_positives": tp,
            "false_positives": fp,
            "planted_errors": planted,
            "missed": c["missed"],
            **scene_population[sid].judgement(floor),
        })

    overall = (
        sum(scorable_accuracies) / len(scorable_accuracies)
        if scorable_accuracies
        else None
    )
    return {
        "overall_accuracy": overall,
        # PUBLISHED scenes: a tally that counted the withheld ones would republish the number
        # `withheld_below_floor` replaced.
        "n_scenes": len(per_scene),
        "per_scene": per_scene,
        "withheld_below_floor": withheld,
        "judgement": population.judgement(floor),
    }


# Judgment-over-artifact calibration band. Mirrors the engine constant
# TRUST_WELL_BAND in packages/learner-state (kept in sync by value): |gap| within
# this band counts as well-calibrated trust.
TRUST_WELL_BAND = 0.4


def _over_distrust_rate(false_positives: int, sound_total: int) -> float | None:
    """Rate of SOUND claims the auditor wrongly flagged, over the sound population.

    Inputs: pooled ``false_positives`` and ``sound_total`` for one scene. Output:
    ``min(fp, sound) / sound`` in [0, 1], or ``None`` when ``sound_total`` is 0 —
    no sound claim was on offer, so over-distrust is UNMEASURED, not zero. Same
    denominator and cap as the engine's recordJudgmentAudit."""
    if sound_total <= 0:
        return None
    return min(max(0, false_positives), sound_total) / sound_total


def compute_trust_calibration(
    data_dir: Path,
    course: str,
    learner: str | None = None,
    bundle_version: str | None = None,
    floor: int | None = None,
) -> dict:
    """trust_calibration (judgment-over-artifact) — teacher surface.

    DISTINCT from confidence_calibration (declared-vs-competence, Brier). This is
    the telemetry-native surface of the engine's `trust_calibration` dimension:
    how well the learner's TRUST in an AI reading of a real artifact matches
    ground truth, computed from the grounded spot_the_flaw audits
    (``ai_audit_result`` events — same source as ai_audit_accuracy).

    Per scorable scene (``planted_errors`` > 0, counters POOLED across that
    scene's events exactly like ai_audit_accuracy)::

        over_trust    = missed / planted             (credulous: missed planted flaws, +)
        over_distrust = min(fp, sound) / sound        (skeptical: flagged sound claims, -)
        gap           = over_trust - over_distrust    in [-1, 1]

    Each direction is a rate over its OWN population: planted flaws for
    over-trust, SOUND claims (``sound_total``) for over-distrust. Same formula as
    the engine's ``recordJudgmentAudit`` (packages/learner-state/src/index.ts),
    so both surfaces report the same number for the same audit.

    overall ``trust_calibration`` = mean(gap) over scorable scenes (mirrors
    ai_audit ``overall_accuracy`` = mean of per-scene scores); ``None`` if no
    scene is scorable (unmeasured ≠ well-calibrated). Band mirrors confidence::

        |gap| <= TRUST_WELL_BAND -> "bien"
        gap   >  TRUST_WELL_BAND -> "sur"   (over-trust / surconfiance IA)
        gap   < -TRUST_WELL_BAND -> "sous"  (over-distrust / méfiance IA)

    Pooled-counter, mean-of-per-scene aggregate (telemetry-native) — NOT the
    engine's per-audit EWMA blend (same spirit as Brier-vs-engine-gap for
    confidence).

    HONESTY BOUNDARY — over-distrust is measurable only where the grader knows
    the SOUND claims. The verdict-deck path (packages/lesson-session/src/grading/
    graders.ts, ~line 88) marks each deck item flawed/sound, so it counts REAL
    false alarms with zero LLM and emits ``sound_total`` > 0: the "sous" band IS
    reachable in production. The keyword flaw-matcher path carries the
    planted-flaw answer key only, so it emits ``false_positives=0`` and
    ``sound_total=0``.

    ``sound_total == 0`` therefore means over-distrust is UNMEASURED, NOT zero:
    no sound claim was on offer, so a false alarm was never possible. Such
    scenes report ``over_distrust: None`` and their ``gap`` collapses to
    ``over_trust`` (the engine's behaviour at index.ts:245-247); the overall
    ``over_distrust`` averages only the scenes that measured it, and is ``None``
    when none did.

    Filtre optionnel : ``learner`` (1 pseudonyme).

    R1 (INT-STUDIUM-030 stage 2) — EVERY number here is floored over the population it was
    actually computed over, not over the course cohort the endpoint checked. A per-scene row
    is a reading over the learners who audited that scene, which can be one person inside a
    class of thirty; over-trust is the most characterological reading this instrument
    produces, so a row under the floor is not published and the payload says only THAT one
    was, never how many. The overall gap is floored over the union of the scorable scenes,
    because a single scorable scene makes the overall that scene's row under another name.

    ``floor`` defaults to ``min_learners()``. Pass ``floor=0`` to read the raw maths — the
    formulas are unit-tested that way, and the default is the publishable one so that a caller
    who forgets the argument withholds rather than discloses.
    """
    # counters[scene_id] = {fp, planted, missed, sound}
    counters: dict[str, dict[str, int]] = defaultdict(
        lambda: {"fp": 0, "planted": 0, "missed": 0, "sound": 0}
    )
    # R1: a per-scene row is a number over the learners who audited THAT scene, which is a
    # narrower population than the course cohort the endpoint floors. Each row therefore
    # carries its own, accumulated on the events pooled into it.
    scene_population: dict[str, Population] = defaultdict(Population)
    population = Population()
    for ev in _iter_events(data_dir, course, bundle_version=bundle_version):
        if ev.get("type") != "ai_audit_result":
            continue
        sid = ev.get("scene_id")
        if not sid:
            continue
        if learner is not None and ev.get("learner_pseudonym") != learner:
            continue
        scene_population[sid].add_event(ev)
        c = counters[sid]
        c["fp"] += int(ev.get("false_positives", 0))
        c["planted"] += int(ev.get("planted_errors", 0))
        c["missed"] += int(ev.get("missed", 0))
        c["sound"] += int(ev.get("sound_total", 0))  # absent in pre-v1.5 JSONL

    floor = min_learners() if floor is None else floor
    withheld = False

    per_scene: list[dict] = []
    gaps: list[float] = []
    over_trusts: list[float] = []
    over_distrusts: list[float] = []
    for sid, c in counters.items():
        # R1: a scene is a population of its own. It is dropped BEFORE its numbers reach any
        # aggregate, not only before they reach the payload — a mean over two scenes, one of
        # them a single learner, is half that learner's judgement published as the class's.
        if floor > 0 and scene_population[sid].below_floor(floor):
            withheld = True
            continue
        planted = c["planted"]
        if planted == 0:
            per_scene.append({
                "scene_id": sid, "gap": None,
                "over_trust": None, "over_distrust": None,
                "planted_errors": 0, "missed": c["missed"],
                "false_positives": c["fp"], "sound_total": c["sound"],
                **scene_population[sid].judgement(floor),
            })
            continue
        over_trust = c["missed"] / planted
        over_distrust = _over_distrust_rate(c["fp"], c["sound"])
        # Unmeasured over-distrust contributes 0 to the gap (engine: index.ts:245-247).
        signed = over_trust - (0.0 if over_distrust is None else over_distrust)
        gap = max(-1.0, min(1.0, signed))
        gaps.append(gap)
        over_trusts.append(over_trust)
        if over_distrust is not None:
            over_distrusts.append(over_distrust)
        population.merge(scene_population[sid])
        per_scene.append({
            "scene_id": sid, "gap": gap,
            "over_trust": over_trust, "over_distrust": over_distrust,
            "planted_errors": planted, "missed": c["missed"],
            "false_positives": c["fp"], "sound_total": c["sound"],
            **scene_population[sid].judgement(floor),
        })

    if not gaps or (floor > 0 and population.below_floor(floor)):
        return {
            "trust_calibration": None, "band": None, "n_audits": 0,
            "over_trust": None, "over_distrust": None, "per_scene": per_scene,
            # A flag, never a count. `n_audits` above is 0 for the same reason it counts only
            # published scenes below: a scorable-scene tally that included the withheld ones
            # would republish exactly the number the flag replaced. That is the R1 lesson from
            # the Observatory — a count moved into a neighbouring key is the same count.
            "withheld_below_floor": withheld,
            # Two different absences, and they need different actions from the reader: nothing
            # to measure is a bundle without planted flaws, and a withheld measurement is a
            # cohort too small. Reporting the first when the second happened sends a teacher
            # looking for a missing scene that is there.
            "reason": ("trust calibration was measured but not published: the learners who "
                       "audited these scenes are fewer than the floor in at least one lesson"
                       if withheld else
                       "no scene carried a planted flaw, so trust calibration was not measured"),
            "judgement": population.judgement(floor),
        }
    overall = sum(gaps) / len(gaps)
    if abs(overall) <= TRUST_WELL_BAND:
        band = "bien"
    elif overall > 0:
        band = "sur"
    else:
        band = "sous"
    return {
        "trust_calibration": overall,
        "band": band,
        "withheld_below_floor": withheld,
        # n_audits = number of PUBLISHED scorable scenes (planted>0), pooled per scene_id —
        # NOT a count of ai_audit_result events (mirrors compute_ai_audit_accuracy's
        # n_scenes; named n_audits here for the teacher-facing "audited scenes" sense).
        "n_audits": len(gaps),
        "over_trust": sum(over_trusts) / len(over_trusts),
        # None when NO scene had a sound population — unmeasured, not zero.
        "over_distrust": (
            sum(over_distrusts) / len(over_distrusts) if over_distrusts else None
        ),
        "per_scene": per_scene,
        # R1: the population of the OVERALL gap is the union of the PUBLISHED scorable scenes',
        # not the course cohort — scenes nobody could be scored on, and scenes under the floor,
        # contribute no one to it and no number to the mean.
        "judgement": population.judgement(floor),
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
            if not _is_autonomy_critique(ev):
                continue  # RC-2: gate AI-literacy critique_completion_rate to AI-critique
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


#: INT-STUDIUM-023 — the operator-facing name of the ratio `compute_autonomy` returns.
#:
#: Two different measurements ship under the wire key `autonomy_ratio`. This one is a
#: CLASS-LEVEL RATIO OF EVENTS over a course's store: of the adaptive interactions the
#: course produced, the share that were AI critiques rather than hints. The other is the
#: runtime's per-session ratio of scenes completed to scenes completed plus scaffolding,
#: whose mean `tools/class_report.py` publishes as `mean_autonomy`
#: (`class_report.AUTONOMY_INDICATOR_NAME`). Numerators, denominators and populations all
#: differ, so a disagreement between them is the definition and not a fault.
#:
#: The wire key is deliberately NOT renamed: historical streams, the `/metrics/autonomy`
#: route and every stored payload carry it, and this intent does not authorise a change to
#: what is measured or transmitted. The two constructs are told apart by the name an
#: operator reads — here, on the teacher dashboard, and on the Observatory sessions page.
AUTONOMY_INDICATOR_NAME = "critique-over-hint balance"


def compute_autonomy(
    data_dir: Path,
    course: str,
    bundle_version: str | None = None,
) -> dict:
    """Anti-offloading metrics: autonomy_ratio + critique_completion_rate.

    `autonomy_ratio` here is the AUTONOMY_INDICATOR_NAME — see that constant for why it is
    not the runtime's identically-keyed ratio.

    - autonomy_ratio = n_critique_submitted / (n_critique_submitted + n_hints_applied)
    - critique_completion_rate = mean(completion_rate of critique_submitted events)
    - keyword_graded_rate = share of those events whose score came from the SUBSTRING MATCHER
      rather than a semantic evaluator (`score_source`, ADR 006 v1.6). It is reported beside
      the completion rate because it says how much that number is worth: the matcher credits a
      point of the answer key when its cue string appears anywhere in the learner's text, with
      no notion of negation or of who is asserting what (INT-STUDIUM-035). A cohort graded that
      way and a cohort graded by an LLM used to arrive here as the same number.
      `n_score_source_known` is the denominator: events predating v1.6 carry no tag, and a rate
      over an empty denominator is not zero — it is unmeasured, so it is reported as None.
    """
    n_critique = 0
    sum_completion = 0.0
    n_hints = 0
    n_source_known = 0
    n_keyword = 0
    population = Population()
    for ev in _iter_events(data_dir, course, bundle_version=bundle_version):
        t = ev.get("type")
        if t == "critique_submitted":
            if not _is_autonomy_critique(ev):
                continue  # RC-2: explain_back (teach-back) is not an AI-critique signal
            n_critique += 1
            sum_completion += float(ev.get("completion_rate", 0))
            src = ev.get("score_source")
            if src:
                n_source_known += 1
                if src == "keyword":
                    n_keyword += 1
            population.add_event(ev)
        elif t == "adaptation_applied" and ev.get("signal") == "hint":
            n_hints += 1
            population.add_event(ev)
    total = n_critique + n_hints
    return {
        "critique_completion_rate": (sum_completion / n_critique) if n_critique else 0.0,
        "autonomy_ratio": (n_critique / total) if total else 0.0,
        "n_critique": n_critique,
        "n_hints": n_hints,
        # None, not 0.0: no tagged event means the question was not answered, and a dashboard
        # showing "0 % keyword-graded" for an untagged cohort would be the reassuring reading of
        # a missing measurement.
        "keyword_graded_rate": (n_keyword / n_source_known) if n_source_known else None,
        "n_score_source_known": n_source_known,
        # R1: both terms of the ratio contribute, so both contribute to its population.
        "judgement": population.judgement(),
    }


def compute_scene_type_breakdown(
    data_dir: Path,
    course: str,
    bundle_version: str | None = None,
) -> dict:
    """RC-2 telemetry scoping: per scene_type engagement from critique_submitted events.

    Returns a dict keyed by scene_type (str) → { n, mean_completion_rate }.
    Covers all active-learning scene types (spot_the_flaw, explain_back, comparison,
    summary_audit, prompt_practice, communication_sim, ai_critique).
    Untagged legacy events bucket under the key "untagged".
    """
    buckets: dict[str, list[float]] = {}
    for ev in _iter_events(data_dir, course, bundle_version=bundle_version):
        if ev.get("type") != "critique_submitted":
            continue
        key = ev.get("scene_type") or "untagged"
        rate = float(ev.get("completion_rate", 0))
        buckets.setdefault(key, []).append(rate)
    result: dict[str, dict] = {}
    for scene_type, rates in sorted(buckets.items()):
        result[scene_type] = {
            "n": len(rates),
            "mean_completion_rate": round(sum(rates) / len(rates), 4),
        }
    return result


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
