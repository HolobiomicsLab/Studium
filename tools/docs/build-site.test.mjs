// tools/docs/build-site.test.mjs — tests of the static documentation site builder.
//
//   node --test tools/docs/build-site.test.mjs
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { runInNewContext } from "node:vm";
import { anchorsOf } from "./check.mjs";
import {
  buildSite, checkOutput, languageOf, navFromPortal, outputPathOf, parseArgs, renderPage, rewriteTarget, twinOf,
} from "./build-site.mjs";

const REPO_URL = "https://github.com/Org/repo/blob/main/";
const roots = [];
function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "studium-docs-site-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

describe("pages and languages", () => {
  test("maps sources to output paths, English at the root and French under fr/", () => {
    assert.equal(outputPathOf("docs/index.md"), "index.html");
    assert.equal(outputPathOf("docs/index.fr.md"), "fr/index.html");
    assert.equal(outputPathOf("docs/teach/teacher-guide.md"), "teach/teacher-guide.html");
    assert.equal(outputPathOf("docs/teach/teacher-guide.fr.md"), "fr/teach/teacher-guide.html");
    assert.equal(outputPathOf("README.md"), "readme.html");
    assert.equal(outputPathOf("README.fr.md"), "fr/readme.html");
    for (const outside of ["docs/design-records/index.md", "docs/internal/agent-log.md", "docs/assets/brand/README.md",
      "CONTRIBUTING.md", "apps/x/README.md"]) assert.equal(outputPathOf(outside), null, outside);
  });
  test("pairs each page with its twin and knows its language", () => {
    assert.equal(twinOf("docs/learn/student-guide.md"), "docs/learn/student-guide.fr.md");
    assert.equal(twinOf("docs/learn/student-guide.fr.md"), "docs/learn/student-guide.md");
    assert.equal(twinOf("README.fr.md"), "README.md");
    assert.equal(languageOf("docs/learn/student-guide.fr.md"), "fr");
    assert.equal(languageOf("README.md"), "en");
  });
});

describe("rewriteTarget", () => {
  const pages = new Set(["docs/index.md", "docs/index.fr.md", "docs/teach/guide.md", "docs/teach/guide.fr.md", "README.md"]);
  const ctx = { pages, repoUrl: REPO_URL, isAsset: (p) => p.startsWith("docs/assets/") && !p.endsWith(".md"), isDir: (p) => p === "apps/lesson-mcp" };
  test("a page link becomes the built page, relative to the current page", () => {
    assert.equal(rewriteTarget("../teach/guide.md", "docs/learn/x.md", ctx).url, "../teach/guide.html");
    assert.equal(rewriteTarget("guide.fr.md", "docs/teach/x.fr.md", ctx).url, "guide.html");
    assert.equal(rewriteTarget("docs/index.md", "README.md", ctx).url, "index.html");
  });
  test("keeps the anchor", () => {
    assert.equal(rewriteTarget("../teach/guide.md#before-you-start", "docs/learn/x.md", ctx).url, "../teach/guide.html#before-you-start");
    assert.equal(rewriteTarget("#local", "docs/learn/x.md", ctx).url, "#local");
  });
  test("crosses languages when the source does", () => {
    assert.equal(rewriteTarget("../teach/guide.md", "docs/learn/x.fr.md", ctx).url, "../../teach/guide.html");
    assert.equal(rewriteTarget("../teach/guide.fr.md", "docs/learn/x.md", ctx).url, "../fr/teach/guide.html");
  });
  test("a file outside the site goes to the repository, a folder to its tree", () => {
    assert.equal(rewriteTarget("../../apps/lesson-mcp/src/server.ts#L3", "docs/develop/x.md", ctx).url, `${REPO_URL}apps/lesson-mcp/src/server.ts#L3`);
    assert.equal(rewriteTarget("../../CHANGELOG.md", "docs/develop/x.md", ctx).url, `${REPO_URL}CHANGELOG.md`);
    assert.equal(rewriteTarget("../design-records/index.md", "docs/develop/x.md", ctx).url, `${REPO_URL}docs/design-records/index.md`);
    assert.equal(rewriteTarget("../../apps/lesson-mcp", "docs/develop/x.md", ctx).url, "https://github.com/Org/repo/tree/main/apps/lesson-mcp");
  });
  test("an image is copied and linked relatively; external links are untouched", () => {
    const r = rewriteTarget("../assets/diagrams/a-light.svg", "docs/teach/x.fr.md", ctx);
    assert.deepEqual(r, { url: "../../assets/diagrams/a-light.svg", asset: "docs/assets/diagrams/a-light.svg" });
    assert.equal(rewriteTarget("docs/assets/hero-light.svg", "README.md", ctx).url, "assets/hero-light.svg");
    assert.equal(rewriteTarget("https://example.org/a.md", "docs/x.md", ctx).url, "https://example.org/a.md");
    assert.equal(rewriteTarget("mailto:a@b.c", "docs/x.md", ctx).url, "mailto:a@b.c");
  });
});

describe("renderPage", () => {
  const ctx = { pages: new Set(["docs/a.md", "docs/a.fr.md"]), repoUrl: REPO_URL, isAsset: () => false, isDir: () => false };
  test("gives headings the anchors the checker (and GitHub) computes", () => {
    const text = [
      "English · [Français](a.fr.md)", "", "# Title", "",
      "## Démarrer le serveur local", "## Run it — the operator harness", "## `start_lesson_session`",
      "## The [file](x.md) protocol: `.studium-session/`", "## Setup", "## Setup", "## Qu'est-ce que c'est ? (« FSRS »)",
      "", "Setext", "------", "", "```bash", "# not a heading", "```",
    ].join("\n");
    const { html } = renderPage(text, "docs/a.md", ctx);
    const ids = [...html.matchAll(/<h[1-6] id="([^"]+)"/g)].map((m) => m[1]);
    const expected = [...anchorsOf(text)];
    assert.deepEqual(ids, expected);
  });
  test("drops the language-switch line, returns the title and the H2s", () => {
    const { html, title, headings } = renderPage("[English](a.md) · Français\n\n# Titre\n\n## Un\n\n### Sous\n\n## Deux\n", "docs/a.fr.md", ctx);
    assert.ok(!html.includes("English"));
    assert.equal(title, "Titre");
    assert.deepEqual(headings.map((h) => h.id), ["un", "deux"]);
  });
  test("rewrites links, puts tables and code in focusable scroll regions", () => {
    const { html } = renderPage("# T\n\n[a](a.fr.md#x)\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```bash\nls\n```\n", "docs/a.md", ctx);
    assert.match(html, /href="fr\/a\.html#x"/);
    assert.match(html, /<div class="scroll" tabindex="0" role="region" aria-label="[^"]+"><table>/);
    assert.match(html, /<th>A<\/th>/);
    assert.match(html, /<pre tabindex="0"><code class="language-bash">/);
  });
});

const PORTAL = [
  "English · [Français](index.fr.md)", "", "# Docs", "", "Intro.", "",
  "## Start with your role", "", "| You are | Read first | Then |", "|---|---|---|",
  "| A student | [Student guide](learn/student.md) | [First lesson](tutorials/first.md) |",
  "| A teacher | [Teacher guide](teach/teacher.md) | [Course](tutorials/course.md) |", "",
  "## Understand", "", "- [How it works](concepts/how.md).", "", "<details>", "<summary>All pages</summary>", "",
  "- **Learn.** [Student guide](learn/student.md) · [Review](learn/review.md)",
  "- **Tutorials.** [First lesson](tutorials/first.md) · [Course](tutorials/course.md)",
  "- **Teach.** [Teacher guide](teach/teacher.md)", "", "</details>", "",
].join("\n");

describe("navFromPortal", () => {
  test("reads the roles from the first table and the groups from the « All pages » list", () => {
    const pages = new Set(["docs/index.md", "docs/learn/student.md", "docs/learn/review.md", "docs/tutorials/first.md",
      "docs/tutorials/course.md", "docs/teach/teacher.md", "docs/concepts/how.md"]);
    const nav = navFromPortal(PORTAL, "docs/index.md", pages);
    assert.equal(nav.roles.label, "Start with your role");
    assert.deepEqual(nav.roles.items.map((r) => [r.label, r.page, r.then.page]), [
      ["A student", "docs/learn/student.md", "docs/tutorials/first.md"],
      ["A teacher", "docs/teach/teacher.md", "docs/tutorials/course.md"],
    ]);
    assert.deepEqual(nav.roles.columns, ["Read first", "Then"]);
    assert.deepEqual(nav.groups.map((g) => g.label), ["Learn", "Tutorials", "Teach", "Other pages"]);
    assert.deepEqual(nav.groups[0].items.map((i) => i.page), ["docs/learn/student.md", "docs/learn/review.md"]);
    assert.deepEqual(nav.groups[3].items.map((i) => [i.label, i.page]), [["How it works", "docs/concepts/how.md"]]);
  });
});

function fixtureSite(extra = {}) {
  return tree({
    "README.md": "English · [Français](README.fr.md)\n\n# Project\n\nSee the [portal](docs/index.md) and [licence](LICENSE).\n",
    "README.fr.md": "[English](README.md) · Français\n\n# Projet\n\nVoir le [portail](docs/index.fr.md).\n",
    "LICENSE": "x\n",
    "docs/index.md": PORTAL.replace("- [How it works](concepts/how.md).", "- [How it works](concepts/how.md#step-two)."),
    "docs/index.fr.md": "[English](index.md) · Français\n\n# Docs FR\n\n<details>\n<summary>Toutes les pages</summary>\n\n- **Apprendre.** [Guide](learn/student.fr.md)\n\n</details>\n",
    "docs/learn/student.md": "English · [Français](student.fr.md)\n\n# Student guide\n\n<picture>\n  <source media=\"(prefers-color-scheme: dark)\" srcset=\"../assets/d-dark.svg\">\n  <img src=\"../assets/d-light.svg\" alt=\"A diagram.\">\n</picture>\n\n## One\n\n## Two\n\nNext: [review](review.md#ok).\n",
    "docs/learn/student.fr.md": "[English](student.md) · Français\n\n# Guide\n\n## Un\n",
    "docs/learn/review.md": "English · [Français](review.fr.md)\n\n# Review\n\n## OK\n",
    "docs/learn/review.fr.md": "[English](review.md) · Français\n\n# Réviser\n",
    "docs/tutorials/first.md": "English · [Français](first.fr.md)\n\n# First\n",
    "docs/tutorials/first.fr.md": "[English](first.md) · Français\n\n# Première\n",
    "docs/tutorials/course.md": "English · [Français](course.fr.md)\n\n# Course\n",
    "docs/tutorials/course.fr.md": "[English](course.md) · Français\n\n# Cours\n",
    "docs/teach/teacher.md": "English · [Français](teacher.fr.md)\n\n# Teacher\n",
    "docs/teach/teacher.fr.md": "[English](teacher.md) · Français\n\n# Enseignant\n",
    "docs/concepts/how.md": "English · [Français](how.fr.md)\n\n# How\n\n## Step two\n",
    "docs/concepts/how.fr.md": "[English](how.md) · Français\n\n# Comment\n",
    "docs/internal/log.md": "# Log\n",
    "docs/assets/d-light.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
    "docs/assets/d-dark.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
    "docs/assets/unused.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
    ...extra,
  });
}

describe("buildSite (end to end)", () => {
  test("builds both languages with a passing link check", async () => {
    const root = fixtureSite();
    const out = join(root, "_site");
    const report = await buildSite({ root, out, repoUrl: REPO_URL, quiet: true });
    assert.deepEqual(report.broken, []);
    assert.deepEqual(report.pages, { en: 8, fr: 8 });
    assert.ok(existsSync(join(out, "assets/d-dark.svg")));
    assert.ok(!existsSync(join(out, "assets/unused.svg")));
    assert.ok(!existsSync(join(out, "internal/log.html")));
    const page = readFileSync(join(out, "fr/learn/student.html"), "utf8");
    assert.match(page, /<html lang="fr"/);
    assert.match(page, /href="\.\.\/\.\.\/learn\/student\.html"[^>]*hreflang="en"/);
    const en = readFileSync(join(out, "learn/student.html"), "utf8");
    assert.match(en, /<a[^>]*aria-current="page"[^>]*>Student guide<\/a>/);
    assert.match(en, /href="review\.html"[^>]*rel="next"|rel="next"[^>]*href="review\.html"/);
    assert.match(en, /href="#one"/);
    assert.match(en, /href="https:\/\/github\.com\/Org\/repo\/blob\/main\/docs\/learn\/student\.md"/);
    assert.ok(!/https?:\/\/(?!github\.com\/Org|holobiomicslab\.cnrs\.fr|ediam\.cnrs\.fr)/.test(en.replace(/http:\/\/www\.w3\.org[^"]*/g, "")), "no other host is referenced");
    for (const [html, lang] of [[en, "en"], [page, "fr"]]) {
      const footer = html.match(/<footer class="site-footer">([\s\S]*?)<\/footer>/)[1];
      assert.match(footer, /Studium · <a href="https:\/\/holobiomicslab\.cnrs\.fr\/">HolobiomicsLab<\/a> · <a href="https:\/\/ediam\.cnrs\.fr\/">eDIAM<\/a> · Institut de Chimie de Nice · Université Côte d'Azur · CNRS/);
      assert.match(footer, lang === "fr" ? /Code sous licence/ : /Code under Apache/);
      assert.equal((html.match(/<footer /g) ?? []).length, 1);
    }
    const home = readFileSync(join(out, "index.html"), "utf8");
    assert.match(home, /class="roles"/);
    assert.equal(checkOutput(out).length, 0);
  });
  test("reports a broken page link and a broken anchor in the output", async () => {
    const root = fixtureSite({ "docs/tutorials/first.md": "English · [Français](first.fr.md)\n\n# First\n\n[x](../learn/review.md#missing)\n" });
    const out = join(root, "_site");
    const report = await buildSite({ root, out, repoUrl: REPO_URL, quiet: true });
    assert.equal(report.broken.length, 1, report.broken.join("\n"));
    assert.match(report.broken[0], /tutorials\/first\.html: .*review\.html#missing/);
    writeFileSync(join(out, "teach/teacher.html"), "<a href=\"nowhere.html\">x</a>");
    assert.ok(checkOutput(out).some((p) => p.includes("nowhere.html")));
  });
});

/** The index a built search-index.js assigns, read without a browser. */
function loadIndex(file) {
  const context = {};
  context.window = context;
  runInNewContext(readFileSync(file, "utf8"), context);
  // A JSON copy brings the arrays into this realm, where deepStrictEqual compares their prototypes.
  return JSON.parse(JSON.stringify(context.STUDIUM_SEARCH_INDEX));
}

/** The pure functions of the client script, loaded as a browser would load it but without a document. */
function loadClient() {
  const context = {};
  context.window = context;
  runInNewContext(readFileSync(new URL("./site-client.js", import.meta.url), "utf8"), context);
  const docs = context.StudiumDocs;
  return { ...docs, search: (index, query) => JSON.parse(JSON.stringify(docs.search(index, query))) };
}

describe("search index", () => {
  const extra = {
    "docs/learn/student.fr.md": "[English](student.md) · Français\n\n# Guide de l'élève\n\nUn élève révise seul.\n\n## Un\n\n### Préparer la séance\n\n```bash\nsecret-command --flag\n```\n",
  };
  test("writes one index per language with titles, H2 and H3 anchors and plain text without code", async () => {
    const root = fixtureSite(extra);
    const out = join(root, "_site");
    const report = await buildSite({ root, out, repoUrl: REPO_URL, quiet: true });
    assert.deepEqual(report.broken, []);
    const en = loadIndex(join(out, "search-index.js")).en;
    const fr = loadIndex(join(out, "fr/search-index.js")).fr;
    assert.equal(en.length, 8);
    assert.equal(fr.length, 8);
    const guide = fr.find((p) => p.url === "learn/student.html");
    assert.equal(guide.title, "Guide de l'élève");
    assert.deepEqual(guide.headings, [{ id: "un", text: "Un", level: 2 }, { id: "préparer-la-séance", text: "Préparer la séance", level: 3 }]);
    assert.match(guide.text, /Un élève révise seul\./);
    assert.ok(!guide.text.includes("secret-command"), "code blocks stay out of the index");
    const page = readFileSync(join(out, "fr/learn/student.html"), "utf8");
    assert.match(page, /id="préparer-la-séance"/);
    for (const entry of [...en.map((p) => ["", p]), ...fr.map((p) => ["fr/", p])]) {
      assert.ok(existsSync(join(out, entry[0] + entry[1].url)), entry[1].url);
    }
    assert.ok(report.searchIndexBytes.en > 0 && report.searchIndexBytes.fr > 0);
  });
  test("each page names its language's index and root relative to itself, outside href and src", async () => {
    const root = fixtureSite();
    const out = join(root, "_site");
    await buildSite({ root, out, repoUrl: REPO_URL, quiet: true });
    const fr = readFileSync(join(out, "fr/learn/student.html"), "utf8");
    assert.match(fr, /<body data-search-index="\.\.\/search-index\.js" data-search-root="\.\.\/">/);
    const home = readFileSync(join(out, "index.html"), "utf8");
    assert.match(home, /<body data-search-index="search-index\.js" data-search-root="">/);
    assert.ok(!/<input/.test(home), "the search box is drawn by the script, so it never shows broken without it");
  });
  test("the link check catches a page pointing at a missing search index", async () => {
    const root = fixtureSite();
    const out = join(root, "_site");
    await buildSite({ root, out, repoUrl: REPO_URL, quiet: true });
    rmSync(join(out, "fr/search-index.js"));
    assert.ok(checkOutput(out).some((p) => p.includes("search-index.js")));
  });
});

describe("search client", () => {
  const client = loadClient();
  const index = [
    { url: "a.html", title: "Text only", headings: [], text: "Nothing here, but later the élève appears in the running text of this page." },
    { url: "b.html", title: "Heading page", headings: [{ id: "eleve-section", text: "L'élève et la séance", level: 2 }], text: "Body." },
    { url: "c.html", title: "Guide de l'Élève", headings: [], text: "Body." },
    { url: "d.html", title: "Unrelated", headings: [], text: "Nothing." },
  ];
  test("folds accents and case", () => {
    assert.equal(client.fold("Élève ÉCOLE"), "eleve ecole");
  });
  test("ranks title matches, then heading matches, then text matches", () => {
    const results = client.search(index, "eleve");
    assert.deepEqual(results.map((r) => [r.url, r.kind]), [["c.html", "title"], ["b.html#eleve-section", "heading"], ["a.html", "text"]]);
    assert.equal(results[1].label, "Heading page › L'élève et la séance");
  });
  test("gives a short excerpt around a text match, with the original accents", () => {
    const [hit] = client.search(index.slice(0, 1), "ELEVE");
    assert.match(hit.excerpt, /élève appears/);
    assert.ok(hit.excerpt.length <= 140, hit.excerpt);
  });
  test("requires every word of the query and ignores an empty one", () => {
    assert.deepEqual(client.search(index, "eleve running").map((r) => r.url), ["a.html"]);
    assert.deepEqual(client.search(index, "   "), []);
  });
  test("speaks the page's language", () => {
    assert.equal(client.stringsFor("fr").copied, "Copié");
    assert.equal(client.stringsFor("en").copy, "Copy");
    assert.equal(client.stringsFor("de").copy, "Copy");
  });
});

describe("footer and command line", () => {
  test("names the revision when one is given, and nothing about it otherwise; never says prototype", async () => {
    const root = fixtureSite();
    const out = join(root, "_site");
    await buildSite({ root, out, repoUrl: REPO_URL, quiet: true, revision: "v0.5.0" });
    const footerOf = (file) => readFileSync(join(out, file), "utf8").match(/<footer class="site-footer">([\s\S]*?)<\/footer>/)[1];
    assert.match(footerOf("learn/student.html"), /built from the Markdown[^<]*<code>v0\.5\.0<\/code>/);
    assert.match(footerOf("fr/learn/student.html"), /construites à partir des fichiers Markdown[^<]*<code>v0\.5\.0<\/code>/);
    await buildSite({ root, out, repoUrl: REPO_URL, quiet: true });
    for (const file of ["learn/student.html", "fr/learn/student.html"]) {
      const html = readFileSync(join(out, file), "utf8");
      assert.ok(!/r[ée]vision/i.test(footerOf(file)), file);
      assert.ok(!/prototype/i.test(html), file);
    }
  });
  test("reads --out, --repo-url and --revision", () => {
    assert.deepEqual(parseArgs(["--out", "x", "--repo-url", "https://e.org/", "--revision", "abc123"]), { out: "x", repoUrl: "https://e.org/", revision: "abc123" });
    assert.deepEqual(parseArgs([]), { out: undefined, repoUrl: undefined, revision: undefined });
  });
  test("ships one client script with the copy buttons and the search, and no inline handler", async () => {
    const root = fixtureSite();
    const out = join(root, "_site");
    await buildSite({ root, out, repoUrl: REPO_URL, quiet: true });
    const js = readFileSync(join(out, "site.js"), "utf8");
    assert.equal(js, readFileSync(new URL("./site-client.js", import.meta.url), "utf8"));
    assert.match(js, /navigator\.clipboard/);
    const html = readFileSync(join(out, "learn/student.html"), "utf8");
    assert.ok(!/\son[a-z]+="/.test(html), "no inline event handler");
  });
});
