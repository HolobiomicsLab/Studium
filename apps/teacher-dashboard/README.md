English · [Français](README.fr.md)

# Teacher dashboard

A local web app for teachers: browse and review the lessons in a library, see whether each one is a
draft, checked or approved, and read class-level analytics (progress, calibration, reasoning, trust)
behind a floor of five learners.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../docs/assets/screenshots/teacher-library-dark.png">
  <img src="../../docs/assets/screenshots/teacher-library-light.png" alt="The teacher dashboard library listing lessons with their status: draft, checked or approved">
</picture>

| | |
|---|---|
| Status | **maintained** (decision D6) |
| Run | `pnpm --filter @studium/teacher-dashboard dev` (development) or `build` then `start` |
| Port | 3001 |
| Calls | analytics collector (8003), lesson server (8010), scene-synth (8002) for learner contributions, Observatory (8004) for report links |
| Tests | `pnpm --filter @studium/teacher-dashboard test`; browser tests with `test:e2e` |

User guide: [Review and approve a lesson](../../docs/teach/review-and-approve.md) and
[Follow a class](../../docs/teach/follow-a-class.md).

## Run it

For the repository's teaching fixtures, from the repository root:

```bash
BUNDLES_ROOT="$PWD/fixtures" pnpm --filter @studium/teacher-dashboard dev
```

A production build:

```bash
NEXT_TELEMETRY_DISABLED=1 pnpm --filter @studium/teacher-dashboard build
pnpm --filter @studium/teacher-dashboard start
```

Open `http://localhost:3001`. The home page leads to the library (`/library`); a course id typed there
opens its analytics under `/courses/<id>/…`.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `BUNDLES_ROOT` | `$STUDIUM_HOME/library` | library folder; it may hold `lesson.json` directly or nested lesson folders |
| `STUDIUM_HOME` | `~/.studium` | used when `BUNDLES_ROOT` is unset |
| `ANALYTICS_BASE_URL` | `http://localhost:8003` | [analytics collector](../../services/analytics-collector/README.md) |
| `LESSON_SERVER_BASE_URL` | `http://localhost:8010` | [lesson server](../lesson-server/README.md) (peer rooms) |
| `SCENE_SYNTH_BASE_URL` | `http://localhost:8002` | [scene-synth](../../services/scene-synth/README.md) (moderation of learner contributions) |
| `OBSERVATORY_BASE_URL` | `http://localhost:8004` | [Observatory](../../services/observatory/README.md) |

A review page probes the Observatory's MySTRA API for the lesson folder's name. It links to the report
only when that report exists; otherwise it explains how to start or configure the Observatory. The
dashboard does not create MySTRA records or infer a report from a bundle id.

Language uses the `studium-locale` cookie (`fr` or `en`) before `Accept-Language`. The header's display
menu saves language and theme; `studium-theme` accepts `light`, `dark` or `system`. Existing analytics
copy remains French.

## Status and review contract

| Status | Meaning |
| --- | --- |
| Draft | The bundle fails its schema or still contains a TODO placeholder. |
| Checked | The bundle passes the shared schema and contains no TODO. This does not claim a full lint run or human approval. |
| Approved | A complete `studium-approval/1` record matches the SHA-256 of the exact `lesson.json` bytes. |

An approval record must contain a reviewer, timestamp, checklist, successful lint result and tool
identifier, as written by `tools/experience_packet.py approve`. Changing even whitespace in the lesson
breaks the digest match. Free-form `validated_by` metadata never grants this status. Matching a
historical record does not depend on later changes to the installed schema validator.

The review page shows only titles, scene types, concepts and bibliographic references. It sends no lesson
bodies, prompts, choices, grading fields or evidence excerpts to the browser. The approval command it
displays quotes the exact local file path and must be run from the repository root; the page itself writes
nothing. Self-study lessons show the tool's refusal rule instead of a command that cannot succeed.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../docs/assets/screenshots/teacher-review-dark.png">
  <img src="../../docs/assets/screenshots/teacher-review-light.png" alt="The review page of one lesson with its scenes, concepts, references and the approval command to run">
</picture>

## Filesystem boundary

Reads stay under the canonical library root. Route references are canonical base64url encodings of
relative folder names; absolute paths, traversal, backslashes, NULs and linked child folders or files are
refused. Each file must be regular and at most 10 MiB. Traversal stops at eight levels and 500 lessons;
unreadable or skipped folders are reported next to healthy lessons.

Opening uses `O_NOFOLLOW`, then rechecks folder and file identity and confinement. A deterministic test
covers a folder replaced by a symlink during opening. These checks detect observed swaps; this local
application assumes trusted library writers and does not claim isolation against a process that keeps
replacing path components.

Missing lessons get a 404. Invalid JSON, unreadable files and unavailable roots get a localized repair
message without upstream errors. A missing, malformed, stale or linked approval file never grants approval.

## Theme

`app/globals.css` imports `../../../design/tokens.css`, so the canonical [design tokens](../../design/README.md)
are bundled directly by Next. Analytics, library and review styles share them. Charts include captions and
data tables; print CSS reveals those tables and keeps the course heading. No webfont or remote asset is
needed.

## Tests

```bash
pnpm --filter @studium/teacher-dashboard test
pnpm --filter @studium/teacher-dashboard exec tsc --noEmit
pnpm --filter @studium/teacher-dashboard test:e2e     # Playwright, tests/integration
```

The browser capture instructions for the screenshots are in
[`docs/assets/screenshots/v2-verification.md`](../../docs/assets/screenshots/v2-verification.md).
