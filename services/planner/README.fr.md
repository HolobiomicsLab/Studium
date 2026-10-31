[English](README.md) · Français

# Service planner

Un service FastAPI qui transforme un manifeste de corpus en plan de leçon, le fait relire par un
critique et peut construire un graphe de parcours d'apprentissage (LWG) avec son enregistrement de
provenance ASTRA. La provenance qu'il écrit sous `.lwg/<cours>/` est celle qu'affiche
l'[Observatory](../observatory/README.fr.md).

| | |
|---|---|
| Statut | **hérité** (parcours de recherche ; la création prise en charge passe par `tools/experience_packet.py` ou une conversation) |
| Lancer | `uvicorn planner_app:app` avec `STUDIUM_LLM_MODE` défini (voir ci-dessous) |
| Port | 8001 par convention |
| Appelé par | l'[Author Studio](../../apps/author-web/README.fr.md) hérité (`NEXT_PUBLIC_PLANNER_SERVICE_URL`), `tools/e2e-a10.sh` |
| Appelle | une adresse LiteLLM en mode `litellm` ; Perspicacité seulement si l'enrichissement par les preuves est actif |
| Tests | `.venv/bin/python -m pytest services/planner` |

## Le lancer

Le planner répond `503` tant qu'aucun mode de modèle n'est choisi. Pour une exécution déterministe sans
modèle :

```bash
STUDIUM_LLM_MODE=mock .venv/bin/python -m uvicorn planner_app:app \
  --app-dir services/planner --host 127.0.0.1 --port 8001
```

Le mode `mock` renvoie des données de recherche figées, pas un plan de votre support. Un vrai plan
demande `STUDIUM_LLM_MODE=litellm` et une adresse LiteLLM. Le corps minimal de `POST /plan` est
`{"manifest_id":"demo-local","target":"L1"}` ; la réponse est un `PlanResponse` marqué
`critic_reviewed`, ce qui ne vaut pas validation humaine.

## Configuration

| Variable | Valeur par défaut | Rôle |
|---|---|---|
| `STUDIUM_LLM_MODE` | non défini (le service répond 503) | `litellm` ou `mock` |
| `LITELLM_BASE_URL` | `http://localhost:4000` | adresse LiteLLM en mode `litellm` |
| `LITELLM_API_KEY` | vide | clé pour cette adresse |
| `STUDIUM_LWG_BUILD` | non défini | `on` construit le LWG et son ensemble ASTRA après chaque plan |
| `STUDIUM_LWG_OUT_DIR` | `.lwg` (relatif au dossier de travail) | où les dossiers de cours sont écrits |
| `STUDIUM_EVIDENCE_ENRICH` | non défini | `on` enrichit le plan de preuves issues de Perspicacité |
| `STUDIUM_PERSPICACITE_ENABLED` | non défini | `on` active le client Perspicacité |
| `PERSPICACITE_MCP_URL` | `http://localhost:8000/mcp` | adresse MCP de Perspicacité (attention : le service d'ingestion utilise aussi le port 8000 par convention) |
| `PERSPICACITE_DOMAIN_KB` | vide | base de connaissances par défaut |

## Approuver un cours généré

Un enseignant peut relire et approuver les affirmations d'un cours généré en ligne de commande, sans
interface graphique. Depuis `services/planner` :

```bash
../../.venv/bin/python -m provenance.approval_cli report --course-dir .lwg/<id>
../../.venv/bin/python -m provenance.approval_cli approve --course-dir .lwg/<id> \
  --approver <votre ORCID ou IRI> --decision approve --approved-at <horodatage ISO>
```

`--decision` accepte aussi `reject` et `hold` (la décision est enregistrée, toutes les affirmations
restent à l'état de brouillon), et `--selected-claim-ids` n'approuve que les affirmations listées.

## Limites

- Aucun CORS n'est configuré pour un POST JSON direct depuis l'Author Studio sur `localhost:3000` : le
  parcours navigateur demande un proxy.
- `services/planner/agents/` et `services/scene-synth/agents/` sont deux paquets de même nom de premier
  niveau ; [`planner_paths.ensure_importable()`](planner_paths.py) place ce service en tête de `sys.path`.

## Tests

```bash
.venv/bin/python -m pytest services/planner
```

Les tests du validateur ASTRA demandent la ligne de commande `astra` (`astra-tools`) ; la CI lance aussi
`python tools/astra_validate_check.py`.
