English · [Français](TESTING.fr.md)

# Testing Studium

This page is for a colleague who tries Studium without the authors present. In about 20 minutes you play an adaptive first-year chemistry lesson (atomistique) in VS Code, then tell us what is right, wrong or missing. No API key is needed, and no network access once setup is done: the rendering libraries are copied locally.

The demo lesson and its detailed walkthrough are in French. Developers looking for the test suites should read [Testing (develop)](docs/develop/testing.md) instead.

## What you are testing

You move concept by concept and unlock the next one by showing that you master the current one. Along the way you manipulate generated scientific objects (3D atomic orbitals, the hydrogen emission spectrum, periodic trends, 3D molecules) while a graph of the lesson updates as you progress. After an answer, the feedback appears as its own step; at the end, a completion screen offers the reviews to come.

## Prerequisites

| You need | Why | How |
|---|---|---|
| macOS or Linux, with VS Code | The lesson runs in a VS Code pane; `setup.sh` is a bash script | [code.visualstudio.com](https://code.visualstudio.com) |
| Node 22 (Node 20 or newer works) | Builds and runs the extension | [nodejs.org](https://nodejs.org) |
| pnpm 9 | Installs the workspace | `corepack enable` (ships with Node) |
| Access to the repository | The clone must succeed | `gh auth login` if the clone says `Repository not found` |

Python is not needed for the lesson. It is used only by the optional evaluation harness and the teacher's class report, and needs Python 3.12 or newer (a stock macOS `python3` is too old).

## Set up

```bash
git clone https://github.com/HolobiomicsLab/studium.git
cd studium
corepack enable
./setup.sh
```

`setup.sh` checks your toolchain, installs the workspace, builds the libraries the lesson server needs, copies the rendering libraries for offline use, builds the extension, and verifies the result. Its last line tells you the next step. It is safe to run again.

## Run the lesson

1. In VS Code, choose **File > Open Folder…** and open `apps/studium-vscode`.
2. Press **F5** (on a Mac, **fn+F5** if F5 is a media key). A second window opens, titled `[Extension Development Host]`: test in that window.
3. Open the Command Palette (`Cmd+Shift+P` on a Mac, `Ctrl+Shift+P` elsewhere) and run **Studium: Open lesson**.

The extension opens `fixtures/atomistique-l1` with no setting to change. Your progress is kept between sessions; run **Studium: Forget my data** to start again from scratch.

## Follow the walkthrough

- [`fixtures/atomistique-l1/GUIDE-TEST-ELISE.md`](fixtures/atomistique-l1/GUIDE-TEST-ELISE.md), in French: Part 2 is the student tour, scene by scene; Part 3 is the teacher side; Part 4 lists the questions below.
- [`apps/studium-vscode/README.md`](apps/studium-vscode/README.md): the extension's commands, settings and scene types.

For the teacher side, Part 3 of the guide uses `tools/class_report.py` to produce an aggregated, anonymous class report offline; no web application is needed.

Want to try learning with your own AI assistant instead? The [quickstart](README.md#quickstart-5-minutes) registers the same server in Claude Code or Codex.

## The feedback we want

- **Scientific accuracy.** Are the statements, correct answers, feedback and numerical values right?
- **Teaching.** Are the order of concepts, the prerequisites and the questions relevant for first-year students?
- **Scientific objects.** Are the orbitals, the Balmer spectrum, the periodic trends and the 3D molecules accurate and useful? What is missing for your students?
- **Feedback and honesty.** Is it clear who wrote the answer key, and what was or was not assessed?
- **Teacher graph.** Does the `teacher` view of the graph reflect your logic of prerequisites?
- **Class report.** Does it point to the right concepts to rework? Would the hint and calibration signals help you?
- **Scene types.** Is a kind of activity missing for what you want your students to do?
- **Accessibility.** Can you complete the lesson with the keyboard alone, in light and dark themes?

Send your feedback through the **Tester feedback** issue form on GitHub (French or English), or by email to Louis-Félix Nothias, `louisfelix.nothias@gmail.com`. Please do not include personal data about students.

## Troubleshooting

| Symptom | Fix |
|---|---|
| The clone fails with `Repository not found` | Run `gh auth login`, then clone again: this is an access problem, not a missing repository |
| `setup.sh` reports a Node or pnpm version that is too old | Install Node 22, run `corepack enable`, then `./setup.sh` again |
| An orbital or an equation appears as plain text | Copy the rendering libraries again: `pnpm --filter studium-vscode vendor` |
| Nothing happens on F5 | Check that the open folder is `apps/studium-vscode`, not the repository root |
| You want to start the lesson over | Run **Studium: Forget my data** |

More cases are covered in [Troubleshooting](docs/start/troubleshooting.md).

## Out of scope for this test

VS Code is the surface under test. You do not need to build the other applications: the Tauri student app (`apps/student-runtime`, frozen, needs Rust), `author-web` (legacy) and the teacher dashboard. You do not need `pnpm -r build` either: `setup.sh` builds only what the lesson uses.
