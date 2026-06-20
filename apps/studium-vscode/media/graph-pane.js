/* graph-pane.js — a GENERIC Cytoscape host for the typed-graph-lens.
 *
 * It is domain-agnostic: the extension host computes Cytoscape elements + a stylesheet from a
 * normalized GraphView (via @studium/typed-graph-lens) and posts them here; this file just lays the
 * graph out (dagre, top-down) and renders. The same pane therefore serves Studium's LWG today and
 * indicium / Astra graphs later — only the producer changes. Posts node taps back to the host.
 */
(function () {
  "use strict";
  let cy = null;

  function ensureDagre() {
    if (window.cytoscape && window.cytoscapeDagre && !window.__dagreReg) {
      try { window.cytoscape.use(window.cytoscapeDagre); window.__dagreReg = true; } catch (e) { /* fall back to breadthfirst */ }
    }
  }

  function render(d) {
    const container = document.getElementById("graph");
    if (!window.cytoscape) { container.textContent = "(cytoscape not loaded — set studium.assets)"; return; }
    ensureDagre();
    const els = d.elements || { nodes: [], edges: [] };
    const elements = [].concat(els.nodes || [], els.edges || []);
    const layout = window.__dagreReg
      ? { name: "dagre", rankDir: "TB", nodeSep: 18, rankSep: 46, edgeSep: 8 }
      : { name: "breadthfirst", directed: true, spacingFactor: 1.1 };
    if (cy) { try { cy.destroy(); } catch (e) { /* noop */ } cy = null; }
    cy = window.cytoscape({ container, elements, style: d.style || [], layout, wheelSensitivity: 0.2 });
    if (d.focus) {
      const f = cy.getElementById(d.focus);
      if (f && f.length) cy.animate({ center: { eles: f }, zoom: 1.15 }, { duration: 280 });
    }
    cy.on("tap", "node", (ev) => {
      const n = ev.target.data();
      if (window.__send) window.__send({ type: "nodeClick", id: n.id, label: n.label, state: n.state, value: n.value });
    });
    renderLegend(d.legend, d.title, d.mode);
  }

  function renderLegend(legend, title, mode) {
    const box = document.getElementById("legend");
    if (!box) return;
    box.innerHTML = "";
    const h = document.createElement("span");
    h.className = "legend-title";
    h.textContent = (title || "Learning graph") + (mode ? "  ·  " + mode + " view" : "");
    box.appendChild(h);
    (legend || []).forEach((e) => {
      const row = document.createElement("span");
      row.className = "legend-item";
      const sw = document.createElement("span");
      sw.className = "legend-swatch";
      sw.style.background = e.swatch;
      row.appendChild(sw);
      row.appendChild(document.createTextNode(e.label));
      box.appendChild(row);
    });
  }

  window.addEventListener("message", (ev) => {
    const d = ev.data || {};
    if (d.type === "graph") render(d);
  });
  const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;
  window.__send = (msg) => { if (vscode) vscode.postMessage(msg); };
})();
