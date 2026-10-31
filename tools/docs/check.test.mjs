// tools/docs/check.test.mjs — tests of the documentation gate and of the generators' pure parts.
//
//   node --test tools/docs/check.test.mjs
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { anchorsOf, checkLinks, checkPairs, checkToolsDocumented, linksOf, markdownFiles, slug } from "./check.mjs";
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
    assert.equal(typeLabel(schema.properties.input), "object, one of 2 shapes");
  });
  test("flattens nested objects, arrays and variants", () => {
    const rows = schemaRows(schema);
    const byPath = Object.fromEntries(rows.map((r) => [r.path, r]));
    assert.equal(byPath.session_id.required, "yes");
    assert.equal(byPath.grade.required, "no");
    assert.equal(byPath["input.kind"].type, "one of `predict`, `begin`");
    assert.equal(byPath["input.text"].required, "in `predict`");
    assert.equal(byPath["checks[].check"].required, "yes");
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
