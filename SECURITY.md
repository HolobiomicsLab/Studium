English · [Français](SECURITY.fr.md)

# Security policy

This page tells you how to report a vulnerability privately, what Studium trusts and what it does not, and how it protects learner data and keys.

## Report a vulnerability

Report privately, never in a public issue, pull request or discussion.

1. On this repository, open the **Security** tab and choose **Report a vulnerability** (GitHub private vulnerability reporting).
2. Describe the affected surface (VS Code extension, MCP server, HTTP API, lesson-server, teacher dashboard, Observatory, Python tools), the revision, the steps to reproduce and the impact you observed.
3. Do not include real learner data or a live API key. A minimal lesson bundle that reproduces the problem is the most useful attachment.

If private reporting is not available to you, open an issue that asks a maintainer for a private contact and contains no detail of the problem. The maintainers acknowledge a report, keep you informed while it is fixed, and can credit you in the changelog if you wish.

## Supported versions

Studium is a research prototype in its 0.x versions. Fixes go to the `dev` branch and then to `main`, and into the next release. Older releases and revisions are not patched.

## What Studium trusts, and what it does not

| Input | Trusted? | How it is handled |
|---|---|---|
| A lesson bundle (`lesson.json`) | Data, not code | Read only inside its configured root; a path that leaves the root is refused. Answer keys are never sent to the learner before the answer, on any host (MCP, file channel, HTTP) |
| A bundle's reproduction command | Not trusted until the learner agrees | The VS Code extension shows the command, its packages and its folder and asks before running it. The consent is tied to a SHA-256 fingerprint of the bundle file and of those fields: any change asks again |
| Markdown, SVG and figures in a lesson | Not trusted | The pane renders Markdown with raw HTML escaped, then through an allowlist sanitizer; SVG loses scripts, styles, embedded objects and images; relative images are replaced by a placeholder |
| A learner-supplied pattern in a reproduction | Not trusted | Evaluated with a time limit |
| Sources given to `prepare_sources` | Data | Capped at 20 sources and 200 000 characters; quotes must match a passage character for character |
| The AI harness and its tools | Outside Studium | Studium does not control what the assistant does with its own tools; the harness's permissions and approvals apply |

## The VS Code pane

The lesson pane runs under a strict Content Security Policy: `default-src 'none'`, scripts only with a nonce generated for each render, styles and fonts from the extension (and the CDN in CDN mode), and images from the extension or `data:` URIs (plus `https:` in CDN mode). The viewer libraries (KaTeX, marked, Vega, 3Dmol and others) are vendored by `pnpm --filter studium-vscode vendor`; when the CDN mode is used instead, each library is loaded from jsDelivr with a subresource-integrity hash equal to the vendored file.

## The HTTP API

`pnpm --filter @studium/lesson-mcp api` listens on `127.0.0.1` only. It refuses non-loopback connections, browser origins and non-local `Host` headers, and requires a bearer token of at least 32 characters in `STUDIUM_API_TOKEN`. The legacy `lesson-server` strips answer keys from every learner projection.

## Decisions on learner contributions

`POST /learner-items/{id}/decide` on scene-synth publishes a learner's item to the class, so it is a teacher act. It requires a bearer token of at least 32 characters in `STUDIUM_REVIEW_TOKEN`, distinct from any course id and compared in constant time; unset or shorter, every decision is refused (`503`). It refuses any request carrying a browser `Origin` (`403`) and grants no CORS access. The teacher dashboard holds the token on its server and calls scene-synth from there; the browser posts only the decision to the dashboard. The token is never logged, echoed in an error or written to the decision log. An approved item carries an `approval.json` record bound to the sha256 of its `lesson.json`.

Two secrets guard this path, one per leg. `STUDIUM_REVIEW_TOKEN` stands between the dashboard's server and scene-synth. `STUDIUM_DASHBOARD_ACCESS_CODE`, at least 16 characters, stands between the teacher's browser and the dashboard: with it set, every dashboard page and API route needs a session obtained at `/login`, a signed cookie (`HttpOnly`, `SameSite=Strict`, `Secure` over https) that lasts 12 hours and whose key is derived from the code, so changing the code ends every session. The code is compared in constant time and never logged or echoed. Sign-in accepts only same-origin requests and answers `429` after 10 wrong codes in 5 minutes. The decision route checks the session itself: without an access code it refuses every decision (`503`), without a valid session it answers `401`. Unset, the dashboard stays readable by anyone who can reach its port, the lesson review pages and class aggregates included; keep it on `localhost`.

The limits are plain. There is one shared code per dashboard, not one account per teacher. The reviewer's name on an approval is declared by the teacher who types it, not authenticated. The sign-in throttle is counted per server process and starts again when the process restarts. Over plain http on a network, the code and the cookie travel in clear: use https, or stay on `localhost`.

## Learner data

- **Local first.** Progress is kept on the learner's machine: `~/.studium/data` for the MCP server (`STUDIUM_HOME`, `STUDIUM_DATA_DIR`), the extension's own storage in VS Code. `STUDIUM_EPHEMERAL=1` keeps everything in memory.
- **Pseudonyms.** On-disk learner folders are named by an HMAC pseudonym, never by the raw learner id. The secret is `STUDIUM_PSEUDO_SECRET` or a per-install file `<data dir>/.studium-secret` created with mode 0600.
- **Erasure.** The `forget_session` tool and the **Studium: Forget my data** command delete the learner's progress. `end_session` closes a session and keeps progress.
- **Telemetry.** Sending telemetry requires the learner's consent. Class reports are aggregated and suppressed below five learners; the floor cannot be lowered from the tool.

[Privacy and limits](docs/concepts/privacy-and-limits.md) explains what this protects against and what it does not; read it before a class pilot.

## Keys and secrets

- Model access is configured through environment variables (`LITELLM_BASE_URL`, `LITELLM_API_KEY`, `LITELLM_MODEL`). Studium works without them; open answers are then compared with the reference instead of judged.
- Never commit a key, a token, a pseudonym secret or learner data. Keep them in your environment or in a git-ignored file.
- If a key was exposed, revoke it with its provider first, then report the exposure.
