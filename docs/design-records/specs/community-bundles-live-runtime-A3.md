# A3 — Approved community bundles in the live student runtime

Status: implemented (branch `feat/roadmap-wave2`).

Closes the last mile of the learner-as-author loop: a community item a teacher
`decide_item`-approves becomes **discoverable and openable by a live student app**
for its course, without ever mutating the canonical course.

## The path mismatch this closes

Wave-1-B shipped two ends that did not meet on a live deployment:

- **Discover** (TS): `discoverCommunityBundles(courseRoot)`
  (`packages/lesson-session-host/src/community-bundles.ts`) scans
  `<courseRoot>/community/` for `community-<item_id>.zip`, returning refs relative
  to `courseRoot` so each loads through the unchanged `resolveBundle` path.
- **Emit** (Python): `decide_item(..., bundles_root=...)`
  (`services/scene-synth/learner_review.py`) writes a flat `community-<item>.zip`
  into the `bundles_root` it is handed. `scene_synth_app.py` handed it
  `LEARNER_DATA_ROOT/community-bundles` — a free-floating dir with **no relation
  to any course root**, so a `SessionHost` rooted at the course never saw it.

The `community_flow_check.mjs` e2e bridged the gap manually by passing
`root + "/community"`.

## The chosen convention (one convention, both ends agree)

`decide_item` is **handed the course root's `community/` subdir**. This keeps
`decide_item`'s own contract unchanged (it still writes a flat `.zip` into the dir
it receives — every existing `test_decide_item.py` assertion holds), while making
the emitted file land exactly where TS discovery scans.

The subdir literal is shared in **three** places, kept in lockstep:

| Side | Symbol | File |
|------|--------|------|
| Runtime (TS) | `COMMUNITY_DIR = "community"` | `packages/lesson-session-host/src/community-bundles.ts` |
| Emit (Python) | `COMMUNITY_DIR` + `community_emit_dir(courseRoot)` | `services/scene-synth/learner_review.py` |
| Extension (TS) | `COMMUNITY_DIR` + `discoverCommunityBundles(bundlesRoot, bundleRef)` | `apps/studium-vscode/src/community.ts` |

`community_emit_dir(courseRoot) == <courseRoot>/community` is the single helper
every caller uses to hand `decide_item` the right directory.

### Live HTTP path

`scene_synth_app.py` now reads `COMMUNITY_BUNDLES_ROOT` (the **course** bundles
root — the dir holding the immutable canonical `lesson.json`) and sets its emit dir
to `community_emit_dir(COMMUNITY_BUNDLES_ROOT)`. A decide on the running server thus
lands under the course's `community/`, where a `SessionHost`/`lesson-mcp` rooted at
the same course discovers it. When unset it falls back to `LEARNER_DATA_ROOT` so the
legacy standalone behaviour is preserved; tests still monkeypatch
`_learner_bundles_root` directly.

### Invariants preserved

- **Canonical course is immutable** — community bundles are separate files in a
  sibling `community/` subdir; the canonical `lesson.json` is never read/written by
  emit, discovery, or load (asserted byte-identical end-to-end).
- **Hidden-temp + scrub guard** — `decide_item` still builds into a hidden
  `.<id>.tmp.zip`, asserts the pseudonym is scrubbed from `lesson.json` + `prov.json`,
  and only then atomically moves the final file into the discovery dir. A failed
  scrub leaves nothing discoverable.
- **Dotfile/temp guard on discovery** — both the TS host discovery and the
  extension mirror skip leading-dot files and non-`community-*.zip` names.
- **Author never exposed** — the distributed bundle is pseudonym-free; the picker
  shows only the neutral item id.

## Learner-facing affordance (VS Code)

Command `studium.communityContributions`
("Contributions de la classe / Community contributions"):

1. discovers approved community bundles for the bound course
   (`discoverCommunityBundles(communityBundlesRoot, bundleRef)`),
2. shows a QuickPick of neutral, pseudonym-free items, and
3. opens the chosen bundle through the **same** `openLesson` path as the canonical
   bundle (the community ref is passed as the `bundleRef` override; `resolveBundle`
   / `start_lesson_session` load it unchanged).

Config `studium.communityBundlesRoot` lets a deployment point discovery at the
course bundles root the emit path writes into (defaults to `studium.bundlesRoot`).
The extension's discovery is a dep-free `node:fs` mirror of the host's
`discoverCommunityBundles` convention (the same pattern by which `host.ts` mirrors
`fsrs.ts`), because the extension bundle must not add `@studium/lesson-session-host`.

## Full-loop proof (`fixtures/atomistique-l1/community_flow_check.mjs`)

Drives the REAL code end-to-end, key-free (`live:false`):

```
author --> peer(rate) --> teacher(approve + IRI + ts) --> emit
        ⟶ discover (SessionHost.listCommunityBundles) --> load (SessionHost.create)
        --> grade (existing quizGrader)
```

The Python half emits into `community_emit_dir(root)`; the TS half discovers it via
`SessionHost.listCommunityBundles()`, boots it exactly like the canonical course,
and the existing `grade()` marks a classmate correct/incorrect — the author is never
exposed and the canonical course is never mutated.

## Tests

- `services/scene-synth/tests/test_community_path_reconcile.py` — `COMMUNITY_DIR`,
  `community_emit_dir`, emit-lands-where-discovery-scans, temp/dotfile + scrub guard,
  app default emit dir.
- `apps/studium-vscode/src/community.driver.ts` — discovery scoping, dotfile/temp/
  wrong-extension exclusion, canonical-only `[]`, root-level course, picker shaping.
- `packages/lesson-session-host/src/community-bundles.test.ts` (Wave-1-B, still green).
- `fixtures/atomistique-l1/community_flow_check.mjs` — the full loop.
