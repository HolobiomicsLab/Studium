English · [Français](first-lesson.fr.md)

# Your first lesson

Play one lesson from start to finish while staying the author of your answers. Allow 15 to 20
minutes once Studium is [installed](../start/installation.md). The lesson shipped with the
repository, `atomistique-l1/lesson.json` (first-year atomic structure), is enough; no API key is
needed. It is written in French: the screens and feedback follow the lesson's language. Terms such as
scene, hint or harness are defined in the [glossary](../concepts/glossary.md).

## Route A: the VS Code lesson pane

1. Install the extension as described in [VS Code](../start/vscode.md).
2. Run **Studium: Open lesson**, or **Studium: Pick a course** to choose among the lessons found.
3. Read the introduction, open the assets, then continue to the first question.
4. Answer yourself; ask for a hint if useful. At a checkpoint, declare your own confidence.
5. Read the feedback, shown as its own step, before moving on. After an open answer that no judge
   assessed, rate your recall with the buttons (again, hard, good, easy): this sets your next review
   and never changes your mastery.
6. At the end, the completion screen lists what you consolidated and when your next review falls.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/vscode-pane-feedback-dark.png">
  <img alt="The Studium lesson pane in VS Code after an answer: the verdict, the reference to compare with and the cited source, then the button to continue." src="../assets/screenshots/vscode-pane-feedback-light.png" width="420">
</picture>

The notebook is another surface: **Studium: Open lesson as notebook** plays the same lesson cell by
cell. The pane and the chat participant (`@studium` in the chat view) are described in
[VS Code](../start/vscode.md).

## Route B: an assistant over MCP

Connect your harness as in [Connect your harness](../start/harnesses.md), with `BUNDLES_ROOT`
pointing at the repository's `fixtures/` folder, as the example configurations in
[`docs/examples/`](../examples/) do. Then send:

> Read `skills/studium-harness/SKILL.md`. This is a student session, not a simulation of answers.
> Start `atomistique-l1/lesson.json` with Studium. Show each screen as Studium wrote it, one at a
> time, wait for my answer and send my own words. Never invent an answer, a confidence level or a
> run result, and do not read the answer keys.

The assistant makes these calls; the identifiers below are templates. `start_lesson_session`
receives:

```json
{"bundle_ref": "atomistique-l1/lesson.json", "learner_id": "demo-local"}
```

The reply carries a `session_id` and a `presentation` whose `display_markdown` is the screen to show
as is. Your answer goes back in your words:

```json
{"session_id": "ID_RETURNED_BY_THE_SERVER", "input": {"kind": "reply", "text": "b"}}
```

`{kind: "reply", text}` accepts what you would type in a chat: a choice letter, a confidence from 0
to 4, a sentence, or "continue" on a reading screen. After the answer, the reply shows
`verdict.display_markdown` first, then the next screen. Other useful calls:

| Call | Use |
|---|---|
| `request_hint` | A hint on the current question, without moving on |
| `explain_last_adaptation` | Why Studium chose the next scene |
| `get_operator_context` | The public scene, its assets and the expected answer shape |
| `end_session` | Stop and keep your progress |

`tools/list` in your harness is the authoritative inventory of tools; the [MCP tools](../reference/mcp-tools.md)
reference describes each one.

## A short judgment exercise

Before changing a parameter of an asset, write a one-sentence prediction. After observing, say what
confirms or contradicts it. Ask the assistant for a new case that could break the explanation,
within the scope the teacher set. Your final answer stays your own; the viewer and the assistant's
text are material to examine.

## Check that the session works

- A real call returned the scene and the expected tools.
- An answer of your own produced feedback or a transition.
- The feedback comes from the session you used, without mixing pane and chat.
- Any run is reported as executed, failed or not run.

This checks the connection and the flow, not the effectiveness of the course.

## Next

- [Learn a topic in a conversation](learn-a-topic-in-a-conversation.md): build a lesson from your
  own sources.
- [A scientific experiment with your agent](agentic-experiment.md).
- Tools missing or a scene that does not move: [Troubleshooting](../start/troubleshooting.md).
