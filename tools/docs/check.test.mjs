// tools/docs/check.test.mjs — tests of the documentation gate and of the generators' pure parts.
//
//   node --test tools/docs/check.test.mjs
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import {
  anchorsOf, checkImages, checkLength, checkLinks, checkPairs, checkReachable, checkSwitchLine, checkToolsDocumented,
  linksOf, markdownFiles, slug,
} from "./check.mjs";
import { readRegion, replaceRegion } from "./lib/generated.mjs";
import { rowsTable, schemaRows, typeLabel } from "./lib/schema-table.mjs";
import { renderTools } from "./gen-mcp-tools.mjs";

const roots = [];
function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "studium-docs-check-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

describe("slug", () => {
  test("follows GitHub's rules", () => {
    assert.equal(slug("Run it — the operator harness"), "run-it--the-operator-harness");
    assert.equal(slug("`start_lesson_session`"), "start_lesson_session");
    assert.equal(slug("Démarrer le serveur local"), "démarrer-le-serveur-local");
    assert.equal(slug("The [file](x.md) protocol: `.studium-session/`"), "the-file-protocol-studium-session");
  });
  test("numbers duplicate headings and reads explicit ids", () => {
    const anchors = anchorsOf("# A\n\n## Setup\n\n## Setup\n\nSetext\n------\n\n<a id=\"custom\"></a>\n");
    for (const a of ["a", "setup", "setup-1", "setext", "custom"]) assert.ok(anchors.has(a), a);
  });
  test("ignores headings inside code fences", () => {
    assert.ok(!anchorsOf("```bash\n# not a heading\n```\n").has("not-a-heading"));
  });
});

describe("linksOf", () => {
  test("finds Markdown, reference and HTML links but not code", () => {
    const text = [
      "See [a](a.md#x) and ![img](i.svg \"t\").",
      "Inline `[no](no.md)` is code.",
      "```md", "[fenced](f.md)", "```",
      "[ref]: <r.md>",
      "<picture><source srcset=\"d.svg 2x, e.svg\"><img src=\"l.svg\" alt=\"\"></picture>",
    ].join("\n");
    assert.deepEqual(linksOf(text).map((l) => l.target).sort(), ["a.md#x", "d.svg", "e.svg", "i.svg", "l.svg", "r.md"]);
  });
});

describe("checkLinks", () => {
  test("reports missing files and anchors, accepts the rest", () => {
    const root = tree({
      "README.md": "# Top\n\n[ok](docs/a.md#part-one) [dir](docs) [self](#top) [web](https://x.y) [mail](mailto:a@b)\n" +
        "[gone](docs/missing.md) [bad](docs/a.md#nope) [abs](/docs/a.md)\n",
      "docs/a.md": "# A\n\n## Part one\n",
    });
    const problems = checkLinks(root);
    assert.equal(problems.length, 2, problems.join("\n"));
    assert.match(problems[0], /README\.md:4: broken link docs\/missing\.md/);
    assert.match(problems[1], /broken anchor docs\/a\.md#nope/);
  });
  test("skips node_modules and symbolic links", () => {
    const root = tree({ "node_modules/x/README.md": "[gone](nowhere.md)\n", "real/b.md": "[gone](nowhere.md)\n" });
    symlinkSync(join(root, "real"), join(root, "linked"));
    assert.deepEqual(markdownFiles(root), ["real/b.md"]);
  });
});

describe("checkPairs", () => {
  test("wants an English and a French page under docs/, except the single-language folders", () => {
    const root = tree({
      "docs/start/quickstart.md": "", "docs/start/quickstart.fr.md": "",
      "docs/learn/guide.md": "", "docs/teach/only.fr.md": "",
      "docs/design-records/adr/0001.md": "", "docs/internal/agent-log.md": "", "docs/assets/brand/README.md": "", "README.md": "",
    });
    assert.deepEqual(checkPairs(root), [
      "docs/learn/guide.md: no French twin (docs/learn/guide.fr.md)",
      "docs/teach/only.fr.md: no English twin (docs/teach/only.md)",
    ]);
  });
});

describe("checkSwitchLine", () => {
  test("wants the exact language-switch line first, on pages that have a twin", () => {
    const root = tree({
      "README.md": "English · [Français](README.fr.md)\n\n# R\n", "README.fr.md": "[English](README.md) · Français\n",
      "docs/a.md": "English · [Français](a.fr.md)\n", "docs/a.fr.md": "[English](a.md) · Français\n",
      "docs/b.md": "# B\n\nEnglish · [Français](b.fr.md)\n", "docs/b.fr.md": "English · [Français](b.fr.md)\n",
      "docs/c.md": "English · [Français](other.fr.md)\n", "docs/c.fr.md": "[English](c.md) · Français\n",
      "docs/design-records/x.md": "# no line\n", "docs/assets/brand/README.md": "# no line\n",
    });
    assert.deepEqual(checkSwitchLine(root), [
      "docs/b.fr.md:1: first line must be `[English](b.md) · Français`",
      "docs/b.md:1: first line must be `English · [Français](b.fr.md)`",
      "docs/c.md:1: first line must be `English · [Français](c.fr.md)`",
    ]);
  });
  test("checks the root README pair too", () => {
    const root = tree({ "README.md": "# R\n", "README.fr.md": "[English](README.md) · Français\n" });
    assert.deepEqual(checkSwitchLine(root), ["README.md:1: first line must be `English · [Français](README.fr.md)`"]);
  });
});

describe("checkReachable", () => {
  test("wants every portal page linked from the index of its language, even inside <details>", () => {
    const root = tree({
      "docs/index.md": "# I\n\n[a](start/a.md)\n<details><summary>x</summary>\n\n[b](learn/b.md#top)\n\n</details>\n",
      "docs/index.fr.md": "# I\n\n[a](start/a.fr.md)\n[b-en](learn/b.md)\n",
      "docs/start/a.md": "", "docs/start/a.fr.md": "", "docs/start/c.md": "", "docs/start/c.fr.md": "",
      "docs/learn/b.md": "", "docs/learn/b.fr.md": "",
      "docs/design-records/r.md": "", "docs/assets/x/README.md": "", "docs/examples/e.md": "",
    });
    assert.deepEqual(checkReachable(root), [
      "docs/learn/b.fr.md: not linked from docs/index.fr.md",
      "docs/start/c.fr.md: not linked from docs/index.fr.md",
      "docs/start/c.md: not linked from docs/index.md",
    ]);
  });
});

describe("checkImages", () => {
  const png = "";
  test("wants the dark twin of a light image, and the reverse", () => {
    const root = tree({
      "docs/a.md": "![shot](assets/s-light.png) ![x](assets/ok-light.png)\n" +
        "<picture><source media=\"(prefers-color-scheme: dark)\" srcset=\"assets/p-dark.png\"><img src=\"assets/p-light.png\" alt=\"p\"></picture>\n" +
        "<picture><source srcset=\"assets/q-dark.png\"><img src=\"assets/q-light.png\" alt=\"q\"></picture>\n" +
        "![plain](assets/plain.png) ![ext](https://x.y/z-light.png)\n",
      "docs/assets/s-light.png": png, "docs/assets/ok-light.png": png, "docs/assets/ok-dark.png": png,
      "docs/assets/p-dark.png": png, "docs/assets/p-light.png": png, "docs/assets/q-dark.png": png, "docs/assets/q-light.png": png,
      "docs/assets/q-dark.png.bak": png, "docs/assets/plain.png": png,
    });
    assert.deepEqual(checkImages(root, ["docs/a.md"], new Set()), [
      "docs/a.md:1: docs/assets/s-light.png has no docs/assets/s-dark.png",
    ]);
  });
  test("reports a dark image without its light twin", () => {
    const root = tree({ "docs/a.md": "![d](d-dark.svg)\n", "docs/d-dark.svg": "" });
    assert.deepEqual(checkImages(root, ["docs/a.md"], new Set()), ["docs/a.md:1: docs/d-dark.svg has no docs/d-light.svg"]);
  });
  test("accepts an allowlisted single-theme image", () => {
    const root = tree({ "docs/a.md": "![d](d-light.png)\n", "docs/d-light.png": "" });
    assert.deepEqual(checkImages(root, ["docs/a.md"], new Set(["docs/d-light.png"])), []);
  });
  test("wants a non-empty alt text on Markdown and HTML images, outside code", () => {
    const root = tree({
      "docs/a.md": "![](x.png)\n![ok](x.png)\n<img src=\"x.png\">\n<img src=\"x.png\" alt=\"\">\n<img\n  src=\"x.png\"\n  alt=\"fine\">\n`![](x.png)`\n",
      "docs/x.png": "",
    });
    assert.deepEqual(checkImages(root, ["docs/a.md"], new Set()), [
      "docs/a.md:1: image without alt text",
      "docs/a.md:3: image without alt text",
      "docs/a.md:4: image without alt text",
    ]);
  });
  test("skips design-records and internal", () => {
    const root = tree({ "docs/design-records/a.md": "![](x-light.png)\n", "docs/internal/b.md": "![](x-light.png)\n" });
    assert.deepEqual(checkImages(root, ["docs/design-records/a.md", "docs/internal/b.md"], new Set()), []);
  });
});

describe("checkLength", () => {
  test("warns about pages over 200 lines, except those with a generated region", () => {
    const lines = (n, extra = "") => `${"line\n".repeat(n)}${extra}`;
    const root = tree({
      "docs/long.md": lines(201), "docs/exact.md": lines(200), "docs/long.fr.md": lines(250),
      "docs/gen.md": lines(300, "<!-- BEGIN GENERATED: x -->\n"), "docs/design-records/big.md": lines(500), "README.md": lines(300),
    });
    assert.deepEqual(checkLength(root), [
      "docs/long.fr.md: 250 lines (over 200)",
      "docs/long.md: 201 lines (over 200)",
    ]);
  });
});

describe("checkToolsDocumented", () => {
  test("names every tool without a section", () => {
    const root = tree({ "docs/reference/mcp-tools.md": "# Tools\n\n### list_lessons\n" });
    assert.deepEqual(checkToolsDocumented(root, ["list_lessons", "rate_recall"]),
      ["docs/reference/mcp-tools.md: tool rate_recall is not documented"]);
  });
});

describe("generated regions", () => {
  const page = "intro\n\n<!-- BEGIN GENERATED: demo (old) -->\nold body\n<!-- END GENERATED: demo -->\n\noutro\n";
  test("replaceRegion keeps the hand-written text around the region", () => {
    const next = replaceRegion(page, "demo", "new body");
    assert.ok(next.startsWith("intro\n\n<!-- BEGIN GENERATED: demo (tools/docs/gen-demo.mjs"));
    assert.ok(next.endsWith("<!-- END GENERATED: demo -->\n\noutro\n"));
    assert.equal(readRegion(next, "demo").trim(), "new body");
    assert.equal(replaceRegion(next, "demo", "new body"), next);
  });
  test("replaceRegion refuses a page without markers", () => {
    assert.throws(() => replaceRegion("no markers", "demo", "x"), /not found/);
  });
});

describe("schema tables", () => {
  const schema = {
    type: "object",
    properties: {
      session_id: { type: "string" },
      grade: { type: "string", enum: ["again", "hard"] },
      max_items: { type: "integer", minimum: 1, maximum: 50, description: "how many | at most" },
      input: {
        anyOf: [
          { type: "object", properties: { kind: { const: "predict" }, text: { type: "string", minLength: 1 } }, required: ["kind", "text"] },
          { type: "object", properties: { kind: { const: "begin" } }, required: ["kind"] },
          {
            type: "object", required: ["kind", "verdicts"],
            properties: { kind: { const: "verdicts" }, verdicts: { type: "array", items: { type: "object", properties: { token: { type: "string" } }, required: ["token"] } } },
          },
        ],
      },
      checks: { type: "array", items: { type: "object", properties: { check: { type: "string" } }, required: ["check"] } },
      alias: { $ref: "#/properties/session_id" },
    },
    required: ["session_id", "input"],
  };
  test("labels types, bounds, enums and refs", () => {
    assert.equal(typeLabel(schema.properties.max_items), "integer (1–50)");
    assert.equal(typeLabel(schema.properties.grade), "one of `again`, `hard`");
    assert.equal(typeLabel(schema.properties.alias, schema), "string");
    assert.equal(typeLabel(schema.properties.input), "object, one of 3 shapes");
  });
  test("flattens nested objects, arrays and variants", () => {
    const rows = schemaRows(schema);
    const byPath = Object.fromEntries(rows.map((r) => [r.path, r]));
    assert.equal(byPath.session_id.required, "yes");
    assert.equal(byPath.grade.required, "no");
    assert.equal(byPath["input.kind"].type, "one of `predict`, `begin`, `verdicts`");
    assert.equal(byPath["input.text"].required, "in `predict`");
    assert.equal(byPath["checks[].check"].required, "yes");
    // An array of objects inside one shape of a union keeps its item rows (submit_response's verdicts).
    assert.equal(byPath["input.verdicts[].token"]?.required, "yes");
  });
  test("escapes pipes in table cells", () => {
    assert.match(rowsTable(schemaRows(schema)), /how many \\\| at most/);
  });
  test("renderTools gives every tool its own section", () => {
    const md = renderTools({
      instructions: "be kind",
      tools: [
        { name: "rate_recall", group: "study", description: "Rate. More text.", inputSchema: schema },
        { name: "get_server_info", group: "lesson", description: "Describe the server.", inputSchema: { type: "object", properties: {} } },
      ],
      prompts: [{ name: "learn", title: "Learn", description: "Learn a topic.", arguments: [{ name: "topic", required: false }] }],
    });
    const anchors = anchorsOf(md);
    assert.ok(anchors.has("rate_recall") && anchors.has("get_server_info"));
    assert.match(md, /\| \[rate_recall\]\(#rate_recall\) \| Study \| Rate\. \|/);
    assert.match(md, /No arguments\./);
  });
});
