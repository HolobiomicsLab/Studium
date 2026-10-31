English · [Français](README.fr.md)

# @studium/lesson-schema

The first lesson format, version 1 (ADR 003), kept for reference. It is a JSON Schema ([src/schema.json](src/schema.json)) validated with Ajv, with a Pydantic mirror. Playable lessons now use the lesson bundle format of [`@studium/lesson-bundle-schema`](../lesson-bundle-schema/README.md); write new code against that package, not this one.

## Where it sits

Outside the current runtime path. Nothing in the workspace imports it; the bundle schema's modulator registry cites it only to record that modulators M4 and M5 were declared here and never implemented. See [architecture](../../docs/develop/architecture.md) and [modulators](../../docs/concepts/modulators.md).

## Public API

From [src/index.ts](src/index.ts):

| Export | Purpose |
|---|---|
| `validateLesson(data)` | Ajv (JSON Schema 2020-12, with formats) validation; returns `{ valid: true, data }` or `{ valid: false, errors }`. |
| `loadSchema()` | The JSON Schema object. |
| `ValidationResult` | The result type. |

Python: `lesson_schema` in [python/](python/lesson_schema/__init__.py), the same model in Pydantic.

## Example

```ts
import { validateLesson } from "@studium/lesson-schema";

const result = validateLesson({ schema_version: "1.0", id: "x" });
if (!result.valid) console.log(result.errors.map((e) => e.message));
```

## Invariants

- `schema_version` is `"1.0"`; a lesson needs at least one learning objective and one scene, and unknown top-level fields are rejected.
- The package exports its compiled `dist/`; build it before importing it from another package.

## Test

```bash
pnpm --filter @studium/lesson-schema test
.venv/bin/python -m pytest packages/lesson-schema -q
```

## Depends on / used by

- Depends on: `ajv`, `ajv-formats` (TypeScript), `pydantic` (Python).
- Used by: none in the workspace.

## Status

Legacy, superseded by `@studium/lesson-bundle-schema`. Kept so older documents and tests still validate. Private workspace package.
