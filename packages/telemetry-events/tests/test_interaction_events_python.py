"""The interaction events of INT-STUDIUM-058 § 2.10, on the Python reader's side.

The examples are the ones the TypeScript test reads (tests/interaction-events.json): an event one
side writes is one the other reads, and what one refuses the other refuses.
"""
import json
from pathlib import Path

import pytest
from pydantic import TypeAdapter, ValidationError
from telemetry_events import TelemetryEvent

adapter = TypeAdapter(TelemetryEvent)
CASES = json.loads((Path(__file__).parent / "interaction-events.json").read_text(encoding="utf-8"))
NEW_TYPES = ["interaction", "prompt_shown", "prompt_outcome", "help_used", "contest", "resume", "review_receipt"]


def test_one_event_of_each_type_validates():
    seen = []
    for event in CASES["valid"]:
        parsed = adapter.validate_python({**CASES["base"], **event})
        assert parsed.type == event["type"]
        if event["type"] not in seen:
            seen.append(event["type"])
    assert seen == NEW_TYPES


@pytest.mark.parametrize("case", CASES["invalid"], ids=lambda case: case["why"])
def test_refuses(case):
    with pytest.raises(ValidationError):
        adapter.validate_python({**CASES["base"], **case["event"]})


def test_a_written_event_reads_back_the_same():
    for event in CASES["valid"]:
        raw = {**CASES["base"], **event}
        dumped = json.loads(adapter.dump_json(adapter.validate_python(raw), exclude_none=True))
        assert dumped == raw
