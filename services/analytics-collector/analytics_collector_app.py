from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel as _PydanticBase

from analytics_collector_schemas import TelemetryBatch, TelemetryResponse
from metrics import (
    cohort_state,
    compute_ai_audit_accuracy,
    compute_ai_literacy_index,
    compute_autonomy,
    compute_blueprint_score,
    compute_calibration,
    compute_cooperation_metrics,
    compute_course_completion,
    compute_journal_metrics,
    compute_progress,
    compute_reasoning_depth_score,
    compute_scene_type_breakdown,
    compute_trust_calibration,
)
from store import (
    _data_dir,
    append_events,
    process_event_for_mastery,
    read_concept_mastery_history,
)


app = FastAPI(title="analytics-collector", version="0.1.0")


def _require_course_token(x_course_token: str | None, course: str) -> None:
    if not x_course_token:
        raise HTTPException(status_code=401, detail="missing X-Course-Token")
    if x_course_token != course:
        raise HTTPException(status_code=403, detail="token does not match course")


def _validate_bundle_version(bundle_version: str | None) -> str | None:
    """Valide le format ``<schema_version>:<bundle_id>@<validated_at>`` (M5.7).

    - ``None`` → pas de filtre (retourne None).
    - ``""`` → 400 (présent mais vide via la query string).
    - Chaîne sans ``:`` ou sans ``@`` → 400 (malformée).
    - La valeur sentinelle ``"unversioned"`` est acceptée comme cas spécial
      pour cibler les events legacy bucketed sous ce label.
    """
    if bundle_version is None:
        return None
    if bundle_version == "":
        raise HTTPException(
            status_code=400,
            detail="bundle_version must not be empty",
        )
    if bundle_version == "unversioned":
        return bundle_version
    if ":" not in bundle_version or "@" not in bundle_version:
        raise HTTPException(
            status_code=400,
            detail=(
                "bundle_version must follow "
                "'<schema_version>:<bundle_id>@<validated_at>' (M5.7)"
            ),
        )
    return bundle_version


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/telemetry", response_model=TelemetryResponse)
def post_telemetry(
    batch: TelemetryBatch,
    x_course_token: str | None = Header(default=None),
) -> TelemetryResponse:
    if not x_course_token:
        raise HTTPException(status_code=401, detail="missing X-Course-Token")
    n = append_events(x_course_token, batch.events)
    # M5.1 : snapshot maîtrise/concept si l'event porte concept_states.
    # Aujourd'hui le schema strict TelemetryEvent ne déclare pas ce champ,
    # donc l'appel est un no-op tant que le runtime n'aura pas été étendu.
    # On laisse le hook en place pour limiter le diff quand C.6 ajoutera
    # concept_states au payload.
    for ev in batch.events:
        process_event_for_mastery(
            _data_dir(), x_course_token, ev.model_dump(mode="python"),
        )
    return TelemetryResponse(accepted=n)


@app.get("/metrics/progress")
def get_progress(
    course: str,
    bundle_version: str | None = None,
    x_course_token: str | None = Header(default=None),
) -> dict:
    _require_course_token(x_course_token, course)
    bv = _validate_bundle_version(bundle_version)
    if (below := cohort_state(_data_dir(), course, bundle_version=bv)) is not None:
        return below
    return compute_progress(_data_dir(), course, bundle_version=bv)


@app.get("/metrics/calibration")
def get_calibration(
    course: str,
    learner: str | None = None,
    bundle_version: str | None = None,
    x_course_token: str | None = Header(default=None),
) -> dict:
    _require_course_token(x_course_token, course)
    bv = _validate_bundle_version(bundle_version)
    if (below := cohort_state(_data_dir(), course, bundle_version=bv)) is not None:
        return below
    return compute_calibration(_data_dir(), course, learner=learner, bundle_version=bv)


@app.get("/metrics/course-completion")
def get_course_completion(
    course: str,
    bundle_version: str | None = None,
    x_course_token: str | None = Header(default=None),
) -> dict:
    """Class-level course-spine funnel: distinct completers per lesson_id.

    The dashboard overlays the CourseSchema spine (order + prerequisites). HONESTY
    BOUNDARY: telemetry pseudonyms are bundle-scoped, so this is a per-lesson
    distinct-completer count, NOT per-individual cross-lesson tracking (see
    metrics.compute_course_completion)."""
    _require_course_token(x_course_token, course)
    bv = _validate_bundle_version(bundle_version)
    if (below := cohort_state(_data_dir(), course, bundle_version=bv)) is not None:
        return below
    return compute_course_completion(_data_dir(), course, bundle_version=bv)


@app.get("/metrics/trust-calibration")
def get_trust_calibration(
    course: str,
    learner: str | None = None,
    bundle_version: str | None = None,
    x_course_token: str | None = Header(default=None),
) -> dict:
    """trust_calibration (judgment-over-artifact) — distinct from /metrics/calibration.

    Surface of the engine's `trust_calibration` dimension over the grounded
    spot_the_flaw audits. Band "sur" = over-trust (surconfiance IA), "sous" =
    over-distrust (méfiance IA), "bien" = within band. The verdict-deck grader
    emits real false_positives and sound_total, so "sous" IS reachable; only the
    free-text keyword path is structurally fp=0/sound=0, which reports as
    UNMEASURED, not zero (see metrics.compute_trust_calibration)."""
    _require_course_token(x_course_token, course)
    bv = _validate_bundle_version(bundle_version)
    if (below := cohort_state(_data_dir(), course, bundle_version=bv)) is not None:
        return below
    return compute_trust_calibration(_data_dir(), course, learner=learner, bundle_version=bv)


@app.get("/metrics/autonomy")
def get_autonomy(
    course: str,
    bundle_version: str | None = None,
    x_course_token: str | None = Header(default=None),
) -> dict:
    _require_course_token(x_course_token, course)
    bv = _validate_bundle_version(bundle_version)
    if (below := cohort_state(_data_dir(), course, bundle_version=bv)) is not None:
        return below
    return compute_autonomy(_data_dir(), course, bundle_version=bv)


@app.get("/metrics/scene-breakdown")
def get_scene_breakdown(
    course: str,
    bundle_version: str | None = None,
    x_course_token: str | None = Header(default=None),
) -> dict:
    """RC-2 telemetry scoping: per scene_type engagement counts + mean completion_rate.
    Covers all active-learning types (spot_the_flaw, explain_back, comparison,
    summary_audit, prompt_practice, communication_sim, ai_critique, untagged)."""
    _require_course_token(x_course_token, course)
    bv = _validate_bundle_version(bundle_version)
    if (below := cohort_state(_data_dir(), course, bundle_version=bv)) is not None:
        return below
    return compute_scene_type_breakdown(_data_dir(), course, bundle_version=bv)


@app.get("/metrics/reasoning")
def get_reasoning(
    course: str,
    pseudonyme: str | None = None,
    scene_id: str | None = None,
    bundle_version: str | None = None,
    x_course_token: str | None = Header(default=None),
) -> dict:
    _require_course_token(x_course_token, course)
    bv = _validate_bundle_version(bundle_version)
    if (below := cohort_state(_data_dir(), course, bundle_version=bv)) is not None:
        return below
    return compute_reasoning_depth_score(
        _data_dir(), course, pseudonyme=pseudonyme, scene_id=scene_id,
        bundle_version=bv,
    )


@app.get("/metrics/ai-audit")
def get_ai_audit(
    course: str,
    pseudonyme: str | None = None,
    bundle_version: str | None = None,
    x_course_token: str | None = Header(default=None),
) -> dict:
    _require_course_token(x_course_token, course)
    bv = _validate_bundle_version(bundle_version)
    if (below := cohort_state(_data_dir(), course, bundle_version=bv)) is not None:
        return below
    return compute_ai_audit_accuracy(
        _data_dir(), course, pseudonyme=pseudonyme, bundle_version=bv,
    )


@app.get("/metrics/ai-literacy")
def get_ai_literacy(
    course: str,
    pseudonyme: str,
    window: int = 10,
    bundle_version: str | None = None,
    x_course_token: str | None = Header(default=None),
) -> dict:
    """ai_literacy_index (M5.4, ADR 011).

    USAGE FORMATIF UNIQUEMENT (cf. ADR 011 — non validé psychométriquement,
    pas d'usage certificatif). Garde-fou : pseudonyme obligatoire — pas
    d'agrégation publique non-nominale via cette endpoint pour éviter
    un ranking inter-étudiants accidentel.
    """
    _require_course_token(x_course_token, course)
    if not pseudonyme:
        raise HTTPException(
            status_code=400,
            detail="pseudonyme is required (ADR 011 guardrail)",
        )
    bv = _validate_bundle_version(bundle_version)
    return compute_ai_literacy_index(
        _data_dir(), course, pseudonyme=pseudonyme, window=window,
        bundle_version=bv,
    )


@app.get("/metrics/journal")
def get_journal(
    course: str,
    pseudonyme: str | None = None,
    bundle_version: str | None = None,
    x_course_token: str | None = Header(default=None),
) -> dict:
    """Journal entry counters (ADR 006 v1.3, ADR 011-style garde-fou).

    Counters only — texte journal local jamais transmis.
    """
    _require_course_token(x_course_token, course)
    bv = _validate_bundle_version(bundle_version)
    if (below := cohort_state(_data_dir(), course, bundle_version=bv)) is not None:
        return below
    return compute_journal_metrics(
        _data_dir(), course,
        pseudonyme=pseudonyme, bundle_version=bv,
    )


@app.get("/metrics/cooperation")
def get_cooperation(
    course: str,
    bundle_version: str | None = None,
    x_course_token: str | None = Header(default=None),
) -> dict:
    """Cooperative session aggregates (F2.1, views v0.4).

    M4 LAN runtime deferred — endpoint operates on POST'ed fixtures only
    in v1. Auth via ``X-Course-Token == course`` (parité ADR 011).
    """
    _require_course_token(x_course_token, course)
    bv = _validate_bundle_version(bundle_version)
    if (below := cohort_state(_data_dir(), course, bundle_version=bv)) is not None:
        return below
    return compute_cooperation_metrics(_data_dir(), course, bundle_version=bv)


class BlueprintRequest(_PydanticBase):
    course: str
    pseudonyme: str
    bundle_version: str | None = None
    blueprint: dict  # loose validation v1 — author trust côté serveur


@app.post("/metrics/blueprint")
def post_blueprint(
    body: BlueprintRequest,
    x_course_token: str | None = Header(default=None),
) -> dict:
    """Composite blueprint score (ADR 013).

    USAGE FORMATIF UNIQUEMENT. Pas de classement nominatif.

    POST body avec blueprint inline (pas de cache de bundles côté collector
    v1). ``metric_fetcher`` route en in-process vers les 6 endpoints metrics
    existants. Garde-fou ADR 013 : ``pseudonyme`` requis dans le body +
    ``X-Course-Token`` doit matcher ``body.course``.
    """
    _require_course_token(x_course_token, body.course)
    bv = _validate_bundle_version(body.bundle_version)

    def fetcher(endpoint: str, field: str):
        # In-process routage vers les fns compute_* existantes.
        if endpoint == "ai_literacy":
            result = compute_ai_literacy_index(
                _data_dir(), body.course,
                pseudonyme=body.pseudonyme, bundle_version=bv,
            )
            return result.get(field)
        elif endpoint == "calibration":
            result = compute_calibration(
                _data_dir(), body.course,
                learner=body.pseudonyme, bundle_version=bv,
            )
            return result.get(field)
        elif endpoint == "autonomy":
            result = compute_autonomy(_data_dir(), body.course, bundle_version=bv)
            return result.get(field)
        elif endpoint == "progress":
            result = compute_progress(_data_dir(), body.course, bundle_version=bv)
            scenes = result.get("scenes", {})
            if not scenes:
                return None
            if field == "completion_rate":
                values = [s["completion_rate"] for s in scenes.values()]
                return sum(values) / len(values) if values else None
            return None
        elif endpoint == "reasoning":
            result = compute_reasoning_depth_score(
                _data_dir(), body.course,
                pseudonyme=body.pseudonyme, bundle_version=bv,
            )
            scenes = result.get("scenes", {})
            scores = [s["score"] for s in scenes.values() if s.get("score") is not None]
            return sum(scores) / len(scores) if scores else None
        elif endpoint == "ai_audit":
            result = compute_ai_audit_accuracy(
                _data_dir(), body.course,
                pseudonyme=body.pseudonyme, bundle_version=bv,
            )
            return result.get(field) if field == "overall_accuracy" else None
        return None

    return compute_blueprint_score(body.blueprint, fetcher)


@app.get("/metrics/concept-mastery-history")
def get_concept_mastery_history(
    course: str,
    pseudonyme: str | None = None,
    concept_id: str | None = None,
    since: str | None = None,
    x_course_token: str | None = Header(default=None),
) -> dict:
    """concept_mastery_history (M5.1 + M5.5).

    Retourne ``{concepts: {concept_id: [{date, pseudonyme, alpha, beta, mastery, n_attempts}]}}``.
    Auth ``X-Course-Token == course`` (parité C.4).
    """
    from datetime import date as _date_type

    _require_course_token(x_course_token, course)
    if (below := cohort_state(_data_dir(), course)) is not None:
        return below
    since_date = _date_type.fromisoformat(since) if since else None
    return {
        "concepts": read_concept_mastery_history(
            _data_dir(), course,
            pseudonyme=pseudonyme, since=since_date, concept_id=concept_id,
        )
    }
