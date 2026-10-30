[English](README.md) · Français

# @studium/lesson-schema

Le premier format de leçon, version 1 (ADR 003), conservé pour référence. C'est un JSON Schema ([src/schema.json](src/schema.json)) validé par Ajv, avec un miroir Pydantic. Les leçons jouables utilisent désormais le format bundle de [`@studium/lesson-bundle-schema`](../lesson-bundle-schema/README.fr.md) : écrivez le nouveau code pour ce paquet-là, pas pour celui-ci.

## Place dans l'ensemble

Hors du chemin d'exécution actuel. Rien dans l'espace de travail ne l'importe ; le registre des modulateurs du schéma bundle ne le cite que pour rappeler que les modulateurs M4 et M5 y ont été déclarés sans jamais être implémentés. Voir l'[architecture](../../docs/develop/architecture.fr.md) et les [modulateurs](../../docs/concepts/modulators.fr.md).

## API publique

Depuis [src/index.ts](src/index.ts) :

| Export | Rôle |
|---|---|
| `validateLesson(data)` | Validation Ajv (JSON Schema 2020-12, avec formats) ; renvoie `{ valid: true, data }` ou `{ valid: false, errors }`. |
| `loadSchema()` | L'objet JSON Schema. |
| `ValidationResult` | Le type du résultat. |

Python : `lesson_schema`, dans [python/](python/lesson_schema/__init__.py), le même modèle en Pydantic.

## Exemple

```ts
import { validateLesson } from "@studium/lesson-schema";

const result = validateLesson({ schema_version: "1.0", id: "x" });
if (!result.valid) console.log(result.errors.map((e) => e.message));
```

## Invariants

- `schema_version` vaut `"1.0"` ; une leçon exige au moins un objectif et une scène, et les champs inconnus au premier niveau sont refusés.
- Le paquet exporte son `dist/` compilé : construisez-le avant de l'importer depuis un autre paquet.

## Tests

```bash
pnpm --filter @studium/lesson-schema test
.venv/bin/python -m pytest packages/lesson-schema -q
```

## Dépendances

- Dépend de : `ajv`, `ajv-formats` (TypeScript), `pydantic` (Python).
- Utilisé par : aucun paquet de l'espace de travail.

## Statut

Hérité, remplacé par `@studium/lesson-bundle-schema`. Conservé pour que les anciens documents et tests restent valides. Paquet privé de l'espace de travail.
