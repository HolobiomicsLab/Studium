// esbuild plus a template keeps the MCP resources self-contained without another bundler.
import { readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import "./vendor.mjs";
const root = fileURLToPath(new URL(".", import.meta.url));
const read = file => readFileSync(`${root}${file}`, "utf8");
const sri = file => `sha384-${createHash("sha384").update(readFileSync(`${root}vendor/${file}`)).digest("base64")}`;
const pinned = path => path.replace(/^([^@]+)@[^/]+/, (_, name) => `${name}@${JSON.parse(readFileSync(new URL(`./node_modules/${name}/package.json`, import.meta.url), "utf8")).version}`);
const cdn = (path, file, css = false) => css
  ? `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/${pinned(path)}" integrity="${sri(file)}" crossorigin="anonymous">`
  : `<script defer src="https://cdn.jsdelivr.net/npm/${pinned(path)}" integrity="${sri(file)}" crossorigin="anonymous"></script>`;
const science = [cdn("katex@0.16.9/dist/katex.min.css", "katex/katex.min.css", true),
  cdn("vega@5.33.1/build/vega.min.js", "vega.min.js"), cdn("vega-lite@5.23.0/build/vega-lite.min.js", "vega-lite.min.js"),
  cdn("vega-embed@6.29.0/build/vega-embed.min.js", "vega-embed.min.js"), cdn("3dmol@2.5.5/build/3Dmol-min.js", "3Dmol-min.js")];
const graph = [cdn("cytoscape@3.34.0/dist/cytoscape.min.js", "cytoscape.min.js"), cdn("dagre@0.8.5/dist/dagre.min.js", "dagre.min.js"), cdn("cytoscape-dagre@4.0.0/dist/cytoscape-dagre.js", "cytoscape-dagre.js")];
mkdirSync(`${root}dist/vscode`, { recursive: true });
for (const name of readdirSync(`${root}src`).filter(name => /(?:\.css|pane\.js|bridge-vscode\.js)$/.test(name))) {
  writeFileSync(`${root}dist/vscode/${name}`, read(`src/${name}`).replace(/export \{ renderView \};?\s*$/, ""));
}
cpSync(`${root}vendor`, `${root}dist/vscode/vendor`, { recursive: true });
cpSync(`${root}VENDOR-LICENSES.md`, `${root}dist/vscode/VENDOR-LICENSES.md`);
for (const kind of ["lesson", "graph"]) {
  const css = ["studium-tokens.css", "studium-components.css", `${kind === "lesson" ? "artifact" : "graph"}-pane.css`];
  const result = await build({ entryPoints: [`${root}src/${kind}-entry.js`], bundle: true, write: false, format: "iife", minify: true, target: "es2022" });
  const inline = kind === "lesson" ? ["marked.min.js", "katex/katex.min.js", "katex/mhchem.min.js"].map(file => read(`vendor/${file}`)).join("\n;\n") : "";
  const script = `${inline}\n;\n${result.outputFiles[0].text}`.replace(/<\/script/gi, "<\\/script");
  const html = read(`${kind}-panel.html`).replace("<!--STYLES-->", () => `<style>${css.map(file => read(`src/${file}`)).join("\n")}</style>`)
    .replace("<!--LIBRARIES-->", () => (kind === "lesson" ? science : graph).join("\n")).replace("<!--ENTRY-->", () => `<script>${script}</script>`);
  const bytes = Buffer.byteLength(html);
  if (bytes > 1_500_000) throw new Error(`${kind} resource exceeds 1.5 MB: ${bytes}`);
  writeFileSync(`${root}dist/${kind}-panel.html`, html);
  console.log(`${kind}-panel.html: ${bytes} bytes`);
}

writeFileSync(`${root}dist/resources.js`, `export const lessonHtml = ${JSON.stringify(read("dist/lesson-panel.html"))};\nexport const graphHtml = ${JSON.stringify(read("dist/graph-panel.html"))};\n`);
writeFileSync(`${root}dist/resources.d.ts`, "export declare const lessonHtml: string;\nexport declare const graphHtml: string;\n");
