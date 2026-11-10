#!/usr/bin/env node
// tools/docs/build-site.mjs — a static HTML rendering of the documentation (prototype).
//
//   node tools/docs/build-site.mjs [--out DIR] [--repo-url URL]
//
// Reads README(.fr).md and every page of docs/ (except design-records/, internal/ and the asset and
// example folders) and writes a self-contained site: English at the root, French under fr/, one CSS
// file, one small script, the images the pages use. No network at build time or at read time; the
// output opens from the file system and from any sub-path. GitHub stays the canonical rendering.
//
// - Markdown: marked 15, resolved from apps/lesson-panel-ui (no new dependency).
// - Heading ids: the slug of tools/docs/check.mjs, so every #anchor the checker accepts works here.
// - Links: a built page becomes its .html (same target language as the source link); an image under
//   docs/ is copied; anything else (source code, LICENSE, design records) goes to --repo-url.
// - Navigation: derived from the portal docs/index(.fr).md: the role table first, then the folder
//   groups of its « All pages » block, then any other page the portal links.
// - Exit 1 when a relative link or #anchor of the built site resolves to nothing.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { markdownFiles, SINGLE_LANGUAGE_DIRS, slug } from "./check.mjs";
import { isEntry, REPO_ROOT } from "./lib/generated.mjs";

const require = createRequire(new URL("../../apps/lesson-panel-ui/package.json", import.meta.url));
const { Marked } = require("marked");

export const DEFAULT_REPO_URL = "https://github.com/HolobiomicsLab/studium/blob/main/";
const MARKER = ".studium-docs-site";
const IMAGE_EXT = /\.(svg|png|jpe?g|gif|webp|avif)$/i;
const SWITCH_LINE = /^(English · \[Français\]\([^)]*\)|\[English\]\([^)]*\) · Français)\s*$/;

const STRINGS = {
  en: {
    docs: "Documentation", skip: "Skip to content", menu: "Menu", nav: "Documentation", home: "Home",
    readme: "Project overview", other: "Other pages", toc: "On this page", pager: "Previous and next",
    prev: "Previous", next: "Next", table: "Table", source: "View the source of this page on GitHub",
    switchLabel: "Français", switchLang: "fr",
    licence: "Code under Apache-2.0, documentation under CC BY 4.0.",
    prototype: "Prototype rendering of the Markdown documentation; the pages on GitHub remain the reference.",
  },
  fr: {
    docs: "Documentation", skip: "Aller au contenu", menu: "Menu", nav: "Documentation", home: "Accueil",
    readme: "Présentation du projet", other: "Autres pages", toc: "Sur cette page", pager: "Page précédente et suivante",
    prev: "Précédent", next: "Suivant", table: "Tableau", source: "Voir la source de cette page sur GitHub",
    switchLabel: "English", switchLang: "en",
    licence: "Code sous licence Apache-2.0, documentation sous licence CC BY 4.0.",
    prototype: "Rendu prototype de la documentation Markdown ; les pages sur GitHub restent la référence.",
  },
};

// ---------------------------------------------------------------------------------------------
// Pages, languages, paths

/** The output path of a source page, or null when the page is not part of the site. */
export function outputPathOf(repoPath) {
  const readme = repoPath.match(/^README(\.fr)?\.md$/);
  if (readme) return readme[1] ? "fr/readme.html" : "readme.html";
  if (!repoPath.startsWith("docs/") || !repoPath.endsWith(".md")) return null;
  const inside = repoPath.slice("docs/".length);
  if (SINGLE_LANGUAGE_DIRS.some((dir) => inside.startsWith(`${dir}/`))) return null;
  const french = inside.endsWith(".fr.md");
  const stem = inside.replace(/(\.fr)?\.md$/, "");
  return `${french ? "fr/" : ""}${stem}.html`;
}

export const languageOf = (repoPath) => (repoPath.endsWith(".fr.md") ? "fr" : "en");
export const twinOf = (repoPath) => (repoPath.endsWith(".fr.md") ? repoPath.replace(/\.fr\.md$/, ".md") : repoPath.replace(/\.md$/, ".fr.md"));
const portalOf = (lang) => (lang === "fr" ? "docs/index.fr.md" : "docs/index.md");
const assetOutputOf = (repoPath) => repoPath.replace(/^docs\//, "");

/** `to` relative to the folder of `from` (both output paths). */
function rel(from, to) {
  return posix.relative(posix.dirname(from), to) || posix.basename(to);
}

const isExternal = (target) => /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//");

/** Where a link of `fromRepoPath` points in the site: {url, asset?}. */
export function rewriteTarget(target, fromRepoPath, ctx) {
  if (!target || isExternal(target) || target.startsWith("#")) return { url: target };
  const hash = target.indexOf("#");
  const fragment = hash >= 0 ? target.slice(hash) : "";
  let path = (hash >= 0 ? target.slice(0, hash) : target).split("?")[0];
  try { path = decodeURIComponent(path); } catch { /* keep the raw text */ }
  const repoPath = posix.normalize(path.startsWith("/") ? path.slice(1) : posix.join(posix.dirname(fromRepoPath), path)).replace(/\/$/, "");
  if (repoPath.startsWith("..")) return { url: target };
  const fromOut = outputPathOf(fromRepoPath) ?? fromRepoPath;
  if (ctx.pages.has(repoPath)) return { url: rel(fromOut, outputPathOf(repoPath)) + fragment };
  if (ctx.isAsset(repoPath)) return { url: rel(fromOut, assetOutputOf(repoPath)) + fragment, asset: repoPath };
  const base = ctx.isDir(repoPath) ? ctx.repoUrl.replace("/blob/", "/tree/") : ctx.repoUrl;
  return { url: base + encodeURI(repoPath) + fragment };
}

// ---------------------------------------------------------------------------------------------
// Rendering

const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const decodeEntities = (s) => s.replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const plain = (html) => decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

/** Rewrite href, src and srcset attributes of rendered HTML; collect the assets it needs. */
function rewriteAttributes(html, repoPath, ctx, assets) {
  const one = (value) => {
    const { url, asset } = rewriteTarget(decodeEntities(value), repoPath, ctx);
    if (asset) assets.add(asset);
    return escapeHtml(url);
  };
  return html
    .replace(/(\s(?:href|src))="([^"]*)"/g, (_, attr, value) => `${attr}="${one(value)}"`)
    .replace(/(\ssrcset)="([^"]*)"/g, (_, attr, value) => `${attr}="${value.split(",").map((candidate) => {
      const [url, ...descriptor] = candidate.trim().split(/\s+/);
      return [one(url), ...descriptor].join(" ");
    }).join(", ")}"`);
}

/** The role table of the portal as plain cards (header cells become the labels). */
function cardsHtml(table, marked) {
  const columns = table.header.map((cell) => marked.parseInline(cell.text));
  const items = table.rows.map((row) => {
    const [who, ...rest] = row.map((cell) => marked.parseInline(cell.text));
    const lines = rest.map((cell, i) => `<p><span class="role-label">${columns[i + 1]}</span> ${cell}</p>`).join("");
    return `<li><h3>${who}</h3>${lines}</li>`;
  });
  return `<ul class="roles">${items.join("")}</ul>\n`;
}

/**
 * Render one Markdown page. Returns {html, title, headings (H2 only), assets}.
 * `options.cards` turns the first table into role cards (the portal's home page).
 */
export function renderPage(text, repoPath, ctx, options = {}) {
  const lines = text.split(/\r?\n/);
  if (SWITCH_LINE.test(lines[0] ?? "")) lines.shift();
  const strings = STRINGS[languageOf(repoPath)];
  const counts = new Map();
  const headings = [];
  let title = null;
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading(token) {
        const base = slug(token.text);
        const n = counts.get(base) ?? 0;
        counts.set(base, n + 1);
        const id = n === 0 ? base : `${base}-${n}`;
        const inner = this.parser.parseInline(token.tokens);
        if (token.depth === 1 && title === null) title = plain(inner);
        if (token.depth === 2) headings.push({ id, text: plain(inner) });
        return `<h${token.depth} id="${escapeHtml(id)}">${inner}</h${token.depth}>\n`;
      },
      code(token) {
        const lang = (token.lang || "").match(/^\S*/)[0];
        const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
        return `<pre tabindex="0"><code${cls}>${escapeHtml(token.text)}\n</code></pre>\n`;
      },
    },
  });
  const tokens = marked.lexer(lines.join("\n"));
  if (options.cards) {
    const index = tokens.findIndex((t) => t.type === "table");
    if (index >= 0) tokens[index] = { type: "html", block: true, pre: false, raw: "", text: cardsHtml(tokens[index], marked) };
  }
  let html = marked.parser(tokens);
  html = html.replace(/<table>([\s\S]*?)<\/table>/g, (whole, inner) => {
    const head = [...inner.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => plain(m[1])).filter(Boolean);
    const label = head.length ? `${strings.table}: ${head.join(", ")}` : strings.table;
    return `<div class="scroll" tabindex="0" role="region" aria-label="${escapeHtml(label)}">${whole}</div>`;
  });
  const assets = new Set();
  html = rewriteAttributes(html, repoPath, ctx, assets);
  return { html, title: title ?? repoPath, headings, assets };
}

// ---------------------------------------------------------------------------------------------
// Navigation from the portal

const LINK = /\[((?:[^\]\\]|\\.)*)\]\(\s*<?([^)\s>]+)>?\s*\)/g;

function resolvePage(target, fromRepoPath, pages) {
  if (isExternal(target) || target.startsWith("#")) return null;
  let path = target.split("#")[0].split("?")[0];
  try { path = decodeURIComponent(path); } catch { /* raw */ }
  const repoPath = posix.normalize(posix.join(posix.dirname(fromRepoPath), path));
  return pages.has(repoPath) ? repoPath : null;
}

/**
 * The navigation a portal page describes:
 *   roles:  {label, columns, items: [{label, page, pageLabel, then: {page, label}}]} from the first table
 *   groups: [{label, items: [{label, page}]}] from the « All pages » list (`- **Group.** links`),
 *           then one group for the other pages the portal links.
 */
export function navFromPortal(text, portalRepoPath, pages) {
  const strings = STRINGS[languageOf(portalRepoPath)];
  const marked = new Marked({ gfm: true });
  const tokens = marked.lexer(text);
  let roles = null;
  let lastH2 = null;
  for (const token of tokens) {
    if (token.type === "heading" && token.depth === 2) lastH2 = plain(marked.parseInline(token.text));
    if (token.type === "table") {
      const link = (cell) => {
        for (const m of cell.text.matchAll(LINK)) {
          const page = resolvePage(m[2], portalRepoPath, pages);
          if (page) return { page, label: plain(marked.parseInline(m[1])) };
        }
        return null;
      };
      roles = {
        label: lastH2,
        columns: token.header.slice(1).map((cell) => plain(marked.parseInline(cell.text))),
        items: token.rows.map((row) => {
          const first = link(row[1]);
          return first && { label: plain(marked.parseInline(row[0].text)), page: first.page, pageLabel: first.label, then: link(row[2] ?? { text: "" }) };
        }).filter(Boolean),
      };
      break;
    }
  }
  const groups = [];
  const placed = new Set();
  const details = text.match(/<details>([\s\S]*?)<\/details>/);
  if (details) {
    for (const line of details[1].split(/\r?\n/)) {
      const m = line.match(/^\s*[-*]\s+\*\*(.+?)\*\*\s*(.*)$/);
      if (!m) continue;
      const items = [];
      for (const link of m[2].matchAll(LINK)) {
        const page = resolvePage(link[2], portalRepoPath, pages);
        if (page && !items.some((i) => i.page === page)) { items.push({ label: plain(marked.parseInline(link[1])), page }); placed.add(page); }
      }
      if (items.length) groups.push({ label: m[1].replace(/[.:]\s*$/, "").trim(), items });
    }
  }
  const others = [];
  for (const link of text.matchAll(LINK)) {
    const page = resolvePage(link[2], portalRepoPath, pages);
    if (!page || page === portalRepoPath || placed.has(page) || /^README/.test(page)) continue;
    placed.add(page);
    others.push({ label: plain(marked.parseInline(link[1])), page });
  }
  if (others.length) groups.push({ label: strings.other, items: others });
  return { roles, groups };
}

// ---------------------------------------------------------------------------------------------
// Layout

function navHtml(nav, page, outPath, strings, lang, pages) {
  const item = (label, target) => {
    const current = target === page ? ` aria-current="page"` : "";
    return `<li><a href="${escapeHtml(rel(outPath, outputPathOf(target)))}"${current}>${escapeHtml(label)}</a></li>`;
  };
  const parts = [];
  const top = [];
  if (pages.has(portalOf(lang))) top.push(item(strings.home, portalOf(lang)));
  const readme = lang === "fr" ? "README.fr.md" : "README.md";
  if (pages.has(readme)) top.push(item(strings.readme, readme));
  if (top.length) parts.push(`<ul class="nav-list nav-top">${top.join("")}</ul>`);
  const group = (id, label, items) => parts.push(
    `<p class="nav-label" id="${id}">${escapeHtml(label)}</p><ul class="nav-list" aria-labelledby="${id}">${items.join("")}</ul>`);
  if (nav.roles?.items.length) group("st-nav-roles", nav.roles.label ?? "", nav.roles.items.map((r) => item(r.label, r.page)));
  nav.groups.forEach((g, i) => group(`st-nav-${i}`, g.label, g.items.map((it) => item(it.label, it.page))));
  return parts.join("\n");
}

function layout({ lang, title, docTitle, body, outPath, page, nav, headings, prev, next, twinHref, sourceUrl, chrome, notice, hero, pages }) {
  const s = STRINGS[lang];
  const root = (p) => escapeHtml(rel(outPath, p));
  const toc = headings.length >= 2
    ? `<aside class="toc" aria-labelledby="st-toc-title"><p class="nav-label" id="st-toc-title">${s.toc}</p><ul>${headings.map((h) => `<li><a href="#${escapeHtml(h.id)}">${escapeHtml(h.text)}</a></li>`).join("")}</ul></aside>`
    : "";
  const brand = chrome.wordmark
    ? `<picture><source media="(prefers-color-scheme: dark)" srcset="${root(chrome.wordmark.dark)}"><img src="${root(chrome.wordmark.light)}" alt="Studium" width="122" height="32"></picture>`
    : `<span class="brand-name">Studium</span>`;
  const pager = prev || next
    ? `<nav class="pager" aria-label="${s.pager}">${prev ? `<a href="${escapeHtml(rel(outPath, outputPathOf(prev.page)))}" rel="prev"><span>${s.prev}</span>${escapeHtml(prev.label)}</a>` : "<span></span>"}${next ? `<a href="${escapeHtml(rel(outPath, outputPathOf(next.page)))}" rel="next" class="next"><span>${s.next}</span>${escapeHtml(next.label)}</a>` : ""}</nav>`
    : "";
  const heroHtml = hero
    ? `<div class="hero"><picture><source media="(prefers-color-scheme: dark)" srcset="${root(hero.dark)}"><img src="${root(hero.light)}" alt="${escapeHtml(hero.alt)}" width="1280" height="420"></picture></div>`
    : "";
  return `<!doctype html>
<html lang="${lang}" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(docTitle)}</title>
<link rel="stylesheet" href="${root("site.css")}">
${chrome.icon ? `<link rel="icon" href="${root(chrome.icon)}" type="image/svg+xml">` : ""}
<link rel="alternate" hreflang="${s.switchLang}" href="${escapeHtml(twinHref)}">
<script src="${root("site.js")}"></script>
</head>
<body>
<a class="skip" href="#st-main">${s.skip}</a>
<header class="site-header">
<a class="brand" href="${root(outputPathOf(portalOf(lang)))}">${brand}<span class="brand-sub">${s.docs}</span></a>
<a class="lang" href="${escapeHtml(twinHref)}" hreflang="${s.switchLang}" lang="${s.switchLang}">${s.switchLabel}</a>
<button class="nav-button" type="button" aria-expanded="false" aria-controls="st-nav" hidden>${s.menu}</button>
</header>
<div class="layout">
<nav id="st-nav" class="sidebar" aria-label="${s.nav}">
${navHtml(nav, page, outPath, s, lang, pages)}
</nav>
<main id="st-main" tabindex="-1">
${heroHtml}<article class="prose">
${body}</article>
${pager}
<p class="source"><a href="${escapeHtml(sourceUrl)}">${s.source}</a></p>
</main>
${toc}
</div>
<footer class="site-footer">
<p>${s.licence} ${escapeHtml(notice)}</p>
<p>${s.prototype}</p>
</footer>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------------------------
// Output check

function walkFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** Broken relative links and anchors in the built site: ["page.html: broken link x", ...]. */
export function checkOutput(outDir) {
  const problems = [];
  const idCache = new Map();
  const idsOf = (file) => {
    if (!idCache.has(file)) {
      const html = readFileSync(file, "utf8");
      idCache.set(file, new Set([...html.matchAll(/\s(?:id|name)="([^"]*)"/g)].map((m) => decodeEntities(m[1]))));
    }
    return idCache.get(file);
  };
  for (const file of walkFiles(outDir).filter((f) => f.endsWith(".html")).sort()) {
    const html = readFileSync(file, "utf8");
    const name = relative(outDir, file).split(sep).join("/");
    const targets = [...html.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1]);
    for (const m of html.matchAll(/\ssrcset="([^"]*)"/g)) targets.push(...m[1].split(",").map((c) => c.trim().split(/\s+/)[0]));
    for (const raw of targets) {
      const target = decodeEntities(raw);
      if (!target || isExternal(target)) continue;
      const hash = target.indexOf("#");
      let path = (hash >= 0 ? target.slice(0, hash) : target).split("?")[0];
      const fragment = hash >= 0 ? target.slice(hash + 1) : "";
      try { path = decodeURIComponent(path); } catch { /* raw */ }
      const resolved = path === "" ? file : resolve(dirname(file), path);
      if (!existsSync(resolved) || !statSync(resolved).isFile()) { problems.push(`${name}: broken link ${target}`); continue; }
      if (!fragment || !resolved.endsWith(".html")) continue;
      let wanted = fragment;
      try { wanted = decodeURIComponent(fragment); } catch { /* raw */ }
      const ids = idsOf(resolved);
      if (!ids.has(wanted) && !ids.has(wanted.toLowerCase())) problems.push(`${name}: broken anchor ${target}`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Build

const SITE_JS = `// Studium documentation: the navigation button at narrow widths. The pages work without it.
document.documentElement.className = document.documentElement.className.replace("no-js", "js");
document.addEventListener("DOMContentLoaded", function () {
  var button = document.querySelector(".nav-button");
  if (!button) return;
  button.hidden = false;
  button.addEventListener("click", function () {
    var open = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(open));
    document.body.classList.toggle("nav-open", open);
  });
});
`;

function copy(root, out, repoPath, outPath) {
  const target = join(out, outPath);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(root, repoPath), target);
  return statSync(target).size;
}

/** Build the site from `root` into `out`. Returns {pages: {en, fr}, assets, bytes, links, broken, unlisted}. */
export async function buildSite({ root = REPO_ROOT, out = join(root, "site"), repoUrl = DEFAULT_REPO_URL, quiet = false } = {}) {
  if (existsSync(out)) {
    if (readdirSync(out).length && !existsSync(join(out, MARKER))) throw new Error(`${out} exists and was not written by this builder; choose another --out`);
    rmSync(out, { recursive: true, force: true });
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, MARKER), "Written by tools/docs/build-site.mjs; safe to delete.\n");

  const sources = markdownFiles(root).filter((f) => outputPathOf(f) !== null);
  const pages = new Set(sources);
  const ctx = {
    pages,
    repoUrl,
    isAsset: (p) => p.startsWith("docs/") && IMAGE_EXT.test(p) && existsSync(join(root, p)) && statSync(join(root, p)).isFile(),
    isDir: (p) => existsSync(join(root, p)) && statSync(join(root, p)).isDirectory(),
  };
  const navs = {};
  for (const lang of ["en", "fr"]) {
    const portal = portalOf(lang);
    navs[lang] = pages.has(portal) ? navFromPortal(readFileSync(join(root, portal), "utf8"), portal, pages) : { roles: null, groups: [] };
  }

  const chromeAsset = (p) => (ctx.isAsset(p) ? assetOutputOf(p) : null);
  const wordmark = { light: chromeAsset("docs/assets/brand/studium-wordmark-light.svg"), dark: chromeAsset("docs/assets/brand/studium-wordmark-dark.svg") };
  const chrome = {
    wordmark: wordmark.light && wordmark.dark ? wordmark : null,
    icon: chromeAsset("docs/assets/brand/studium-mark.svg"),
  };
  const assets = new Set(["docs/assets/brand/studium-wordmark-light.svg", "docs/assets/brand/studium-wordmark-dark.svg",
    "docs/assets/brand/studium-mark.svg"].filter(ctx.isAsset));
  const noticePath = join(root, "NOTICE");
  const notice = existsSync(noticePath) ? (readFileSync(noticePath, "utf8").match(/^Copyright .*$/m)?.[0] ?? "") : "";

  const heroFor = (lang) => {
    const light = "docs/assets/hero-light.svg";
    const dark = "docs/assets/hero-dark.svg";
    if (!ctx.isAsset(light) || !ctx.isAsset(dark)) return null;
    assets.add(light); assets.add(dark);
    const readme = join(root, lang === "fr" ? "README.fr.md" : "README.md");
    const alt = existsSync(readme) ? (readFileSync(readme, "utf8").match(/hero-light\.svg"[^>]*\salt="([^"]*)"/)?.[1] ?? "") : "";
    return { light: assetOutputOf(light), dark: assetOutputOf(dark), alt };
  };

  const counts = { en: 0, fr: 0 };
  const listed = new Set();
  for (const lang of ["en", "fr"]) {
    for (const g of navs[lang].groups) for (const it of g.items) listed.add(it.page);
  }
  for (const page of sources) {
    const lang = languageOf(page);
    const outPath = outputPathOf(page);
    const isHome = page === portalOf(lang);
    const rendered = renderPage(readFileSync(join(root, page), "utf8"), page, ctx, { cards: isHome });
    for (const asset of rendered.assets) assets.add(asset);
    const nav = navs[lang];
    const group = nav.groups.find((g) => g.items.some((it) => it.page === page));
    const at = group ? group.items.findIndex((it) => it.page === page) : -1;
    const twin = twinOf(page);
    const twinTarget = pages.has(twin) ? twin : portalOf(lang === "fr" ? "en" : "fr");
    const html = layout({
      lang,
      title: rendered.title,
      docTitle: isHome ? rendered.title : `${rendered.title} · Studium`,
      body: rendered.html,
      outPath,
      page,
      nav,
      headings: rendered.headings,
      prev: at > 0 ? group.items[at - 1] : null,
      next: group && at < group.items.length - 1 ? group.items[at + 1] : null,
      twinHref: pages.has(twinTarget) ? rel(outPath, outputPathOf(twinTarget)) : rel(outPath, outputPathOf(page)),
      sourceUrl: repoUrl + encodeURI(page),
      chrome,
      notice,
      hero: isHome ? heroFor(lang) : null,
      pages,
    });
    mkdirSync(dirname(join(out, outPath)), { recursive: true });
    writeFileSync(join(out, outPath), html);
    counts[lang] += 1;
  }

  let bytes = 0;
  for (const asset of [...assets].sort()) bytes += copy(root, out, asset, assetOutputOf(asset));
  const tokens = join(root, "design", "tokens.css");
  const css = (existsSync(tokens) ? `${readFileSync(tokens, "utf8")}\n` : "") + readFileSync(new URL("./site.css", import.meta.url), "utf8");
  writeFileSync(join(out, "site.css"), css);
  writeFileSync(join(out, "site.js"), SITE_JS);

  const broken = checkOutput(out);
  const unlisted = sources.filter((p) => !listed.has(p) && p !== portalOf(languageOf(p)) && !/^README/.test(p));
  const report = { pages: counts, assets: assets.size, bytes, broken, unlisted };
  if (!quiet) {
    const total = walkFiles(out).reduce((sum, f) => sum + statSync(f).size, 0);
    const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
    process.stdout.write(`pages built: ${counts.en} English, ${counts.fr} French\n`);
    process.stdout.write(`assets copied: ${assets.size} (${kb(bytes)}), plus site.css and site.js\n`);
    if (unlisted.length) process.stdout.write(`pages outside the portal navigation (${unlisted.length}): ${unlisted.join(", ")}\n`);
    process.stdout.write(`${broken.length === 0 ? "ok  " : "FAIL"} links and anchors of the built site${broken.length ? ` (${broken.length})` : ""}\n`);
    for (const problem of broken) process.stdout.write(`  ${problem}\n`);
    process.stdout.write(`site written to ${relative(process.cwd(), out) || "."}/ (${kb(total)} in all)\n`);
  }
  return report;
}

function option(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function main(argv = process.argv.slice(2)) {
  const out = option(argv, "--out");
  const report = await buildSite({
    out: out ? resolve(out) : join(REPO_ROOT, "site"),
    repoUrl: option(argv, "--repo-url") ?? DEFAULT_REPO_URL,
  });
  return report.broken.length === 0 ? 0 : 1;
}

if (isEntry(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 2; });
}
