/* graph-pane.js — a GENERIC Cytoscape host for the typed-graph-lens.
 *
 * It is domain-agnostic: the extension host computes Cytoscape elements + a stylesheet from a
 * normalized GraphView (via @studium/typed-graph-lens) and posts them here; this file just lays the
 * graph out (dagre, top-down) and renders. The same pane therefore serves Studium's LWG today and
 * indicium / Astra graphs later — only the producer changes. Posts node taps back to the host.
 * The message carries `strings` (the phrases.ts catalogue) and `locale`, as extension.ts pushGraph sends
 * them; without them (an older host) the pane falls back to its built-in French strings.
 */
(function () {
  "use strict";
  const DEFAULT_STRINGS = {
    graph_title: "Graphe d'apprentissage",
    graph_mode_student: "vue apprenant",
    graph_mode_teacher: "vue enseignant",
    graph_unavailable: "Graphe indisponible : la bibliothèque d'affichage n'a pas pu être chargée.",
    graph_summary: "{title} : {nodes} nœuds, {edges} liens.",
    graph_legend: "Légende",
  };
  let strings = { ...DEFAULT_STRINGS };
  function t(key, params) {
    const template = strings[key] || DEFAULT_STRINGS[key] || key;
    return template.replace(/\{([a-z_]+)\}/gi, (token, name) =>
      params && params[name] !== undefined ? String(params[name]) : token);
  }
  let cy = null;

  function ensureDagre() {
    if (window.cytoscape && window.cytoscapeDagre && !window.__dagreReg) {
      try { window.cytoscape.use(window.cytoscapeDagre); window.__dagreReg = true; } catch (e) { /* fall back to breadthfirst */ }
    }
  }

  const reducedMotion = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function render(d) {
    if (d.strings && typeof d.strings === "object") strings = { ...DEFAULT_STRINGS, ...d.strings };
    if (d.locale) document.documentElement.lang = d.locale;
    const container = document.getElementById("graph");
    const els = d.elements || { nodes: [], edges: [] };
    const nodes = els.nodes || [], edges = els.edges || [];
    const title = d.title || t("graph_title");
    // The canvas is a picture to assistive technology: it gets a role and a summary in words (VSC-3).
    container.setAttribute("role", "img");
    container.setAttribute("aria-label", t("graph_summary", { title, nodes: nodes.length, edges: edges.length }));
    renderLegend(d.legend, title, d.mode);
    if (!window.cytoscape) { container.textContent = t("graph_unavailable"); return; }
    ensureDagre();
    const layout = window.__dagreReg
      ? { name: "dagre", rankDir: "TB", nodeSep: 18, rankSep: 46, edgeSep: 8 }
      : { name: "breadthfirst", directed: true, spacingFactor: 1.1 };
    if (cy) { try { cy.destroy(); } catch (e) { /* noop */ } cy = null; }
    cy = window.cytoscape({ container, elements: [].concat(nodes, edges), style: d.style || [], layout, wheelSensitivity: 0.2 });
    if (d.focus) {
      const f = cy.getElementById(d.focus);
      // Under reduced motion the view jumps to the focused node instead of gliding there.
      if (f && f.length) cy.animate({ center: { eles: f }, zoom: 1.15 }, { duration: reducedMotion() ? 0 : 280 });
    }
    cy.on("tap", "node", (ev) => {
      const n = ev.target.data();
      if (window.__send) window.__send({ type: "nodeClick", id: n.id, label: n.label, state: n.state, value: n.value });
    });
  }

  function renderLegend(legend, title, mode) {
    const box = document.getElementById("legend");
    if (!box) return;
    box.innerHTML = "";
    box.setAttribute("aria-label", t("graph_legend"));
    const heading = document.createElement("span");
    heading.className = "legend-title";
    const modeLabel = mode === "student" ? t("graph_mode_student") : mode === "teacher" ? t("graph_mode_teacher") : "";
    heading.textContent = title + (modeLabel ? "  ·  " + modeLabel : "");
    box.appendChild(heading);
    const list = document.createElement("span");
    list.className = "legend-items";
    list.setAttribute("role", "list");
    (legend || []).forEach((e) => {
      const row = document.createElement("span");
      row.className = "legend-item";
      row.setAttribute("role", "listitem");
      const sw = document.createElement("span");
      sw.className = "legend-swatch";
      sw.setAttribute("aria-hidden", "true");
      sw.style.background = e.swatch;
      row.appendChild(sw);
      row.appendChild(document.createTextNode(e.label));
      list.appendChild(row);
    });
    box.appendChild(list);
  }

  window.addEventListener("message", (ev) => {
    const d = ev.data || {};
    if (d.type === "graph") render(d);
  });
  const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;
  window.__send = (msg) => { if (vscode) vscode.postMessage(msg); };
})();
