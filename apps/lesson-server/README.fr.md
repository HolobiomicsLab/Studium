[English](README.md) · Français

# Serveur de leçons Studium (HTTP)

Un hôte Fastify autour du même `SessionHost` que le [serveur MCP](../lesson-mcp/README.fr.md). C'est le
serveur du [tableau de bord enseignant](../teacher-dashboard/README.fr.md) (salles entre pairs, graphe de
cours) et une façon simple de piloter une leçon en HTTP. Les corrigés sont expurgés sur toutes les routes.

| | |
|---|---|
| Statut | **maintenu**, expurgé (décision D6) |
| Lancer | `pnpm --filter @studium/lesson-server start` |
| Port | 8010 sur 127.0.0.1 (`PORT`) |
| Dépend de | [`@studium/lesson-session-host`](../../packages/lesson-session-host), [`@studium/lesson-session`](../../packages/lesson-session) |
| Appelé par | le tableau de bord enseignant (`LESSON_SERVER_BASE_URL`) |
| Tests | `pnpm --filter @studium/lesson-server test` |

Les surfaces apprenant prises en charge sont le harnais conversationnel (MCP) et le panneau VS Code. Ce
serveur n'expose qu'une partie des méthodes de l'hôte (ni mesure des indices, ni révisions espacées, ni
informations serveur) : considérez ses routes apprenant comme expérimentales.

## Le lancer

Depuis la racine du dépôt :

```bash
BUNDLES_ROOT="$PWD/fixtures" pnpm --filter @studium/lesson-server start
```

| Variable | Valeur par défaut | Rôle |
|---|---|---|
| `BUNDLES_ROOT` | le dossier de travail du processus | où les `bundle_ref` sont résolus |
| `PORT` | `8010` | port ; le serveur écoute toujours sur 127.0.0.1 |
| `LITELLM_BASE_URL` | vide | adresse du modèle juge ; vide signifie pas de juge |

## Routes

| Route | Rôle |
|---|---|
| `POST /sessions`, `GET /sessions/:id`, `POST /sessions/:id/respond` | ouvrir, lire et répondre à une leçon |
| `POST /sessions/:id/turns`, `GET /sessions/:id/state`, `DELETE /sessions/:id` | tour de tuteur, état, effacement |
| `POST /rooms`, `POST /rooms/join`, `POST /rooms/:id/ratings`, `POST /rooms/:id/close`, `GET /rooms/:id` | salles entre pairs |
| `GET /courses?ref=` | manifeste de cours analysé (le graphe de leçons du tableau de bord) |

La [référence de l'API HTTP](../../docs/reference/http-api.fr.md) décrit les requêtes et les réponses.

## Ce qu'il n'envoie jamais

Chaque scène renvoyée passe par la même projection que le serveur MCP (`publicPresentation` /
`publicTransition`) : ni `correct`, ni `feedback_*`, `hints`, `claims`, `key_points` ou `model_*` avant
la réponse. Le retour mérité arrive dans le `verdict` de la transition, après la réponse.
[`src/server.redaction.test.ts`](src/server.redaction.test.ts) parcourt tout le fil sur chaque route
qui renvoie une scène.

## Limites

- Aucune authentification au-delà de la clé enseignant d'une salle : gardez le serveur sur 127.0.0.1.
- `GET /rooms/:id` lit la clé enseignant dans l'URL (`teacher_key`) ; elle devrait passer en en-tête.

## Tests

```bash
pnpm --filter @studium/lesson-server test
```

## Voir aussi

- [Architecture](../../docs/develop/architecture.fr.md)
- [Suivre une classe](../../docs/teach/follow-a-class.fr.md)
