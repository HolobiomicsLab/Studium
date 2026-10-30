English · [Français](README.fr.md)

# @studium/reasoning-scorer

Labels one learner turn in a discussion with the kind of reasoning it shows: `justification`, `hypothesis`, `question`, `counterexample` or `synthesis`, with a confidence between 0 and 1. A language model does the reading; this package writes the prompt in the lesson's language and refuses any answer it cannot trust. The label feeds teacher analytics; it is never a grade.

## Where it sits

[`@studium/lesson-session`](../lesson-session/README.md) calls it through its `ReasoningScorer` port (`LiteLLMReasoningScorer` in live mode, a stub otherwise) on discussion scenes, and emits the result as a `reasoning_signal` event ([`@studium/telemetry-events`](../telemetry-events/README.md)). See [architecture](../../docs/develop/architecture.md).

## Public API

From [src/index.ts](src/index.ts):

| Export | Purpose |
|---|---|
| `classifyTurn(llm, turn, topic, { timeoutMs?, locale? })` | Returns `{ signal, confidence }` or `null`. |
| `ReasoningSignal` | The five labels. |
| `ClassifyResult` | `{ signal, confidence }`. |
| `LLMClient` | Any object with `complete(prompt): Promise<string>`. |
| `ScorerLocale` | `"fr"` or `"en"`. |

## Example

```ts
import { classifyTurn } from "@studium/reasoning-scorer";

const llm = { complete: async () => '{"signal": "hypothesis", "confidence": 0.7}' };
const result = await classifyTurn(llm, "Maybe the peak is an adduct?", "Mass spectra", { locale: "en" });
// { signal: "hypothesis", confidence: 0.7 }
```

## Invariants

- `null` means "not measured": the model timed out (2 seconds by default), returned something other than strict JSON, named an unknown label, or gave a confidence outside [0, 1].
- The learner's text is inserted literally into the prompt; `$&` and similar patterns are not expanded.
- The default locale is `fr`; pass the lesson's language so the turn is read in it.

## Test

```bash
pnpm --filter @studium/reasoning-scorer test
```

## Depends on / used by

- Depends on: nothing at run time.
- Used by: `@studium/lesson-session`, `apps/student-runtime`.

## Status

Active. Workspace package, not published to npm.
