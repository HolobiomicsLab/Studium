English · [Français](share-through-your-course-platform.fr.md)

# Share a lesson through your course platform

You can give students an approved lesson from your course page, in Moodle or in any platform that carries a file and a text. The platform holds one file and the instruction; the lesson plays on the student's own computer, and nothing is installed in the platform.

## Before you start

- A lesson you have approved, with `approval.json` next to `lesson.json`: see [Review and approve](review-and-approve.md#approve-the-exact-file).
- The Python environment of the repository, where `tools/experience_packet.py` runs (see [Installation](../start/installation.md)).
- What each student needs: VS Code and the Studium extension. No AI account and no terminal: the pane plays the lesson without a model ([VS Code](../start/vscode.md)).

## 1. Pack the lesson

```bash
.venv/bin/python tools/experience_packet.py pack --bundle work/library/my-course/lesson.json --out .
```

`pack` writes `<bundle_id>.studium.zip`: `lesson.json`, `approval.json`, then the files under `assets/`, and nothing else (not `reviews/`, not `community/`, no hidden file such as `.DS_Store`). It refuses a lesson whose `approval.json` is missing, incomplete or does not match the exact `lesson.json`: approve again after any edit. It also refuses a file under `assets/` that a student's computer could not store (a name with `: * ? " < > |`, a Windows device name such as `NUL`, two names that differ only by case or accents), a symbolic link, more than 2000 files, a file over 50 MiB or more than 200 MiB in all; each refusal names the file. System files such as `Thumbs.db` are left out like hidden files. It refuses an existing output file unless you add `--force`. `--language en|fr` sets the language of the instruction, which defaults to the lesson's; `--json` prints the report as JSON.

It prints the file, the title, who approved and when, the first 12 characters of the lesson fingerprint, then the text to paste:

```text
Lesson: Capsule-grounded judgment (decay fit)
Validated by Your Name on 2026-11-27. Lesson fingerprint: 4cc0d00ed822.

1. Install VS Code, then the Studium extension (https://marketplace.visualstudio.com/items?itemName=holobiomicslab.studium-vscode).
2. Download capsule-judgment-demo.studium.zip from this course page.
3. In VS Code, open the Studium view, choose "Import a lesson file" and select the downloaded file.

In the Studium pane the lesson plays on your computer and your answers stay there. If you use an AI assistant with it, that assistant's provider receives what the assistant reads.
```

## 2. Put the file and the instruction in the course

1. Add the `.studium.zip` file to the course page. In Moodle, add a **File** resource; any platform that carries a file works. Keep the file name.
2. Paste the instruction, as printed, next to it.

Optionally, add a link that opens VS Code on the import dialog, as an HTML link in a Label or a Page:

```html
<a href="vscode://holobiomicslab.studium-vscode/import">Import the lesson in VS Code</a>
```

The link opens the dialog of the **Studium: Import a lesson…** command. It can never name or fetch a file: the student still downloads the file from the course page and selects it.

## 3. What the student does and sees

The student downloads the file, then runs **Studium: Import a lesson…** (also offered in the empty **Lessons** view, in the course picker, and on a right-click on a `.studium.zip` file). Studium checks the file, then asks for a confirmation that shows:

- the lesson's title and its number of steps;
- the approval the file records, with the reminder that it is a record, not a signature;
- the first 12 characters of the lesson fingerprint.

On confirmation the lesson is copied into the student's library and opens. The file is read on the computer; Studium makes no network call for it.

## Update a lesson

Approve again, pack again, and replace the file in the course. When a student imports the new file:

- the same lesson already in the library is opened; when the file carries an approval that matches the lesson, its approval record and figures are updated if they differ, and otherwise nothing is written;
- a different lesson under the same identifier (`bundle_id`) is replaced only after a second confirmation. Progress is kept, because it is saved under the lesson's identifier, and so are the class contributions in the lesson's `community/` folder.

## In a classroom

Where the computers are prepared by an IT team, put the lessons in a shared folder and skip the import: see [Classroom workstations](../start/classroom-workstations.md). For what the institution is asked to provide, see [Studium for IT and data protection](../start/for-it-and-data-protection.md).

## What you will not see

No class view comes back by this route. A class report needs consented telemetry gathered in one place: see [Follow a class](follow-a-class.md).

## What the file contains

The whole `lesson.json`, answer keys included. Any student can open the file and read them, so this route is not for a graded test.

## What `approval.json` is and is not

It is a record of your approval, bound to the exact bytes of `lesson.json`. It is not a signature: anyone can write a file that claims an approval. What tells students where the file comes from is your course page. It covers `lesson.json` only: the figures under `assets/` are not part of the fingerprint.

## What the platform records

Moodle logs that a student viewed the resource. Studium sends it nothing.

## Limits

- Tried: automated tests of the packer and the importer; a scripted round trip from pack to install with identical fingerprint; on a disposable local Moodle 5.3.1 with default settings and a hand-made zip (not one made by `pack`): upload as a File resource by an editing teacher, download by a student with identical bytes, refusal without a session, a `vscode://` link kept in a Label and a Page.
- Not tried: a real VS Code window (the command was exercised by drivers with a fake VS Code), a click on a `vscode://` link in a real browser, a university's Moodle or another Moodle version or a site that restricts file types, an ENT or Teams, Windows, a class.
