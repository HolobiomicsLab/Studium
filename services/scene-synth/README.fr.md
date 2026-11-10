[English](README.md) · Français

# Service scene-synth

Un service FastAPI à deux rôles. Son rôle de recherche transforme un plan de leçon approuvé en scènes et
en bundle de leçon (`bundler.py`, utilisé aussi par le [banc d'évaluation](../../eval/README.fr.md)). Son
rôle actif héberge la modération des contributions des apprenants : un apprenant propose une question de
quiz, ses pairs la testent, l'enseignant décide ; une question approuvée devient un bundle communautaire
à côté du cours.

| | |
|---|---|
| Statut | **hérité** pour la synthèse ; les routes de contributions servent le tableau de bord enseignant, maintenu |
| Lancer | `uvicorn scene_synth_app:app` (voir ci-dessous) |
| Port | 8002 par convention ; CORS autorise `localhost:3000` (l'application apprenant), jamais sur la route de décision |
| Appelé par | le [tableau de bord enseignant](../../apps/teacher-dashboard/README.fr.md) (`SCENE_SYNTH_BASE_URL`), l'[Author Studio](../../apps/author-web/README.fr.md) hérité |
| Appelle | un modèle seulement par un orchestrateur injecté par une intégration |
| Tests | `.venv/bin/python -m pytest services/scene-synth` |

## Le lancer

Depuis la racine du dépôt, avec l'environnement virtuel installé :

```bash
COMMUNITY_BUNDLES_ROOT=/tmp/studium-community LEARNER_PSEUDONYM_SECRET="$(openssl rand -hex 32)" \
  STUDIUM_REVIEW_TOKEN="$STUDIUM_REVIEW_TOKEN" \
  .venv/bin/python -m uvicorn scene_synth_app:app --app-dir services/scene-synth --host 127.0.0.1 --port 8002
```

## Routes

| Route | Rôle |
|---|---|
| `GET /health` | disponibilité |
| `POST /scenes/synthesize` | transformer un `lesson_plan` en bundle ; **503** tant qu'aucun orchestrateur n'est configuré |
| `POST /scenes/critique-eval` | noter une critique au regard d'affirmations et d'une grille ; **503** tant qu'aucun évaluateur n'est configuré |
| `POST /learner-items/validate`, `POST /learner-items`, `GET /learner-items` | vérifier, déposer et lister les questions proposées pour un cours |
| `POST /learner-items/{item_id}/peer-review`, `GET /learner-items/{item_id}/peer-signals` | résultats des tests par les pairs ; les signaux destinés à l'enseignant sont protégés par un plancher de trois évaluateurs |
| `POST /learner-items/{item_id}/decide` | la décision de l'enseignant, avec `Authorization: Bearer $STUDIUM_REVIEW_TOKEN` et sans `Origin` de navigateur ; une question approuvée est écrite en `community-<id>.zip` (avec son enregistrement `approval.json`) sous `<racine>/<course_id>/community/`, et chaque décision est ajoutée à `learner_decisions.jsonl` |

Lancer l'application ne suffit pas pour synthétiser : il n'existe pas d'orchestrateur par défaut, et un
schéma de requête n'est pas une barrière d'approbation. Le `lesson.json` canonique du cours n'est jamais
modifié.

## Configuration

| Variable | Valeur par défaut | Rôle |
|---|---|---|
| `BUNDLES_ROOT` | le `fixtures/` du dépôt | racine contenant un `<course_id>/lesson.json` par cours |
| `COMMUNITY_BUNDLES_ROOT` | la valeur de `BUNDLES_ROOT` | où sont écrits les bundles communautaires approuvés ; définissez-la pour garder un clone propre |
| `LEARNER_DATA_ROOT` | `/tmp/studium-learner-items` | magasin des questions déposées |
| `LEARNER_PSEUDONYM_SECRET` | `dev-insecure-secret` | clé HMAC des pseudonymes d'auteur ; fixez la vôtre hors démonstration |
| `STUDIUM_REVIEW_TOKEN` | aucune | jeton de relecture enseignant (32 caractères au moins) exigé pour une décision ; absent, toute décision est refusée avec `503` |

## Tests

```bash
.venv/bin/python -m pytest services/scene-synth
```

[`tests/e2e/test_full_pipeline.py`](tests/e2e/test_full_pipeline.py) montre comment injecter un client de
modèle (un faux déterministe qui renvoie du JSON préparé par type de scène).

## Voir aussi

- [Contributions des apprenants](../../docs/teach/learner-contributions.fr.md)
- [Format du bundle de leçon](../../docs/reference/lesson-bundle.fr.md)
