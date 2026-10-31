[English](README.md) · Français

# @studium/reasoning-scorer

Étiquette une intervention de l'apprenant dans une discussion selon le type de raisonnement qu'elle montre : `justification`, `hypothesis` (hypothèse), `question`, `counterexample` (contre-exemple) ou `synthesis` (synthèse), avec une confiance entre 0 et 1. Un modèle de langage fait la lecture ; ce paquet rédige la consigne dans la langue de la leçon et rejette toute réponse à laquelle il ne peut se fier. L'étiquette alimente les analyses de l'enseignant ; ce n'est jamais une note.

## Place dans l'ensemble

[`@studium/lesson-session`](../lesson-session/README.fr.md) l'appelle par son port `ReasoningScorer` (`LiteLLMReasoningScorer` en direct, un substitut sinon) sur les scènes de discussion, et émet le résultat comme événement `reasoning_signal` ([`@studium/telemetry-events`](../telemetry-events/README.fr.md)). Voir l'[architecture](../../docs/develop/architecture.fr.md).

## API publique

Depuis [src/index.ts](src/index.ts) :

| Export | Rôle |
|---|---|
| `classifyTurn(llm, turn, topic, { timeoutMs?, locale? })` | Renvoie `{ signal, confidence }` ou `null`. |
| `ReasoningSignal` | Les cinq étiquettes. |
| `ClassifyResult` | `{ signal, confidence }`. |
| `LLMClient` | Tout objet doté de `complete(prompt): Promise<string>`. |
| `ScorerLocale` | `"fr"` ou `"en"`. |

## Exemple

```ts
import { classifyTurn } from "@studium/reasoning-scorer";

const llm = { complete: async () => '{"signal": "hypothesis", "confidence": 0.7}' };
const result = await classifyTurn(llm, "Et si ce pic était un adduit ?", "Spectres de masse", { locale: "fr" });
// { signal: "hypothesis", confidence: 0.7 }
```

## Invariants

- `null` signifie « non mesuré » : le modèle a dépassé le délai (2 secondes par défaut), n'a pas renvoyé du JSON strict, a cité une étiquette inconnue ou une confiance hors de [0, 1].
- Le texte de l'apprenant est inséré tel quel dans la consigne ; `$&` et les motifs du même genre ne sont pas interprétés.
- La langue par défaut est `fr` ; passez celle de la leçon pour que l'intervention soit lue dans sa langue.

## Tests

```bash
pnpm --filter @studium/reasoning-scorer test
```

## Dépendances

- Dépend de : rien à l'exécution.
- Utilisé par : `@studium/lesson-session`, `apps/student-runtime`.

## Statut

Actif. Paquet de l'espace de travail, non publié sur npm.
