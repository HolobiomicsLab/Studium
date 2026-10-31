English · [Français](experiment-journal.fr.md)

# Experiment journal

Before you run an experiment, write down what you expect and why. Afterwards, write what you saw and what you
conclude. Studium keeps these four entries in a private journal next to the lesson, in your own words, so you
can compare your first reasoning with what happened.

The journal is **not graded**, does not move the lesson forward and never enters teacher analytics. The
assistant asks for your words and your permission to save them; it must not fill them in for you.

## The four steps

| Step | You record | Rule |
|---|---|---|
| `predict` | Your prediction, your reason and your confidence (0 = not confident, 4 = very confident) | Comes first |
| `begin` | Nothing: it marks the moment before any code runs or any result is shown | Only after a prediction |
| `observe` | What you observed, optionally which results you looked at (`evidence_refs`) | After `begin` |
| `conclude` | What the observations do and do not establish, whether they changed your reasoning, and your confidence | Last |

Each entry is final once saved; sending the same entry again changes nothing. For a new attempt, use a new
experiment id rather than rewriting your first prediction. An observation or conclusion can come in a later
scene of the same lesson, with the same experiment id; the scene where you predicted stays attached.

## With an assistant (MCP)

The assistant calls `record_experiment` with the session id, the current scene id and one entry, and
`get_experiment_journal` to read your entries back. A prediction looks like this; the placeholders are for
your words, never for an example answer:

```json
{
  "kind": "predict",
  "experiment_id": "network-threshold-1",
  "prediction": "<my prediction>",
  "justification": "<my reason>",
  "confidence": 2,
  "authorship": "learner",
  "consent": true
}
```

`begin` needs only `kind` and `experiment_id`. `observe` takes `text` and optional `evidence_refs` (strings
naming the results consulted); `conclude` takes `text` and `confidence`. Both repeat `authorship: "learner"`
and `consent: true`. Evidence references are links you supply: Studium does not check them.

## With the file channel

When a lesson runs through the file channel (the session runner in watch mode, see the
[agentic session protocol](../reference/agentic-session-protocol.md)), write a complete
`experiment-action.json` into its `.studium-session` folder, atomically:

```json
{
  "session_id": "<current session id from task.md>",
  "scene_id": "<current scene id from task.md>",
  "input": { "kind": "begin", "experiment_id": "network-threshold-1" }
}
```

Replace `input` with each entry in turn, starting with `predict`. The runner consumes the file, writes
`experiment.json` (schema `studium/experiment-journal/v1`) and a short `feedback.md`, and keeps waiting: a
journal entry never submits a lesson answer. Use `response.json` or `run_result.json` for that. An envelope
with an old session or scene id is refused. Each entry counts as one step of the runner's step budget, so
allow four extra steps per experiment.

This journal is distinct from the scientific provenance record of `tools/experience_exploration.py`; keep that
tool's workspace in a separate folder.

## Resume, storage and privacy

The journal is saved on disk, in your private data folder, per learner and per lesson revision, when two
conditions hold: progress is durable (the default; see [review over time](review-over-time.md#where-your-data-lives))
and the assistant passes an explicit learner id. With the shared default ids `anonymous` or `agent-operator`,
a blank id, or `STUDIUM_EPHEMERAL=1`, it stays in memory only, and its `storage` field says `ephemeral`.
A review session's journal is never saved to disk.

To resume, start the same lesson with the same learner id and data folder, through MCP or files; the new
session has a new session id. A changed lesson opens a new journal: earlier entries are not relabelled.

- Forgetting your data for a lesson (`forget_session`) erases its journals for every revision. Copies already
  exported to a harness folder or a conversation must be removed there.
- Do not commit or share `experiment.json`; keep the session folder private.
- These local tools add no hosted authentication: a shared deployment must protect session ids and storage.
- A lock file refuses two writers at once. After a crash, check that nothing is writing before removing a
  stale `experiments/.lock`.

The journal records the order of entries and the authorship you declare. It cannot prove that nobody helped,
who typed the text, or that you learned something. Its purpose is to make your reasoning visible to you.

## Practise in the linked spectrum viewer

A local example connects a synthetic molecular network, a mirror-spectrum pair and a candidate table through
shared node ids. It teaches the difference between changing an edge threshold and changing the evidence.
Candidate similarity is not compound identification.

1. Write a prediction: does lowering the threshold change nodes, edges, both or neither? Calculations stay
   hidden until your prediction has text.
2. Reveal the network and compare the recorded baseline (0.65) with the "new edges" (0.64) and "no edge
   change" (0.70) presets. The baseline edges stay visible as a dashed reference; a threshold filters edges
   (`score >= threshold`) and never removes nodes.
3. Select a node with the pointer, or Tab to it and press Enter or Space: the same id is selected in the
   network, the mirror title and the candidate row.
4. Write an observation and a conclusion. Nothing is graded, saved or submitted.
5. Press **Export my notes** only if you want a local JSON copy.

The viewer's notes are separate from the journal. If you use both, record your prediction in the journal
before revealing the calculations, and never backfill an exported note as if it had been recorded first.
The scores illustrate a calculation (greedy, one-to-one, precursor-aware modified cosine on L2-normalised
intensities); they do not establish identity or novelty, and moving the threshold is not a new run.

### Build the viewer (teachers)

Produce the spectra, run result, public operator context and checked review folder with the
[literature-and-evidence workflow](../teach/literature-and-evidence.md), then:

```bash
node examples/literature-experience/build-viewer.mjs \
  SPECTRA_JSON RESULT_JSON OPERATOR_CONTEXT_JSON CHECKED_REVIEW_DIR NEW_OUTPUT_DIR [NETWORK_JSON]
python3 -m http.server 8118 --bind 127.0.0.1 --directory NEW_OUTPUT_DIR
```

The network defaults to `examples/literature-experience/linked-network.json`. Another teacher-reviewed
synthetic network must carry a `generation_brief` (`learning_goal`, `inputs`, `reference_calculation`,
`allowed_parameters`, `hidden_information`, `cross_view_questions`, `learner_sequence`, `export_policy`),
and unique node ids shared by `nodes` and `candidates`; keep at least one parameter change that alters edges
and one that does not. The builder refuses malformed or non-synthetic data and records the network hash in
`viewer-provenance.json`. Checks:

```bash
.venv/bin/python -m pytest -q tools/test_linked_viewer_numeric.py tools/test_linked_viewer_build.py tools/test_experience_viewer_inputs.py
```
