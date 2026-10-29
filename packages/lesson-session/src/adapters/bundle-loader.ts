import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { LessonBundleSchema, type LessonBundle } from "@studium/lesson-bundle-schema";

const LEGACY_OPTIONAL_NULL_KEYS = new Set(["abs_asset", "doi"]);

/** Remove only nulls written for known legacy optional fields. */
function normalizeLegacyOptionalNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeLegacyOptionalNulls);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null && LEGACY_OPTIONAL_NULL_KEYS.has(k)) continue;
      out[k] = normalizeLegacyOptionalNulls(v);
    }
    return out;
  }
  return value;
}

/** Load and validate a zipped lesson bundle. */
export async function loadBundleZip(path: string): Promise<LessonBundle> {
  const buf = await readFile(path);
  const files = unzipSync(new Uint8Array(buf));
  const entry = files["lesson.json"];
  if (!entry) throw new Error(`bundle ${path} missing lesson.json`);
  return LessonBundleSchema.parse(normalizeLegacyOptionalNulls(JSON.parse(strFromU8(entry))));
}

/** Validate an already decoded lesson bundle. */
export function loadBundleJson(raw: unknown): LessonBundle {
  return LessonBundleSchema.parse(normalizeLegacyOptionalNulls(raw));
}
