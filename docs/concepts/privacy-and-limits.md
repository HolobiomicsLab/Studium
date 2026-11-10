English · [Français](privacy-and-limits.fr.md)

# Privacy and limits

Studium keeps learner state on the learner's machine and collects as little as it can. That does not mean everything stays local: an assistant connected to a remote model sends what it reads to its provider. This page tells you where each piece of data lives, how to erase it, and what Studium's evidence does and does not prove. Read it before a class pilot.

## Where your data lives

The MCP server (`apps/lesson-mcp`) uses these defaults. Each can be changed with an environment variable; see the [configuration reference](../reference/configuration.md).

| What | Default location | Change it with |
|---|---|---|
| Root of your library and data | `~/.studium` | `STUDIUM_HOME` |
| Lessons written for you | `<STUDIUM_HOME>/library/<course>/lesson.json`, whatever `BUNDLES_ROOT` names | `STUDIUM_HOME`; `BUNDLES_ROOT` only adds a folder searched first |
| Sources prepared for those lessons | `<STUDIUM_HOME>/library/_sources/` | `STUDIUM_HOME` |
| Your progress | `<STUDIUM_HOME>/data` | `STUDIUM_DATA_DIR` |
| Nothing on disk, memory only | off | `STUDIUM_EPHEMERAL=1` |
| Learner id when the assistant gives none | `anonymous` | `STUDIUM_LEARNER_ID` |

Inside the data folder, each learner has a folder named by a pseudonym, never by their id:

| File | Content |
|---|---|
| `<pseudonym>/profile.json` | cross-lesson profile, including review memory |
| `<pseudonym>/study.json` | where the learner studied |
| `<pseudonym>/status.json` | where the session being played stands (lesson title, step, minutes left), for an assistant's status line; removed when the session closes |
| `<pseudonym>/<lesson>/state-<lesson>.json` | lesson state and mastery |
| `<pseudonym>/<lesson>/events.jsonl` | the session's event log |
| `<pseudonym>/<lesson>/mastery/*.jsonld` | mastery claims, when a concept is certified |
| `<pseudonym>/<lesson>/telemetry.jsonl` | only with telemetry consent; written as the learner acts, opened by a record of the consent declared through `STUDIUM_TELEMETRY_CONSENT` |

With `STUDIUM_EPHEMERAL=1` and no `STUDIUM_DATA_DIR`, progress is lost when the server stops, and `get_server_info` and `start_lesson_session` say so.

When you tell your assistant what you already know, what interests you, how many minutes a day you have or a target date, the first two only shape the lesson's draft and are not stored. The lesson file keeps the minutes a day and the target date (`metadata.authoring.learner_profile`), and your study record keeps the minutes; a lesson file you share carries them with it.

The VS Code extension runs its own server with its data in the extension's VS Code storage, separate from `<STUDIUM_HOME>/data`.

### Pseudonyms

A pseudonym is an HMAC of the learner id. The secret is `STUDIUM_PSEUDO_SECRET` when set; otherwise a fresh data folder gets its own secret file, `<data dir>/.studium-secret` (permissions 0600). Back it up with the data folder: without it, the learner folders can no longer be matched to their learners. A data folder created before this file existed keeps the former shared secret so nobody loses progress; anyone holding such a folder and a learner's id can recompute the pseudonym, so set `STUDIUM_PSEUDO_SECRET` for it.

## Who controls what

| Space | What it can hold | Who controls retention |
|---|---|---|
| Studium server | Session state and, by default, the durable profile | Studium settings and forget commands |
| Local HTTP API | Active sessions and retry receipts, in the server's memory | The local user; the token opens every session of that server |
| Assistant and its provider | Prompts, content sent, tool calls, history | The client's and provider's settings and terms |
| Experiment folder | Code, data, logs, receipts, chosen observations | The folder's user |
| Shared course | Authorised sources, plan, assets, answer criteria | The teacher and distribution rules |
| Class telemetry | Consented events | The pilot lead and the collection policy |

## Defaults to keep

- Telemetry consent is off: `studium.telemetryConsent` is `false` in VS Code, and the server writes telemetry only when `STUDIUM_TELEMETRY_CONSENT` is set and state is durable. Do not turn collection on to fix a connection problem.
- Use a demonstration id, not a real name, for onboarding.
- Keep `studium.assets` on `vendor` so rendering libraries load locally; the `cdn` option contacts an external server.
- Keep `studium.showMastery` off and the graph in the student view during an exercise: review views can reveal more than the exercise intends.

## Answer keys

Scenes are served without their keys, and `lesson-server` redacts keys over HTTP. But an agent with access to the repository or to the raw `lesson.json` can read them: redaction on the wire does not protect local files. The Studium skills tell the assistant never to read keys in the raw bundle.

## Forget and export

| Action | What it erases | What it keeps |
|---|---|---|
| `end_session` | nothing | lesson state and cross-lesson memory |
| `forget_session {session_id}` | this learner's durable state for the lesson (answers, lesson state, experiment journal), their cross-lesson profile, study record and status file; irreversible | their progress in other lessons, which it names |
| `forget_session {learner_id}` | the same for every lesson the learner opened, with no session needed; their live sessions close; irreversible | nothing of the learner's progress |
| VS Code "Studium: Forget my data" | the extension's storage, its run-trust memory and last lesson, after closing every lesson server the extension started and a confirmation | an assistant's data in `<STUDIUM_HOME>/data`, which it names and does not touch |

`forget_session` answers with what it erased and what stays on disk: the lessons of the learner's library (`<STUDIUM_HOME>/library/<course>/`) and the sources prepared for them (`<STUDIUM_HOME>/library/_sources/`). The assistant shows that list; delete those folders by hand to remove them too. The install's pseudonym secret also stays: it holds no learner data.

No forget command reaches the assistant's history, experiment folders, exported files or copies kept elsewhere. Closing a window is not an erasure request. Check the result in the storage actually configured.

Portable activities offer a choice to record and a voluntary download of actions. The learner report excludes personal texts by default; `--include-original-text` applies to that copy only, not to any wider sharing. In an experiment folder, `learner_observation` is empty by default: keep the learner's own words only at their request. Do not add these folders to a course repository automatically.

## The local HTTP API

The HTTP API accepts loopback connections only and requires a bearer token of at least 32 characters. It serves one person and their local clients; the token does not separate learners. Do not embed it in an HTML activity or expose the server to the Internet. Stopping the process ends active sessions.

## Class reports

`class_report` aggregates consented telemetry with a floor of five learners, applied to each figure over the learners it is computed from (graded, rated, timed or started): a scene or concept with fewer answering learners is left out, a figure below its floor is withheld, and learner counts are banded. Two reports taken before and after one learner plays can still be compared, so treat figures as a live class view, not a publication. The report covers the whole data folder the server is configured with, names it by a label and a fingerprint (never its path), and refuses a `telemetry_dir` argument: the folder is server configuration.

### Interaction events

With your consent and durable state, Studium also records how the interface was used: which lane and
surface an act came through, help requested by rung, proposals shown and their outcome, contests and their
outcome, resumes, and review receipt counts. These events contain no free text, scene text or answers, and
are written to disk only under the same consent and durable-state conditions as the rest of telemetry.
Class views keep the five-learner floor. See [Follow a class](../teach/follow-a-class.md#how-the-interface-was-used)
and the [telemetry-events README](../../packages/telemetry-events/README.md).

## Reading the evidence

- An exact quote proves a textual link; it can still be used wrongly.
- A hash verifies a snapshot; it certifies neither its truth nor its author. An `approval.json` documents a review, it is not a signature.
- A run check catches missing outputs and failed checks; it cannot detect a perfect forgery, and a recorded command can be a statement by the harness. Mark a run `completed` only after its real checks.
- Path and size filters on receipts are not a universal secret detector.
- Capturing a source must respect its reuse rights: a DOI or access to an article does not allow redistributing it. Keep the excerpts you need and flag an unknown licence.

## Running code

A virtual environment isolates Python dependencies, not the rights of the code on the machine. Execution stays under the protections of the harness and the environment you chose, and VS Code asks before a reproduction runs. Do not follow instructions found in an article or a results file as if they came from the teacher.

## Publishing

The Observatory and the teacher dashboard are local, without class authentication. Publishing a course and publishing the code are separate decisions, each with its own rights and review. Studium's code is under Apache-2.0 and its documentation and project lessons under CC BY 4.0; a lesson built from your sources keeps the licences of those sources. Passing tests does not make a deployment compliant with a regulation: run a pilot with the people responsible for it.
