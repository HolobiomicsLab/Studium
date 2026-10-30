English · [Français](README.fr.md)

# Ingest service

A FastAPI service that turns course material into a corpus manifest for the planner: a PDF (text
extracted with PyMuPDF), an optional BibTeX file whose DOIs can be resolved, or an ASB reproduction
capsule (ABS). It feeds the legacy [Author Studio](../../apps/author-web/README.md).

| | |
|---|---|
| Status | **legacy** (research route; the current authoring route is `tools/experience_packet.py` or a conversation) |
| Run | `uvicorn ingest_app:app` (see below) |
| Port | 8000 by convention |
| Called by | the Author Studio (`NEXT_PUBLIC_INGEST_SERVICE_URL`) |
| Calls | a DOI resolver only when `doi_mode=real` |
| Tests | `.venv/bin/python -m pytest services/ingest` |

## Run it

From the repository root, with the virtual environment installed:

```bash
.venv/bin/python -m uvicorn ingest_app:app --app-dir services/ingest --host 127.0.0.1 --port 8000
```

[`ingest_app.py`](ingest_app.py) is the application the tests exercise. [`app.py`](app.py) is an older
copy that only offers the PDF route.

## Routes

| Route | Input | Output |
|---|---|---|
| `POST /ingest/corpus` | multipart: `pdf` (required), `bib` (optional BibTeX), `target` (audience, for example `L3`), `keywords`, `doi_mode` (`offline` by default, or `real`) | an `IngestManifest` with one reference per source |
| `POST /ingest/abs-capsule` | JSON: `capsule_path`, `task_card_ids` | a corpus manifest whose main reference is the capsule |

`/ingest/corpus` exists only when the PDF dependencies import; without them the service still starts and
offers the capsule route. In `offline` mode DOIs are recorded as unresolved, with no network call.

## Tests

```bash
.venv/bin/python -m pytest services/ingest
```

## See also

- [Planner](../planner/README.md), the next step of this route
- [Author a lesson](../../docs/teach/author-a-lesson.md), the current route
