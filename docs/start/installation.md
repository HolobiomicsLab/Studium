English · [Français](installation.fr.md)

# Installation

Install Studium once from a checkout, then connect it to your assistant or open lessons in VS Code. The
learner path needs only Node; teachers who prepare courses from literature add Python. The first session
uses local example lessons and needs no model API key.

## Choose what you install

| You want to | Install |
|---|---|
| Learn with an AI assistant (Codex, Claude Code, Copilot, OpenCode, Cursor) | Node, pnpm, the checkout |
| Play lessons in a visual pane | the above, plus VS Code and the Studium extension |
| Prepare and approve courses from sources | the above, plus Python 3.12 and the teacher tools |
| Open a portable activity a teacher prepared | only a recent browser: open its `index.html` (see [Activity to report](../tutorials/activity-to-report.md)) |

## Requirements

| Tool | Version | Check with |
|---|---|---|
| Git | any recent | `git --version` |
| Node | 22 LTS (the repository accepts 20 and later) | `node --version` |
| pnpm | 9.15.9 | `pnpm --version` |
| Python (teacher tools only) | 3.12 or later | `python3.12 --version` |
| VS Code (pane only) | 1.95 or later | Help, About |

If `pnpm` is missing, `corepack enable` (shipped with Node) or the
[pnpm installation guide](https://pnpm.io/installation) provides it. On a stock macOS, `python3` is often
3.9, which is too old for the teacher tools.

## Get the code and build

The repository is private: authenticate before cloning, otherwise Git reports `Repository not found`.

```bash
gh auth login
git clone https://github.com/HolobiomicsLab/studium.git
cd studium
./setup.sh
```

`setup.sh` is safe to re-run. It checks Node and pnpm, installs the workspace, builds the workspace
libraries, copies the offline renderers (KaTeX, Vega, 3Dmol) into the extension, builds the extension and
verifies the outputs. The manual equivalent is:

```bash
pnpm install --frozen-lockfile
pnpm build:libs
pnpm --filter studium-vscode vendor
pnpm --filter studium-vscode build
```

The last command writes `apps/studium-vscode/dist/extension.js` and
`apps/studium-vscode/dist/lesson-mcp.cjs`. The second file is the self-contained Studium MCP server that the
[harness configurations](harnesses.md) start with `node`; it needs no global `tsx`.

## Check the server without any client

```bash
node apps/lesson-mcp/scripts/headless_smoke.mjs
```

A bare MCP client starts the server, lists its tools, plays a shipped lesson and prints
`all 19 assertions passed`. The smoke test keeps nothing on disk. It proves the server works; it does not
prove that a given assistant is connected.

## Where Studium keeps your lessons and progress

The server started by an assistant uses these defaults. Each can be changed with an environment variable
in the harness configuration; the full list is in [Configuration](../reference/configuration.md).

| What | Default | Variable |
|---|---|---|
| Studium home | `~/.studium` | `STUDIUM_HOME` |
| Lessons built for you | `~/.studium/library` | `STUDIUM_HOME` (`BUNDLES_ROOT` only adds a folder looked up first) |
| Durable progress and reviews | `~/.studium/data` | `STUDIUM_DATA_DIR` |
| Keep everything in memory (tests, demos) | off | `STUDIUM_EPHEMERAL=1` |

Learner folders on disk are named by a pseudonym, never by your learner id. The VS Code extension keeps its
own progress in VS Code's extension storage; see [VS Code](vscode.md#your-data).

## Other ways to run the server

| Use | Command |
|---|---|
| From sources, for development | `pnpm --filter @studium/lesson-mcp start` |
| Standalone single file | `pnpm --filter @studium/lesson-mcp bundle`, which writes `apps/lesson-mcp/dist/studium-mcp.cjs` |
| Local HTTP API instead of MCP | `pnpm --filter @studium/lesson-mcp api` (see [Harnesses](harnesses.md#direct-http-api)) |

A tagged release attaches `studium-vX.Y.Z.vsix`, `lesson-mcp.cjs` and `SHA256SUMS.txt` to a GitHub release
drafted by the release workflow. Nothing is published to npm or the VS Code Marketplace.

## Install the VS Code extension

Build an installable package from the checkout, then install it:

```bash
pnpm --filter studium-vscode package
code --install-extension apps/studium-vscode/studium.vsix
```

`package` vendors the renderers, builds, and runs the pinned `vsce` dev dependency. The VSIX contains
the server and the renderers, so a colleague can install it without a checkout. Lessons are not inside the
VSIX: the extension reads your personal library (`~/.studium/library`) or the folder you pick. Developers
can instead open `apps/studium-vscode` in VS Code and press F5. What the extension offers is described in
[VS Code](vscode.md).

## Add the teacher tools (Python)

From the repository root, in a virtual environment (never the system Python):

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python tools/experience_packet.py --help
```

`experience_packet.py` offers `passages`, `prepare`, `check`, `bundle` and `approve`. Continue with the
[teacher guide](../teach/teacher-guide.md). Scientific libraries a course capsule needs are installed in
that capsule's own environment, at the versions it declares.

## Windows

The commands above are written for macOS and Linux. On Windows:

- create the environment with `py -3.12 -m venv .venv` and replace `.venv/bin/python` with
  `.venv\Scripts\python.exe`;
- in PowerShell, set a variable with `$env:NAME="value"` before the command instead of `NAME=value command`;
- `setup.sh` and the extension's `vendor` script use Unix tools (`mkdir -p`, `cp`): build under WSL, or
  install a VSIX built elsewhere. Do not mix Windows and WSL `node_modules`;
- the discovery links in `.claude/skills` and `.agents/skills` are symlinks, which a Windows checkout may
  not keep; point your assistant at `skills/<name>/SKILL.md` directly.

The Windows path has not been run end to end.

## Update

```bash
git pull
./setup.sh
```

Then restart or reconnect the MCP server in your assistant. A `lesson-mcp.cjs` built before the pull lacks
recent tools without any other symptom: ask your assistant to call `get_server_info`, which reports the
version, whether the build is `source` or `bundled`, its build date and the tool list. Your lessons and
progress in `~/.studium` are not touched by an update.

## Remove your data

Your assistant can erase one lesson's progress with `forget_session`, only when you ask; it also
erases your cross-lesson profile and study record (your review schedule), and cannot be undone. Asked to
erase all your data, it erases every lesson's progress too. Its reply names what stays: the lessons in
your library and their prepared sources. To remove everything the assistant-side server kept, delete the
Studium home folder (`~/.studium` by default). In VS
Code, **Studium: Forget my data** erases what the extension keeps. Exported reports and your assistant's own
history are separate copies. More in [Privacy and limits](../concepts/privacy-and-limits.md).
