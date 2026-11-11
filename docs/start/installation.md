English · [Français](installation.fr.md)

# Installation

Pick the shortest route for your case. To learn with an AI assistant you need only Node: the assistant
starts the Studium server with `npx`, and no checkout is needed. Teachers who prepare and approve courses,
and contributors, install from a checkout. The first session needs no model API key.

## Choose how you install

| You want to | Route | You need |
|---|---|---|
| Learn with an AI assistant (Codex, Claude Code, Copilot, Cursor, OpenCode, Claude Desktop) | [Add the server to your assistant](#add-the-server-to-your-assistant) | Node |
| Learn in Claude Code, with the lesson agents and the skills | [Install the Claude Code plugin](#install-the-claude-code-plugin) | Node, Claude Code 2.1.275 or later |
| Play lessons in a visual pane | [Install the VS Code extension](#install-the-vs-code-extension) | VS Code |
| Prepare and approve courses, or contribute | [Install from a checkout](#install-from-a-checkout) | Git, Node, pnpm; Python for the teacher tools |
| Open a portable activity a teacher prepared | nothing: open its `index.html` (see [Activity to report](../tutorials/activity-to-report.md)) | a recent browser |

Only a checkout gives you:

- the demo lessons of `fixtures/`;
- the teacher tools (Python), which prepare, check and approve a course;
- the [skills](skills.md) for assistants other than Claude Code (the plugin brings them to Claude Code);
- the [Observatory](../teach/observatory.md) and the teacher dashboard (see [Follow a class](../teach/follow-a-class.md)).

## Requirements

| Tool | Version | Route | Check with |
|---|---|---|---|
| Node | 22 LTS (20 and later accepted) | server, plugin, checkout | `node --version` |
| Claude Code | 2.1.275 or later | plugin | `claude --version` |
| VS Code | 1.95 or later | extension | Help, About |
| Git | any recent | checkout | `git --version` |
| pnpm | 9.15.9 | checkout | `pnpm --version` |
| Python | 3.12 or later | checkout, teacher tools only | `python3.12 --version` |

The extension carries its own server and needs no separate Node. If `pnpm` is missing, `corepack enable`
(shipped with Node) or the [pnpm installation guide](https://pnpm.io/installation) provides it. On a stock
macOS, `python3` is often 3.9, which is too old for the teacher tools.

## If a package is not published yet

The npm package `studium-mcp` and the extension on the Visual Studio Marketplace and Open VSX are available
from the first public release that carries them. Until then, a command may answer that the package or the
extension does not exist. Use the files attached to a
[GitHub release](https://github.com/HolobiomicsLab/studium/releases) instead:

- download `lesson-mcp.cjs` and start it with `node /path/to/lesson-mcp.cjs` wherever this documentation
  writes `npx -y studium-mcp`;
- download `studium-vX.Y.Z.vsix` and install it with `code --install-extension studium-vX.Y.Z.vsix`.

The Claude Code plugin is not published anywhere: Claude Code reads it from this repository, so it installs
as soon as you have access to the repository. It starts its server with `npx -y studium-mcp`, so it needs
the npm package too. Otherwise,
[install from a checkout](#install-from-a-checkout). While the repository is private, cloning it and
downloading release files need access to it.

## Add the server to your assistant

You need Node 20 or later. `npx` fetches the server the first time; there is nothing else to install.
`LITELLM_BASE_URL=` (empty) tells Studium to call no judge model, even if your shell defines one.

| Assistant | Command or file |
|---|---|
| Claude Code | `claude mcp add --scope user studium -e LITELLM_BASE_URL= -- npx -y studium-mcp` |
| Codex | `codex mcp add studium --env LITELLM_BASE_URL= -- npx -y studium-mcp` |
| Copilot in VS Code | `code --add-mcp '{"name":"studium","command":"npx","args":["-y","studium-mcp"],"env":{"LITELLM_BASE_URL":""}}'` |
| Cursor | `.cursor/mcp.json` or `~/.cursor/mcp.json`, see [Connect Cursor](cursor.md) |
| OpenCode | `opencode.jsonc`, see [Connect OpenCode](opencode.md) |
| Claude Desktop | `claude_desktop_config.json`, see [Connect your assistant](harnesses.md#claude-desktop) |

Check the server itself:

```bash
npx -y studium-mcp --version
npx -y studium-mcp --help
```

Both answer without starting the server. Then check that your assistant is connected:
[Connect your assistant](harnesses.md#check-the-connection).

## Install the Claude Code plugin

The plugin `studium` adds the server, the twelve skills of `skills/` and the two lesson agents in one step:

```bash
claude plugin install studium --marketplace HolobiomicsLab/studium
```

Inside a session, `/plugin install studium --marketplace HolobiomicsLab/studium` does the same. How the
skills and agents are named under the plugin, and the two-step, update and removal commands, are in
[Connect Claude Code](claude-code.md#install-the-plugin).

## Install the VS Code extension

From the Visual Studio Marketplace or Open VSX, once the extension is
[published there](#if-a-package-is-not-published-yet):

```bash
code --install-extension holobiomicslab.studium-vscode
```

Or from a release file: `code --install-extension studium-vX.Y.Z.vsix`. The extension contains the server and
the renderers. Lessons are not inside it: it reads your personal library (`~/.studium/library`) or the
folder you pick. What it offers is described in [VS Code](vscode.md).

## Install from a checkout

This route is for teachers who prepare and approve courses, and for contributors.

### Get the code and build

Cloning needs access to the repository while it is private: run `gh auth login` first if Git answers
`Repository not found`.

```bash
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
`apps/studium-vscode/dist/lesson-mcp.cjs`. The second file is the self-contained Studium MCP server, the
same file as `lesson-mcp.cjs` in a release. An assistant starts it with `node` (see
[Connect your assistant](harnesses.md)); it needs no global `tsx`.

### Check the server without any client

```bash
node apps/lesson-mcp/scripts/headless_smoke.mjs
```

A bare MCP client starts the server, lists its tools, plays a shipped lesson and prints
`all 19 assertions passed`. The smoke test keeps nothing on disk. It proves the server works; it does not
prove that a given assistant is connected.

### Other ways to run the server

| Use | Command |
|---|---|
| From sources, for development | `pnpm --filter @studium/lesson-mcp start` |
| Standalone single file | `pnpm --filter @studium/lesson-mcp bundle`, which writes `apps/lesson-mcp/dist/studium-mcp.cjs` |
| Local HTTP API instead of MCP | `pnpm --filter @studium/lesson-mcp api` (see [HTTP API](../reference/http-api.md#start-it)) |

How a release is built and published is in [Release](../develop/release.md).

### Build the VS Code extension

```bash
pnpm --filter studium-vscode package
code --install-extension apps/studium-vscode/studium.vsix
```

`package` vendors the renderers, builds, and runs the pinned `vsce` dev dependency. A colleague can install
the VSIX without a checkout. Developers can instead open `apps/studium-vscode` in VS Code and press F5.

### Add the teacher tools (Python)

From the repository root, in a virtual environment (never the system Python):

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python tools/experience_packet.py --help
```

`experience_packet.py` offers `passages`, `prepare`, `check`, `bundle`, `approve` and `receipt`. The
last records a review receipt for a lesson you send back, without approving it; `approve` refuses a
`to_fix` verdict and points to it. Continue with the [teacher guide](../teach/teacher-guide.md).
Scientific libraries a course capsule needs are installed in that capsule's own environment, at the
versions it declares.

### Windows

The checkout commands are written for macOS and Linux. On Windows:

- create the environment with `py -3.12 -m venv .venv` and replace `.venv/bin/python` with
  `.venv\Scripts\python.exe`;
- in PowerShell, set a variable with `$env:NAME="value"` before the command instead of `NAME=value command`;
- `setup.sh` and the extension's `vendor` script use Unix tools (`mkdir -p`, `cp`): build under WSL, or
  install a VSIX built elsewhere. Do not mix Windows and WSL `node_modules`;
- the discovery links in `.claude/skills` and `.agents/skills` are symlinks, which a Windows checkout may
  not keep; point your assistant at `skills/<name>/SKILL.md` directly.

The Windows path has not been run end to end.

## Where Studium keeps your lessons and progress

The server started by an assistant uses these defaults, whatever the route. Each can be changed with an
environment variable in the assistant's configuration; the full list is in
[Configuration](../reference/configuration.md).

| What | Default | Variable |
|---|---|---|
| Studium home | `~/.studium` | `STUDIUM_HOME` |
| Lessons built for you | `~/.studium/library` | `STUDIUM_HOME` (`BUNDLES_ROOT` only adds a folder looked up first) |
| Durable progress and reviews | `~/.studium/data` | `STUDIUM_DATA_DIR` |
| Keep everything in memory (tests, demos) | off | `STUDIUM_EPHEMERAL=1` |

Learner folders on disk are named by a pseudonym, never by your learner id. The VS Code extension keeps its
own progress in VS Code's extension storage; see [VS Code](vscode.md#your-data).

## Update

| Route | Update |
|---|---|
| Server with `npx` | restart the assistant. `npx` may reuse a copy it already fetched: `npx -y studium-mcp@latest --version` asks npm for the newest |
| Claude Code plugin | `claude plugin marketplace update holobiomicslab`, then `claude plugin update studium@holobiomicslab` |
| VS Code extension | from a marketplace, VS Code updates it; from a file, install the newer `.vsix` |
| Checkout | `git pull`, then `./setup.sh` |

Then restart or reconnect the MCP server in your assistant. A server file built or downloaded before the
update lacks recent tools without any other symptom: ask your assistant to call `get_server_info`, which
reports the version, whether the build is `source` or `bundled`, its build date and the tool list. Your
lessons and progress in `~/.studium` are not touched by an update.

## Remove your data

Your assistant can erase one lesson's progress with `forget_session`, only when you ask; it also
erases your cross-lesson profile and study record (your review schedule), and cannot be undone. Asked to
erase all your data, it erases every lesson's progress too. Its reply names what stays: the lessons in
your library and their prepared sources. To remove everything the assistant-side server kept, delete the
Studium home folder (`~/.studium` by default). In VS
Code, **Studium: Forget my data** erases what the extension keeps. Exported reports and your assistant's own
history are separate copies. More in [Privacy and limits](../concepts/privacy-and-limits.md).
