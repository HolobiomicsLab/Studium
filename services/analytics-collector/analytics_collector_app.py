from fastapi import FastAPI, Header, HTTPException

from analytics_collector_schemas import TelemetryBatch, TelemetryResponse
from metrics import (
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
def get_progress(course: str, x_course_token: str | None = Header(default=None)) -> dict:
    _require_course_token(x_course_token, course)
    return compute_progress(_data_dir(), course)


@app.get("/metrics/calibration")
def get_calibration(
    course: str,
    learner: str | None = None,
    x_course_token: str | None = Header(default=None),
) -> dict:
    _require_course_token(x_course_token, course)
    return compute_calibration(_data_dir(), course, learner=learner)


@app.get("/metrics/autonomy")
def get_autonomy(course: str, x_course_token: str | None = Header(default=None)) -> dict:
    _require_course_token(x_course_token, course)
    return compute_autonomy(_data_dir(), course)


@app.get("/metrics/reasoning")
def get_reasoning(
    course: str,
    pseudonyme: str | None = None,
    scene_id: str | None = None,
    x_course_token: str | None = Header(default=None),
) -> dict:
    _require_course_token(x_course_token, course)
    return compute_reasoning_depth_score(
        _data_dir(), course, pseudonyme=pseudonyme, scene_id=scene_id,
    )
