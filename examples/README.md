English · [Français](README.fr.md)

# Examples

Small, finished examples you can open, play or copy: a self-study lesson built from a historical text,
five interactive activity templates, a literature-to-viewer walk-through, and media and visual-support
requests. They are teaching material for trying Studium, not validated curricula.

| | |
|---|---|
| Status | **maintained** (several are inputs of the tool tests) |
| Run | each example says how in its README or in the tool that reads it |
| Tests | `.venv/bin/python -m pytest tools` exercises the templates, the literature viewer and the self-study example |

For lessons used by the test suites and demonstrations, see [`fixtures/`](../fixtures/README.md).

## Index

| Example | What it shows | Start here |
|---|---|---|
| [`self-study-durkheim/`](self-study-durkheim/README.md) | a finished French self-study lesson (about 18 minutes, four scenes) built from chapter I of Durkheim's *Les Règles de la méthode sociologique*, with its passages and author response | [README](self-study-durkheim/README.md) |
| [`activity-templates/`](activity-templates) | five ready activity templates, catalogued in `manifest.json`: linked representations, controlled parameter comparison, evidence and claim, diagnose a flawed analysis, test conclusion robustness; `viewer.html` displays them | `.venv/bin/python tools/experience_templates.py list` |
| [`literature-experience/`](literature-experience) | captured passages and an author response for a literature-grounded activity, and a host-built spectrum explorer (`build-viewer.mjs`, `viewer.html`) | `.venv/bin/python tools/demo-literature-experience.py <new dir>` |
| [`archaeology/`](archaeology/README.md) | the `evidence-claim` template applied to a museum photograph, separating visible features, catalogue statements and interpretations | [README](archaeology/README.md) |
| [`media/`](media/README.md) | a provider-neutral media request: a teacher brief with source references and an expected output contract | [README](media/README.md) |
| [`visual-support/`](visual-support) | render-asset fragments for adapted support: an equation, a figure asset, a Mermaid concept map and robustness support in English and French | read with [Language and supports](../docs/learn/language-and-supports.md) |

## Play the self-study lesson

In VS Code, right-click `self-study-durkheim/lesson.json` and choose **Studium: Open this lesson**. With an
assistant, set `BUNDLES_ROOT` to the absolute path of this `examples/` folder in its Studium server
configuration (see [Connect an assistant](../docs/start/harnesses.md)), then ask it to start
`self-study-durkheim/lesson.json`.

## See also

- [Self-study from references](../docs/tutorials/self-study-from-references.md)
- [Activity templates](../docs/teach/activity-templates.md)
- [Media and visual support](../docs/teach/media-and-visual-support.md)
