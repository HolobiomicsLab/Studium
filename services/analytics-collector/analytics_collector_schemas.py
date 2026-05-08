"""Pydantic schemas for analytics-collector requests/responses.

Convention rule 004: never imported as `schemas` at root level.
"""

from pydantic import BaseModel, ConfigDict
from telemetry_events import TelemetryEvent


class TelemetryBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    events: list[TelemetryEvent]


class TelemetryResponse(BaseModel):
    accepted: int
