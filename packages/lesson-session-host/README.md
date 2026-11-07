English · [Français](README.fr.md)

# @studium/lesson-session-host

Everything a surface needs around lesson sessions. A `SessionHost` finds lessons, starts or resumes sessions for a learner, keeps their progress (durable by default in the apps, or in memory), hides answer keys until the learner has answered, builds the study plan and review sessions, and writes the text a chat client shows. The package also holds the conversational author that turns sources a learner chose into a lesson. The MCP server, the HTTP lesson server and the VS Code extension are thin layers over it; the tools are listed in [MCP tools](../../docs/reference/mcp-tools.md).

## Where it sits

Above [`@studium/lesson-session`](../lesson-session/README.md) (one session) and below `apps/lesson-mcp` and `apps/lesson-server`. See [architecture](../../docs/develop/architecture.md).

## Public API

From [src/index.ts](src/index.ts), grouped:

| Area | Main exports |
|---|---|
| Sessions | `SessionHost` (`create`, `respond`, `rateRecall`, `requestHint`, `close`, `forget`, `forgetLearner`, `studyPlan`, `listLessons`, `startReview`, `workflowGraph`...), `SessionHostNotFoundError`, `RunRequiredError`, `SessionRegistry`. |
| Time | `NowMsSchema`, `checkNowMs`, `OffsetClock` (the clock of a session started with `now_ms`), `calendarDate`, `localTimeZone`, `checkTimeZone`. |
| Persistence | `resolvePersistence(env, homedir)`, `persistenceInfo`, `DEFAULT_LEARNER_ID`, `buildHostDeps`, `durableDataDir`, `FileLearnerProfileStore`, `telemetryConsentGranted`. |
| Lessons | `resolveBundle`, `loadResolvedBundle`, `discoverCommunityBundles`, `resolveCourse`, `shuffleQuizChoices`. |
| Redaction | `publicScene`, `publicPresentation`, `publicTransition`, `citedSources`, `REDACTED_SCENE_FIELDS`. |
| Provenance | `authoringOf`, `draftedByOf`, `readApproval`, `buildReviewInbox` and `readLastReceipt` (the review inbox and its receipts), `isTeacherValidated`, `keyClassOf`, `SELF_STUDY_NOTICE`, `AGENT_DRAFTED_NOTICE`. |
| Chat | `presentationMarkdown`, `transitionMarkdown`, `verdictMarkdown`, `replyToInput`, `ResponseInputSchema`. |
| Conversational author | `authoringGuide`, `prepareSources`, `createLesson`, `LessonDraftSchema`, `lintBundleData`, `MAX_SOURCES`, `MAX_TOTAL_SOURCE_CHARS`. |
| Review | `reviewQueueFromState`, `conceptMemoryFromState`, `nextReinforcementFromState`, `dueReinforcementTargetsFromMemory`, `pickReviewScene`, `isDiagnosticScene`. |
| Runs and agents | `SessionWorkspace` (file channel), `RunResultSchema`, `parseRunResult`, `runStudiumSession`, `operatorContext`, `StubJudgmentGenerator`, `HttpLlmJudgmentGenerator`. |
| Peer rooms | `aggregateRatings`, `distinctRaters`, `ROOM_K_FLOOR`. |

## Example

```ts
import { SessionHost } from "@studium/lesson-session-host";

const host = new SessionHost({ bundlesRoot: "fixtures", dataDir: null, live: false });
const { sessionId, presentation, persistence } = await host.create("atomistique-l1/lesson.json", "learner-1");
console.log(presentation.display_markdown); // persistence.durable is false: in memory only
const transition = await host.respond(sessionId, { kind: "ack" });
const plan = await host.studyPlan("learner-1"); // due_reviews, relearn, unmeasured_reviews, next_lesson...
await host.close(sessionId);
```

## Invariants

- No key before an answer: served scenes drop the fields in `REDACTED_SCENE_FIELDS` (correct-choice feedback, hints, key points, model answers, claims). Cited passages and the reference are released only when the learner leaves the scene for good; a retry or a prerequisite detour on the same point holds them back.
- Quiz choices are shuffled and re-lettered per scene, deterministically, so the right answer is never always "a".
- `resolvePersistence` puts lessons and data under `STUDIUM_HOME` (default `~/.studium`); `STUDIUM_EPHEMERAL=1` keeps state in memory, and an explicit `STUDIUM_DATA_DIR` wins over it. See [configuration](../../docs/reference/configuration.md).
- On-disk learner folders are HMAC pseudonyms; the secret is `STUDIUM_PSEUDO_SECRET` or a per-install `.studium-secret` file in the data directory.
- Every served lesson says who wrote it and who drafted its keys (`teacher`, `learner`, `agent`), and whether a teacher approval record matches its exact bytes.
- `prepareSources` accepts up to 20 sources and 200 000 characters in total; `createLesson` checks each quote against its passage character for character, validates and lints the lesson before writing it, and marks it agent-drafted. Both write only to the library root they are given; the MCP server passes `<STUDIUM_HOME>/library`, never `BUNDLES_ROOT`.
- A session started with `nowMs` runs on an `OffsetClock` anchored there, so its answers, ratings and review dates are stamped in that simulated time. Every date shown is a calendar day in the host's time zone (`timeZone`, default the machine's).
- A review never replays a diagnostic scene (`isDiagnosticScene`) and, without a judge, prefers a scene graded against a key; the study plan uses the same rule (`pickReviewScene`).
- Telemetry is written to disk only with consent (`STUDIUM_TELEMETRY_CONSENT`) and durable state.
- The interaction log (INT-STUDIUM-058 § 2.10) is written by the host alone: `settleAct(id, {act, lane, surfaceRank, clientMs?}, run)` times `run` and adds one `interaction` event; `requestHint`, a contest's last check answer, `create` on a resumed lesson and `surfaceChanged` add `help_used`, `contest` and `resume`. `create` on a resumed lesson also opens a `resume_notice` in the session's prompt book ("Resumed at step n of total.", the status line's numbers), bound to that first scene: its conversation text and the panel's `prompts` both carry it. Labels, ids, counts and delays only; the list of what emits what is in [telemetry-events](../telemetry-events/README.md).

## Test

```bash
STUDIUM_EPHEMERAL=1 pnpm --filter @studium/lesson-session-host test
```

## Depends on / used by

- Depends on: `@studium/lesson-session`, `@studium/adaptation-engine`, `@studium/lesson-bundle-schema`, `@studium/learner-state`, `@studium/typed-graph-lens`, `zod`.
- Used by: `apps/lesson-mcp` (and through it the VS Code extension), `apps/lesson-server`.

## Status

Active. Private workspace package, not published to npm.
