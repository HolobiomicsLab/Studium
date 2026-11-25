// packages/lesson-session-host/src/authoring-draft/source-file.ts
//
// prepare_sources from a local file (INT-STUDIUM-064, change 1). The harness names a file instead of
// copying its whole text into the call, which is the slowest part of building a lesson; Studium reads
// the bytes itself, so the passages, and every quote checked against them, come from the file on disk.
// Local files only: Studium still fetches nothing from the network.
//
// The MCP server runs with the learner's own rights, outside the file permissions of the harness, so a
// path is read only when it passes every rule below; each refusal is an issue the assistant can relay:
//   - absolute, `~/...` (the home folder), or relative to the policy's base (the server's working folder);
//   - not under /dev, /proc or /sys, not in Studium's own data folder (lessons with their keys, progress),
//     not in a usual place of secrets (SECRET_DIRS, SECRET_FILES, ...), checked on the path as given and
//     on the target of every link;
//   - a regular file with a text extension (TEXT_EXTENSIONS), at most MAX_SOURCE_CHARS * 4 bytes;
//   - UTF-8 text: a PDF, an office or zip document, a file holding a NUL byte or invalid UTF-8 is refused.
import { createHash } from "node:crypto";
import { open, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, resolve, sep } from "node:path";

/** Where a source given by path may be read from; the server builds it, the model never sees it. */
export interface SourceFilePolicy {
  /** The folder a relative path is read from: the stdio server passes its working directory. */
  base: string;
  /** The folder `~/` names; the user's home when absent. */
  home?: string | undefined;
  /** Folders no source is read from: Studium's own data (STUDIUM_HOME, the library, the data folder). */
  refusedRoots: readonly string[];
}

/** What a source set records about a file it read (provenance: the exact bytes the passages come from). */
export interface SourceFileRecord {
  /** The real absolute path, links resolved. */
  path: string;
  bytes: number;
  /** sha256 of the bytes of the file (a byte order mark included). */
  sha256: string;
}

export type SourceFileRead =
  | { ok: true; text: string; file: SourceFileRecord }
  | { ok: false; message: string; hint: string };

/** Extensions read as text. Anything else is refused by name before a byte is read. */
export const TEXT_EXTENSIONS = [
  ".txt", ".md", ".markdown", ".text", ".mdown", ".mkd", ".rst", ".tex", ".org", ".adoc", ".asciidoc",
  ".csv", ".tsv", ".srt", ".vtt",
] as const;
/** Folder names that usually hold keys or tokens; a path through one of them is never read. */
export const SECRET_DIRS = [
  ".ssh", ".gnupg", ".aws", ".azure", ".kube", ".docker", ".password-store", ".gcloud", "keychains", "secrets", ".secrets",
] as const;
/** Pairs of folders (parent, child) that hold tokens: `.config/gcloud`, `.config/gh`. */
export const SECRET_DIR_PAIRS = [[".config", "gcloud"], [".config", "gh"]] as const;
/** File names that hold secrets; also any `.env` or `.env.<name>`. */
export const SECRET_FILES = [
  ".netrc", ".npmrc", ".pypirc", ".git-credentials", "credentials", "credentials.json",
  "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
] as const;
/** Extensions of keys, certificates and password stores. */
export const SECRET_EXTENSIONS = [".pem", ".key", ".p12", ".pfx", ".kdbx", ".keychain", ".keychain-db"] as const;
/** Device and process trees: their files are not documents (and /proc/self/environ holds the environment). */
const SYSTEM_ROOTS = ["/dev", "/proc", "/sys"];

const HTML_EXTENSIONS = [".html", ".htm", ".xhtml"];
const OFFICE_EXTENSIONS = [".docx", ".doc", ".odt", ".pptx", ".ppt", ".xlsx", ".xls", ".ods", ".odp", ".zip", ".epub", ".pages", ".numbers"];

const REFUSE = {
  html: { message: "is an HTML page, not text", hint: "pass the text of the page, or save it as a .txt or .md file and pass that path" },
  pdf: { message: "is a PDF, not text",
    hint: "extract its text (your own PDF reader, or pdftotext) and pass it as text, or save it as a .txt or .md file and pass that path" },
  office: { message: "is a compressed or office document (.docx, .odt, .pptx, .zip), not text",
    hint: "save it as plain text or Markdown (.txt, .md) and pass that path, or pass its text" },
  binary: { message: "is a binary file, not text", hint: "pass a text file (.txt, .md), or the text itself" },
  encoding: { message: "is not UTF-8 text", hint: "save it with the UTF-8 encoding (most editors offer it in Save as), or pass its text" },
  system: { message: "is a device or system file, not a document", hint: "pass one of the learner's documents (.txt, .md)" },
  folder: { message: "is a folder, not a file", hint: "name one file in it" },
};

/** Read the source file `given` under `policy`, or say why not. `maxChars` bounds the bytes read. */
export async function readSourceFile(given: string, policy: SourceFilePolicy, maxChars: number): Promise<SourceFileRead> {
  const trimmed = given.trim();
  if (!trimmed) return { ok: false, message: "is empty", hint: "give the absolute path of the file" };
  const home = policy.home ?? homedir();
  const relative = !isAbsolute(trimmed) && trimmed !== "~" && !trimmed.startsWith("~/");
  const absolute = trimmed === "~" ? home : trimmed.startsWith("~/") ? resolve(home, trimmed.slice(2)) : resolve(policy.base, trimmed);

  const before = await placeRefusal(absolute, policy, false);
  if (before) return before;
  let real: string;
  try {
    real = await realpath(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR") {
      return { ok: false, message: `no file at ${absolute}`,
        hint: relative ? `check the name; a relative path is read from ${policy.base}: prefer an absolute path` : "check the name and the folder" };
    }
    return unreadable(error);
  }
  const after = await placeRefusal(real, policy, true);
  if (after) return after;

  let size: number;
  try {
    const info = await stat(real);
    if (info.isDirectory()) return { ok: false, ...REFUSE.folder };
    if (!info.isFile()) return { ok: false, ...REFUSE.system };
    size = info.size;
  } catch (error) { return unreadable(error); }

  const extension = extname(real).toLowerCase();
  if (HTML_EXTENSIONS.includes(extension)) return { ok: false, ...REFUSE.html };
  if (extension === ".pdf") return { ok: false, ...REFUSE.pdf };
  if (OFFICE_EXTENSIONS.includes(extension)) return { ok: false, ...REFUSE.office };
  if (!(TEXT_EXTENSIONS as readonly string[]).includes(extension)) {
    return { ok: false, message: `is not a text format Studium reads (${extension || "no extension"})`,
      hint: `Studium reads ${TEXT_EXTENSIONS.join(", ")}: save the text in one of them, or pass the text itself` };
  }

  // UTF-8 takes at most 4 bytes a character: a file larger than this cannot fit the cap on characters.
  const limit = maxChars * 4;
  const tooLarge = (bytes: number) => ({ ok: false as const, message: `has ${bytes} bytes, more than a source of at most ${maxChars} characters`,
    hint: "pass the chapter or section the lesson is about: copy it into a file of its own" });
  if (size > limit) return tooLarge(size);

  let bytes: Buffer;
  try {
    const handle = await open(real, "r");
    try {
      // The handle is the file read: a swap of the path after the checks above changes nothing.
      const info = await handle.stat();
      if (!info.isFile()) return { ok: false, ...REFUSE.system };
      if (info.size > limit) return tooLarge(info.size);
      const buffer = Buffer.alloc(limit + 1);
      let read = 0;
      for (;;) {
        const { bytesRead } = await handle.read(buffer, read, buffer.length - read, read);
        if (bytesRead === 0) break;
        read += bytesRead;
        if (read > limit) return tooLarge(read);
      }
      bytes = buffer.subarray(0, read);
    } finally {
      await handle.close();
    }
  } catch (error) { return unreadable(error); }

  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return { ok: false, ...REFUSE.pdf };
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05) && (bytes[3] === 0x04 || bytes[3] === 0x06)) {
    return { ok: false, ...REFUSE.office };
  }
  if (bytes.includes(0)) return { ok: false, ...REFUSE.binary };
  let text: string;
  try {
    // fatal: a byte sequence that is not UTF-8 refuses the file instead of becoming U+FFFD in a quote.
    // The decoder drops a leading byte order mark; the record's size and sha256 still count it.
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, ...REFUSE.encoding };
  }
  return { ok: true, text, file: { path: real, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } };
}

/** The title of a file given without one: its name without the extension. */
export function fileTitle(path: string): string {
  const name = basename(path);
  const extension = extname(name);
  return extension && extension !== name ? name.slice(0, -extension.length) : name;
}

function unreadable(error: unknown): SourceFileRead {
  const code = (error as NodeJS.ErrnoException).code ?? "error";
  return { ok: false, message: `cannot be read (${code})`, hint: "check that the file exists and that the learner can open it, or pass its text" };
}

async function placeRefusal(path: string, policy: SourceFilePolicy, real: boolean): Promise<SourceFileRead | undefined> {
  if (SYSTEM_ROOTS.some((root) => within(path, root))) return { ok: false, ...REFUSE.system };
  const secret = secretPlace(path);
  if (secret) {
    return { ok: false, message: `is in a place that holds secrets (${secret}); Studium does not read it`,
      hint: "copy the text the lesson needs into a file elsewhere, or pass the text itself" };
  }
  for (const root of policy.refusedRoots) {
    const roots = [resolve(root)];
    if (real) roots.push(await realpath(root).catch(() => resolve(root)));
    if (roots.some((candidate) => within(path, candidate))) {
      return { ok: false, message: `is inside Studium's own data folder (${root})`,
        hint: "pass one of the learner's documents: Studium's lessons and progress are not sources" };
    }
  }
  return undefined;
}

function within(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

/** The part of `path` that marks a usual place of secrets, or undefined. Case is ignored. */
export function secretPlace(path: string): string | undefined {
  const parts = path.split(sep).filter(Boolean);
  const lower = parts.map((part) => part.toLowerCase());
  for (let index = 0; index < lower.length - 1; index += 1) {
    if ((SECRET_DIRS as readonly string[]).includes(lower[index]!)) return parts[index];
    const pair = SECRET_DIR_PAIRS.find(([parent, child]) => lower[index] === parent && lower[index + 1] === child);
    if (pair && index + 1 < lower.length - 1) return `${parts[index]}/${parts[index + 1]}`;
  }
  const name = lower[lower.length - 1] ?? "";
  if (name === ".env" || name.startsWith(".env.")) return parts[parts.length - 1];
  if ((SECRET_FILES as readonly string[]).includes(name)) return parts[parts.length - 1];
  const extension = extname(name);
  if ((SECRET_EXTENSIONS as readonly string[]).includes(extension)) return extension;
  return undefined;
}
