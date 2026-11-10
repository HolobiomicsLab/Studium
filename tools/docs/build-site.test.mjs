// tools/docs/build-site.test.mjs — tests of the static documentation site builder.
//
//   node --test tools/docs/build-site.test.mjs
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { anchorsOf } from "./check.mjs";
import {
  buildSite, checkOutput, languageOf, navFromPortal, outputPathOf, renderPage, rewriteTarget, twinOf,
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
    assert.ok(!/https?:\/\/(?!github\.com\/Org)/.test(en.replace(/http:\/\/www\.w3\.org[^"]*/g, "")), "no other host is referenced");
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
