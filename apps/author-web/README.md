English · [Français](README.fr.md)

# Author Studio (legacy)

The first authoring interface: upload a PDF, get a lesson plan from the planner, edit its titles and
export it; plus two learner-as-author pages where a student proposes a quiz item (`/studio`) and peers
test it (`/peer`). The app shows a "legacy" banner. Current lessons are prepared from a conversation or
with `tools/experience_packet.py`, and reviewed in the [teacher dashboard](../teacher-dashboard/README.md).

| | |
|---|---|
| Status | **legacy** (decision D6; banner in the app) |
| Run | `pnpm --filter @studium/author-web dev` |
| Port | 3000 |
| Calls | ingest (8000), planner (8001), scene-synth (8002) |
| Tests | `pnpm --filter @studium/author-web test` |

## Run it

```bash
pnpm --filter @studium/author-web dev
```

Open `http://localhost:3000`. The pages:

| Page | What it does |
|---|---|
| `/` | upload a PDF; calls ingestion, then the planner |
| `/plan/<id>` | edit the plan title and scene titles; **Valider et exporter** (validate and export) downloads the JSON |
| `/studio` | a learner proposes a quiz item, validated by scene-synth |
| `/peer` | peers take and rate a classmate's item |

**Valider et exporter** marks the plan `approved` and fills `validated_by` in the downloaded file only; it
does not record a server-side approval and does not start synthesis.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `NEXT_PUBLIC_INGEST_SERVICE_URL` | `http://localhost:8000` | [ingest service](../../services/ingest/README.md) |
| `NEXT_PUBLIC_PLANNER_SERVICE_URL` | `http://localhost:8001` | [planner](../../services/planner/README.md) |
| `NEXT_PUBLIC_SCENE_SYNTH_SERVICE_URL` | `http://localhost:8002` | [scene-synth](../../services/scene-synth/README.md) |

## Limits

- The services must be started and configured separately. The planner answers 503 without a configured
  model, and it does not set CORS for a direct JSON POST from `localhost:3000`, so the browser flow is
  blocked without a proxy.
- `POST /scenes/synthesize` answers 503 until an orchestrator is configured, so the plan cannot be turned
  into a lesson from this app.
- The interface is in French.

## Tests

```bash
pnpm --filter @studium/author-web test
pnpm --filter @studium/author-web typecheck
```

## See also

- [Author a lesson](../../docs/teach/author-a-lesson.md), the current route
- [Learner contributions](../../docs/teach/learner-contributions.md)
