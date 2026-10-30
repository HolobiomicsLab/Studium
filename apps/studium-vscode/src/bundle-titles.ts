// bundle-titles.ts — the concept titles of a lesson bundle, by id, read on the extension side so the pane names
// concepts (review due, completion lists) by title, never by bare id (W4 review). A bundle is a lesson.json
// file, a folder holding one, or a .zip holding one at its root (a community bundle, community-<item>.zip, as
// the scene-synth decide_item path writes it and the host's loadBundleZip reads it). The .zip is read with
// node:zlib only: the end-of-central-directory record, the central directory, then the one local entry.
// Pure: no VS Code import.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
/** The end record is 22 bytes plus a comment of at most 65 535 bytes. */
const EOCD_SEARCH = 22 + 0xffff;

/** The bytes of one entry of a zip archive, or null when it is absent, encrypted, ZIP64 or compressed by a
 * method other than stored (0) or deflate (8). Throws on a truncated archive; callers catch. */
export function zipEntry(zip: Buffer, name: string): Buffer | null {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - EOCD_SEARCH); i--) {
    if (zip.readUInt32LE(i) === EOCD) { end = i; break; }
  }
  if (end < 0) return null;
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(at) !== CENTRAL) return null;
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const localAt = zip.readUInt32LE(at + 42);
    if (zip.toString("utf8", at + 46, at + 46 + nameLength) === name) {
      if (flags & 1 || size === 0xffffffff || zip.readUInt32LE(localAt) !== LOCAL) return null;
      const start = localAt + 30 + zip.readUInt16LE(localAt + 26) + zip.readUInt16LE(localAt + 28);
      const data = zip.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      return null;
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

/** The lesson.json text of a bundle path (file, folder or .zip). Throws when it cannot be read. */
function lessonText(bundlePath: string): string {
  if (statSync(bundlePath).isDirectory()) return readFileSync(join(bundlePath, "lesson.json"), "utf8");
  if (bundlePath.toLowerCase().endsWith(".zip")) {
    const entry = zipEntry(readFileSync(bundlePath), "lesson.json");
    if (!entry) throw new Error(`${bundlePath} holds no readable lesson.json`);
    return entry.toString("utf8");
  }
  return readFileSync(bundlePath, "utf8");
}

/** The concept titles of a bundle, by id (an empty title falls back to the id); empty when the bundle cannot
 * be read, and the pane then shows ids without their "concept:" prefix. */
export function readConceptTitles(bundlePath: string): Record<string, string> {
  try {
    const bundle = JSON.parse(lessonText(bundlePath)) as { concepts?: unknown } | null;
    const concepts = Array.isArray(bundle?.concepts) ? bundle.concepts as Array<{ id?: unknown; title?: unknown } | null> : [];
    return Object.fromEntries(concepts
      .filter((c): c is { id: string; title?: unknown } => typeof c?.id === "string")
      .map((c) => [c.id, typeof c.title === "string" && c.title ? c.title : c.id]));
  } catch { return {}; }
}
