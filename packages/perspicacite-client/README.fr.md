[English](README.md) · Français

# @studium/perspicacite-client

Des clients pour Perspicacité, le service de recherche bibliographique (un serveur MCP) qui fournit des passages de sources avec citations exactes. Le paquet Python `perspicacite_mcp` est celui qui sert : il interroge des bases de connaissances, construit la base d'un cours et normalise les réponses de passages. Un petit client TypeScript résout des DOI, avec un mode simulé. La page [littérature et preuves](../../docs/teach/literature-and-evidence.fr.md) montre comment les enseignants s'en servent.

## Place dans l'ensemble

Appelé côté Python : le planificateur (`services/planner`), `tools/experience_packet.py passages` et le banc d'évaluation (`eval/`). Quand le service est désactivé ou injoignable, l'appelant reçoit un statut `offline` explicite plutôt qu'une erreur. Voir l'[architecture](../../docs/develop/architecture.fr.md).

## API publique

Python, [python/perspicacite_mcp](python/perspicacite_mcp/__init__.py) :

| Export | Rôle |
|---|---|
| `make_perspicacite_client()` | Fabrique à partir de l'environnement ; renvoie `None` sauf si `STUDIUM_PERSPICACITE_ENABLED=on`. |
| `LivePerspicaciteClient`, `MockPerspicaciteClient`, `PerspicaciteClient` | `search(query=, mode=, max_results=, kb_names=)` et `ensure_course_kb(...)`. |
| `passages.normalize_passage_envelope(payload)` | Une seule forme pour les réponses récentes et anciennes ; une recherche échouée reste `offline`. |

TypeScript, [src/index.ts](src/index.ts) :

| Export | Rôle |
|---|---|
| `makePerspicaciteClient(opts)` | `{ mode: "mock" }` ou `{ mode: "real", mcpUrl, timeoutMs?, maxRetries? }`. |
| `PerspicaciteClient`, `ResolveResult`, `DOIMetadata`, `OfflineResult` | `resolveDOI(doi)` renvoie les métadonnées ou `{ status: "offline" }`. |

## Exemple

```bash
STUDIUM_PERSPICACITE_ENABLED=on STUDIUM_PERSPICACITE_MODE=mock \
  .venv/bin/python -c "import sys; sys.path.insert(0, 'packages/perspicacite-client/python'); \
from perspicacite_mcp import make_perspicacite_client; \
print(make_perspicacite_client().search(query='mass spectrometry', mode='basic', max_results=3))"
```

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `STUDIUM_PERSPICACITE_ENABLED` | non définie | `on` active le client. |
| `STUDIUM_PERSPICACITE_MODE` | non définie | `mock` renvoie des données de test. |
| `PERSPICACITE_MCP_URL` | `http://localhost:8000/mcp` | Adresse du serveur. |
| `PERSPICACITE_DOMAIN_KB` | vide | Base interrogée quand aucune n'est nommée. |
| `STUDIUM_PERSPICACITE_CACHE`, `STUDIUM_PERSPICACITE_CACHE_DIR` | `on`, `.cache/perspicacite` | Cache disque des réponses de recherche. |

## Invariants

- Hors ligne est un statut, pas une exception : une leçon construite sans le service le dit.
- Le client TypeScript réessaie avec un délai croissant (200 ms, 400 ms, 800 ms), puis renvoie `offline`.

## Tests

```bash
.venv/bin/python -m pytest packages/perspicacite-client -q
pnpm --filter @studium/perspicacite-client test
```

Les tests en direct sont ignorés tant que `PERSPICACITE_MCP_URL` et `PERSPICACITE_DOMAIN_KB` ne sont pas définies.

## Dépendances

- Dépend de : la bibliothèque standard Python ; `fetch` global côté TypeScript.
- Utilisé par : `services/planner`, `tools/experience_packet.py`, `eval/`. Aucun paquet TypeScript n'importe le client TypeScript aujourd'hui.

## Statut

Client Python actif ; client TypeScript minimal et inutilisé. Paquet privé de l'espace de travail.
