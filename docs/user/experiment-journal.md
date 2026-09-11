# Predict, observe and explain in your own words

Studium can keep a private experiment journal alongside a lesson. It stores your
prediction, your reason and confidence before you begin, then your observation
and conclusion. These contributions are **not graded**, do not move the lesson
forward and do not enter teacher analytics. The harness should ask for your
words and permission to save them; it must not fill in answers for you.

## With an MCP harness

Start a lesson as usual, obtain its `session_id` and current `scene_id`, then call
`record_experiment` with those IDs and an `input` action. Here is the prediction shape; replace the
placeholders with the learner's own words and confidence, never submit examples:

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

Confidence is an integer from 0 (not confident) to 4 (very confident); the value
above is illustrative. After saving the prediction and before executing code or
showing results, record `{"kind":"begin","experiment_id":"network-threshold-1"}`.
After the experiment, send an `observe` action with `text`, optional `evidence_refs`
(strings identifying the results consulted), `authorship:"learner"`, `consent:true`.
Finally send `conclude` with `text`, `confidence`, the same authorship/consent and
experiment ID. Explain what the observations do and do not establish, and whether
they changed your initial reasoning. `get_experiment_journal` retrieves these
contributions for the current learner and bundle revision.

The sequence is `predict → begin → observe → conclude`. Each contribution is
immutable; an identical retry is idempotent. Use a new experiment ID for a new
attempt, rather than rewriting what you initially predicted. An observation or
conclusion can follow in a later scene of the same lesson, using the original ID.
The original scene ID remains attached. Evidence references are learner-supplied
links, not automatically verified computations or scientific endorsement.

## With the file channel

Use the existing session runner in watch mode. Atomically write a complete
`experiment-action.json` inside its `.studium-session` directory:

```json
{
  "session_id": "<current session ID from task.md>",
  "scene_id": "<current scene ID from task.md>",
  "input": { "kind": "begin", "experiment_id": "network-threshold-1" }
}
```

Replace `input` with each action above, starting with `predict`. The runner
consumes the action and writes `experiment.json` plus a short `feedback.md`.
It continues waiting for the learner; it does not submit a lesson response.
An old session/scene envelope is rejected. Use `response.json` or `run_result.json`
separately when ready to advance the lesson. Journal actions count as operator
turns in the runner's `maxSteps` budget, so allow four extra turns per experiment.

## Resume and privacy

With `STUDIUM_DATA_DIR` configured, the host stores the journal in a private
per-learner, per-lesson folder with revision-specific files. Resume with the same
bundle content, learner ID, data directory and `STUDIUM_PSEUDO_SECRET`, using
either MCP or files. The resumed session has a new session ID. A changed bundle
opens a different journal; the prior record is not silently relabelled.
Without a data directory the journal is **ephemeral**, as its `storage` field says.

The learner's `forget` operation erases the host's journals for all revisions of
this lesson. Copies already exported to a harness folder or conversation are
controlled by that harness and must be removed there too. Do not commit or share
`experiment.json`; keep the session folder private. A shared teaching deployment
must protect session IDs and storage access: these local tools do not add hosted
authentication. A filesystem lock rejects concurrent writes. After a crash, inspect
that no process is writing before removing a stale `experiments/.lock` and retrying.

The journal records system order and declared authorship. It cannot establish
that no outside assistance occurred, authenticate who typed the text or demonstrate
learning gains. Its purpose is to make a learner's reasoning inspectable by that
learner without replacing it with an assistant's conclusion.
