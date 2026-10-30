English · [Français](README.fr.md)

# @studium/perspicacite-client

Clients for Perspicacité, the literature-search service (an MCP server) that supplies source passages with exact quotes. The Python package `perspicacite_mcp` is the one in use: it searches knowledge bases, builds a course knowledge base and normalizes passage responses. A small TypeScript client resolves DOIs, with a mock mode. See [literature and evidence](../../docs/teach/literature-and-evidence.md) for how teachers use it.

## Where it sits

Called by the Python side: the planner (`services/planner`), `tools/experience_packet.py passages` and the evaluation harness (`eval/`). When the service is disabled or unreachable, callers get an explicit `offline` status instead of an error. See [architecture](../../docs/develop/architecture.md).

## Public API

Python, [python/perspicacite_mcp](python/perspicacite_mcp/__init__.py):

| Export | Purpose |
|---|---|
| `make_perspicacite_client()` | Factory from the environment; returns `None` unless `STUDIUM_PERSPICACITE_ENABLED=on`. |
| `LivePerspicaciteClient`, `MockPerspicaciteClient`, `PerspicaciteClient` | `search(query=, mode=, max_results=, kb_names=)` and `ensure_course_kb(...)`. |
| `passages.normalize_passage_envelope(payload)` | One shape for live and legacy passage responses; a failed retrieval stays `offline`. |

TypeScript, [src/index.ts](src/index.ts):

| Export | Purpose |
|---|---|
| `makePerspicaciteClient(opts)` | `{ mode: "mock" }` or `{ mode: "real", mcpUrl, timeoutMs?, maxRetries? }`. |
| `PerspicaciteClient`, `ResolveResult`, `DOIMetadata`, `OfflineResult` | `resolveDOI(doi)` returns metadata or `{ status: "offline" }`. |

## Example

```bash
STUDIUM_PERSPICACITE_ENABLED=on STUDIUM_PERSPICACITE_MODE=mock \
  .venv/bin/python -c "import sys; sys.path.insert(0, 'packages/perspicacite-client/python'); \
from perspicacite_mcp import make_perspicacite_client; \
print(make_perspicacite_client().search(query='mass spectrometry', mode='basic', max_results=3))"
```

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `STUDIUM_PERSPICACITE_ENABLED` | unset | `on` enables the client. |
| `STUDIUM_PERSPICACITE_MODE` | unset | `mock` returns fixtures. |
| `PERSPICACITE_MCP_URL` | `http://localhost:8000/mcp` | Server endpoint. |
| `PERSPICACITE_DOMAIN_KB` | empty | Knowledge base searched when none is named. |
| `STUDIUM_PERSPICACITE_CACHE`, `STUDIUM_PERSPICACITE_CACHE_DIR` | `on`, `.cache/perspicacite` | On-disk cache of search responses. |

## Invariants

- Offline is a status, not an exception, so a lesson built without the service says so.
- The TypeScript client retries with exponential backoff (200 ms, 400 ms, 800 ms) and then returns `offline`.

## Test

```bash
.venv/bin/python -m pytest packages/perspicacite-client -q
pnpm --filter @studium/perspicacite-client test
```

The live tests are skipped unless `PERSPICACITE_MCP_URL` and `PERSPICACITE_DOMAIN_KB` are set.

## Depends on / used by

- Depends on: the Python standard library; global `fetch` for TypeScript.
- Used by: `services/planner`, `tools/experience_packet.py`, `eval/`. No TypeScript package imports the TypeScript client today.

## Status

Python client active; TypeScript client kept small and unused. Private workspace package.
