English · [Français](docs-style.fr.md)

# Writing the documentation

This page is for anyone who adds or changes a page under `docs/`. It gives the folder each page belongs
in, the bilingual rule, a page template, the house style, and the two commands that keep the reference
pages and links honest.

## Where a page goes

| Folder | Reader | Content |
|---|---|---|
| `docs/start/` | everyone | install, connect an assistant, first steps |
| `docs/learn/` | students and self-learners | how to learn and review with Studium |
| `docs/teach/` | teachers | authoring, review and approval, following a class |
| `docs/tutorials/` | everyone | one worked task from start to result |
| `docs/concepts/` | everyone | how Studium works and why; the [glossary](../concepts/glossary.md) |
| `docs/reference/` | developers and power users | tools, bundle format, configuration, CLI, HTTP API |
| `docs/develop/` | contributors | architecture, testing, release, this page |
| `docs/design-records/` | maintainers | specifications, ADRs, audits; archives, see [the index](../design-records/index.md) |
| `docs/internal/` | maintainers and agents | the agent log and the handoff history |

The portal [docs/index.md](../index.md) links every reader's path; a new page gets a link from it or from a
page it already links.

## Two languages, one structure

Every page under `docs/` exists twice: `page.md` in English and `page.fr.md` in French. Both have the same
headings in the same order, the same tables and the same commands. The French page is written in natural
French and addresses the reader as « vous »; it is not a word-for-word translation.

The first line of each page is the language switch, exactly:

```markdown
English · [Français](page.fr.md)
```

on the English page, and on the French page:

```markdown
[English](page.md) · Français
```

Three exceptions:

- `docs/design-records/` keeps each record in its original language; only its index has two versions.
- `docs/internal/` is single-language working material.
- In a generated reference page, the generated tables stay in English on both versions; the prose around
  them is translated.

The root README follows the same rule (`README.md` and `README.fr.md`).

## Page template

~~~markdown
English · [Français](my-page.fr.md)

# Title that names the task or the subject

One or two sentences: what the reader can do with this page and what they get.

## Before you start

What must be installed or known, with links.

## Do the task

1. A step.
2. A step, with the command:

   ```bash
   pnpm --filter @studium/lesson-mcp start
   ```

## What you get

The result, and how to check it.

## Limits

What this does not do, said once.
~~~

## House style

- Lead with what the reader can do and the result. One H1, then H2 and H3 only.
- Aim for 60 to 200 lines. Split a longer page by task.
- Use a table for parallel facts and a fenced `bash` block for commands. Commands are copy-pasteable and
  use repository-relative paths, never a path on your own machine.
- Explain a term at first use or link the [glossary](../concepts/glossary.md).
- No emoji, no hype, no dates that will go stale. "Since <version>" is fine when it helps.
- State a limit plainly, once, in the place the reader needs it.
- Document only what the code does. Before you write a command, a flag, a tool or a default, find it in
  the code. When a feature goes away, its documentation goes with it.

## Links and images

Link pages and code with relative paths, for example `[testing](testing.md)` or
`[server.ts](../../apps/lesson-mcp/src/server.ts)`. Images live in `docs/assets/`. When an image has light
and dark versions, use both, with alt text that says what the image shows:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/diagrams/architecture-dark.svg">
  <img src="../assets/diagrams/architecture-light.svg" alt="What the diagram shows, in one sentence.">
</picture>
```

## Generated reference pages

Parts of `docs/reference/` are written by scripts from the code. The generated part of a page sits between
two markers; everything outside them is written by hand and stays editable in both languages:

```markdown
<!-- BEGIN GENERATED: mcp-tools (tools/docs/gen-mcp-tools.mjs; do not edit by hand) -->
<!-- END GENERATED: mcp-tools -->
```

| Script | Pages | Source |
|---|---|---|
| [`tools/docs/gen-mcp-tools.mjs`](../../tools/docs/gen-mcp-tools.mjs) | `docs/reference/mcp-tools.md` and `.fr.md` | the running MCP server: tools, input fields, prompts, instructions |
| [`tools/docs/gen-lesson-bundle.mjs`](../../tools/docs/gen-lesson-bundle.mjs) | `docs/reference/lesson-bundle.md` and `.fr.md` | the Zod schemas of `packages/lesson-bundle-schema` |

After changing a tool or the bundle schema, regenerate and commit the result with the code change:

```bash
node tools/docs/gen-mcp-tools.mjs
node tools/docs/gen-lesson-bundle.mjs
node tools/docs/gen-mcp-tools.mjs --check     # exit 1 when a page is out of date
```

The generators run the code through the workspace `tsx` with `STUDIUM_EPHEMERAL=1`, so `pnpm install` must
have run and no learner state is written.

## The docs check

[`tools/docs/check.mjs`](../../tools/docs/check.mjs) is the documentation gate. Run it before you open a
pull request:

```bash
node tools/docs/check.mjs                     # everything; exit 1 on any problem
node tools/docs/check.mjs --skip-generated    # links and pairs only, without running TypeScript
node --test tools/docs/check.test.mjs         # tests of the check itself
```

It checks that:

1. every relative link and `#anchor` in every Markdown file of the repository resolves;
2. every page under `docs/`, outside `design-records/` and `internal/`, has its English or French twin;
3. every tool the MCP server registers has a section in `docs/reference/mcp-tools.md`;
4. the generated regions match the code.

It does not check the language-switch line, that both versions say the same thing, or that a command
works. Those are for the reviewer.
