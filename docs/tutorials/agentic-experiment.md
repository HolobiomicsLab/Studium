English · [Français](agentic-experiment.fr.md)

# A scientific experiment with your agent

Use the freedom of your harness to test an idea while staying tied to the scene, its evidence and
Studium's answer contract. The teacher sets the scope; the student chooses a hypothesis and defends
a conclusion. The result is a prediction, a reproducible comparison, a stated limit and an argued
transfer to a new case.

## Case A: spectral similarity and a custom viewer

Proposed question: "Does a better similarity after shifting peaks suffice to identify a molecule?"
The example is an illustrative computation on synthetic spectra, linked to a captured passage of the
SimMS article. It reproduces neither the article nor an ASB library-cleaning capsule.

To replay the computation, the viewer and the technical audit (Node, Python and Chrome available):

```bash
.venv/bin/python tools/demo-grounded-exploration.py "$HOME/studium-exploration-demo"
```

The script writes, among others, `capsule/outputs/match.json`, `execution.json`, `audit/viewer/`,
`audit/report.json`, `exploration-receipt/` and `exploration-verification.json`. It reuses the
captured passages offline, runs the computation and tests the viewer. The audit's observations are
synthetic, not student answers. To inspect the viewer:

```bash
.venv/bin/python -m http.server 8118 --bind 127.0.0.1 --directory "$HOME/studium-exploration-demo/audit/viewer"
```

Open `http://127.0.0.1:8118`, move the controls and check that the values change consistently. The
viewer is an external local artefact; it is not installed in the Studium pane. Stop with Ctrl-C.

## Case B: a real task from an ASB capsule

From a capsule the teacher provides, a spectral-cleaning task can become a before/after comparison:
which spectra were rejected, by which criteria, with what consequences for the analysis? Read its
exact card, data and dependencies. Never replace an unavailable task with the synthetic example under
the real result's name.

The harness checks its actual tools: file access, terminal, web search, Perspicacité if present, and
domain skills. A skill explains how to operate; its presence installs neither a library nor a
connector. For a scientific question, read the article and primary sources; to code or install,
start from the official documentation of the chosen version. Keep the URL, date, useful excerpt and
reason for each choice.

## The loop to use in a session

1. **Predict.** The student states the expected effect before seeing results.
2. **Run a reference.** The harness performs the authorised task and keeps inputs, versions, command
   and real outputs.
3. **Vary one factor.** The student picks a threshold or a hypothesis; the reference stays visible.
4. **Test the limits.** Examine at least one edge case and one null or contradictory result. Check
   units and computations, not only appearance.
5. **Judge.** The student explains what the experiment supports, what it does not show and which
   further evidence would help.
6. **Transfer.** Apply the reasoning to a new case, then return to the personal answer Studium asks
   for.

A prompt to adapt:

> Read the public context of the scene and the Studium skill. Check your tools. Help me experiment on
> [question], within [teacher's scope]. Ask for my prediction first. Propose the minimal environment
> and the relevant official sources; use a domain skill if needed. Run the reference, then the
> variation I choose. Build a viewer with data, units, reference and variant visible. Test the
> controls and an edge case. Keep the evidence and distinguish `completed`, `failed` and `not_run`.
> End with a judgment question and wait for my answer; submit nothing on my behalf.

Prefer an existing asset or a declarative specification when it is enough. A custom viewer earns its
place when an interaction answers a precise teaching question. Install libraries in an environment
dedicated to the experiment and record the versions; a virtual environment is not a security
sandbox, and the harness keeps its usual execution permissions.

## Follow the run protocol

For a scene with a run, call `get_run_manifest`, actually perform the authorised operation, then send
a conforming `RunResult` with `submit_run_result`. The [`studium-harness`](../../skills/studium-harness/SKILL.md)
skill and the [agentic session protocol](../reference/agentic-session-protocol.md) list the current
fields. Studium does not run the science for the harness at study time. In VS Code, **Studium: Run
reproduction** shows what will run and asks for your confirmation; it asks again whenever the
command, the packages or the lesson file change. An exploratory
recomputation in a chart is not a new attested run and must not silently replace the submitted
result.

## Keep a portable experiment folder

Save the public JSON of `get_operator_context` as `current-context.json`, then:

```bash
.venv/bin/python tools/experience_exploration.py prepare --context current-context.json --out new-experiment
```

Read `task.md` and the generated schema. Fill `experiment.json` with the question, hypothesis,
sources, explicitly chosen files, actions and controls; the starting template is deliberately
incomplete. An action declared `completed` requires evidence and passed controls. Then:

```bash
.venv/bin/python tools/experience_exploration.py seal --workspace new-experiment --out new-receipt
.venv/bin/python tools/experience_exploration.py verify new-receipt --context fresh-context.json
```

The receipt checks the integrity of the captured files and their link to the context. It proves
neither scientific truth, nor independent execution, nor human authorship, and it is not submitted
as `response.json` or `run_result.json`. Receipts are not yet integrated in the MySTRA review. Keep
the student's personal observation only at their request; it is empty by default. These files stay
outside session erasure and Studium telemetry. For notes kept by the engine itself, see the
[experiment journal](../learn/experiment-journal.md).

**Expected learning outcome:** a personal prediction, a reproducible comparison, an explicit limit
and an argued transfer. That the agent wrote code or produced a nice chart is not enough.
