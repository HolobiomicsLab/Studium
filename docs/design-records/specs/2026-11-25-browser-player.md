# Browser player, local first

Date: 2026-11-25. Status: proposed by an agent, approved for a first slice by the owner on 2026-11-25
(open decision 5 of INT-STUDIUM-064). Language: English. This record is not rewritten afterwards.

## Problem

A university staff member who tried Studium reported that using it "requires a strong habit of development
environments": a lesson is played in VS Code or through an AI assistant. A learner or a teacher who has
neither should be able to play an existing lesson in an ordinary web browser.

Scope decided by the lead: **local first**. The player runs on the person's own machine or on a classroom
workstation and listens on the loopback interface only. Hosted, multi-user deployment is out of scope; what
it would need is listed at the end.

## Decision

The local lesson API of `apps/lesson-mcp` (`http.ts`) gains an optional **player**: a page and a small set of
routes under `/play`, served by the same process, on the same port, on 127.0.0.1. The page is the shared
renderer (`apps/lesson-panel-ui/src/artifact-pane.js`) driven by the existing MCP Apps bridge
(`bridge-mcp-app.js`), to which the page hands an object that has the shape of an MCP App but carries each
tool call over `fetch` to the player routes. The routes call the panel tools of the same server code
(`open_lesson_panel`, `get_panel_view`, `panel_action`, `list_lessons`) through an in-process MCP client,
so the browser receives exactly the public `PanelView` the VS Code pane and the MCP Apps panels receive:
the same honesty notices (who wrote the answer key, whether a judge assessed), hints, recall ratings,
language switch, help ladder, map and completion, drawn by the same code.

`npx -y studium-mcp play [folder]` starts it in one command: it generates a token, starts the server on a
free loopback port, prints the address and opens the default browser.

### What the browser player changes in the view, and why

- The session is negotiated as a native **pane** (rank 3), as the VS Code extension does: no client
  capability can declare a browser page.
- `ask` (hand a question to the assistant) is removed from the view's actions and refused by the routes:
  there is no assistant on this page, and the notice "ask in the conversation" would be false. The
  renderer already draws no « Ask a question » button when the view does not offer it.
- `learner_id` is never taken from the browser: every call uses the server's default learner
  (`STUDIUM_LEARNER_ID`, else `anonymous`). One player process is one learner.
- `open_lesson_panel` opens only a `bundle_ref` that `list_lessons` lists (the lessons folder and the
  library), whatever path the request names.

## Alternatives rejected

| Alternative | Why not now |
|---|---|
| A second process serving static files, talking to the API | Two ports, two lifetimes, and the API refuses browser origins by design; CORS would have to be widened. |
| Call the `/v1` lesson operations from the browser and compose the view in the page | Forks the panel composition (`packages/lesson-panel`) into the browser; the honesty notices would be recomputed elsewhere and could drift from the pane. |
| Export a new panel API from `panel-tools.ts` instead of an in-process MCP client | Changes a module the MCP server and its tests pin; the in-process client reuses it unchanged, at the cost of one JSON round trip per call. |
| Token in a cookie set by a one-time launch link | Safer against browser history, but a cookie is an ambient credential, so every route would then need CSRF protection; a header-only token does not. Kept as an option for a hosted version. |
| Serve the science libraries from the local server (offline) | Would add some 3 MB to the npm package. The page uses the same pinned, SRI-checked CDN files as the MCP Apps panel; without network, prose, quizzes and inline marked/KaTeX still work, charts and 3D fall back to their readable versions. |
| A Studium command in VS Code to open the player | Not needed for the target audience (people without VS Code); left for later. |

## How it starts

`studium-mcp play [folder] [--port N] [--no-open]` (and `pnpm --filter @studium/lesson-mcp play` in a
checkout):

1. Lessons are read from `folder` when given (it becomes `BUNDLES_ROOT`), and from the library
   `<STUDIUM_HOME>/library`. Progress is kept in `<STUDIUM_HOME>/data` unless `STUDIUM_EPHEMERAL=1`, as for
   the stdio server, so reopening a lesson resumes it at the first unfinished step.
2. A 256-bit token is generated for this run (`crypto.randomBytes`); it is never written to disk.
3. The server listens on `127.0.0.1` (port 0, chosen by the system, unless `--port`).
4. The address `http://127.0.0.1:<port>/play#token=<token>` is printed and opened with the platform's
   opener (`open`, `xdg-open`, `cmd /c start`), the URL passed as one argument, without a shell.
5. The process stops with its terminal (Ctrl+C). The token then means nothing.

## Security model

The threat is a web page in the same browser (cross-site requests, DNS rebinding) and another program or
user on the same machine. A learner reading the answer key is also a threat to the lesson's value.

- **Loopback only.** The server binds 127.0.0.1 and, as for `/v1`, refuses a connection whose local or
  remote address is not loopback.
- **Host check against DNS rebinding.** Every `/play` request must carry `Host: 127.0.0.1:<port>`,
  `localhost:<port>` or `[::1]:<port>`, with the port the server listens on. A rebinding page sends its
  own host name and is refused.
- **Origin check against cross-site requests.** Every `/play/api` request must carry an `Origin` equal to
  `http://<Host>`, and `Sec-Fetch-Site`, when the browser sends it, must be `same-origin`. A request with no
  `Origin` is refused on these routes (browsers always send one on a `POST`).
- **No CORS widening.** No route answers with `Access-Control-Allow-*`; `OPTIONS` is refused. The `/v1`
  routes keep refusing every request that has an `Origin`, unchanged.
- **Token.** The token travels in the address's fragment (`#token=`), which the browser never sends to a
  server, so it is not in a request line, a log or a `Referer`. The page reads it, removes it from the
  address bar with `history.replaceState`, and keeps it in `sessionStorage` (this tab, until it closes),
  not in `localStorage` or a cookie. Each `/play/api` call sends it as `Authorization: Bearer`, compared
  in constant time. The page itself (`GET /play`) carries no secret and needs no token.
- **Page headers.** `Content-Security-Policy`: `default-src 'none'`, scripts only by the hash of the page's
  inline script and from the pinned CDN, `connect-src 'self'`, `img-src 'self' data:`, `frame-ancestors
  'none'`, `base-uri 'none'`, `form-action 'none'`; `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `Cache-Control: no-store`. A script injected through lesson content could reach only this server.
- **Answer keys.** The browser receives only what the panel tools return: `publicPresentation` /
  `publicTransition` (`packages/lesson-session-host/src/public-scene.ts`) strip `correct`, `claims`,
  `key_points`, the `model_*` reveals and quiz feedback; grading stays on the server. A test checks that
  the view of an unanswered quiz carries no `correct` flag.
- **Narrow surface.** Four tools only; authoring, teacher, export and forget-by-learner tools are not
  reachable from the page. Erasing progress (`panel_action end`) is reachable, behind the panel's own
  confirmation, as in the pane.

Known limits of this model: the token is visible to the user's own processes while the opener runs (its
command line) and may stay in the browser's history entry for the first load on some browsers; anyone
with the user's session on the machine can already read the progress files. On a shared classroom
account, every student who uses the same login and the same `STUDIUM_HOME` shares one learner record.

## Not covered

- Hosted or multi-user use: sign-in, one identity per learner, isolation between learners, TLS, a
  reverse proxy, rate limits, persistent sessions across server restarts behind a load balancer, data
  protection (GDPR: legal basis, record of processing, retention, the right to erasure for each learner,
  a data-protection impact assessment for learning analytics), and an institutional hosting decision.
- Building a lesson: the player plays lessons; authoring still needs an assistant.
- Capsule reproduction (`run`): needs the VS Code terminal; the page says so, as the MCP Apps panel does.
- Asking the assistant (`ask`): there is none.
- A VS Code command to open the player, and a packaged desktop shortcut for classroom machines.
- Offline charts and molecules (CDN libraries; see above).
