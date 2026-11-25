English · [Français](README.fr.md)

# Lessons shipped with Studium: sources

`apps/lesson-mcp/shipped-lessons/` holds the lessons that ship inside the VS Code extension
(`dist/shipped-lessons/`) and the npm package `studium-mcp` (`shipped-lessons/`). The server finds them beside
itself and searches them after the bundles root and the learner's library: a learner's own lesson always
wins, `list_lessons` lists them apart (`shipped_lessons`), and `get_study_plan` offers one only to a learner
who has no lesson of their own. This folder holds what they are built from.

## Discover Studium / Découvrir Studium

| | |
|---|---|
| Lessons | `discover-studium-en/lesson.json` (English), `discover-studium-fr/lesson.json` (French) |
| Content | 12 scenes, about 11 minutes, 5 concepts: the assistant relays and the learner answers; a course is a graph of concepts (with a prerequisite detour); who holds the key and where it comes from; spaced reviews; local first |
| Sources | seven pages of Studium's own documentation, in the lesson's language (`sources.json`), CC BY 4.0 |
| Drafted by | an AI agent (Claude Opus 5.5 in Claude Code), 25 November 2026 |
| Status | self-study mode, `drafted_by: agent`, validated by nobody; no approval record (rule 003) |

| File | What it is |
|---|---|
| `sources.json` | the pages, their URL and licence, and the goal of each language version |
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
library: every quote is checked against its passage character for character and the linter runs, so a
documentation page that no longer holds a quoted sentence makes the build fail. The test plays both lessons
through the MCP server and checks that every quoted passage is still in the page it cites.

## Review and approve

No teacher has reviewed these lessons, and they say so on their first screen. `experience_packet.py approve`
refuses a self-study lesson. To approve one after reading it, its authoring mode becomes `teacher` (keeping
`drafted_by: agent`) and the sentences that say no teacher checked it change: the welcome text (`s1-intro`)
and the right answer of `s6-quiz` ("Who wrote this key"). Then:

```bash
.venv/bin/python tools/experience_packet.py approve \
  --bundle apps/lesson-mcp/shipped-lessons/discover-studium-en/lesson.json \
  --validated-by "Reviewer name" --opened s1-intro,s2-quiz,s3-concept,s4-quiz,s5-concept,s6-quiz,s7-explain_back,s8-concept,s9-quiz,s10-concept,s11-quiz,s12-quiz
```

and the same for `discover-studium-fr`. This writes `approval.json` and `reviews/` next to the lesson; the test
that asserts there is no approval record changes with it.
