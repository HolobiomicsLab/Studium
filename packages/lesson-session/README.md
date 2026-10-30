English · [Français](README.fr.md)

# @studium/lesson-session

Plays one lesson for one learner. A `LessonSession` presents scenes, grades answers, lets the adaptation engine decide what comes next, records self-ratings, emits telemetry and writes mastery claims. All I/O goes through ports (state store, event log, telemetry sink, pseudonym provider, scorers, judges, clock, id generator), so the same session runs in tests, in a terminal or behind a server. The feedback rules it enforces are described in [honesty and provenance](../../docs/concepts/honesty-and-provenance.md).

## Where it sits

Between the pure engine ([`@studium/adaptation-engine`](../adaptation-engine/README.md)) and the host ([`@studium/lesson-session-host`](../lesson-session-host/README.md)), which manages many sessions, persistence and redaction for the MCP server, the HTTP server and the VS Code extension. See [architecture](../../docs/develop/architecture.md).

## Public API

Main entry, [src/index.ts](src/index.ts):

| Export | Purpose |
|---|---|
| `LessonSession` | `start()`, `currentPresentation()`, `respond(input)`, `rateRecall(sceneId, grade)`, `requestHint()`, `submitTurn(text)`, `explainLast()`, `getState()`, `erase()`. |
| `grade` | Grades a response against a scene. |
| `verdictDeck`, `publicDeck`, `scoreVerdictDeck` | The spot-the-flaw verdict deck: claims behind opaque tokens, graded per claim. |
| `matchClaimsAgainstCritique` | Offline matching of a critique against planted flaws. |
| `SELF_RATING_CHOICES`, `SelfRatingRequest`, `SelfRatingRecord` | again / hard / good / easy, in FSRS order. |
| `SessionError`, `SessionNotStartedError`, `SessionAlreadyCompleteError`, `SceneGradingError`, `SelfRatingNotRequestedError`, `InvalidSelfRatingError` | Typed errors. |
| `StubAuditJudge`, `HttpLlmAuditJudge` | Audit judges (offline and model-backed). |
| `enrichEvent`, `bundleVersionOf` | Telemetry helpers. |
| `runGateValidity`, `simulateVerdicts`, `CANONICAL_LEARNERS` | Synthetic-learner check of the trust gate. |
| Types `Presentation`, `ResponseInput`, `Transition`, `CompletionSummary`, `SessionDeps` and the port interfaces | The session contract. |

Node adapters, `@studium/lesson-session/node`: `FileStateStore`, `JsonlEventLog`, `JsonlTelemetrySink`, `HttpTelemetrySink`, `HmacPseudonymProvider`, `SystemClock`, `RandomIdGen`, `loadBundleZip`, `loadBundleJson`, live and stub scorers, tutors and critique evaluators, in-memory stores, `FileMasteryClaimSink`. `loadBundleZip` inflates only the archive's `lesson.json`, refused past `MAX_LESSON_JSON_BYTES` (8 MB uncompressed) even when the archive declares a smaller size. Test doubles, `@studium/lesson-session/testing`: `buildTestDeps`, `FixedClock`, `SeqIdGen`, `StaticPseudonym`.

## Example

```ts
import { readFileSync } from "node:fs";
import { LessonSession } from "@studium/lesson-session";
import { loadBundleJson } from "@studium/lesson-session/node";
import { buildTestDeps } from "@studium/lesson-session/testing";

const raw = JSON.parse(readFileSync("packages/lesson-session/src/fixtures/all-scene-types.json", "utf8"));
const session = new LessonSession(loadBundleJson(raw), buildTestDeps(), undefined, "learner-1");
const first = await session.start();               // the first scene
const next = await session.respond({ kind: "ack" }); // next.kind: "next", "replay", "remediate", "complete"...
```

To play a scripted run in the terminal (files land in the `--out` directory):

```bash
pnpm --filter @studium/lesson-session play src/fixtures/all-scene-types.json src/fixtures/scripts/all-types-happy.json --out .playthrough
```

## Invariants

- Every verdict names who assessed the answer: `assessed_by` is `key`, `judge` or `none`. `graded` only says an answer was submitted.
- Without a judge model, an open answer is not scored by keyword counting: the verdict carries the reference (`key_points`, `model_answer`, `reference_kind`) and asks for a self-rating. A quiz answered wrong carries the text of its correct choice (`reference_kind: "correct_choice"`).
- A self-rating is accepted only for a scene that asked for one; it becomes an FSRS grade for every concept of that scene (`concept_ids`) and never moves mastery. Pending requests are saved with the learner state; a request an older state lost raises `SelfRatingExpiredError`.
- An answer nobody graded is unmeasured, not wrong: it never sends the learner to remediation.
- A concept is certified only with a posterior of at least 0.8 and at least 3 graded attempts.
- The session sees the answer keys. Redacting them before display is the host's job.
- The pseudonym is an HMAC of learner id and lesson id; the CLI uses `STUDIUM_PSEUDO_SECRET`.

## Test

```bash
pnpm --filter @studium/lesson-session test
```

## Depends on / used by

- Depends on: `@studium/adaptation-engine`, `@studium/learner-state`, `@studium/learning-workflow-schema`, `@studium/lesson-bundle-schema`, `@studium/reasoning-scorer`, `@studium/telemetry-events`, `@studium/llm-client`, `fflate`, `zod`.
- Used by: `@studium/lesson-session-host`, `apps/lesson-mcp`, `apps/lesson-server`, `apps/student-runtime`.

## Status

Active. Private workspace package, not published to npm.
