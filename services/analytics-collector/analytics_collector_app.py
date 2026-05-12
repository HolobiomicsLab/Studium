from fastapi import FastAPI, Header, HTTPException

from analytics_collector_schemas import TelemetryBatch, TelemetryResponse
from metrics import (
    compute_ai_audit_accuracy,
    compute_ai_literacy_index,
    compute_autonomy,
    compute_calibration,
    compute_progress,
    compute_reasoning_depth_score,
)
from store import _data_dir, append_events, process_event_for_mastery


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
    return compute_calibration(_data_dir(), course, learner=learner, bundle_version=bv)


@app.get("/metrics/autonomy")
def get_autonomy(
    course: str,
    bundle_version: str | None = None,
    x_course_token: str | None = Header(default=None),
) -> dict:
    _require_course_token(x_course_token, course)
    bv = _validate_bundle_version(bundle_version)
    return compute_autonomy(_data_dir(), course, bundle_version=bv)


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
