#!/usr/bin/env node
// tools/docs/check.mjs — the documentation gate.
//
//   node tools/docs/check.mjs                 # every check below; exit 1 on any problem
//   node tools/docs/check.mjs --skip-generated  # links and pairs only (no TypeScript run)
//
// 1. Relative links and anchors in every .md file of the repository (node_modules, .git, virtual
//    environments, build output and symbolic links excluded): the target exists, and a #fragment
//    names a heading (GitHub slug) or an explicit id of the target page.
// 2. Every page under docs/ (except docs/design-records/, docs/internal/ and the asset and example
//    folders) has its pair:
//    page.md (English) and page.fr.md (French).
// 3. Every tool the MCP server registers has a section in docs/reference/mcp-tools.md.
// 4. The generated regions of docs/reference/ match the code (tools/docs/gen-*.mjs --check).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { isEntry, REPO_ROOT } from "./lib/generated.mjs";

export const SKIP_DIRS = new Set([
  "node_modules", ".git", ".venv", "venv", "dist", "build", "target", ".next", "__pycache__",
  ".pytest_cache", ".mypy_cache", ".ruff_cache", ".cache", "coverage", ".turbo",
]);
/** Folders under docs/ that keep one language: archives and internal logs (decision D7), and the
 * asset and example folders, whose README files describe files rather than being pages. */
export const SINGLE_LANGUAGE_DIRS = ["design-records", "internal", "assets", "examples"];

/** Every .md file under `root`, repo-relative with forward slashes, sorted. */
export function markdownFiles(root) {
  const files = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) visit(full); }
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(relative(root, full).split(sep).join("/"));
    }
  };
  visit(root);
  return files.sort();
}

/** `text` with fenced code blocks blanked (line count kept) and YAML front matter removed. */
function proseLines(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let fence = null;
  let frontMatter = lines[0] === "---";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (frontMatter) {
      out.push("");
      if (i > 0 && /^(---|\.\.\.)\s*$/.test(line)) frontMatter = false;
      continue;
    }
    const open = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      out.push("");
      continue;
    }
    if (open) { fence = open[1]; out.push(""); continue; }
    out.push(line);
  }
  return out;
}

/** Inline code spans removed, so `[a](b)` written as an example is not taken for a link. */
const stripInlineCode = (line) => line.replace(/(`+)(?:(?!\1).)+?\1/g, (m) => " ".repeat(m.length));

/** The GitHub anchor of a heading text (github-slugger rules, without its duplicate counter). */
export function slug(heading) {
  const text = heading
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[`*~]/g, "");
  return text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "").replace(/ /g, "-");
}

/** The anchors a page defines: one per heading (with GitHub's -1, -2 suffixes) plus explicit ids. */
export function anchorsOf(text) {
  const anchors = new Set();
  const counts = new Map();
  const add = (base) => {
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  };
  const lines = proseLines(text);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const atx = line.match(/^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/);
    if (atx) { add(slug(atx[1])); continue; }
    const next = lines[i + 1];
    if (next !== undefined && line.trim() && !/^\s*([-*+>|]|\d+\.)/.test(line) && /^ {0,3}(=+|-+)[ \t]*$/.test(next)) {
      add(slug(line.trim()));
    }
  }
  for (const match of text.matchAll(/<[a-z][^>]*\s(?:id|name)=["']([^"']+)["']/gi)) anchors.add(match[1]);
  return anchors;
}

/** The link targets of a page: {target, line}, from Markdown links, references and HTML attributes. */
export function linksOf(text) {
  const links = [];
  proseLines(text).forEach((raw, index) => {
    const line = stripInlineCode(raw);
    const lineNo = index + 1;
    for (const m of line.matchAll(/!?\[(?:[^\]\\]|\\.)*\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g)) {
      links.push({ target: m[1].replace(/^<|>$/g, ""), line: lineNo });
    }
    const ref = line.match(/^ {0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/);
    if (ref) links.push({ target: ref[1].replace(/^<|>$/g, ""), line: lineNo });
    for (const m of line.matchAll(/\s(?:href|src)=["']([^"']+)["']/gi)) links.push({ target: m[1], line: lineNo });
    for (const m of line.matchAll(/\ssrcset=["']([^"']+)["']/gi)) {
      for (const candidate of m[1].split(",")) {
        const url = candidate.trim().split(/\s+/)[0];
        if (url) links.push({ target: url, line: lineNo });
      }
    }
  });
  return links;
}

const isExternal = (target) => /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//");

/** Broken relative links and anchors of the given files: ["file:line: message", ...]. */
export function checkLinks(root, files = markdownFiles(root)) {
  const problems = [];
  const anchorCache = new Map();
  const anchorsFor = (path) => {
    if (!anchorCache.has(path)) anchorCache.set(path, anchorsOf(readFileSync(path, "utf8")));
    return anchorCache.get(path);
  };
  for (const file of files) {
    const path = join(root, file);
    const text = readFileSync(path, "utf8");
    for (const { target, line } of linksOf(text)) {
      if (!target || isExternal(target)) continue;
      const hash = target.indexOf("#");
      const rawPath = hash >= 0 ? target.slice(0, hash) : target;
      const fragment = hash >= 0 ? target.slice(hash + 1) : "";
      let decoded;
      try { decoded = decodeURIComponent(rawPath.split("?")[0]); } catch { decoded = rawPath; }
      const resolved = decoded === "" ? path
        : decoded.startsWith("/") ? join(root, decoded) : resolve(dirname(path), decoded);
      if (!existsSync(resolved)) {
        problems.push(`${file}:${line}: broken link ${target} (no ${relative(root, resolved) || "."})`);
        continue;
      }
      if (!fragment || !resolved.toLowerCase().endsWith(".md") || !statSync(resolved).isFile()) continue;
      let wanted;
      try { wanted = decodeURIComponent(fragment); } catch { wanted = fragment; }
      const anchors = anchorsFor(resolved);
      if (!anchors.has(wanted) && !anchors.has(wanted.toLowerCase())) {
        problems.push(`${file}:${line}: broken anchor ${target} (no heading #${wanted} in ${relative(root, resolved)})`);
      }
    }
  }
  return problems;
}

/** Pages under docs/ that miss their English or French twin. */
export function checkPairs(root, files = markdownFiles(root)) {
  const problems = [];
  const set = new Set(files);
  for (const file of files) {
    if (!file.startsWith("docs/")) continue;
    const inside = file.slice("docs/".length);
    if (SINGLE_LANGUAGE_DIRS.some((dir) => inside.startsWith(`${dir}/`))) continue;
    const twin = file.endsWith(".fr.md") ? file.replace(/\.fr\.md$/, ".md") : file.replace(/\.md$/i, ".fr.md");
    if (!set.has(twin)) problems.push(`${file}: no ${file.endsWith(".fr.md") ? "English" : "French"} twin (${twin})`);
  }
  return problems;
}

/** Tools the server registers that have no `### name` section in the tool reference. */
export function checkToolsDocumented(root, toolNames, page = "docs/reference/mcp-tools.md") {
  const path = join(root, page);
  if (!existsSync(path)) return [`${page}: missing`];
  const anchors = anchorsOf(readFileSync(path, "utf8"));
  return toolNames.filter((name) => !anchors.has(slug(name))).map((name) => `${page}: tool ${name} is not documented`);
}

async function checkGenerated() {
  const { syncRegion } = await import("./lib/generated.mjs");
  const problems = [];
  const tools = await import("./gen-mcp-tools.mjs");
  const dump = tools.dumpServer();
  problems.push(...checkToolsDocumented(REPO_ROOT, dump.tools.map((t) => t.name)));
  problems.push(...syncRegion(tools.PAGES, tools.REGION, tools.renderTools(dump), { write: false }));
  const bundle = await import("./gen-lesson-bundle.mjs");
  problems.push(...syncRegion(bundle.PAGES, bundle.REGION, bundle.render(), { write: false }));
  return problems;
}

export async function main(argv = process.argv.slice(2)) {
  const files = markdownFiles(REPO_ROOT);
  const sections = [
    ["links and anchors", checkLinks(REPO_ROOT, files)],
    ["English/French pairs", checkPairs(REPO_ROOT, files)],
  ];
  if (!argv.includes("--skip-generated")) sections.push(["MCP tools and generated pages", await checkGenerated()]);
  let total = 0;
  for (const [name, problems] of sections) {
    total += problems.length;
    process.stdout.write(`${problems.length === 0 ? "ok  " : "FAIL"} ${name}${problems.length ? ` (${problems.length})` : ""}\n`);
    for (const problem of problems) process.stdout.write(`  ${problem}\n`);
  }
  process.stdout.write(`${files.length} Markdown files checked, ${total} problem(s)\n`);
  return total === 0 ? 0 : 1;
}

if (isEntry(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 2; });
}

