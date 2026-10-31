# Studium factual diagrams

Source evidence below is anchored to the mission baseline `7ad27cf`. The shared
sprint checkout can advance independently while these new assets are prepared.

Four diagrams are supplied as matched light/dark SVG pairs. They use real SVG
`<text>`, accessible `title`/`desc` names, and the palette and system typography
from `design/tokens.json` keys `typography.font.{display,text}` and
`color.{light,dark}.*`. Run `node docs/assets/diagrams/generate.mjs` from the
repository root to reproduce all eight files.

| Diagram | Main reading |
|---|---|
| `architecture-{light,dark}.svg` | Author-time services produce typed course artifacts; runtime hosts serve learner clients; teacher and Observatory paths remain review surfaces. |
| `learning-loop-{light,dark}.svg` | Only certified correctness updates Beta/IRT mastery and FSRS; ungraded and keyword-only paths bypass those updates. |
| `self-learner-journey-{light,dark}.svg` | A learner chooses references, reviews an agent-authored outline, sees the authoring notice at play entry, and later returns through a due review queue. |
| `teacher-journey-{light,dark}.svg` | Evidence and MySTRA review precede an explicit human approval; learner contributions have their own teacher-gated publication loop. |

Solid teal arrows are operational progression. Dashed gray arrows are review,
queued return, or documented handoffs whose timing is not automatic. Scene-class
and graph-state colors come from `design/tokens.json` keys
`color.{light,dark}.scene-*` and `color.{light,dark}.node-*`; concept circles and
task rounded squares are node kinds, while mastered and due are states.

The files under `rendered/` are inspection evidence, not alternate sources. Each
SVG was converted with repository `.venv` PyMuPDF 1.27.2.3 and rasterised at an
exact width of 880 px. The light and dark renders were inspected at original
resolution for text clipping, connector crossings, contrast and spacing.
PyMuPDF substitutes Helvetica/Helvetica Bold and Times Bold for unavailable
system-stack faces; the SVGs retain the exact token font stacks for host rendering.

## Architecture evidence

- `README.md:35-47` defines concept/task nodes and typed LWG edges;
  `README.md:62-75` gives the author-time → LessonBundle/LWG → runtime flow.
- `README.md:108-119` names the Python services, three runtime packages, schemas,
  provenance, and HTTP/MCP hosts.
- `docs/getting-started/harnesses-and-api.md:1-18` describes the stdio MCP route and
  Codex/Claude Code clients; `docs/getting-started/harnesses-and-api.md:158-173`
  documents the file channel.
- `apps/studium-vscode/README.md:3-24` documents the lesson pane, notebook, MCP
  client and adaptive turn loop; `apps/studium-vscode/README.md:65-79` adds the
  live graph, FSRS cue and learner-facing surfaces.
- `docs/features.md:15-26` distinguishes VS Code, MCP, file channel, MySTRA,
  Observatory and contribution capabilities and their limits.
- `docs/guides/observatory.md:9-14` explicitly makes Observatory an operator view,
  separate from the teacher dashboard and invisible to learners.

The repository does not define one common client wire from the runtime host to
both review products. The diagram therefore connects course/review artifacts to
those surfaces with a dashed review path rather than inventing a runtime-client
relationship. This matches the open integration boundaries at
`docs/features.md:122-128`.

## Learning-loop evidence

- `packages/lesson-session-host/src/key-class.ts:8-27` is the exhaustive mapping
  of all 13 scene types to the four key classes. The same user-facing contract is
  documented at `docs/features.md:67-75`.
- `packages/lesson-session/src/session.ts:294-319` shows grading, signal
  application, decision and navigation in order.
- `packages/learner-state/src/index.ts:57-72` states that keyword-only free-text
  feedback carries no `correct`, so Beta, FSRS and concept gates receive nothing.
  `packages/adaptation-engine/src/engine.ts:104-165` preserves that distinction.
- `packages/adaptation-engine/src/beta-updater.ts:5-40` implements the Beta update,
  hint discount and explicit ungraded-attempt path. The item difficulty is the IRT
  weight (`packages/lesson-session/src/grading/graders.ts:33-44`).
- `packages/adaptation-engine/src/fsrs.ts:56-85` defines due timing and grades from
  certified answers; `packages/adaptation-engine/src/fsrs.ts:146-183` builds and
  routes the due reinforcement queue.
- `design/tokens.json` keys `color.{light,dark}.scene-*` and
  `color.{light,dark}.node-*` supply the visual vocabulary; the key-class and
  correctness rules themselves come from the runtime sources cited above.

## Self-learner evidence

- `docs/tutorials/self-study-from-references.md:3-19` defines the no-teacher route,
  licence check and learner/agent responsibilities; lines `65-80` cover agent
  authoring followed by learner outline review without answer keys.
- `docs/tutorials/self-study-from-references.md:160-200` starts play through MCP or
  the panel and shows the returned authoring notice; lines `210-226` state that
  this is neither teacher validation nor publication.
- `docs/features.md:53-65` says the notice is returned by session start, operator
  context and presentation. `apps/studium-vscode/src/webview-pane.driver.ts:439-455`
  verifies that the notice renders above the scene, so it is not withheld until
  after an answer.
- `packages/lesson-session-host/src/host.review.test.ts:72-87` verifies that a fresh
  answer is not due immediately and can become due later. The diagram says queue
  and learner return; it does not claim an automatic notification.

## Teacher evidence

- `docs/tutorials/literature-to-course.md:3-16` and lines `23-46` define the
  evidence packet, sourced draft, checks and MySTRA review while status remains
  draft.
- `docs/user/teacher-guide.md:52-65` says MySTRA presents provenance but neither
  executes the code nor approves the course.
- `services/planner/provenance/approval_cli.py:1-15` requires review before the
  explicit approval command; lines `36-49` identify rule 003, the human approver
  and explicit timestamp. `README.md:121-123` requires human approval before
  student-facing use.
- `docs/user/teacher-guide.md:131-190` records the current manual/export and
  synthesis gaps. The transfer-boundary callout preserves this instead of showing
  a seamless browser pipeline.
- `docs/guides/learner-as-author-UI-guide.md:102-108` shows that learners can only
  submit, the teacher dashboard exposes the scene and answer key for review, and
  approval alone emits a de-identified community bundle without mutating the
  canonical course.

No unresolved claim was filled speculatively. The two documented uncertainties
are shown as boundaries: review surfaces lack one shared runtime wire, and the
teacher authoring path still has a file/manual transfer before class delivery.
