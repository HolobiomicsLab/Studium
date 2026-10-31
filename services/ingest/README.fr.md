[English](README.md) · Français

# Service d'ingestion

Un service FastAPI qui transforme un support de cours en manifeste de corpus pour le planner : un PDF
(texte extrait avec PyMuPDF), un fichier BibTeX facultatif dont les DOI peuvent être résolus, ou une
capsule de reproduction ASB (ABS). Il alimente l'[Author Studio](../../apps/author-web/README.fr.md)
hérité.

| | |
|---|---|
| Statut | **hérité** (parcours de recherche ; la création actuelle passe par `tools/experience_packet.py` ou une conversation) |
| Lancer | `uvicorn ingest_app:app` (voir ci-dessous) |
| Port | 8000 par convention |
| Appelé par | l'Author Studio (`NEXT_PUBLIC_INGEST_SERVICE_URL`) |
| Appelle | un résolveur de DOI seulement si `doi_mode=real` |
| Tests | `.venv/bin/python -m pytest services/ingest` |

## Le lancer

Depuis la racine du dépôt, avec l'environnement virtuel installé :

```bash
.venv/bin/python -m uvicorn ingest_app:app --app-dir services/ingest --host 127.0.0.1 --port 8000
```

[`ingest_app.py`](ingest_app.py) est l'application testée. [`app.py`](app.py) en est une copie plus
ancienne qui n'offre que la route PDF.

## Routes

| Route | Entrée | Sortie |
|---|---|---|
| `POST /ingest/corpus` | multipart : `pdf` (obligatoire), `bib` (BibTeX facultatif), `target` (public visé, par exemple `L3`), `keywords`, `doi_mode` (`offline` par défaut, ou `real`) | un `IngestManifest` avec une référence par source |
| `POST /ingest/abs-capsule` | JSON : `capsule_path`, `task_card_ids` | un manifeste de corpus dont la référence principale est la capsule |

`/ingest/corpus` n'existe que si les dépendances PDF s'importent ; sans elles, le service démarre quand
même et propose la route capsule. En mode `offline`, les DOI sont notés non résolus, sans appel réseau.

## Tests

```bash
.venv/bin/python -m pytest services/ingest
```

## Voir aussi

- [Planner](../planner/README.fr.md), l'étape suivante de ce parcours
- [Créer une leçon](../../docs/teach/author-a-lesson.fr.md), le parcours actuel
