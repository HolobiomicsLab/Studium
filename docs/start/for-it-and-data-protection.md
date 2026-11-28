English · [Français](for-it-and-data-protection.fr.md)

# Studium for IT and data protection

This page is for the IT department and the data-protection officer of a university who need to say what Studium asks of their information system, without knowing Studium. It describes the software; it is not a compliance statement (see [Limits](#limits)).

## What Studium is

Studium turns sources a teacher trusts into lessons that students play. Each answer says who wrote the key and whether anything assessed it. A teacher approves a lesson before students use it, and the lesson plays on the student's own computer, in a pane of VS Code.

## What is installed, and from where

| What | Where it comes from | Needed |
|---|---|---|
| The VS Code extension `holobiomicslab.studium-vscode` | the Visual Studio Marketplace, Open VSX (VSCodium, Cursor, Gitpod), or a `studium-vX.Y.Z.vsix` file of a [GitHub release](https://github.com/HolobiomicsLab/studium/releases), to be checked against the release's `SHA256SUMS.txt` | yes, with VS Code 1.95 or later |
| Node.js 20 or later and the `studium-mcp` package (npm) | npm, or the `lesson-mcp.cjs` file of a release | only for the [browser player](browser.md) or to connect an AI assistant |

The extension carries its lesson server and its viewers and runs them with VS Code's own runtime: students need no Node, no terminal, no Git, no Python and no AI account to play a lesson. Where to install it and which settings to write for a teaching room: [Classroom workstations](classroom-workstations.md). Where a lesson comes from on a student's own computer: [Share a lesson through your course platform](../teach/share-through-your-course-platform.md).

## What is installed on the institution's servers

Nothing. Studium has no server of its own to host, no plugin for the course platform, no LTI tool, no single sign-on and no link to a gradebook. The course platform only carries a file and a text.

## What goes over the network by default

Nothing from Studium. The extension calls no model, class telemetry is off (`studium.telemetryConsent` is `false`; when on, events are written in a local folder and nothing is sent), and the viewer libraries (equations, plots, 3D) are loaded from the extension itself. The lesson server and the browser player listen on 127.0.0.1 only. VS Code's own traffic (updates, Marketplace, its telemetry) is set by the institution's VS Code configuration, outside Studium.

Three choices change this:

| Choice | Effect |
|---|---|
| An AI assistant with a remote model, chosen by the user | the assistant's provider receives what the assistant reads; Studium does not control it |
| `studium.assets` set to `cdn` | the viewer libraries load from jsdelivr instead of locally |
| A judge model endpoint (`LITELLM_BASE_URL`, empty by default) | written answers go to that endpoint to be assessed |

See [Privacy and limits](../concepts/privacy-and-limits.md) and the [configuration reference](../reference/configuration.md).

## Where learner data lives

On the student's computer, never in the lessons folder. With VS Code, progress and review dates are in the extension's storage for that user account (`globalStorage/holobiomicslab.studium-vscode` under the VS Code user folder). Each learner has a folder named by a pseudonym, never by their id: an HMAC of the learner id, with a secret kept in a file of the data folder (`.studium-secret`, permissions 0600). An imported lesson is copied into the personal library, `~/.studium/library` (or `<STUDIUM_HOME>/library`).

| To erase | Do |
|---|---|
| One lesson's state | **Forget me** in the pane's menu |
| Everything the extension keeps | **Studium: Forget my data**, after a confirmation |
| The same, by an administrator | delete the `globalStorage/holobiomicslab.studium-vscode` folder |

Students who share one account share one record. Erasing does not reach the lessons in the library, the data an assistant's server keeps in `~/.studium/data`, the assistant's history or copies made elsewhere.

## What the course platform records

That is the platform's own business. On the disposable Moodle 5.3.1 used for a check, Moodle logged one view event per visit to the file resource (user, course, date, IP address) and no event for the download itself; Studium sends the platform nothing. What your platform records depends on its configuration.

## What a teacher sees of a class

Nothing by default. A class report needs consented telemetry folders gathered in one place by the teacher or the pilot lead; no supported surface sends them over the network. Each class figure is computed over at least five learners, and a figure below that floor is withheld. See [Follow a class](../teach/follow-a-class.md).

## What Studium does not do today

- It is not a hosted service: there is no account to create and no institutional instance.
- It sends no grade back to the course platform.
- It imports no roster of students.

## What would need a formal assessment

A hosted, multi-user service. The design record of the browser player lists it under « Not covered »: sign-in, one identity per learner, isolation between learners, TLS, data protection (legal basis, record of processing, retention, erasure for each learner, an impact assessment for learning analytics) and an institutional hosting decision. See [that list](../design-records/specs/2026-11-25-browser-player.md#not-covered).

## Limits

- No teaching room has been prepared with these steps.
- This page describes the software. It is not a compliance statement: passing tests does not make a deployment compliant with a regulation, so run a pilot with the people responsible for it ([Privacy and limits](../concepts/privacy-and-limits.md#publishing)).
