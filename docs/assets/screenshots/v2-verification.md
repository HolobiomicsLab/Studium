# Studium V2 web surfaces — implementation evidence

Date: 2026-10-30. Coordinator: `/root`, `gpt-6-astra`, effort `max`.
Integration owner: the Fable/Opus caller. Scope: teacher dashboard, author-web
shell, Observatory templates and shared UI assets. The hub and `design/` remained
read-only. No Git state-changing command, package installation, secret read,
external request, or VS Code dist build was performed by this mission.

**Result: partial.** Implementation and the available automated checks pass.
Real browser captures and visual inspection remain blocked by this process's
sandbox. Portable report exports retain their historical theme for exact
verification. This is not acceptance of the complete V2 screenshot requirement.

## Delivered behavior

- Teacher library and per-lesson review are dynamic server pages. They read
  `BUNDLES_ROOT`, defaulting to `$STUDIUM_HOME/library` or `~/.studium/library`.
  Titles, language, authoring mode, scene count, key-class mix and status are
  shown. The review contains an outline, concepts, source references, TODO/schema
  counts, receipt details, an exact quoted approval command and a probed MySTRA
  link when its report exists.
- C5 approval requires a complete `studium-approval/1` receipt with a matching
  digest of the exact lesson bytes and zero lint errors. `validated_by` alone
  never approves a lesson. “Checked” means schema-valid plus no TODO, explicitly
  distinct from human approval and from a full lint pass.
- Review sends only a whitelist projection to the page. Server-render tests
  verify that lesson bodies, answer choices and source excerpts do not appear.
  Missing and unreadable lessons have different localized recovery paths.
  Self-study lessons do not offer a command rejected by the approval CLI.
- Confinement rejects traversal, noncanonical route references, symbolic child
  directories/files, nonregular files and oversized input. Post-open identity
  checks reject an observed directory replacement. The local library assumes
  trusted writers; this is not a claim of descriptor-relative isolation against
  an adversarial concurrent writer.
- All ten analytical figures expose captions and semantic data tables. Missing
  values remain distinct from zero. Existing privacy suppression stays intact.
  Series use token colours with dash patterns, labels or patterned geometry.
  Semantic classes replace the leftover utility strings. Available lesson,
  scene and concept titles are used in class views.
- Tokens supply light/dark colours, typography and visible keyboard focus. The
  dashboard has language/theme preferences, FR/EN library and review copy, and
  print rules that expose data tables and retain course headings. Existing
  French analytics copy is preserved. author-web receives only a token shell
  and a visible bilingual `legacy (M1 demo)` notice.

## Token source and legacy compatibility

Dashboard and author-web import `design/tokens.css` directly. Observatory inlines
the deterministic `ui/studium-tokens.css` copy, maintained by
`node ui/sync-studium-tokens.mjs --write` and checked with `--check`.
Fractional CSS leading zeroes are normalized without changing computed values,
because existing privacy assertions search the entire rendered HTML for withheld
measurement text.

The Observatory composition adds `ui/studium-theme-current.css` after the frozen
`ui/studium-theme.css`. The latter remains byte-identical, SHA-256
`c68f49670366c3eeb5bc7587a0ca0a329fca62a19c37a2578984904ac364319c`.
Changing it in place would change the exact HTML reconstructed by historical
portable-report verification. Moving portable reports/activity exports to the
new tokens therefore needs a new bounded renderer generation in files outside
this mission's write scope. See [shared UI contract](../../../ui/README.md).

## Executed checks

Runtime: Node `v24.16.0`, pnpm `9.15.9`, Python `3.13.13` from `.venv`,
Next.js `14.2.35`. The dependency change in dashboard `package.json` belongs to
the concurrent dependency worker and is excluded from this mission's file list.

| Command | Result |
| --- | --- |
| `pnpm --filter @studium/teacher-dashboard test` | Exit 0; 14 files, **129 tests passed**. |
| `pnpm --filter @studium/teacher-dashboard exec tsc --noEmit` | Exit 0. |
| `NEXT_TELEMETRY_DISABLED=1 pnpm --filter @studium/teacher-dashboard build` | Exit 0; `/library` and `/library/[lesson]/review` generated as dynamic server routes; 96.6 kB first-load JS each. |
| `pnpm --filter @studium/author-web test` | Exit 0; **52 tests passed**. |
| `pnpm --filter @studium/author-web exec tsc --noEmit` | Exit 0. |
| `.venv/bin/python -m pytest services/observatory -q` | Exit 0; **242 tests passed**; one existing Starlette deprecation warning. |
| `.venv/bin/python -m pytest tools/test_learner_report.py tools/test_report_theme.py tools/test_context_help.py -q` | Exit 0; **29 tests passed**; historical verification, current export verification and tamper rejection included. |
| `node design/scripts/check-contrast.mjs` | Exit 0; **128 checks, 0 failures**. Canonical design files unchanged. |
| `node ui/sync-studium-tokens.mjs --check` | Exit 0; generated token copy matches. |
| `node --check docs/assets/screenshots/capture-web.mjs` | Exit 0. |
| `node docs/assets/screenshots/capture-web.mjs --check` | Exit 0; local browser discovered, optional pane directory absent; deliberately does not launch a browser. |
| `git diff --check -- apps/teacher-dashboard apps/author-web services/observatory/templates ui` | Exit 0. |

Additional source checks found zero undefined `--st-*` references in the five
new/updated surface stylesheets and no remaining Tailwind utility strings in
production dashboard TSX. The Observatory leaf's ASGI render of `review-demo`
returned HTTP 200, four ordered inline style layers, and zero external asset
references. ASGI and server-render tests do not establish browser layout.

Build warnings remain in existing `api.test.ts` and `SubmissionsQueue.test.tsx`
(`no-explicit-any`), along with the existing Next ESLint-plugin notice and stale
Browserslist data. No dependency download or unrelated test repair was attempted.
Whole-repository tests, diagnostics and Git integration remain with the caller
while the other production-sprint writers are active.

## Native leaf coordination and review disposition

Both leaves used `gpt-5.6-sol`, effort `max`, depth zero, with explicit exclusive
paths, skill references and an evidence contract. Their final runtime state is
`completed`; neither has an unfinished task.

| Leaf | Delivered scope | Coordinator disposition |
| --- | --- | --- |
| `/root/observatory_theme` | Observatory base template and four shared-theme/sync documents/assets, preserving legacy CSS bytes. | Integrated; decisive Observatory/report tests reproduced. Visual acceptance remains pending. |
| `/root/dashboard_components` | Ten chart/metric components, submission/room presentation, semantic CSS, shared table/palette and 15 accessibility tests. Also performed a bounded read-only review of the parent library work. | Integrated; full dashboard tests, types and production build reproduced. |

The library review identified five defects/limits. All received a disposition:

1. Incomplete receipts could show “Approved”: fixed by full C5 record checks and
   rejection tests.
2. Fixture-root fallback disagreed with C6: fixed to the personal-library default
   with explicit-root precedence tests.
3. Self-study showed a failing approval command: withheld, with a render test.
4. All read errors became 404: split into missing, unreadable and root-unavailable
   errors, with filesystem and render tests.
5. An ancestor could change between checking and opening: added post-open inode
   and confinement checks, plus a deterministic directory-swap test. The trusted
   writer limitation is recorded in the dashboard README; no stronger isolation
   claim is made.

The coordinator sent this disposition to the completed review leaf. This records
application and verification, not a new independent acceptance of the amended
code. Caller integration/release authority remains unchanged.

## Screenshot blocker and exact next step

**PNG screenshots produced by V2: none.** No synthetic screenshot was substituted.
The locally installed browser is
`~/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell`.
An explicit Playwright launch failed with
`bootstrap_check_in ... Permission denied (1100)` and `SIGTRAP`. A separate local
Chrome headless probe exited 134. Starting Next on `127.0.0.1:3107` failed with
`listen EPERM`. These are sandbox/runtime barriers, not test passes. The optional
VS Code pane snapshot directory supplied by the caller was absent at the final
capture preflight.

The capture script is prepared and syntax-checked. In a caller environment that
can launch its local browser and bind loopback sockets, start the following two
read-only services in separate terminals from this repository root:

```sh
BUNDLES_ROOT="$PWD/fixtures" OBSERVATORY_BASE_URL=http://127.0.0.1:8124 \
  NEXT_TELEMETRY_DISABLED=1 pnpm --filter @studium/teacher-dashboard exec \
  next start --hostname 127.0.0.1 --port 3107
```

```sh
.venv/bin/python services/observatory/observatory_app.py \
  --course-root /Users/nothiasl/git/studium_dev/docs/superpowers/audits/assets/2026-09-10-mystra-reviewer/synthetic-courses \
  --eval-root eval/reports --validity-root eval/validity --port 8124
```

Then capture:

```sh
node docs/assets/screenshots/capture-web.mjs \
  --dashboard http://127.0.0.1:3107 --observatory http://127.0.0.1:8124 \
  --course review-demo
```

Expected outputs are `teacher-library-{light,dark}.png`,
`teacher-review-{light,dark}.png`, `observatory-mystra-{light,dark}.png`
(1440 × 1000), and `teacher-library-mobile.png` (390 × 1000). If the supplied pane
directory exists, up to two actual HTML snapshots are rendered as well.
The script prohibits external browser requests, checks HTTP/browser errors and
horizontal overflow, enforces PNG size ≤300,000 bytes, and writes actual sizes,
dimensions and descriptions to `capture-manifest.json` only after capture.
It does not install anything. Inspect the resulting light/dark/mobile images,
keyboard focus, print layout and high-contrast behavior before accepting the
visual requirement.

## Changed files and pending dependencies

[`v2-files.json`](v2-files.json) lists every implementation/capture file, byte size
and SHA-256 at handoff. The additional evidence files are this document,
`v2-files.json`, `v2-capture-status.json`, and `v2-result.json`.
The local dirty checkout is the handoff target; hashes, not the moving branch
name, identify the delivered scope.

- **V1 → V2:** canonical tokens and identity artifacts were available and used;
  the V1 browser-validation limitation remains unclaimed.
- **V2 → documentation screenshots:** capture execution/inspection is pending;
  the caller has a runnable packet, not screenshots or visual acceptance.
- **W4 pane → optional screenshot:** snapshot input was absent; skipped, not
  accepted by elapsed time.
- **Portable theme migration:** a versioned renderer change outside V2 ownership
  is required before archived and new portable reports can use the new palette
  while preserving exact legacy verification.

No live channel to the external Claude caller was available inside this native
team. These artifacts and the required result JSON are the delivery; no external
receipt or approval is invented.
