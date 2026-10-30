// packages/lesson-bundle-schema/src/errors.ts
//
// Readable validation errors (RT-7). A ZodError from LessonBundleSchema, or from any schema built
// on this package (the conversational LessonDraft), becomes a list of {path, message, hint} that an
// author — a person or an agent — can act on, instead of the raw issue dump ("invalid_literal …").
import { z } from "zod";

/** One validation problem. `path` is the dotted path of the offending value ("scenes.2.choices"),
 * "" for the root; `hint` says what to change and is never empty. */
export interface BundleIssue {
  path: string;
  message: string;
  hint: string;
}

/** The ISO 8601 shape `validated_at` and other date-times must have. */
const DATETIME_EXAMPLE = "2026-10-30T12:00:00Z";

/**
 * Turn `error` into readable issues, in Zod's order. `input` (the value that was parsed) lets a
 * report name the offending value where Zod does not, e.g. an unknown scene type. A failed plain
 * union is reported through its closest alternative: one whose type matched the value (it failed
 * deeper), then the one with the fewest issues.
 */
export function formatBundleError(error: z.ZodError, input?: unknown): BundleIssue[] {
  return error.issues.flatMap((issue) => readableIssues(issue, input));
}

function readableIssues(issue: z.ZodIssue, input: unknown): BundleIssue[] {
  if (issue.code === z.ZodIssueCode.invalid_union) {
    const at = issue.path.join(".");
    const typeMismatch = (branch: z.ZodError): number =>
      branch.issues.some((inner) => inner.code === z.ZodIssueCode.invalid_type && inner.path.join(".") === at) ? 1 : 0;
    const closest = [...issue.unionErrors]
      .sort((a, b) => typeMismatch(a) - typeMismatch(b) || a.issues.length - b.issues.length)[0];
    if (closest && closest.issues.length > 0) return formatBundleError(closest, input);
  }
  const path = issue.path.join(".");
  return [{ path, ...describe(issue, input) }];
}

function describe(issue: z.ZodIssue, input: unknown): { message: string; hint: string } {
  const field = issue.path.at(-1);
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      return issue.received === z.ZodParsedType.undefined
        ? { message: "required field is missing", hint: typeof field === "string" ? `add "${field}"` : "add the missing value" }
        : { message: `expected ${issue.expected}, got ${issue.received}`, hint: `give ${article(issue.expected)} ${issue.expected}` };
    case z.ZodIssueCode.invalid_literal:
      return {
        message: `must be ${JSON.stringify(issue.expected)}, got ${JSON.stringify(issue.received)}`,
        hint: field === "schema_version"
          ? `this Studium reads lesson bundles ${String(issue.expected)}; a bundle written for another version needs a matching Studium or a migration`
          : `write ${JSON.stringify(issue.expected)}`,
      };
    case z.ZodIssueCode.invalid_union_discriminator:
      return {
        message: `${JSON.stringify(valueAt(input, issue.path))} is not a known ${String(field ?? "value")}`,
        hint: `use one of: ${issue.options.map(String).join(", ")} (a newer bundle may need a newer Studium)`,
      };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: `${JSON.stringify(issue.received)} is not allowed`, hint: `use one of: ${issue.options.map(String).join(", ")}` };
    case z.ZodIssueCode.unrecognized_keys:
      return issue.keys.length === 1
        ? { message: `unknown field: ${issue.keys[0]}`, hint: "remove it or fix its spelling" }
        : { message: `unknown fields: ${issue.keys.join(", ")}`, hint: "remove them or fix their spelling" };
    case z.ZodIssueCode.too_small:
      return bound(issue, "at least", valueAt(input, issue.path));
    case z.ZodIssueCode.too_big:
      return bound(issue, "at most", valueAt(input, issue.path));
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === "datetime") {
        return { message: "must be an ISO 8601 date-time", hint: `write it like ${DATETIME_EXAMPLE}` };
      }
      if (issue.validation === "url") return { message: "must be a URL", hint: "write an absolute http(s) URL" };
      return { message: issue.message, hint: "fix the text to the expected format" };
    default:
      return { message: issue.message, hint: "change the value as the message says" };
  }
}

/** A size bound in words: items for arrays, characters for strings, plain values for numbers. */
function bound(issue: z.ZodTooSmallIssue | z.ZodTooBigIssue, side: "at least" | "at most", value: unknown): { message: string; hint: string } {
  const limit = Number("minimum" in issue ? issue.minimum : issue.maximum);
  const quantity = issue.exact ? "exactly" : side;
  if (issue.type === "array") {
    const has = Array.isArray(value) ? `, has ${value.length}` : "";
    return { message: `needs ${quantity} ${limit} ${limit === 1 ? "item" : "items"}${has}`, hint: side === "at least" ? "add items" : "remove items" };
  }
  if (issue.type === "string") {
    if (side === "at least" && limit === 1 && !issue.exact) return { message: "must not be empty", hint: "write the text" };
    return { message: `needs ${quantity} ${limit} characters`, hint: side === "at least" ? "write a longer text" : "shorten the text" };
  }
  const strict = !issue.inclusive && !issue.exact;
  const relation = side === "at least" ? (strict ? "greater than" : "at least") : (strict ? "less than" : "at most");
  return { message: `must be ${issue.exact ? "exactly" : relation} ${limit}`, hint: side === "at least" ? "raise the value" : "lower the value" };
}

function article(word: string): string {
  return /^[aeiou]/.test(word) ? "an" : "a";
}

/** The value at `path` inside `input`, or undefined when the path does not lead anywhere. */
function valueAt(input: unknown, path: ReadonlyArray<string | number>): unknown {
  let current = input;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}
