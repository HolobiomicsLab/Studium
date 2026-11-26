English · [Français](README.fr.md)

# Lessons shipped with Studium: sources

`apps/lesson-mcp/shipped-lessons/` holds the lessons that ship inside the VS Code extension
(`dist/shipped-lessons/`) and the npm package `studium-mcp` (`shipped-lessons/`). The server finds them beside
itself and searches them after the bundles root and the learner's library: a learner's own lesson always
wins, `list_lessons` lists them apart (`shipped_lessons`; asked in a language, only the one in that language when it
exists), and `get_study_plan` offers one only to a learner
who has no lesson of their own. This folder holds what they are built from.

## Discover Studium / Découvrir Studium

| | |
|---|---|
| Lessons | `discover-studium-en/lesson.json` (English), `discover-studium-fr/lesson.json` (French) |
| Content | 12 scenes, about ten minutes, 5 concepts: the assistant relays and the learner answers; a course is a graph of concepts (with a prerequisite detour); who holds the key and where it comes from; spaced reviews; local first |
| Sources | seven pages of Studium's own documentation, in the lesson's language (`sources.json`), CC BY 4.0 |
| Drafted by | an AI agent (Claude Opus 5.5 in Claude Code), 25 November 2026; rewritten by an AI agent on 26 November 2026 (decision D7: each instruction names the control on screen, not a surface, and one duration, ten minutes) |
| Status | teacher mode (`authoring_mode` in `sources.json`), `drafted_by: agent`; the project's owner approved them on 25 November 2026, under the name beta-testeur, without reading them (no scene opened, no checklist declared); the rewrite of 26 November 2026 was approved again under the same name, recorded by the agent on the owner's delegation, with no scene read; `approval.json` is bound to the exact bytes of `lesson.json` (rule 003) |

| File | What it is |
|---|---|
| `sources.json` | the pages, their URL and licence, the goal of each language version, and the authoring mode the build writes (`authoring_mode`) |
| `draft.en.json`, `draft.fr.json` | the LessonDraft sent to `create_lesson`; a quote's `passage_id` written `doc:<key>` is resolved to the one passage of that page holding it |
| `source-set.en.json`, `source-set.fr.json` | the source set `prepare_sources` produced: every passage the lesson may cite, named by the lesson's `source_plan_id` |

## Rebuild

From the repository root, after `pnpm build:libs`:

```bash
pnpm --filter @studium/lesson-mcp exec tsx scripts/build-shipped-lessons.ts
node tools/bundle_lint.mjs apps/lesson-mcp/shipped-lessons/discover-studium-en/lesson.json
node tools/bundle_lint.mjs apps/lesson-mcp/shipped-lessons/discover-studium-fr/lesson.json
STUDIUM_EPHEMERAL=1 pnpm --filter @studium/lesson-mcp exec vitest run src/shipped-lessons.test.ts
```

The script runs `prepare_sources` and `create_lesson` (the library functions the MCP tools call) in a temporary
library: every quote is checked against its passage character for character, so a documentation page that no
longer holds a quoted sentence makes the build fail. `create_lesson` always writes a self-study lesson; the script
then sets the authoring mode `sources.json` names, keeping `drafted_by: agent`, and lints the lesson it ships. The test plays both lessons
through the MCP server, checks that every quoted passage is still in the page it cites, and rebuilds them with `--out` into a
temporary folder to check that the shipped lessons are what the drafts give.

## Review and approve

`experience_packet.py approve` refuses a self-study lesson, so these lessons are built in teacher mode
(`authoring_mode` in `sources.json`), still `drafted_by: agent`. The project's owner approved them on 25 November
2026, under the name beta-testeur, without reading them: their receipt in `reviews/` says that no scene was
opened, and their approval record declares no checklist. The rewrite of 26 November 2026 (decision D7) was approved the
same way, recorded by the agent on the owner's delegation: no scene read, no checklist. The lesson's text never says that it was approved, since
the status comes from the record, which a copy or a rebuild leaves behind: the welcome text (`s1-intro`) says that
an AI agent drafted the lesson and points to the top of the screen, which says whether someone validated this exact
version and who; the right answer of `s6-quiz` ("Who wrote this key") is the AI agent.

To approve a lesson, for each language:

```bash
.venv/bin/python tools/experience_packet.py approve \
  --bundle apps/lesson-mcp/shipped-lessons/discover-studium-en/lesson.json \
  --validated-by "Reviewer name" --opened s1-intro,s6-quiz \
  --note "What happened: the scenes read, and how"
```

`--opened` lists only the scenes actually opened and read (leave it out when none was); `--note` says what
happened. The command rewrites `lesson.json` (`validated_by`, `validated_at`), then writes `approval.json`,
bound to the sha256 of those bytes, and a receipt in `reviews/` next to the lesson.

Rebuilding the lessons, or any edit of a `lesson.json`, changes its bytes: its approval record is then stale, and
learners read that the lesson changed since its approval. `src/shipped-lessons.test.ts` (and the demo check of
`apps/studium-vscode/src/extension-host.driver.ts`) fail until `approve` runs again on the new bytes, with the
reviewer's own name, `--opened` listing only the scenes actually opened and read, and a `--note` saying what
happened. The tests name no reviewer: they read it from `approval.json` and check that the record, `validated_by`
and the one receipt for the current bytes agree.
