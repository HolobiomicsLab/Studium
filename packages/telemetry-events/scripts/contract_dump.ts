// contract_dump.ts — print the Zod union's wire contract as JSON for the TS/Python parity gate:
//   { "<type literal>": { "<field>": "required" | "optional" } }
// "optional" = the emitter may omit it (zod .optional() or .default()). The Python side of the
// gate (tests/test_contract_parity.py) builds the same summary from the Pydantic union and diffs.
//   Run: tsx packages/telemetry-events/scripts/contract_dump.ts
import { TelemetryEventSchema } from "../src/events.js";

const summary: Record<string, Record<string, "required" | "optional">> = {};
for (const option of TelemetryEventSchema.options) {
  const shape = (option as { shape: Record<string, unknown> }).shape;
  const typeLiteral = (shape.type as { value: string }).value;
  const fields: Record<string, "required" | "optional"> = {};
  for (const [name, field] of Object.entries(shape)) {
    if (name === "type") continue;
    fields[name] = (field as { isOptional(): boolean }).isOptional() ? "optional" : "required";
  }
  summary[typeLiteral] = fields;
}
console.log(JSON.stringify(summary, null, 2));
