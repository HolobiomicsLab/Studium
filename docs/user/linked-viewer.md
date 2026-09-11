# Linked synthetic spectrum viewer

This local example connects one synthetic molecular network, a mirror-spectrum
pair and a candidate table through fixed node IDs. It is designed to teach the
difference between changing an edge threshold and changing the underlying
evidence. Candidate similarity is not compound identification.

## Build it

Use the existing checked literature-experience workflow to produce the spectra,
run result, public operator context and checked review directory. Then run:

```bash
node examples/literature-experience/build-viewer.mjs \
  SPECTRA_JSON RESULT_JSON OPERATOR_CONTEXT_JSON CHECKED_REVIEW_DIR NEW_OUTPUT_DIR
```

The existing five-input command remains valid. It uses
`examples/literature-experience/linked-network.json` by default. To test another
teacher-reviewed synthetic network, pass its path as a sixth argument after the
new output directory. The builder rejects malformed or non-synthetic network
data and writes its hash and generation-brief ID to `viewer-provenance.json`.

Serve the output locally and open `index.html` in a browser. For example:

```bash
python -m http.server 8118 --bind 127.0.0.1 --directory NEW_OUTPUT_DIR
```

## Learner sequence

1. Enter a prediction about whether lowering the threshold changes nodes, edges,
   both or neither. Calculations remain hidden until the prediction has text.
2. Reveal the network and compare the recorded baseline threshold with the
   “new edges” and “no edge change” presets.
3. Select a node with a pointer, or focus it with Tab and press Enter or Space.
   The same ID becomes selected in the network, mirror title and candidate row.
4. Record an observation and conclusion in the page. Nothing is graded,
   persisted or submitted.
5. Press **Export my notes** only when a local learner-owned JSON copy is wanted.

The baseline edge set remains visible as a dashed reference. Moving the threshold
filters edges inclusively (`score >= threshold`) and never removes nodes. The
0.64 preset produces a meaningful edge change for the bundled data; 0.70 is a
stable no-change case relative to the 0.65 baseline.

## Reusable generation brief

Every network input must carry `generation_brief` with these fields:

- `learning_goal`: the scientific judgment the views should support;
- `inputs`: the exact public and synthetic inputs available to the viewer;
- `reference_calculation`: the independently testable numerical rule;
- `allowed_parameters`: only controls the learner may change;
- `hidden_information`: calculations withheld until prediction;
- `cross_view_questions`: prompts that require using more than one view;
- `learner_sequence`: prediction, reveal, observation, conclusion and optional export;
- `export_policy`: an explicit learner action, with no automatic submission.

Keep every node ID unique and use the same ID in `nodes`, `candidates` and any
linked controls. Retain at least one parameter change that alters edges and one
that leaves the baseline edge set unchanged. Source claims and captured hashes
still come from the checked literature packet; the synthetic network does not
extend those claims.

## Scientific and computation limits

The viewer's optional notes download is separate from the
[host experiment journal](experiment-journal.md). If the harness uses both,
record the learner's prediction, justification and confidence through the host
before revealing calculations here. Do not backfill an exported note as if the
host had recorded it before results were visible. No viewer action submits an answer.

The viewer calculates greedy, one-to-one, precursor-aware modified cosine on
L2-normalized intensities. Equal products resolve by the lowest peak indices.
Its synthetic scores illustrate a calculation and a threshold effect. They do
not establish identity, novelty, identification level, learning outcome or
learning style. A threshold exploration is not a new capsule run, and the build
hashes establish snapshot integrity rather than scientific truth.

Run the independent numerical and build checks with the repository virtualenv:

```bash
python -m pytest -q tools/test_linked_viewer_numeric.py tools/test_linked_viewer_build.py
python -m pytest -q tools/test_experience_viewer_inputs.py
```
