// Reproduce browser assets from the already installed, pinned extension packages.
import { cpSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL(".", import.meta.url));
const modules = fileURLToPath(new URL("./node_modules/", import.meta.url));
export const VENDOR_FILES = [
  ["marked/marked.min.js", "marked.min.js"],
  ["katex/dist/katex.min.js", "katex/katex.min.js"],
  ["katex/dist/katex.min.css", "katex/katex.min.css"],
  ["katex/dist/contrib/mhchem.min.js", "katex/mhchem.min.js"],
  ["katex/dist/fonts", "katex/fonts"],
  ["vega/build/vega.min.js", "vega.min.js"],
  ["vega-lite/build/vega-lite.min.js", "vega-lite.min.js"],
  ["vega-embed/build/vega-embed.min.js", "vega-embed.min.js"],
  ["3dmol/build/3Dmol-min.js", "3Dmol-min.js"],
  ["cytoscape/dist/cytoscape.min.js", "cytoscape.min.js"],
  ["dagre/dist/dagre.min.js", "dagre.min.js"],
  ["cytoscape-dagre/dist/cytoscape-dagre.js", "cytoscape-dagre.js"],
];
mkdirSync(`${root}vendor/katex`, { recursive: true });
for (const [source, destination] of VENDOR_FILES) cpSync(`${modules}${source}`, `${root}vendor/${destination}`, { recursive: true });
