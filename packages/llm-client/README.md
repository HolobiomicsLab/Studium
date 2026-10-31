English · [Français](README.fr.md)

# @studium/llm-client

A small client for language models addressed by role. Code asks for a completion from an alias such as `studium/runtime-tutor`; a LiteLLM proxy (any OpenAI-compatible endpoint) maps the alias to a real model. A mock mode returns a fixed string, so tests and offline runs need no model at all.

## Where it sits

Used by the live adapters of [`@studium/lesson-session`](../lesson-session/README.md) (reasoning scorer, Socratic tutor). The endpoint comes from `LITELLM_BASE_URL`, read by the caller, not by this package (see [configuration](../../docs/reference/configuration.md)). See [architecture](../../docs/develop/architecture.md).

## Public API

From [src/index.ts](src/index.ts):

| Export | Purpose |
|---|---|
| `LLM_ALIASES` / `LLMAlias` | `studium/planner`, `studium/scene-synth`, `studium/critic`, `studium/teacher-review`, `studium/runtime-tutor`. |
| `LLMClient` | `complete(prompt, alias)` returns the model's text. |
| `makeLLMClient(opts)` | `{ mode: "mock" }` or `{ mode: "litellm", baseUrl, apiKey? }`. |
| `LLMClientOptions`, `MockClientOptions`, `LiteLLMClientOptions` | Option types. |

## Example

```ts
import { makeLLMClient } from "@studium/llm-client";

const llm = process.env.LITELLM_BASE_URL
  ? makeLLMClient({ mode: "litellm", baseUrl: process.env.LITELLM_BASE_URL, apiKey: process.env.LITELLM_API_KEY })
  : makeLLMClient({ mode: "mock" });

const text = await llm.complete("Explain a p-value in one sentence.", "studium/runtime-tutor");
```

## Invariants

- An alias outside `LLM_ALIASES` throws before any request is sent.
- The LiteLLM mode posts one user message to `<baseUrl>/v1/chat/completions` with `model` set to the alias; a non-2xx answer throws with the status and body.
- No timeout and no retry: callers add their own (the reasoning scorer gives up after 2 seconds).
- The package exports its compiled `dist/`; build it before importing it from another package.

## Test

```bash
pnpm --filter @studium/llm-client test
```

## Depends on / used by

- Depends on: nothing at run time (global `fetch`, Node 20 or later).
- Used by: `@studium/lesson-session`.

## Status

Active. Private workspace package, not published to npm.
