import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { LessonBundleSchema, type LessonBundle } from "@studium/lesson-bundle-schema";

/**
 * Recursively strip explicit `null` values from a JSON-parsed object so that
 * Zod `.optional()` fields (which reject null) are treated as absent.
 * Older fixture versions (m6) may have `"abs_asset": null` or `"doi": null`.
 */
function stripNulls(value: unknown): unknown {
  if (value === null) return undefined;
  if (Array.isArray(value)) return value.map(stripNulls);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const stripped = stripNulls(v);
      if (stripped !== undefined) out[k] = stripped;
    }
    return out;
  }
  return value;
}

export async function loadBundleZip(path: string): Promise<LessonBundle> {
  const buf = await readFile(path);
  const files = unzipSync(new Uint8Array(buf));
  const entry = files["lesson.json"];
  if (!entry) throw new Error(`bundle ${path} missing lesson.json`);
  return LessonBundleSchema.parse(stripNulls(JSON.parse(strFromU8(entry))));
}

export function loadBundleJson(raw: unknown): LessonBundle {
  return LessonBundleSchema.parse(stripNulls(raw));
}
