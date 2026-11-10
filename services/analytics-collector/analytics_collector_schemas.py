"""Pydantic schemas for analytics-collector requests/responses.

Convention rule 004: never imported as `schemas` at root level.
"""

import sys
from pathlib import Path

from pydantic import BaseModel, ConfigDict

try:
    from telemetry_events import TelemetryEvent
except ModuleNotFoundError:
    # The environment `requirements.txt` builds does not install packages/telemetry-events (CI and the
    # workspace do, with `pip install -e`). Fall back to the checkout, as tools/class_report.py and
    # tools/interaction_report.py do; an installed copy still wins.
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "packages" / "telemetry-events" / "python"))
    from telemetry_events import TelemetryEvent


class TelemetryBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    events: list[TelemetryEvent]


class TelemetryResponse(BaseModel):
    accepted: int
