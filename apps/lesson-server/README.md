English · [Français](README.fr.md)

# Studium lesson server (HTTP)

A Fastify host around the same `SessionHost` as the [MCP server](../lesson-mcp/README.md). It is the
backend of the [teacher dashboard](../teacher-dashboard/README.md) (peer rooms, course graph) and a
plain-HTTP way to drive a lesson. Answer keys are redacted on every route.

| | |
|---|---|
| Status | **maintained**, redacted (decision D6) |
| Run | `pnpm --filter @studium/lesson-server start` |
| Port | 8010 on 127.0.0.1 (`PORT`) |
| Depends on | [`@studium/lesson-session-host`](../../packages/lesson-session-host), [`@studium/lesson-session`](../../packages/lesson-session) |
| Called by | the teacher dashboard (`LESSON_SERVER_BASE_URL`) |
| Tests | `pnpm --filter @studium/lesson-server test` |

The supported learner surfaces are the chat harness (MCP) and the VS Code pane. This server covers a
subset of the host's methods (no hint metering, no spaced-review endpoint, no server info), so treat its
learner routes as experimental.

## Run it

From the repository root:

```bash
BUNDLES_ROOT="$PWD/fixtures" pnpm --filter @studium/lesson-server start
```

| Variable | Default | Meaning |
|---|---|---|
| `BUNDLES_ROOT` | the process's working directory | where `bundle_ref` values are resolved |
| `PORT` | `8010` | port; the server always binds 127.0.0.1 |
| `LITELLM_BASE_URL` | empty | judge model endpoint; empty means no judge |

## Routes

| Route | Purpose |
|---|---|
| `POST /sessions`, `GET /sessions/:id`, `POST /sessions/:id/respond` | open, read and answer a lesson |
| `POST /sessions/:id/turns`, `GET /sessions/:id/state`, `DELETE /sessions/:id` | tutor turn, state, erase |
| `POST /rooms`, `POST /rooms/join`, `POST /rooms/:id/ratings`, `POST /rooms/:id/close`, `GET /rooms/:id` | peer rooms |
| `GET /courses?ref=` | parsed course manifest (the dashboard's lesson graph) |

The [HTTP API reference](../../docs/reference/http-api.md) documents the request and response shapes.

## What it never sends

Every scene it returns goes through the same projection as the MCP server (`publicPresentation` /
`publicTransition`): no `correct` flag, no `feedback_*`, `hints`, `claims`, `key_points` or `model_*`
before the learner has answered. The earned feedback arrives on the transition's `verdict` after the
answer. [`src/server.redaction.test.ts`](src/server.redaction.test.ts) walks the whole wire on every
route that returns a scene.

## Limits

- There is no authentication beyond a room's teacher key, so keep the server on 127.0.0.1.
- `GET /rooms/:id` reads the teacher key from the query string (`teacher_key`); it belongs in a header.

## Tests

```bash
pnpm --filter @studium/lesson-server test
```

## See also

- [Architecture](../../docs/develop/architecture.md)
- [Follow a class](../../docs/teach/follow-a-class.md)
