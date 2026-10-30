English · [Français](README.fr.md)

# @studium/telemetry-events

The wire contract of learning events: what a session may report about a learner, for teachers' class analytics. Seventeen event types share a base (event id, learner pseudonym, lesson id, bundle version, client timestamp) and are discriminated by `type`. The contract exists twice, in Zod and in Pydantic, and a parity test fails on any difference.

## Where it sits

[`@studium/lesson-session`](../lesson-session/README.md) emits these events through its telemetry port. The host writes them to disk only when the learner has consented (`STUDIUM_TELEMETRY_CONSENT`) and state is durable; the Python analytics collector validates them with the mirror. See [privacy and limits](../../docs/concepts/privacy-and-limits.md) and [architecture](../../docs/develop/architecture.md).

## Public API

From [src/index.ts](src/index.ts) (re-exporting [src/events.ts](src/events.ts)):

| Export | Purpose |
|---|---|
| `TelemetryEventSchema` / `TelemetryEvent` | The discriminated union of every event. |
| `LessonStartedSchema`, `SceneEnteredSchema`, `SceneCompletedSchema`, `LessonCompletedSchema` | Progress through a lesson. |
| `QuizAnsweredSchema`, `HintRequestedSchema`, `AdaptationAppliedSchema` | Answers, hints and adaptation decisions. |
| `CritiqueSubmittedSchema`, `AIAuditResultSchema`, `ReasoningSignalSchema`, `TutorMoveSchema` | AI critique, audits of flawed output, reasoning labels, tutor moves. |
| `JournalEntrySubmittedSchema`, `CooperativeVoteSchema`, `CooperativeConvergenceSchema`, `UniverseSelectedSchema` | Reflective writing, group scenes, scenario variants. |
| `ConsentGrantedSchema`, `ForgetRequestedSchema` | Consent and erasure requests. |

Python: `telemetry_events` in [python/](python/telemetry_events/__init__.py), with `TelemetryEvent` as a Pydantic discriminated union.

## Example

```ts
import { TelemetryEventSchema } from "@studium/telemetry-events";

const event = TelemetryEventSchema.parse({
  type: "lesson_started",
  event_id: crypto.randomUUID(),
  learner_pseudonym: "3f9c0a1b2c3d4e5f",
  lesson_id: "intro-stats",
  client_timestamp: new Date().toISOString(),
  bundle_uri: "intro-stats.json",
});
event.bundle_version; // "unversioned" when absent
```

## Invariants

- Events carry identifiers, counters, labels and scores, never the learner's free text: a journal entry is reported by its length and revision count.
- The learner appears only as a pseudonym.
- Every field added on one side must be added on the other, with the same required or optional status; [tests/test_contract_parity.py](tests/test_contract_parity.py) compares the two unions.

## Test

```bash
pnpm --filter @studium/telemetry-events test
.venv/bin/python -m pytest packages/telemetry-events -q
```

## Depends on / used by

- Depends on: `zod` (TypeScript), `pydantic` (Python).
- Used by: `@studium/lesson-session`, `apps/student-runtime`; the mirror by `services/analytics-collector` and `services/observatory`.

## Status

Active, package version 0.5.0. Workspace package, not published to npm.
