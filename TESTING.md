# Testing Studium — the atomistique lesson

This is the entry point for a colleague testing the prototype without the author
present. It is short and single-path. The demo course and its full walkthrough are
in **French**; this page gets you there and points at the French guide, which is the
richer document.

## 1. What you are testing

An adaptive L1 chemistry lesson (atomistique) that runs **inside VS Code**. You move
concept by concept, unlock the next one by demonstrating mastery, and manipulate
generated scientific objects (3D atomic orbitals, the hydrogen emission spectrum,
periodic trends, 3D molecules) while a workflow graph lights up in real time. About
**20 minutes**. **No API key** and **no internet** are needed after install — the
render libraries are vendored locally.

## 2. Prerequisites

- **macOS** and **VS Code**.
- **Node 20+** and **pnpm 9+**. The reliable way to get a matching pnpm is
  `corepack enable` (ships with Node).
- **`gh auth login` before you clone.** The repo is private, so an unauthenticated
  clone fails.

Python is **not** needed for the lesson. It is needed only for the optional eval
harness and the teacher class report — and note that a stock macOS `python3` is 3.9,
which is too old; those tools want a real 3.12+ (`brew install python@3.12`).

> Troubleshooting the clone: an unauthenticated clone of a private repo fails with
> `Repository not found`. That means authentication, not a missing repo — run
> `gh auth login` and clone again.

## 3. Setup

Clone, then run the one setup command:

```bash
git clone https://github.com/HolobiomicsLab/studium.git
cd studium
./setup.sh
```

`setup.sh` checks your toolchain, installs the workspace, vendors the render
libraries offline, and builds the extension. When it finishes, its last line tells
you the next step: open `apps/studium-vscode` in VS Code and press F5.

## 4. Run the lesson

1. In VS Code, **File ▸ Open Folder…** and open `apps/studium-vscode`.
2. Press **F5** (on a Mac, **fn+F5** if F5 is a media key). A second window opens,
   titled `[Extension Development Host]` — that is where you test.
3. In that second window, open the Command Palette (`Cmd+Shift+P`) and run
   **Studium: Open Lesson**.

It runs zero-config against `fixtures/atomistique-l1`. No settings to change to start.

## 5. The detailed walkthrough

- **[`fixtures/atomistique-l1/GUIDE-TEST-ELISE.md`](fixtures/atomistique-l1/GUIDE-TEST-ELISE.md)**
  — the full student and teacher walkthrough, in French. This is the richer document;
  read it for the scene-by-scene tour (Partie 2, student) and the teacher side
  (Partie 3).
- **[`apps/studium-vscode/README.md`](apps/studium-vscode/README.md)** — the
  extension's settings, commands, and scene types.

## 6. What feedback we want

These questions are the ones already written in Partie 4 of the French guide and in
[`docs/guides/learner-as-author-test-guide.md`](docs/guides/learner-as-author-test-guide.md):

- **Chemical accuracy** — are the statements, correct answers, feedback, and numeric
  values right?
- **Pedagogy** — is the order of concepts, the prerequisites, and the quiz relevance
  right for an L1 level?
- **Artifacts** — are the generated objects (orbitals, Balmer spectrum, periodic
  trends, 3D molecules) accurate and useful? What is missing for your students?
- **Teacher graph** — does the `teacher` graph view reflect your prerequisite logic?
- **Class report** — does it point at the right concepts to rework, and would the
  hint / calibration signals be useful to you?
- **Scene types** — is a scene type missing (beyond quiz) for what you want your
  students to do?

Send it by opening a GitHub issue (there is a **Tester feedback** issue form), or by email
to Louis-Félix Nothias — `louisfelix.nothias@gmail.com`.

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| Clone fails with `Repository not found` | `gh auth login`, then clone again — the repo is private |
| An orbital renders as plain text instead of 3D | re-run the vendor step: `pnpm --filter studium-vscode vendor` |
| Wrong Node or pnpm version | `corepack enable`, then re-run `./setup.sh` |
| Tempted to build every package | **Do not run `pnpm -r build`** — it is known-red at `teacher-dashboard` and is not needed; `setup.sh` builds only what the tester path uses |

## 8. Out of scope for testers

VS Code is *the* interactive surface. You do not need — and should not try to build —
the other apps:

- `student-runtime` (Tauri) — needs a Rust toolchain.
- `author-web` and `teacher-dashboard` — web apps not needed for this test.

For the teacher side, read **Partie 3** of the French guide: it uses the offline
`tools/class_report.py` to produce an aggregated, anonymous class report — no web app
required.
