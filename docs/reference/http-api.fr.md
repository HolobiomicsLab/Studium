[English](http-api.md) · Français

# API HTTP

Studium propose deux serveurs HTTP locaux. Utilisez l'**API de leçon** d'`apps/lesson-mcp` pour
piloter des leçons depuis un script ou un harnais sans MCP ; elle expose les mêmes opérations que
les [outils MCP](mcp-tools.fr.md). L'ancien **lesson-server** (`apps/lesson-server`) sert les salles
entre pairs et les pages de cours du tableau de bord enseignant. Les deux cachent les clés de
réponse : une scène est envoyée dans sa projection publique, jamais avec sa clé.

| | API de leçon | lesson-server |
|---|---|---|
| Démarrage | `pnpm --filter @studium/lesson-mcp api` | `pnpm --filter @studium/lesson-server start` |
| Adresse | `http://127.0.0.1:8130` (`STUDIUM_API_PORT`) | `http://127.0.0.1:8010` (`PORT`) |
| Authentification | jeton Bearer, boucle locale uniquement, origines de navigateur refusées | aucune (boucle locale uniquement) |
| Opérations | les 25 outils de leçon, avec découverte | sessions, salles entre pairs, cours |
| Relances | idempotentes avec `request_id` | aucune |

Aucun des deux n'est fait pour une classe sur Internet : ils n'écoutent que sur 127.0.0.1 et leurs
sessions appartiennent au processus en cours. Les identifiants de session ne passent pas de l'un à
l'autre.

## API de leçon

### La démarrer

```bash
export STUDIUM_API_TOKEN="$(openssl rand -hex 32)"   # au moins 32 caractères ; à partager avec les clients, jamais dans un chat ni dans Git
BUNDLES_ROOT="$PWD/fixtures" pnpm --filter @studium/lesson-mcp api
```

L'API n'appelle jamais de modèle sans `STUDIUM_API_LIVE=1` et `LITELLM_BASE_URL`. L'état de
l'apprenant reste en mémoire tant que `STUDIUM_DATA_DIR` n'est pas fixée (voir
[Configuration](configuration.fr.md)).

### L'appeler

| Route | Méthode | Rôle |
|---|---|---|
| `/health` | GET | `{schema: "studium/http/v1", status: "ready", sessions: "process-local"}` |
| `/v1/operations` | GET | Toutes les opérations : `name`, `description`, `mutating`, `requires_scene_id`, `input_schema` (JSON Schema) |
| `/v1/operations/<nom>` | POST | Exécute une opération. Le résultat a les mêmes champs que l'outil MCP, sans l'enveloppe MCP. |

Chaque requête porte `Authorization: Bearer <jeton>` ; le corps d'un POST est du JSON
(`content-type: application/json`, 1 Mio au plus) dans cette enveloppe :

```json
{
  "request_id": "start-001",
  "expected_scene_id": "s-intro",
  "arguments": { "bundle_ref": "capsule-judgment-demo/lesson.json", "learner_id": "local-student" }
}
```

| Champ | Quand |
|---|---|
| `arguments` | Toujours : les arguments de l'outil, vérifiés par son schéma. |
| `request_id` | Pour toute opération qui modifie l'état. Réutilisez-le, avec des arguments identiques, pour relancer sans risque : la réponse conservée est renvoyée et rien ne s'exécute deux fois. |
| `expected_scene_id` | `submit_response`, `submit_turn`, `submit_run_result`, `request_hint`, `record_experiment` : la scène à laquelle l'apprenant répond. Une scène qui a changé donne `409 stale_scene`. |

```bash
curl -s -H "Authorization: Bearer $STUDIUM_API_TOKEN" http://127.0.0.1:8130/v1/operations
curl -s -X POST -H "Authorization: Bearer $STUDIUM_API_TOKEN" -H 'content-type: application/json' \
  -d '{"request_id":"start-001","arguments":{"bundle_ref":"capsule-judgment-demo/lesson.json","learner_id":"local-student"}}' \
  http://127.0.0.1:8130/v1/operations/start_lesson_session
```

Le dépôt fournit aussi un petit client qui lit le jeton dans l'environnement et ne l'affiche
jamais :

```bash
pnpm --silent --filter @studium/lesson-mcp api:call health
pnpm --silent --filter @studium/lesson-mcp api:call operations
pnpm --silent --filter @studium/lesson-mcp api:call start_lesson_session /chemin/absolu/start.json
```

Les opérations en lecture seule (`get_*`, `explain_last_adaptation`, `list_community_bundles`)
n'exigent pas de `request_id` et sont recalculées à chaque appel. `forget_session` prend `session_id` ou
`learner_id`, comme par MCP ; avec `learner_id`, aucune session n'a besoin d'être ouverte, et une requête
rejouée sur l'une des sessions qu'il a fermées répond `410 forgotten`. Les outils d'étude, d'auteur et
d'enseignant ne sont pas servis ici dans cette version ; passez par MCP.

### Erreurs

Une erreur est un objet `{error, code}` avec ces statuts :

| Statut | Codes | Que faire |
|---|---|---|
| 400 | `invalid_json`, `invalid_input`, `request_id_required`, `scene_required`, `invalid_bundle` | Corriger la requête d'après le schéma de découverte ; rien n'a été enregistré. |
| 401, 403 | `unauthorized`, `local_only`, `origin_rejected` | Vérifier le jeton, et que le client est local et n'est pas un navigateur. |
| 404 | `not_found`, `session_not_found` | Route ou session inconnue (un redémarrage met fin à toutes les sessions). Ne pas inventer de reprise. |
| 409 | `stale_scene`, `request_conflict` | Relire la scène courante ; ou un `request_id` a été réutilisé avec un autre contenu. |
| 410 | `session_closed`, `forgotten` | La session a été fermée ou effacée ; en ouvrir une nouvelle, sans jamais recréer des données effacées. |
| 413, 415 | `body_too_large`, `media_type` | Envoyer du JSON de moins de 1 Mio ; passer les médias par référence. |
| 422 | `operation_failed` | Le moteur de leçon a refusé l'opération ; lire `error`. |
| 503 | `busy`, `receipt_limit` | Relancer avec le même `request_id` ; ou exporter puis redémarrer après 512 modifications (16 Mio de réponses conservées). |

Les opérations s'exécutent une à une. Après une erreur réseau, renvoyez le même fichier avec le
même `request_id` plutôt qu'une seconde réponse. Pour changer de harnais en cours de leçon,
transmettez l'adresse, le `session_id` et la langue, et commencez par `get_operator_context` ; ne
redémarrez pas la leçon.

## lesson-server

Un serveur Fastify pour le tableau de bord enseignant. Les réponses sont `{success, ok, ...}` en cas
de succès et `{success: false, ok: false, error}` sinon.

| Route | Méthode | Corps ou paramètres | Réponse |
|---|---|---|---|
| `/sessions` | POST | `{bundle_ref, learner_id?}` | `201 {session_id, presentation}` |
| `/sessions/:id` | GET | | `{presentation}` |
| `/sessions/:id/respond` | POST | `{input}` (une réponse, comme pour `submit_response`) | `{transition}` ; `409` si la session ne peut pas l'accepter |
| `/sessions/:id/turns` | POST | `{text}` | `{accepted: true}` |
| `/sessions/:id/state` | GET | | `{state}` |
| `/sessions/:id` | DELETE | | `{forgotten: true}` : efface la session |
| `/rooms` | POST | `{bundle_ref}` | `201`, la nouvelle salle entre pairs |
| `/rooms/join` | POST | `{join_code, session_id}` | la salle |
| `/rooms/:id/ratings` | POST | `{rater_session_id, target_session_id, passed, rating (1–5), helpful}` | l'évaluation |
| `/rooms/:id` | GET | `?teacher_key=` | l'état de la salle |
| `/rooms/:id/close` | POST | `{teacher_key}` | la salle fermée |
| `/courses` | GET | `?ref=` (un chemin sous `BUNDLES_ROOT`) | `{course}` : ordre du cours et prérequis |

Il n'a pas d'authentification : gardez-le sur une machine que vous contrôlez. Sa configuration
(`BUNDLES_ROOT`, `PORT`, `LITELLM_BASE_URL`) se trouve dans
[Configuration](configuration.fr.md#lesson-server).
