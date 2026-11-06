#!/usr/bin/env node
// tools/docs/gen-mcp-tools.mjs — regenerate the tool reference in docs/reference/mcp-tools.md and
// docs/reference/mcp-tools.fr.md from the running MCP server (apps/lesson-mcp): every tool's name,
// description and input fields, the prompts and the server instructions.
//
//   node tools/docs/gen-mcp-tools.mjs           # rewrite the generated region of both pages
//   node tools/docs/gen-mcp-tools.mjs --check   # exit 1 when a page is out of date
import { generatorMain, isEntry, runDump } from "./lib/generated.mjs";
import { prose, rowsTable, schemaRows, tableCell } from "./lib/schema-table.mjs";

export const REGION = "mcp-tools";
export const PAGES = ["docs/reference/mcp-tools.md", "docs/reference/mcp-tools.fr.md"];

const GROUPS = [
  ["study", "Study tools", "What to do now, and reviews over days."],
  ["authoring", "Authoring tools", "Turn sources the learner chose into a playable lesson."],
  ["lesson", "Lesson tools", "Play one lesson: scenes, answers, hints, runs, experiments, peer rooms and data."],
  ["teacher", "Teacher tools", "Review a lesson and read an aggregated class report."],
  ["form", "Form tool (prototype)", "Answer screens and quizzes in forms the client shows, with no model turn in between."],
  ["panel", "Panel tools", "Open a lesson as a panel the host renders next to the conversation, and act on it."],
];

/** The first sentence of a description, for the summary table. */
function firstSentence(text) {
  const flat = text.replace(/\s+/g, " ").trim();
  const match = flat.match(/^(.+?\.)(\s+[A-Z(`"]|$)/);
  const sentence = match ? match[1] : flat;
  return sentence.length > 160 ? `${sentence.slice(0, 157).trimEnd()}...` : sentence;
}

/** The Markdown of the generated region, from the dump of the server. */
export function renderTools(dump) {
  const out = [];
  const known = new Set(GROUPS.map(([g]) => g));
  const groups = [...GROUPS, ...[...new Set(dump.tools.map((t) => t.group))].filter((g) => !known.has(g))
    .map((g) => [g, `Other tools (${g})`, ""])];
  const byGroup = (g) => dump.tools.filter((t) => t.group === g).sort((a, b) => a.name.localeCompare(b.name));

  out.push(`The server registers ${dump.tools.length} tools.`, "");
  out.push("| Tool | Group | Summary |", "|---|---|---|");
  for (const [group, title] of groups) {
    for (const tool of byGroup(group)) {
      out.push(`| [${tool.name}](#${tool.name}) | ${title.replace(/ tools$/, "")} | ${tableCell(prose(firstSentence(tool.description)))} |`);
    }
  }
  out.push("");

  for (const [group, title, blurb] of groups) {
    const tools = byGroup(group);
    if (tools.length === 0) continue;
    out.push(`## ${title}`, "");
    if (blurb) out.push(blurb, "");
    for (const tool of tools) {
      out.push(`### ${tool.name}`, "");
      out.push(prose(tool.description.replace(/\s+/g, " ").trim()), "");
      const rows = schemaRows(tool.inputSchema, { maxDepth: 3 });
      out.push(rows.length ? rowsTable(rows) : "No arguments.", "");
    }
  }

  out.push("## Prompts", "");
  out.push("| Prompt | Title | Description | Arguments |", "|---|---|---|---|");
  for (const prompt of dump.prompts) {
    const args = prompt.arguments.map((a) => `\`${a.name}\`${a.required ? " (required)" : ""}: ${a.description ?? ""}`).join("; ");
    out.push(`| \`${prompt.name}\` | ${tableCell(prompt.title)} | ${tableCell(prose(prompt.description))} | ${tableCell(prose(args))} |`);
  }
  out.push("");
  out.push("## Server instructions", "");
  out.push("What a harness receives once, when it connects (MCP `instructions`):", "");
  out.push("```text", dump.instructions, "```");
  return out.join("\n");
}

export function dumpServer() {
  return runDump("dump-mcp.mts");
}

export function render() {
  return renderTools(dumpServer());
}

if (isEntry(import.meta.url)) generatorMain(PAGES, REGION, render);
