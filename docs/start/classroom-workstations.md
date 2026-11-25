English · [Français](classroom-workstations.fr.md)

# Classroom workstations

This page is for an IT team that prepares the computers of a teaching room, so that students open a Studium
lesson in VS Code with no terminal, no Node and no AI account. It covers what to install, where to put the
lessons, which settings to write, where each student's progress is kept and what leaves the machine. No room
has been prepared with these steps yet: see [Limits](#limits).

## Before you start

| On each workstation | Needed | Why |
|---|---|---|
| VS Code 1.95 or later | yes | it hosts the lesson pane |
| The Studium extension | yes | it carries the lesson server and the viewers, and runs them with VS Code's own runtime |
| A folder of lessons | yes | the extension holds no lesson |
| Node, a terminal, Git, Python | no | only to build lessons with an assistant, to prepare courses, or to contribute |
| An AI account or a model API key | no | the pane plays a lesson without any model |

Ask the teacher for the course folders, each with its `lesson.json`, its assets and, once the teacher has
approved it, its `approval.json` (see [Review and approve](../teach/review-and-approve.md)). The course list
in VS Code says whether a teacher approved each lesson, and flags a lesson changed since its approval.

## 1. Install the extension

VS Code installs extensions for each user account. Run this once for every account students use, for
example from the provisioning of the machine image or a login script:

```bash
code --install-extension holobiomicslab.studium-vscode
```

Without access to the Marketplace, download `studium-vX.Y.Z.vsix` from a
[GitHub release](https://github.com/HolobiomicsLab/studium/releases), check it against the release's
`SHA256SUMS.txt`, and install it with `code --install-extension studium-vX.Y.Z.vsix`. Open VSX carries
the same extension for VSCodium.

## 2. Put the lessons in a shared folder

Copy the course folders into one folder that every student account can read, on the local disk or on a
network share, one subfolder per course, at most two levels below that folder. Students only read it: the
lesson server writes nothing in the lessons folder, and progress goes to each account's own storage (see
[Where progress is kept](#where-progress-is-kept)). The folder can therefore be read-only.

## 3. Point the extension at the folder

Write these settings in the VS Code user settings of each student account (`settings.json`):

```json
{
  "studium.bundlesRoot": "/path/to/shared/lessons",
  "studium.bundleRef": "course-folder/lesson.json"
}
```

| Setting | Effect |
|---|---|
| `studium.bundlesRoot` | the folder the **Lessons** view lists and the lessons are read from |
| `studium.bundleRef` | the lesson **Studium: Open lesson** opens, relative to that folder |

The user settings file is `~/Library/Application Support/Code/User/settings.json` on macOS,
`~/.config/Code/User/settings.json` on Linux and `%APPDATA%\Code\User\settings.json` on Windows. A
folder students open with **File, Open Folder** can carry the same lines in its `.vscode/settings.json`,
which take precedence. The extension declares no setting that VS Code's enterprise policies can set: use the
settings files. Keep `studium.assets` on `vendor`, `studium.telemetryConsent` off and
`studium.showMastery` off, which are the defaults.

## 4. What a student does

1. Open VS Code.
2. Select the **Studium** icon in the activity bar.
3. Select a course in the **Lessons** view. It opens in a pane, at its first step.

A student who picks another folder with **Studium: Pick a course** changes only their own user settings,
or the settings of the folder they opened.

## Where progress is kept

The extension starts its own lesson server and gives it, as data folder, the storage VS Code keeps for the
extension in that user account (`globalStorage/holobiomicslab.studium-vscode` under the VS Code user
folder). Progress and review dates are kept there, never in the lessons folder; learner folders inside it are
named by a pseudonym. The courses a student chose to trust and the last lesson open are kept in VS Code's own
state for the extension, in the same user account.

- Each user account has its own progress. Students who share one account share one record: give each
  student an account, or erase the record between sessions.
- **Studium: Forget my data** erases all of it for that account, after a confirmation. Deleting the
  `globalStorage/holobiomicslab.studium-vscode` folder when the session closes erases progress and review
  dates.
- With roaming profiles, the folder follows the profile like any VS Code user data; this has not been tried.

## What leaves the machine

| What | Default | Note |
|---|---|---|
| Calls to a model | none | the extension calls no model; a judge model is used only when `LITELLM_BASE_URL` is set in the environment VS Code starts from, so leave it unset |
| Class telemetry | off | `studium.telemetryConsent`; when on, pseudonymised events are written in the local data folder, nothing is sent |
| Viewer libraries (equations, plots, 3D) | local | `studium.assets` = `vendor`; `cdn` would load them from jsdelivr |
| VS Code's own traffic (updates, Marketplace, telemetry) | as configured | set by the institution's VS Code configuration, outside Studium |

A reproduction step runs a command on the workstation, only after the student confirms the exact command.
Such a step needs the software its capsule declares, Python for example; for a room without it, choose
courses without reproduction steps.

## With an assistant

Building new lessons in the room, with Copilot in VS Code or another assistant, adds what this page avoids:
Node on the workstation, one command per account (see
[Add the server to your assistant](installation.md#add-the-server-to-your-assistant)) and an account with
the assistant's provider for each student. The pane and an assistant keep separate progress. This has not
been tried in a room.

## Limits

- No teaching room has been prepared with these steps. What they rely on is in the code and its automated
  tests; the server was also checked alone, outside VS Code, playing a course from a read-only folder.
- Windows has not been tried end to end.
- The pane gives no class view. A class report needs consented telemetry gathered in one data folder: see
  [Follow a class](../teach/follow-a-class.md).
- Report what you meet, with the version and the steps you followed:
  [Report a problem or contribute](report-and-contribute.md).
