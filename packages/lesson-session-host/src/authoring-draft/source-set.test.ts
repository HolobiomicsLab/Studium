import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthoringInputError, MAX_TOTAL_SOURCE_CHARS, prepareSources, readSourceSet, SOURCES_DIR } from "./source-set.js";
import { FRENCH_SOURCE, P1, P2, P3 } from "./test-fixtures.js";

const roots: string[] = [];
function library(): string {
  const root = mkdtempSync(join(tmpdir(), "authoring-sources-"));
  roots.push(root);
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("prepareSources", () => {
  it("cuts each source into passages p:<source>:<n> and stores the set in <library>/_sources", async () => {
    const root = library();
    const set = await prepareSources(root, [FRENCH_SOURCE], { goal: "distinguer les deux solidarités", language: "fr" });
    expect(set.source_set_id).toMatch(/^ss-[0-9a-f]{16}$/);
    expect(set.passages.map((passage) => passage.id)).toEqual([P1, P2, P3]);
    expect(set.passages.every((passage) => passage.source_id === "deux-formes-de-solidarite")).toBe(true);
    // The heading joined its section; whitespace runs (no-break spaces included) became one space.
    expect(set.passages[0]!.text.startsWith("# Deux formes de solidarité\n\nDans une société")).toBe(true);
    expect(set.passages[0]!.text).toContain("solidarité : elle tient");
    expect(set.dropped_short).toBe(0);
    const stored = JSON.parse(readFileSync(join(root, SOURCES_DIR, `${set.source_set_id}.json`), "utf8"));
    expect(stored).toMatchObject({
      schema: "studium-source-set/1", source_set_id: set.source_set_id, goal: "distinguer les deux solidarités",
      language: "fr", min_chars: 200, max_chars: 1200,
    });
    expect(stored.sources).toEqual([{
      source_id: "deux-formes-de-solidarite", title: "Deux formes de solidarité", url: "https://example.org/solidarite",
      license: "CC-BY-4.0", sha256: expect.stringMatching(/^[0-9a-f]{64}$/), chars: FRENCH_SOURCE.text.length, passages: 3,
    }]);
    expect(await readSourceSet(root, set.source_set_id)).toEqual(set);
  });

  it("records that a source is a conversation, and leaves a document's record and id as they were", async () => {
    const root = library();
    const document = await prepareSources(root, [FRENCH_SOURCE], { goal: "g", language: "fr" });
    const explicit = await prepareSources(root, [{ ...FRENCH_SOURCE, kind: "document" }], { goal: "g", language: "fr" });
    expect(explicit.source_set_id).toBe(document.source_set_id);
    expect(document.sources[0]).not.toHaveProperty("kind");
    const conversation = await prepareSources(root, [{ ...FRENCH_SOURCE, url: undefined, kind: "conversation" }], { goal: "g", language: "fr" });
    expect(conversation.sources[0]!.kind).toBe("conversation");
    expect(conversation.source_set_id).not.toBe(document.source_set_id);
    expect(await readSourceSet(root, conversation.source_set_id)).toEqual(conversation);
  });

  it("gives the same id for the same preparation and another for another goal", async () => {
    const root = library();
    const first = await prepareSources(root, [FRENCH_SOURCE], { goal: "g" });
    const again = await prepareSources(root, [FRENCH_SOURCE], { goal: "g" });
    const other = await prepareSources(root, [FRENCH_SOURCE], { goal: "autre" });
    expect(again.source_set_id).toBe(first.source_set_id);
    expect(other.source_set_id).not.toBe(first.source_set_id);
  });

  it("keeps two sources with the same title apart and records an unknown licence", async () => {
    const set = await prepareSources(library(), [FRENCH_SOURCE, { title: FRENCH_SOURCE.title, text: FRENCH_SOURCE.text }], {});
    expect(new Set(set.passages.map((passage) => passage.source_id))).toEqual(
      new Set(["deux-formes-de-solidarite", "deux-formes-de-solidarite-2"]),
    );
    expect(set.sources[1]).toMatchObject({ url: null, license: "unknown" });
  });

  it("refuses a source with no passage long enough, naming it", async () => {
    const error = await prepareSources(library(), [FRENCH_SOURCE, { title: "Note", text: "Trop court." }], {})
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AuthoringInputError);
    expect((error as AuthoringInputError).issues).toEqual([{
      path: "sources.1.text", message: "no passage of at least 200 characters",
      hint: "pass the full text of the source (the harness fetches it), not a title or a summary",
    }]);
  });

  it("caps one preparation at 200 000 characters in all: every passage comes back in that one tool result", async () => {
    expect(MAX_TOTAL_SOURCE_CHARS).toBe(200_000);
    const root = library();
    const sentence = "Une phrase de source assez longue pour remplir un passage entier. "; // 66 characters
    const part = (n: number) => ({ title: `Partie ${n}`, text: sentence.repeat(1700) }); // 112 200 characters each
    const error = await prepareSources(root, [part(1), part(2)], {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AuthoringInputError);
    expect((error as AuthoringInputError).issues).toEqual([{
      path: "sources", message: "have 224400 characters in all, at most 200000 in one preparation",
      hint: "pass only the chapters or sections the lesson is about: every passage comes back in this one tool result",
    }]);
    expect(existsSync(join(root, SOURCES_DIR))).toBe(false);
    // One source over the cap is named by its own path, once (no second issue for the total).
    const single = await prepareSources(root, [{ title: "Tout", text: sentence.repeat(3100) }], {}).catch((caught: unknown) => caught);
    expect((single as AuthoringInputError).issues).toEqual([{
      path: "sources.0.text", message: "has 204600 characters, at most 200000",
      hint: "pass the chapter or section the lesson is about",
    }]);
    // Just under the cap is prepared.
    const fits = await prepareSources(root, [part(1)], {});
    expect(fits.passages.length).toBeGreaterThan(50);
  });

  it("refuses a set id that is not one prepareSources made, before touching the disk", async () => {
    const root = library();
    for (const id of ["../etc/passwd", "ss-zz", "ss-0123456789abcdef/../../x"]) {
      const error = await readSourceSet(root, id).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(AuthoringInputError);
      expect((error as AuthoringInputError).issues[0]!.path).toBe("source_set_id");
    }
    const missing = await readSourceSet(root, "ss-0123456789abcdef").catch((caught: unknown) => caught);
    expect((missing as AuthoringInputError).issues[0]).toMatchObject({ path: "source_set_id", message: "no source set ss-0123456789abcdef in this library" });
    expect(existsSync(join(root, SOURCES_DIR))).toBe(false);
  });

  it("reads a damaged set file as unreadable, not as a crash", async () => {
    const root = library();
    const set = await prepareSources(root, [FRENCH_SOURCE], {});
    writeFileSync(join(root, SOURCES_DIR, `${set.source_set_id}.json`), "{ not json");
    const error = await readSourceSet(root, set.source_set_id).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AuthoringInputError);
    expect((error as AuthoringInputError).issues[0]).toMatchObject({ path: "source_set_id", message: `source set ${set.source_set_id} is unreadable` });
  });
});
