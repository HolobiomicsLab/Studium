English · [Français](literature-and-evidence.fr.md)

# Literature and evidence

You can ground a lesson in papers and keep, for every claim a student meets, the passage it rests on.
Perspicacité finds and captures the passages; Studium checks that each quote matches them exactly
and carries their provenance into the review. During a lesson, the student's assistant can then
explore with real tools (web pages, domain skills, code) while Studium keeps the pedagogical thread,
and a portable receipt keeps the evidence of what was done.

| You want to | Use |
|---|---|
| Capture passages from papers | Perspicacité, then `experience_packet.py prepare --passages` |
| Capture one local document | `experience_packet.py passages` |
| Let an assistant build a visual for the current scene | `get_operator_context` |
| Keep the evidence of an exploration | `experience_exploration.py prepare`, `seal`, `verify` |

## Capture passages with Perspicacité

Perspicacité is a literature-search MCP server: connect it to your assistant, ask for the passages
that answer your question, and keep the real JSON envelope it returns. The envelope lists
`passages` with their `text`, `source_doi` or `source_url`, `license_id` and `title`, and an
`origin` saying how they were obtained. `examples/literature-experience/passages.json` is a real one.

```bash
.venv/bin/python tools/experience_packet.py prepare \
  --passages work/passages.json --title "What does spectral similarity show?" \
  --target "Master / PhD" --out work/packet
```

For one local document, `passages` writes an envelope of the same shape from a URL, a saved HTML
page, a PDF with a text layer or a text file. Pass `--license` when you know it; without it, `check`
reports the licence as a warning. Its passages carry the self-study author brief.

```bash
.venv/bin/python tools/experience_packet.py passages \
  --pdf paper.pdf --title "Paper title" --license CC-BY-4.0 --out work/passages.json
```

The rest of the chain (draft, `check`, MySTRA, lesson file) is in
[author a lesson](author-a-lesson.md#route-b-the-evidence-packet). Treat a search result as a lead:
record the page actually read, its version or date, and why you chose it. If a source is not
accessible, record the gap instead of filling it.

## Add an executable capsule

For an [ASB](../concepts/glossary.md) capsule, add `--capsule path/to/capsule --task-id TASK_ID` to
`prepare`. The capsule card keeps its scientific description, limits, reproducibility status and
command as data. Values in `executable.env` are removed; only variable names remain. Neither
`prepare` nor `check` runs a capsule command, and no ASB tier counts as proof of execution: a
`type-checked` tier is not a successful run.

## Let the assistant build a viewer during a lesson

The MCP tool `get_operator_context {session_id}` gives the student's assistant the public scene,
its resolved assets, the run manifest if any, and a response example checked against the canonical
schema. The file channel carries the same JSON in `task.md`, under
`<!-- studium-operator-context -->`. Answer keys, anticipated feedback and the author's result of a
run scene are left out.

The assistant chooses the representation from the teaching question: table, plot, equation, graph,
code or a dedicated page. Prefer existing asset kinds when they suffice; for filtering or varying a
parameter, a declarative chart specification is often enough. An exploratory control may recompute a
display; it is not a new attested run. Keep sources, units, transformations and the synthetic nature
of data visible, and test values and the effect of each control before trusting the picture.

In teaching mode the assistant asks for the student's own reasoning and confidence and never
answers for them; payload examples are templates, never answers to submit.

## The student's exploration loop

1. **Predict.** Link a question to the current concept; collect the student's prediction first.
2. **Establish the baseline.** Run the planned task on the identified inputs; keep command,
   environment, outputs and the checks actually done.
3. **Vary.** The student chooses one factor to change; show baseline and variation side by side.
4. **Compare.** Look at the effect, a limit case and a counter-example; keep failures and nulls.
5. **Judge.** What do the results support, what do they not show, what evidence is missing?
6. **Transfer.** Try the explanation on a new case, then return to the Studium scene for the
   personal answer.

Install dependencies inside the experiment's own folder and keep the resolved versions and lock
files. A virtual environment isolates dependencies; it does not protect the machine from unknown
code, so execution stays under the assistant's own permissions. Define the exploratory scope before
the pilot: a new explanation or exercise beyond it is a draft for you to review.

## Keep the evidence in a portable receipt

Save the JSON from `get_operator_context` (or from `task.md`), then:

```bash
.venv/bin/python tools/experience_exploration.py prepare --context current-context.json --out work/experiment
.venv/bin/python tools/experience_exploration.py seal --workspace work/experiment --out work/receipt
.venv/bin/python tools/experience_exploration.py verify work/receipt --context fresh-context.json
```

`prepare` writes `context.json`, `task.md`, `experiment.json` and its schema. Fill in the question,
hypothesis, sources (role, identifier, address, date consulted, why it fits, captured file) and
actions. Files are relative to the folder and carry a role: `source`, `skill`, `input`, `code`,
`output`, `environment` or `log`. An action marked `completed` needs a captured environment, an
output or log, and passing checks; `failed` and `not_run` record the other cases honestly.

`seal` stores the context, the experiment and only the named files, by SHA-256. The receipt verifies
after being moved, without the original files. Paths leaving the folder, symlinks and usual secret
locations are refused; each file is limited to 20 MiB, the whole to 100 MiB. It is not a general
secret detector: prepare suitable excerpts and logs first.

`learner_observation` is empty by default; fill it only at the student's request, with their own
words. The receipt stays local and outside Studium telemetry; erasing a session does not delete it.
To attach a summary of it to a reviewed plan, see
[review and approve](review-and-approve.md#optional-approve-a-plan-before-synthesis).

## Replay the shipped demonstrations

With a built checkout and Chrome available:

```bash
.venv/bin/python tools/demo-literature-experience.py reports/paper-demo
.venv/bin/python tools/demo-grounded-exploration.py reports/grounded-exploration
```

The first replays an exact excerpt of the SimMS paper captured through Perspicacité, checks a
prepared draft, renders MySTRA, runs a small local computation on illustrative spectra and tests the
external viewer against the Python score. The second extends it into a sealed exploration receipt.
No search or model call happens during the replay. The spectra are synthetic: this is neither a
reproduction of the paper's results nor a chemical identification. To adapt the viewer, start from
`examples/literature-experience/`.

## Limits

- A successful `verify` means the snapshot is intact. It proves neither that the sources are true,
  nor that the science is right, nor that the commands ran, nor who wrote a text.
- An exact quote proves a textual link, not a correct interpretation.
- The receipt is never submitted as a response or a run result; the run protocol stays separate.

Code: [`tools/experience_packet.py`](../../tools/experience_packet.py),
[`tools/experience_exploration.py`](../../tools/experience_exploration.py).
