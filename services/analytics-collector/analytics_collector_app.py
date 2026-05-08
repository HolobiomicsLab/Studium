from fastapi import FastAPI, Header, HTTPException

from analytics_collector_schemas import TelemetryBatch, TelemetryResponse
from store import append_events


app = FastAPI(title="analytics-collector", version="0.1.0")


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
    return TelemetryResponse(accepted=n)
