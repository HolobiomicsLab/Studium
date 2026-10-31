English · [Français](README.fr.md)

# Planner service

A FastAPI service that turns a corpus manifest into a lesson plan, reviews it with a critic, and can
build a learning-workflow graph (LWG) with its ASTRA provenance record. The provenance it writes under
`.lwg/<course>/` is what the [Observatory](../observatory/README.md) displays.

| | |
|---|---|
| Status | **legacy** (research route; the supported authoring route is `tools/experience_packet.py` or a conversation) |
| Run | `uvicorn planner_app:app` with `STUDIUM_LLM_MODE` set (see below) |
| Port | 8001 by convention |
| Called by | the legacy [Author Studio](../../apps/author-web/README.md) (`NEXT_PUBLIC_PLANNER_SERVICE_URL`), `tools/e2e-a10.sh` |
| Calls | a LiteLLM endpoint in `litellm` mode; Perspicacité only when evidence enrichment is on |
| Tests | `.venv/bin/python -m pytest services/planner` |

## Run it

The planner answers `503` until a model mode is chosen. For a deterministic run without a model:

```bash
STUDIUM_LLM_MODE=mock .venv/bin/python -m uvicorn planner_app:app \
  --app-dir services/planner --host 127.0.0.1 --port 8001
```

The mock is canned research data, not a plan of your material. A real plan needs `STUDIUM_LLM_MODE=litellm`
and a LiteLLM endpoint. The minimal body of `POST /plan` is `{"manifest_id":"demo-local","target":"L1"}`;
the answer is a `PlanResponse` marked `critic_reviewed`, which is not a human validation.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `STUDIUM_LLM_MODE` | unset (the service answers 503) | `litellm` or `mock` |
| `LITELLM_BASE_URL` | `http://localhost:4000` | LiteLLM endpoint in `litellm` mode |
| `LITELLM_API_KEY` | empty | key for that endpoint |
| `STUDIUM_LWG_BUILD` | unset | `on` builds the LWG and its ASTRA set after each plan |
| `STUDIUM_LWG_OUT_DIR` | `.lwg` (relative to the working directory) | where course folders are written |
| `STUDIUM_EVIDENCE_ENRICH` | unset | `on` enriches the plan with evidence from Perspicacité |
| `STUDIUM_PERSPICACITE_ENABLED` | unset | `on` enables the Perspicacité client |
| `PERSPICACITE_MCP_URL` | `http://localhost:8000/mcp` | Perspicacité MCP endpoint (note: the ingest service uses port 8000 by convention too) |
| `PERSPICACITE_DOMAIN_KB` | empty | default knowledge base |

## Approve a generated course

A teacher can review and approve the claims of a generated course from the command line, with no GUI.
Run from `services/planner`:

```bash
../../.venv/bin/python -m provenance.approval_cli report --course-dir .lwg/<id>
../../.venv/bin/python -m provenance.approval_cli approve --course-dir .lwg/<id> \
  --approver <your ORCID or IRI> --decision approve --approved-at <ISO timestamp>
```

`--decision` also accepts `reject` and `hold` (the decision is recorded, every claim stays draft), and
`--selected-claim-ids` approves only the listed claims.

## Limits

- No CORS is configured for a direct JSON POST from the Author Studio at `localhost:3000`, so the browser
  flow needs a proxy.
- `services/planner/agents/` and `services/scene-synth/agents/` are two packages with the same top-level
  name; [`planner_paths.ensure_importable()`](planner_paths.py) puts this service first on `sys.path`.

## Tests

```bash
.venv/bin/python -m pytest services/planner
```

The ASTRA validator tests need the `astra` command line (`astra-tools`); CI also runs
`python tools/astra_validate_check.py`.
