[English](README.md) · Français

# @studium/llm-client

Un petit client pour modèles de langage désignés par leur rôle. Le code demande une complétion à un alias comme `studium/runtime-tutor` ; un proxy LiteLLM (ou tout point d'accès compatible OpenAI) associe l'alias à un vrai modèle. Un mode simulé renvoie une chaîne fixe : les tests et les exécutions hors ligne n'ont besoin d'aucun modèle.

## Place dans l'ensemble

Utilisé par les adaptateurs en direct de [`@studium/lesson-session`](../lesson-session/README.fr.md) (évaluateur de raisonnement, tuteur socratique). L'adresse vient de `LITELLM_BASE_URL`, lue par l'appelant et non par ce paquet (voir la [configuration](../../docs/reference/configuration.fr.md)). Voir l'[architecture](../../docs/develop/architecture.fr.md).

## API publique

Depuis [src/index.ts](src/index.ts) :

| Export | Rôle |
|---|---|
| `LLM_ALIASES` / `LLMAlias` | `studium/planner`, `studium/scene-synth`, `studium/critic`, `studium/teacher-review`, `studium/runtime-tutor`. |
| `LLMClient` | `complete(prompt, alias)` renvoie le texte du modèle. |
| `makeLLMClient(opts)` | `{ mode: "mock" }` ou `{ mode: "litellm", baseUrl, apiKey? }`. |
| `LLMClientOptions`, `MockClientOptions`, `LiteLLMClientOptions` | Types d'options. |

## Exemple

```ts
import { makeLLMClient } from "@studium/llm-client";

const llm = process.env.LITELLM_BASE_URL
  ? makeLLMClient({ mode: "litellm", baseUrl: process.env.LITELLM_BASE_URL, apiKey: process.env.LITELLM_API_KEY })
  : makeLLMClient({ mode: "mock" });

const text = await llm.complete("Expliquez une p-valeur en une phrase.", "studium/runtime-tutor");
```

## Invariants

- Un alias hors de `LLM_ALIASES` lève une erreur avant tout envoi.
- Le mode LiteLLM envoie un message utilisateur à `<baseUrl>/v1/chat/completions`, avec `model` égal à l'alias ; une réponse hors 2xx lève une erreur avec le code et le corps.
- Ni délai maximal ni nouvelle tentative : c'est à l'appelant de les ajouter (l'évaluateur de raisonnement abandonne après 2 secondes).
- Le paquet exporte son `dist/` compilé : construisez-le avant de l'importer depuis un autre paquet.

## Tests

```bash
pnpm --filter @studium/llm-client test
```

## Dépendances

- Dépend de : rien à l'exécution (`fetch` global, Node 20 ou plus).
- Utilisé par : `@studium/lesson-session`.

## Statut

Actif. Paquet privé de l'espace de travail, non publié sur npm.
