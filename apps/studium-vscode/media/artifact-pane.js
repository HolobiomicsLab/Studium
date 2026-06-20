/* artifact-pane.js — renders a scene's normalized render-manifest (scene_assets[]) "pair by pair".
 *
 * One renderer, two homes:
 *   - inside the VS Code webview, KaTeX + Vega-Lite are loaded → equations and plots are rich/interactive;
 *   - anywhere they are absent (e.g. a quick preview), every renderer DEGRADES GRACEFULLY
 *     (equation → styled code, plot_spec → a minimal inline-SVG bar chart from the spec's data).
 * The render path is identical; only fidelity changes. Drives off window.postMessage from the
 * extension host: { type: 'render', scene, scene_assets, progress, mastery, explanation }.
 */
(function () {
  "use strict";
  const $ = (sel, root) => (root || document).querySelector(sel);
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    for (const k in (attrs || {})) {
      if (k === "class") n.className = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    for (const c of kids) n.append(c && c.nodeType ? c : document.createTextNode(c == null ? "" : String(c)));
    return n;
  };

  function badge(kind) {
    const labels = {
      image: "figure", svg: "spectrum", equation_latex: "equation", plot_spec: "interactive plot",
      code: "code", data_csv: "table", protocol_md: "protocol", executed_result: "executed ✓",
    };
    return el("span", { class: "badge badge-" + kind }, labels[kind] || kind);
  }

  // --- per-kind renderers --------------------------------------------------
  function renderEquation(a) {
    const box = el("div", { class: "eq" });
    if (window.katex) {
      try { window.katex.render(a.payload || "", box, { displayMode: true, throwOnError: false }); return box; }
      catch (e) { /* fall through */ }
    }
    box.append(el("code", { class: "eq-fallback" }, a.payload || ""));
    return box;
  }

  function renderPlot(a) {
    const host = el("div", { class: "plot" });
    let spec = null;
    try { spec = JSON.parse(a.payload || "{}"); } catch (e) { /* noop */ }
    if (window.vegaEmbed && spec) {
      window.vegaEmbed(host, spec, { actions: false, renderer: "svg" }).catch(() => host.append(fallbackBars(spec)));
      return host;
    }
    host.append(fallbackBars(spec));
    return host;
  }

  // minimal inline-SVG bar chart from a Vega-Lite-ish spec {data:{values:[{x,y}...]}, mark:'bar'}
  function fallbackBars(spec) {
    const values = (spec && spec.data && spec.data.values) || [];
    const ex = (spec && spec.encoding && spec.encoding.x && spec.encoding.x.field) || "x";
    const ey = (spec && spec.encoding && spec.encoding.y && spec.encoding.y.field) || "y";
    if (!values.length) return el("pre", { class: "code" }, JSON.stringify(spec, null, 2));
    const W = 360, H = 180, pad = 28, n = values.length;
    const max = Math.max(...values.map((v) => +v[ey] || 0)) || 1;
    const bw = (W - pad * 2) / n * 0.7;
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("class", "barchart");
    const axis = document.createElementNS(ns, "line");
    axis.setAttribute("x1", pad); axis.setAttribute("y1", H - pad); axis.setAttribute("x2", W - pad); axis.setAttribute("y2", H - pad);
    axis.setAttribute("class", "axis"); svg.append(axis);
    values.forEach((v, i) => {
      const h = (H - pad * 2) * ((+v[ey] || 0) / max);
      const x = pad + (W - pad * 2) / n * i + ((W - pad * 2) / n - bw) / 2;
      const r = document.createElementNS(ns, "rect");
      r.setAttribute("x", x); r.setAttribute("y", H - pad - h); r.setAttribute("width", bw); r.setAttribute("height", h);
      r.setAttribute("class", "bar"); svg.append(r);
      const t = document.createElementNS(ns, "text");
      t.setAttribute("x", x + bw / 2); t.setAttribute("y", H - pad + 12); t.setAttribute("class", "tick");
      t.textContent = String(v[ex]); svg.append(t);
    });
    return svg;
  }

  function renderImage(a) {
    const src = a.path && a.path.startsWith("data:") ? a.path
      : a.dataUri ? a.dataUri
      : a.path ? toWebviewUri(a.path) : "";
    return el("img", { class: "figure", src, alt: a.title || "figure" });
  }

  function renderSvg(a) { return el("div", { class: "svgwrap", html: a.payload || "" }); }
  function renderCode(a) { return el("pre", { class: "code", "data-lang": a.language || "" }, el("code", {}, a.payload || "")); }
  function renderProtocol(a) { return el("div", { class: "protocol", html: mdLite(a.payload || "") }); }

  function renderCsv(a) {
    const rows = (a.payload || "").trim().split(/\r?\n/).map((r) => r.split(","));
    const t = el("table", { class: "csv" });
    rows.forEach((cells, i) => {
      const tr = el("tr");
      cells.forEach((c) => tr.append(el(i === 0 ? "th" : "td", {}, c)));
      t.append(tr);
    });
    return t;
  }

  function renderExecuted(a) {
    const m = a.meta || {};
    const card = el("div", { class: "exec " + (m.passed ? "exec-pass" : "exec-fail") });
    card.append(el("div", { class: "exec-head" },
      el("span", { class: "exec-dot" }, m.passed ? "✓" : "✗"),
      el("strong", {}, m.passed ? "Reference run passed" : "Reference run failed")));
    if (a.path) card.append(renderImage(a));
    if (m.landmark) card.append(el("div", { class: "exec-landmark" }, "landmark: " + m.landmark));
    const checks = Array.isArray(m.checks) ? m.checks : [];
    if (checks.length) {
      const ul = el("ul", { class: "checks" });
      checks.forEach((c) => ul.append(el("li", { class: c.passed ? "ok" : "no" }, (c.passed ? "✓ " : "✗ ") + (c.check || ""))));
      card.append(ul);
    }
    if (m.cmd) card.append(el("div", { class: "exec-cmd" }, "$ " + (Array.isArray(m.cmd) ? m.cmd.join(" ") : m.cmd)));
    if (a.provenance) card.append(el("div", { class: "prov" }, "↳ " + a.provenance));
    return card;
  }

  const RENDERERS = {
    image: renderImage, svg: renderSvg, equation_latex: renderEquation, plot_spec: renderPlot,
    code: renderCode, data_csv: renderCsv, protocol_md: renderProtocol, executed_result: renderExecuted,
  };

  function renderAsset(a) {
    const card = el("section", { class: "asset asset-" + a.kind });
    card.append(el("header", { class: "asset-head" }, badge(a.kind), el("span", { class: "asset-title" }, a.title || a.kind)));
    const body = (RENDERERS[a.kind] || ((x) => el("pre", { class: "code" }, JSON.stringify(x, null, 2))))(a);
    card.append(el("div", { class: "asset-body" }, body));
    return card;
  }

  // --- whole pane ----------------------------------------------------------
  function renderPane(state) {
    const root = $("#pane"); root.innerHTML = "";
    const sc = state.scene || {};
    const head = el("div", { class: "scene-head" });
    head.append(el("div", { class: "crumbs" },
      el("span", { class: "stype" }, sc.type || ""),
      state.progress ? el("span", { class: "prog" }, `${state.progress.index}/${state.progress.total}`) : ""));
    head.append(el("h2", { class: "scene-title" }, sc.title || ""));
    if (state.explanation) head.append(el("div", { class: "adapt" }, "⟳ " + state.explanation.rule_id + " — " + state.explanation.explanation_short));
    root.append(head);

    if (sc.markdown) root.append(el("div", { class: "prose", html: mdLite(sc.markdown) }));

    const assets = state.scene_assets || [];
    if (assets.length) {
      root.append(el("div", { class: "pane-label" }, "Artifacts paired with this scene"));
      assets.forEach((a) => root.append(renderAsset(a)));
    } else {
      root.append(el("div", { class: "empty" }, "— no artifact for this scene —"));
    }

    root.append(renderControls(sc));
    const hint = el("div", { id: "hint", class: "hint" }); root.append(hint);

    if (state.mastery) {
      const bar = el("div", { class: "mastery" });
      Object.entries(state.mastery).forEach(([k, v]) => {
        bar.append(el("div", { class: "mrow" },
          el("span", { class: "mk" }, k.replace(/^concept:/, "").slice(0, 26)),
          el("span", { class: "mbar" }, el("span", { class: "mfill", style: `width:${Math.round(v * 100)}%` })),
          el("span", { class: "mv" }, v.toFixed(2))));
      });
      root.append(el("div", { class: "pane-label" }, "Mastery"));
      root.append(bar);
    }
  }

  // interactive controls the learner uses to advance — posts back to the extension host.
  function renderControls(sc) {
    const wrap = el("div", { class: "controls" });
    const send = (msg) => () => (window.__send ? window.__send(msg) : null);
    if (sc.type === "quiz") {
      (sc.choices || []).forEach((c) => {
        const b = el("button", { class: "choice" }, c.id + ") " + c.text);
        b.addEventListener("click", send({ type: "respond", input: { kind: "quiz_choice", choiceId: c.id } }));
        wrap.append(b);
      });
      const hb = el("button", { class: "ghost" }, "💡 Hint"); hb.addEventListener("click", send({ type: "hint" })); wrap.append(hb);
    } else if (sc.type === "meta_checkpoint") {
      [0, 1, 2, 3, 4].forEach((v) => { const b = el("button", { class: "choice" }, "conf " + v); b.addEventListener("click", send({ type: "respond", input: { kind: "confidence", value: v } })); wrap.append(b); });
    } else if (sc.type === "ai_critique") {
      const ta = el("textarea", { class: "critique", placeholder: "Write your critique…" });
      const b = el("button", { class: "primary" }, "Submit critique"); b.addEventListener("click", () => window.__send && window.__send({ type: "respond", input: { kind: "critique", text: ta.value } }));
      wrap.append(ta, b);
    } else {
      const b = el("button", { class: "primary" }, "Continue ▸"); b.addEventListener("click", send({ type: "respond", input: { kind: "ack" } })); wrap.append(b);
    }
    return wrap;
  }

  // tiny markdown (bold/italic/code/headings/paragraphs) — no deps
  function mdLite(s) {
    return s.split(/\n{2,}/).map((p) => {
      let h = p.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      h = h.replace(/`([^`]+)`/g, "<code>$1</code>")
           .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
           .replace(/\$([^$]+)\$/g, '<span class="imath">$1</span>');
      if (/^#{1,3}\s/.test(p)) { const lvl = p.match(/^#+/)[0].length; return `<h${lvl}>${h.replace(/^#+\s/, "")}</h${lvl}>`; }
      return `<p>${h}</p>`;
    }).join("");
  }

  // VS Code webview rewrites file paths via acquireVsCodeApi + asWebviewUri (the host pre-resolves
  // image paths into dataUri before posting, so this is only a passthrough fallback).
  function toWebviewUri(p) { return p; }

  // wiring: receive renders from the extension host; (the preview build calls window.__render directly)
  window.addEventListener("message", (ev) => {
    const d = ev.data || {};
    if (d.type === "render") renderPane(d);
    else if (d.type === "hint") { const h = document.getElementById("hint"); if (h) h.textContent = d.hint ? ("💡 " + d.hint + (d.remaining != null ? "  (" + d.remaining + " left)" : "")) : "(no more hints)"; }
    else if (d.type === "done") { const r = $("#pane"); r.innerHTML = ""; r.append(el("div", { class: "done" }, "✔ " + (d.message || "Lesson complete"))); }
  });
  window.__render = renderPane;
  const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;
  window.__send = (msg) => { if (vscode) vscode.postMessage(msg); };
})();
