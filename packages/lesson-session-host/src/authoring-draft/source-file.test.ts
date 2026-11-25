// prepare_sources from a local file (INT-STUDIUM-064, change 1): a source given by `path` is read by
// Studium itself, so the passages come from the bytes on disk and the set records the file's real path,
// size and sha256. The rules a path must pass are pinned here: a regular UTF-8 text file, outside
// Studium's own data folder and outside the usual places of secrets.
import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AuthoringInputError, MAX_SOURCE_CHARS, prepareSources, readSourceSet, SOURCES_DIR, type SourceFilePolicy,
} from "./source-set.js";
import { FRENCH_SOURCE, P1, P2, P3 } from "./test-fixtures.js";

const dirs: string[] = [];
function folder(prefix = "authoring-file-"): string {
  // realpath: on macOS the temporary folder is reached through the /var -> /private/var link.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** A library, a Studium home holding it, a learner folder with one Markdown source, and the policy. */
function setup() {
  const home = folder("authoring-home-");
  const library = join(home, "library");
  mkdirSync(library, { recursive: true });
  const learner = folder("authoring-learner-");
  const file = join(learner, "solidarite.md");
  writeFileSync(file, FRENCH_SOURCE.text, "utf8");
  const policy: SourceFilePolicy = { base: learner, home: learner, refusedRoots: [home] };
  return { home, library, learner, file, policy };
}

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

async function issuesOf(library: string, sources: Parameters<typeof prepareSources>[1], policy?: SourceFilePolicy) {
  const error = await prepareSources(library, sources, { files: policy }).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(AuthoringInputError);
  return (error as AuthoringInputError).issues;
}

describe("prepareSources with a source given by path", () => {
  it("cuts the file into the same passages as its text and records its real path, size and sha256", async () => {
    const { library, file, policy } = setup();
    const fromText = await prepareSources(folder(), [{ title: FRENCH_SOURCE.title, text: FRENCH_SOURCE.text }], {});
    const fromFile = await prepareSources(library, [{ title: FRENCH_SOURCE.title, path: file }], { files: policy });
    expect(fromFile.passages).toEqual(fromText.passages);
    expect(fromFile.passages.map((passage) => passage.id)).toEqual([P1, P2, P3]);
    const bytes = readFileSync(file);
    expect(fromFile.sources).toEqual([{
      source_id: "deux-formes-de-solidarite", title: FRENCH_SOURCE.title, url: null, license: "unknown",
      sha256: sha256(FRENCH_SOURCE.text), chars: FRENCH_SOURCE.text.length, passages: 3,
      file: { path: file, bytes: bytes.length, sha256: sha256(bytes) },
    }]);
    // A set from a file is another set than the same text pasted: the file is part of its provenance.
    expect(fromFile.source_set_id).not.toBe(fromText.source_set_id);
    const stored = JSON.parse(readFileSync(join(library, SOURCES_DIR, `${fromFile.source_set_id}.json`), "utf8"));
    expect(stored.sources[0].file).toEqual({ path: file, bytes: bytes.length, sha256: sha256(bytes) });
    expect(await readSourceSet(library, fromFile.source_set_id)).toEqual(fromFile);
  });

  it("names the source after the file when no title is given, and keeps url and licence", async () => {
    const { library, file, policy } = setup();
    const set = await prepareSources(library, [{ path: file, url: "https://example.org/solidarite", license: "CC-BY-4.0" }], { files: policy });
    expect(set.sources[0]).toMatchObject({ source_id: "solidarite", title: "solidarite", url: "https://example.org/solidarite", license: "CC-BY-4.0" });
    expect(set.passages[0]!.id).toBe("p:solidarite:1");
  });

  it("reads a relative path from the base, ~/ from the home, and records the absolute path", async () => {
    const { library, learner, policy } = setup();
    mkdirSync(join(learner, "cours"));
    writeFileSync(join(learner, "cours", "notes.txt"), FRENCH_SOURCE.text, "utf8");
    const relative = await prepareSources(library, [{ path: "cours/notes.txt" }], { files: policy });
    const tilde = await prepareSources(library, [{ path: "~/cours/notes.txt" }], { files: policy });
    expect(relative.sources[0]!.file!.path).toBe(join(learner, "cours", "notes.txt"));
    expect(tilde.sources[0]!.file!.path).toBe(join(learner, "cours", "notes.txt"));
  });

  it("follows a link to its target and records the target", async () => {
    const { library, learner, file, policy } = setup();
    const link = join(learner, "lien.md");
    symlinkSync(file, link);
    const set = await prepareSources(library, [{ path: link }], { files: policy });
    expect(set.sources[0]!.file!.path).toBe(file);
  });

  it("strips a UTF-8 byte order mark from the text and counts it in the bytes of the file", async () => {
    const { library, learner, policy } = setup();
    const file = join(learner, "bom.md");
    writeFileSync(file, `\uFEFF${FRENCH_SOURCE.text}`, "utf8");
    const set = await prepareSources(library, [{ path: file }], { files: policy });
    expect(set.passages[0]!.text.startsWith("# Deux formes")).toBe(true);
    expect(set.sources[0]!.file!.bytes).toBe(Buffer.byteLength(FRENCH_SOURCE.text, "utf8") + 3);
    expect(set.sources[0]!.file!.sha256).toBe(sha256(readFileSync(file)));
  });

  describe("refusals, each on sources.<n>.path with a hint the assistant can relay", () => {
    it("refuses a path when the host reads no file", async () => {
      const { library, file } = setup();
      expect(await issuesOf(library, [{ path: file }])).toEqual([{
        path: "sources.0.path", message: "this server does not read files",
        hint: "read the file with your own tools and pass its text",
      }]);
    });

    it("refuses text and path together, and a source with neither", async () => {
      const { library, file, policy } = setup();
      expect(await issuesOf(library, [{ title: "T", text: FRENCH_SOURCE.text, path: file }, { title: "Rien" }], policy)).toEqual([
        { path: "sources.0", message: "gives both text and path", hint: "pass path for a local file, text for what you fetched yourself; not both" },
        { path: "sources.1", message: "gives neither text nor path", hint: "pass path for a local file, text for what you fetched yourself" },
      ]);
    });

    it("refuses a missing file, naming the absolute path it looked for and the base", async () => {
      const { library, learner, policy } = setup();
      const [issue] = await issuesOf(library, [{ path: "absent.md" }], policy);
      expect(issue).toEqual({
        path: "sources.0.path", message: `no file at ${join(learner, "absent.md")}`,
        hint: `check the name; a relative path is read from ${learner}: prefer an absolute path`,
      });
    });

    it("refuses a folder and a device", async () => {
      const { library, learner, policy } = setup();
      const [dir] = await issuesOf(library, [{ path: learner }], policy);
      expect(dir).toMatchObject({ path: "sources.0.path", message: "is a folder, not a file", hint: "name one file in it" });
      const [device] = await issuesOf(library, [{ path: "/dev/null" }], policy);
      expect(device).toMatchObject({ path: "sources.0.path", message: "is a device or system file, not a document" });
    });

    it("refuses a PDF, an office document and other binary files, saying what to do instead", async () => {
      const { library, learner, policy } = setup();
      const pdf = join(learner, "cours.txt"); // the bytes decide, not the name
      writeFileSync(pdf, Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from(FRENCH_SOURCE.text)]));
      const docx = join(learner, "cours.md");
      writeFileSync(docx, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(FRENCH_SOURCE.text)]));
      const binary = join(learner, "data.txt");
      writeFileSync(binary, Buffer.concat([Buffer.from(FRENCH_SOURCE.text), Buffer.from([0, 1, 2, 3])]));
      const latin1 = join(learner, "latin1.txt");
      writeFileSync(latin1, Buffer.from(FRENCH_SOURCE.text.replace(/’/g, "'"), "latin1"));
      expect(await issuesOf(library, [{ path: pdf }, { path: docx }, { path: binary }, { path: latin1 }], policy)).toEqual([
        { path: "sources.0.path", message: "is a PDF, not text",
          hint: "extract its text (your own PDF reader, or pdftotext) and pass it as text, or save it as a .txt or .md file and pass that path" },
        { path: "sources.1.path", message: "is a compressed or office document (.docx, .odt, .pptx, .zip), not text",
          hint: "save it as plain text or Markdown (.txt, .md) and pass that path, or pass its text" },
        { path: "sources.2.path", message: "is a binary file, not text", hint: "pass a text file (.txt, .md), or the text itself" },
        { path: "sources.3.path", message: "is not UTF-8 text",
          hint: "save it with the UTF-8 encoding (most editors offer it in Save as), or pass its text" },
      ]);
    });

    it("refuses a file format it does not read by its extension, with the HTML and PDF advice where it fits", async () => {
      const { library, learner, policy } = setup();
      for (const name of ["page.html", "doc.pdf", "settings.json", "notes"]) writeFileSync(join(learner, name), FRENCH_SOURCE.text);
      const issues = await issuesOf(library, ["page.html", "doc.pdf", "settings.json", "notes"].map((name) => ({ path: join(learner, name) })), policy);
      expect(issues.map((issue) => issue.message)).toEqual([
        "is an HTML page, not text", "is a PDF, not text",
        "is not a text format Studium reads (.json)", "is not a text format Studium reads (no extension)",
      ]);
      expect(issues[0]!.hint).toBe("pass the text of the page, or save it as a .txt or .md file and pass that path");
      expect(issues[2]!.hint).toMatch(/^Studium reads \.txt, \.md, /);
    });

    it("applies the HTML rule of text to the text of a file", async () => {
      const { library, learner, policy } = setup();
      const file = join(learner, "page.md");
      writeFileSync(file, `<!DOCTYPE html><html><body><p>${FRENCH_SOURCE.text}</p></body></html>`);
      expect(await issuesOf(library, [{ path: file }], policy)).toEqual([
        { path: "sources.0.path", message: "is an HTML page, not text", hint: "pass the text of the page, not its HTML" },
      ]);
    });

    it("refuses a file too large before reading it, and one with more characters than a source may have", async () => {
      const { library, learner, policy } = setup();
      const huge = join(learner, "huge.txt");
      writeFileSync(huge, "");
      truncateSync(huge, MAX_SOURCE_CHARS * 4 + 1);
      const [tooBig] = await issuesOf(library, [{ path: huge }], policy);
      expect(tooBig).toEqual({
        path: "sources.0.path", message: `has ${MAX_SOURCE_CHARS * 4 + 1} bytes, more than a source of at most ${MAX_SOURCE_CHARS} characters`,
        hint: "pass the chapter or section the lesson is about: copy it into a file of its own",
      });
      const long = join(learner, "long.txt");
      writeFileSync(long, "Une phrase de source assez longue pour remplir un passage entier. ".repeat(3100));
      expect(await issuesOf(library, [{ path: long }], policy)).toEqual([{
        path: "sources.0.path", message: "has 204600 characters, at most 200000",
        hint: "pass the chapter or section the lesson is about",
      }]);
    });

    it("refuses a file of Studium's own data folder, also through a link", async () => {
      const { home, library, learner, policy } = setup();
      const lesson = join(library, "cours", "notes.md");
      mkdirSync(join(library, "cours"));
      writeFileSync(lesson, FRENCH_SOURCE.text);
      const link = join(learner, "raccourci.md");
      symlinkSync(lesson, link);
      const issues = await issuesOf(library, [{ path: lesson }, { path: link }], policy);
      expect(issues).toHaveLength(2);
      for (const issue of issues) {
        expect(issue).toEqual({
          path: expect.stringMatching(/^sources\.[01]\.path$/), message: `is inside Studium's own data folder (${home})`,
          hint: "pass one of the learner's documents: Studium's lessons and progress are not sources",
        });
      }
    });

    it("refuses the usual places of secrets, whatever the extension, also through a link", async () => {
      const { library, learner, policy } = setup();
      const cases = [
        join(learner, ".ssh", "notes.md"), join(learner, ".env"), join(learner, "projet", ".env.local"),
        join(learner, "projet", "secrets", "cours.md"), join(learner, "Library", "Keychains", "login.txt"),
        join(learner, ".aws", "credentials"), join(learner, "cles", "server.pem"), join(learner, ".config", "gh", "hosts.txt"),
      ];
      for (const file of cases) {
        mkdirSync(join(file, ".."), { recursive: true });
        writeFileSync(file, FRENCH_SOURCE.text);
      }
      const link = join(learner, "anodin.md");
      symlinkSync(cases[0]!, link);
      const issues = await issuesOf(library, [...cases, link].map((path) => ({ path })), policy);
      expect(issues).toHaveLength(cases.length + 1);
      for (const issue of issues) {
        expect(issue.message).toMatch(/^is in a place that holds secrets \(.+\); Studium does not read it$/);
        expect(issue.hint).toBe("copy the text the lesson needs into a file elsewhere, or pass the text itself");
      }
    });
  });
});
