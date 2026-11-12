English · [Français](README.fr.md)

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/hero-dark.svg">
    <img src="docs/assets/hero-light.svg" width="880" alt="Studium: adaptive lessons, grounded in knowledge. For teachers, students and self-learners.">
  </picture>
</p>

# Studium

Studium turns sources you trust into adaptive lessons that you can play in VS Code or through your own AI assistant. Each answer says who wrote the answer key and whether anything assessed it.

[eDIAM](https://ediam.cnrs.fr/) · Institut de Chimie de Nice · Université Côte d'Azur · CNRS · [HolobiomicsLab](https://holobiomicslab.cnrs.fr/) · [Studium site](https://ediam.cnrs.fr/studium/)

## Start here

Studium has two parts. Knowing which does what saves the first ten minutes:

| Part | What it does | What it does not do |
|---|---|---|
| **Your AI assistant**, connected to the Studium server | builds a lesson from the sources you name, asks you its questions in the conversation, brings the ideas back over the following days | answer for you |
| **The VS Code extension** | shows a lesson in a pane, with its figures, equations and reviews | build a lesson: on a new machine its **Lessons** view stays empty until an assistant has built one |

So a new lesson always starts in an assistant.

### 1. Connect your assistant

You need Node 20 or later (`node --version`). Run the line for your assistant once, then restart it:

| Assistant | Command |
|---|---|
| Claude Code | `claude mcp add --scope user studium -e LITELLM_BASE_URL= -- npx -y studium-mcp` |
| Codex | `codex mcp add studium --env LITELLM_BASE_URL= -- npx -y studium-mcp` |
| Copilot in VS Code, agent mode | `code --add-mcp '{"name":"studium","command":"npx","args":["-y","studium-mcp"],"env":{"LITELLM_BASE_URL":""}}'` |

Cursor, OpenCode and Claude Desktop, and the Claude Code plugin that also brings the skills, are on the
[Installation](docs/start/installation.md) page. `LITELLM_BASE_URL=` (empty) keeps Studium from calling
any paid model. Which model to use, with a Copilot plan or a model on your machine, is in
[Choose your model](docs/start/models.md).

### 2. Ask for a lesson

In a new conversation, in your own words:

> I want to learn how the water cycle works with Studium. Use these two pages: (two links you trust).

The assistant builds a lesson from your sources, shows you its outline, then asks the first question. You
answer; it passes your words on. The lesson is saved in `~/.studium/library` and your progress in
`~/.studium/data`. Each step is described in
[Learn with your assistant](docs/learn/learn-with-your-assistant.md).

### 3. Play it in VS Code (optional)

```bash
code --install-extension holobiomicslab.studium-vscode
```

Open the **Studium** icon in the activity bar: the lesson your assistant built is in the **Lessons** view
(use its refresh button if VS Code was already open), unless you picked another lessons folder. You can
also ask the assistant to open the lesson in VS Code for you. The pane keeps its own progress, separate
from the conversation. See [VS Code](docs/start/vscode.md#get-your-first-lesson).

### If you are an AI assistant helping someone with Studium

These steps are written for you.

1. Check Node: `node --version` must print 20 or later.
2. Register the server with the line of step 1 for your own harness. Keep `LITELLM_BASE_URL` empty unless
   the person asks for a judge model: a non-empty value is a paid route.
3. After the restart, prove the connection by calling `get_server_info`: it returns the version and the
   tool list. A configuration file is not proof.
4. Call `get_study_plan` with one stable `learner_id` and the person's language. Its `next_step` names the
   next call; with no lesson yet it sends you to `get_authoring_guide`, then `prepare_sources` and
   `create_lesson`.
5. The learner answers and you relay: never answer, choose or rate for them, and do not read a lesson's
   answer key. Show each `display_markdown` as it is.
6. A lesson you draft is not approved by a teacher: relay the notice of its first screen.

The server repeats these rules in its own instructions when you connect. Details:
[Connect your assistant](docs/start/harnesses.md), the skill
[`studium-harness`](skills/studium-harness/SKILL.md) and the [MCP tools](docs/reference/mcp-tools.md). To
change Studium's code instead, read [`AGENTS.md`](AGENTS.md).

## Choose your path

| I want to… | Start here | What you get |
|---|---|---|
| Learn a topic on my own with an AI assistant | [Learn with your assistant](docs/learn/learn-with-your-assistant.md) | A lesson built from the sources you chose, then reviews spaced over the following days |
| Study in a class | [Student guide](docs/learn/student-guide.md) | A teacher-approved lesson in VS Code or in your assistant, with feedback after each answer |
| Teach | [Teacher guide](docs/teach/teacher-guide.md) | A sourced lesson, an approval record bound to its exact content, and an aggregated class report |
| Build on Studium | [Architecture](docs/develop/architecture.md) and [MCP tools](docs/reference/mcp-tools.md) | The runtime contracts, the 40 MCP tools and the lesson bundle format |

The [documentation portal](docs/index.md) lists every page by role. The same pages build into a site with a
menu, a search box, both languages and light and dark themes, readable without a network:
`node tools/docs/build-site.mjs --out site`, then open `site/index.html`.

<table>
  <tr>
<td width="50%" valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/vscode-pane-choices-dark.png"><img src="docs/assets/screenshots/vscode-pane-choices-light.png" width="420" alt="The Studium lesson pane in VS Code on a quiz step of a French lesson: a notice saying the learner wrote the answer key, step 3 of 8 on the Lyman series, the Rydberg formula as a step document, four lettered choices with A selected, an optional confidence scale from 0 to 4, a Submit button and a Hint link."></picture><br><em>A quiz step in the VS Code lesson pane; the notice on top says who wrote the answer key.</em></td>
<td width="50%" valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/vscode-pane-feedback-dark.png"><img src="docs/assets/screenshots/vscode-pane-feedback-light.png" width="420" alt="The feedback step after a written answer in a French lesson: a compare-it-yourself box marked not certified because no judge assessed the answer, the key points, a collapsed model answer, the cited source passage with its link, four buttons to rate recall and a Continue button."></picture><br><em>Feedback after a written answer that no judge assessed: compare with the key points, then rate your recall.</em></td>
  </tr>
</table>

## From a checkout, with the demo lessons

This path is for teachers and contributors, and gives you the demo lessons. Plan about fifteen minutes. You need git, Node 22 and pnpm 9. Python is not needed to learn.

```bash
git clone https://github.com/HolobiomicsLab/studium.git
cd studium
corepack enable        # provides the pnpm version pinned in package.json
./setup.sh             # installs, builds the libraries and the VS Code extension
```

If the clone answers `Repository not found`, the repository is not visible to your account yet: run `gh auth login` and clone again.

**In VS Code.** Install the extension with the two commands below, then run **Studium: Pick a course** and choose the `fixtures` folder for the demo lessons, which need no API key. Contributors can press F5 in `apps/studium-vscode` instead. See [VS Code](docs/start/vscode.md) and [Installation](docs/start/installation.md).

```bash
pnpm --filter studium-vscode package
code --install-extension apps/studium-vscode/studium.vsix
```

**In your AI assistant.** Register the Studium server that `setup.sh` built (MCP is the protocol an assistant uses to call tools), from the repository root. `LITELLM_BASE_URL=` (empty) tells Studium to use no judge model, even if your shell defines one.

```bash
# Claude Code
claude mcp add --scope project studium -e LITELLM_BASE_URL= -- node "$PWD/apps/studium-vscode/dist/lesson-mcp.cjs"

# Codex
codex mcp add studium --env LITELLM_BASE_URL= -- node "$PWD/apps/studium-vscode/dist/lesson-mcp.cjs"
```

Restart the assistant and ask: "I want to learn photosynthesis with Studium". The assistant asks for sources, builds a lesson and asks you the first question. Your progress is kept in `~/.studium/data`; lessons you create go to `~/.studium/library`. Copilot, OpenCode and Cursor are covered in [Connect your assistant](docs/start/harnesses.md). More detail: [Quickstart](docs/start/quickstart.md) and [Troubleshooting](docs/start/troubleshooting.md).

## What makes Studium different

- **A course is a graph.** Each lesson links concepts by prerequisites; navigation, remediation and the teacher's view read it. [How Studium works](docs/concepts/how-studium-works.md)
- **Honest assessment, with provenance.** Every lesson says who wrote the answer key and whether a judge model assessed the answer. [Honesty and provenance](docs/concepts/honesty-and-provenance.md)
- **Sourced lessons.** Each graded item cites a passage, and each quote must match its source character for character.
- **Spaced review.** Studium schedules reviews (FSRS); rating your own recall never changes measured mastery. [Review over time](docs/learn/review-over-time.md)
- **Local-first.** Learner state stays on your machine, under pseudonyms, and you can erase it. [Privacy and limits](docs/concepts/privacy-and-limits.md)
- **Any harness.** One session contract over MCP, a local HTTP API and a file channel; the assistant relays, the learner answers.

## Status and limits

Studium is a research prototype, version 0.6.1. The adaptive runtime, the authoring tools, the provenance records and the evaluation harness are implemented and tested, but Studium has not been evaluated for learning outcomes. A teacher must review and approve a lesson before students use it. A lesson built by an AI assistant from your sources is labelled as agent-drafted and not teacher-validated. Without a configured judge model, open answers are compared with the reference rather than scored. The HTTP adapter exposes the 25 lesson operations plus `rate_recall`; the other study tools and all authoring and teacher tools are MCP-only. The release workflow can publish to the VS Code Marketplace, Open VSX and npm once their tokens are configured; until then, a release is a GitHub draft with the VSIX and the server file.

- [Capabilities, surfaces and maturity](docs/concepts/capabilities.md#surfaces-and-maturity): what each surface does and how far it is supported.
- [Architecture and repository map](docs/develop/architecture.md): the diagram, every app, package and service.
- Screenshots of the [teacher library](docs/teach/teacher-guide.md) and the [concept map](docs/learn/concept-map.md).

## Part of a family

Studium composes four sibling projects of the lab: [Perspicacité](https://github.com/HolobiomicsLab/Perspicacite-AI) grounds prerequisites in literature passages, [indicium](https://github.com/HolobiomicsLab/indicium) represents the graph as evidence-bound claims, [ASTRA](https://github.com/LightconeResearch/astra-spec) records each adaptive decision so it can be replayed, and [ASB](https://github.com/HolobiomicsLab/AgenticScienceBuilder) supplies reproduction capsules and the agentic-step standard.

## Who makes Studium

Studium is developed by the [HolobiomicsLab](https://holobiomicslab.cnrs.fr/), within the [eDIAM team](https://ediam.cnrs.fr/) (Équipe d'Intelligence Artificielle pour les Sciences Moléculaires) of the Institut de Chimie de Nice (ICN, UMR 7272), Université Côte d'Azur and CNRS.

We thank the [EUR Spectrum](https://spectrum.univ-cotedazur.fr/), the graduate school of fundamental sciences and engineering of Université Côte d'Azur, for its support. Studium grew from teaching questions raised around the school.

## Licence

The code is licensed under the [Apache License 2.0](LICENSE). The documentation, the visual identity and the lessons written by the project are licensed under [Creative Commons Attribution 4.0](LICENSES/CC-BY-4.0.txt). Source excerpts quoted in a lesson keep their own licence, named on each source line, and a lesson you build from your own sources belongs to you. Teaching material used by the evaluation harness under `eval/corpus/` is not redistributed; its manifest lists each source's licence. [NOTICE](NOTICE) says which licence covers which folder.

## Citation

If you use Studium in research, cite it with the metadata in [`CITATION.cff`](CITATION.cff). GitHub shows a "Cite this repository" button from that file. No DOI has been assigned yet.

## Contributing and security

[Report a problem or contribute](docs/start/report-and-contribute.md) · [Contributing](CONTRIBUTING.md) · [Code of conduct](CODE_OF_CONDUCT.md) · [Security policy](SECURITY.md) · [Testing Studium](TESTING.md) · [Changelog](CHANGELOG.md)
