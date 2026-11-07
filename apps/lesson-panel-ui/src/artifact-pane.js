/* artifact-pane.js — the Studium lesson pane: one scene with its paired assets and answer controls,
 * then the feedback on the answer as its own step, then the end-of-lesson screen.
 *
 * One renderer, two homes:
 *   - inside the VS Code webview, marked + KaTeX + Vega-Lite + 3Dmol are loaded → prose, equations,
 *     plots and molecules are rich;
 *   - anywhere they are absent (a standalone preview, a test), every renderer DEGRADES GRACEFULLY
 *     (equation → styled code, plot_spec → a minimal inline-SVG bar chart from the spec's data).
 *
 * Host → pane (window.postMessage):
 *   render {scene, scene_assets, progress, verdict, navigation, self_rating, sources, calibration,
 *           reviewDue, mastery, authoring, modalityPreference, explanation (older hosts), strings, locale}
 *   done {message, verdict?, self_rating?, sources?, calibration?, completion?, authoring?}
 *   hint, turn_result, recall_rated {sceneId, grade, completion?}, action_pending, action_settled, action_notice,
 *   action_error {message, action?, sceneId?}, loading, error
 * Pane → host (window.__send): respond, turn, hint, end, run, rateRecall, reviewNow, restartLesson,
 *   pickCourse.
 * Concepts (reviewDue, completion.consolidated / practised / not_measured, and to_revisit from older hosts) arrive
 * as {id, label} (practised ones also carry `answers`, the graded answers counted); a bare string is an id.
 * The pane never holds an answer key: the host strips it (publicScene) and releases the feedback with
 * the verdict, after the answer.
 */
let renderView;
(function () {
  "use strict";
  const DEFAULT_STRINGS = {
    pane_image_unresolved: "image : {path} (non résolue)",
  };
  let strings = { ...DEFAULT_STRINGS };
  const initialStrings = document.getElementById("studium-strings");
  if (initialStrings) {
    try { strings = { ...strings, ...JSON.parse(initialStrings.textContent) }; }
    catch { /* A standalone preview can omit the initial catalogue. */ }
  }
  function t(key, params) {
    const template = strings[key] || key;
    return template.replace(/\{([a-z_]+)\}/gi, (token, name) =>
      params && params[name] !== undefined ? String(params[name]) : token);
  }
  const $ = (sel, root) => (root || document).querySelector(sel);
  const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  const escapeHtml = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  // Build an element: `class` and `html` are special; a null, undefined or false attribute is omitted.
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    for (const k in (attrs || {})) {
      const value = attrs[k];
      if (value === null || value === undefined || value === false) continue;
      if (k === "class") n.className = value;
      else if (k === "html") n.innerHTML = value;
      else n.setAttribute(k, value === true ? "" : String(value));
    }
    for (const c of kids) {
      if (c === null || c === undefined || c === false || c === "") continue;
      n.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return n;
  };
  let lastId = 0;
  const nextId = (prefix) => `${prefix}-${++lastId}`;
  const pageLocale = () => document.documentElement.lang || "fr";
  const conceptKey = (id) => String(id || "").replace(/^concept:/, "");
  // How a concept is named to the learner: the host sends {id, label} (the bundle's concept title); a bare
  // string from an older host is an id, shown without its "concept:" prefix.
  const conceptName = (c) => (isObject(c) ? String(c.label || conceptKey(c.id)) : conceptKey(c));

  // Which key grades each scene type: mirrors SCENE_KEY_CLASS (packages/lesson-session-host/src/
  // key-class.ts); scene-io.driver.ts fails if the two drift. The chip names the evaluation basis.
  const KEY_CLASS = {
    intro: "ungraded",
    concept: "ungraded",
    meta_checkpoint: "ungraded",
    quiz: "author_keyed",
    spot_the_flaw: "author_keyed",
    explain_back: "production",
    comparison: "production",
    summary_audit: "production",
    prompt_practice: "production",
    communication_sim: "production",
    discussion: "production",
    ai_critique: "production",
    reproduction: "externally_grounded",
  };
  // The design system's symbols per key class (design/preview.html), so a chip never relies on colour.
  const KEY_CLASS_SYMBOL = { ungraded: "○", author_keyed: "◇", production: "↗", externally_grounded: "⌘" };
  // C4: the grades a learner may give their own recall, in FSRS order (pane-messages.ts validates them).
  const RECALL_GRADES = ["again", "hard", "good", "easy"];
  const REASONING_SIGNALS = new Set(["justification", "hypothesis", "question", "counterexample", "synthesis"]);

  // What the pane remembers within one lesson: the title and concepts of each scene it showed (the
  // feedback names the answered scene, a detour names where it returns, the end screen names
  // questions), each answer's outcome, the furthest step reached (the rail never runs backwards),
  // the notices already shown in full and the scenes already self-rated.
  let memory = freshMemory();
  function freshMemory() {
    return { titles: new Map(), concepts: new Map(), outcomes: new Map(), furthest: 0, total: 0, notices: new Set(), rated: new Set(), mapOpen: null, left: null };
  }
  // Live nodes of the current screen. The pane keeps references rather than looking ids up, so an id
  // inside an authored SVG can never capture the hint box or the status line.
  let ui = blankUi();
  function blankUi() { return { status: null, hint: null, turns: null, keys: null, rating: null, pendingTurn: null }; }
  // The lesson's authoring block as last sent (the feedback of an AI-drafted lesson names its key, L-7), and the
  // end-of-lesson data waiting behind the last feedback step (a rating may still update its next review, UX-11).
  let lastAuthoring = null;
  let pendingDone = null;

  // --- announcements and focus (VSC-3) ---------------------------------------------------------------
  // One persistent polite region outside #pane (paneHtml writes it; a bare preview gets one here).
  function liveRegion() {
    let region = document.getElementById("pane-live");
    if (!region) {
      region = el("div", { id: "pane-live", class: "visually-hidden", role: "status", "aria-live": "polite", "aria-atomic": "true" });
      document.body.append(region);
    }
    return region;
  }
  function announce(text) { liveRegion().textContent = text; }
  // After a new screen, the keyboard and screen-reader position restarts at its heading.
  function focusHeading(heading) {
    try { heading.focus({ preventScroll: true }); } catch { heading.focus(); }
    const scroller = document.scrollingElement || document.documentElement;
    if (scroller) scroller.scrollTop = 0;
  }

  // --- pending actions ---------------------------------------------------------------------------------
  let actionPending = false;
  const disabledBeforePending = new WeakMap();

  function setActionPending(pending, message) {
    actionPending = pending;
    const root = $("#pane");
    if (!root) return;
    root.setAttribute("aria-busy", pending ? "true" : "false");
    root.querySelectorAll("button, textarea, input").forEach((control) => {
      if (pending) {
        if (!disabledBeforePending.has(control)) disabledBeforePending.set(control, control.disabled);
        control.disabled = true;
      } else if (disabledBeforePending.has(control)) {
        control.disabled = disabledBeforePending.get(control);
        disabledBeforePending.delete(control);
      }
    });
    if (ui.status) {
      ui.status.className = "action-status" + (pending ? " pending" : "");
      ui.status.textContent = message || "";
    }
  }

  // INT-STUDIUM-058 (client_ms): the delay between an action and the display of the view that answers
  // it, measured here and joined once to the next action; the server logs it under consent.
  const now = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());
  let actionSentAt = null;
  let displayDelayMs = null;

  // Actions that leave the learner on the same scene: the view that answers one may still carry the
  // verdict of the answer before, whose feedback the learner already read and left. Only such a view
  // skips that feedback: the same verdict on any other view is a new answer (a question replayed and
  // answered the same way) and is shown.
  const KEEPS_SCENE = new Set(["openMap", "closeMap", "hint", "ask", "prompt", "setAttention", "setLanguage", "replan"]);
  let sameSceneAwaited = false;

  function postAction(message, pendingText) {
    if (actionPending || !window.__send) return false;
    sameSceneAwaited = isObject(message) && KEEPS_SCENE.has(message.type);
    if (!sameSceneAwaited) memory.left = null;
    setActionPending(true, pendingText || t("pane_updating"));
    const delay = displayDelayMs;
    displayDelayMs = null;
    actionSentAt = now();
    if (delay === null) window.__send(message);
    else window.__send(message, { client_ms: delay });
    return true;
  }

  /** A view was displayed: if an action was waiting for it, keep how long that took. */
  function noteDisplayed() {
    if (actionSentAt === null) return;
    displayDelayMs = Math.max(0, Math.round(now() - actionSentAt));
    actionSentAt = null;
  }

  function showActionError(message) {
    setActionPending(false);
    if (ui.rating) ui.rating.failed();
    // UX-07: a discussion turn the host did not take is not in the transcript; its text goes back in the box.
    if (ui.pendingTurn) {
      const turn = ui.pendingTurn;
      ui.pendingTurn = null;
      turn.line.remove();
      if (!turn.textarea.value) turn.textarea.value = turn.text;
      turn.sync();
    }
    if (!ui.status) return;
    ui.status.className = "action-status error";
    ui.status.textContent = t("pane_action_failed", { error: message || t("pane_retry") });
  }

  // A calm answer to an action that changed nothing (« Réviser maintenant » with nothing due): release the
  // gate and say it in the status line, worded as information, never as a failure.
  function showActionNotice(message) {
    setActionPending(false);
    if (!ui.status) return;
    ui.status.className = "action-status notice";
    ui.status.textContent = message || "";
  }

  // A new screen: empty the pane and forget the previous screen's live nodes and shortcuts.
  function resetPane() {
    const root = $("#pane");
    root.innerHTML = "";
    actionPending = false;
    root.setAttribute("aria-busy", "false");
    ui = blankUi();
    return root;
  }

  function badge(kind) {
    return el("span", { class: "badge badge-" + kind }, badgeLabel(kind));
  }
  const BADGE_KINDS = new Set(["image", "svg", "equation_latex", "plot_spec", "code", "data_csv", "protocol_md",
    "executed_result", "orbital", "mol_3d", "spectrum"]);
  const badgeLabel = (kind) => t(BADGE_KINDS.has(kind) ? "pane_badge_" + kind : "pane_badge_other");

  // --- per-kind renderers --------------------------------------------------
  function renderEquation(a) {
    const box = el("div", { class: "eq" });
    const formula = el("div", { class: "eq-formula" });
    if (window.katex) {
      try { window.katex.render(a.payload || "", formula, { displayMode: true, throwOnError: false }); }
      catch (e) { /* fall through */ }
    }
    if (!formula.childNodes.length) formula.append(el("code", { class: "eq-fallback" }, a.payload || ""));
    box.append(formula);
    if (Array.isArray(a.legend) && a.legend.length) {
      const legend = el("ul", { class: "eq-legend" });
      a.legend.forEach((entry) => {
        if (entry && typeof entry.symbol === "string" && typeof entry.meaning === "string") {
          legend.append(el("li", { class: "eq-legend-entry" }, `${entry.symbol} : ${entry.meaning}`));
        }
      });
      if (legend.childNodes.length) box.append(legend);
    }
    return box;
  }

  function renderPlot(a) {
    const title = a.title || badgeLabel(a.kind);
    const host = el("div", { class: "plot", role: "img", "aria-label": t("pane_plot_label", { title }) });
    let spec = null;
    try { spec = JSON.parse(a.payload || "{}"); } catch (e) { /* noop */ }
    const wrap = el("div", { class: "plot-wrap" }, host);
    const table = plotDataTable(spec);
    if (table) wrap.append(table);
    if (window.vegaEmbed && spec) {
      window.vegaEmbed(host, spec, { actions: false, renderer: "svg", config: vegaThemeConfig() })
        .catch(() => host.append(fallbackBars(spec)));
      return wrap;
    }
    host.append(fallbackBars(spec));
    return wrap;
  }

  // The text alternative of a plot: its inline data as a table, behind a disclosure (VSC-3).
  function plotDataTable(spec) {
    const rows = spec && spec.data && Array.isArray(spec.data.values) ? spec.data.values.filter(isObject) : [];
    if (!rows.length) return null;
    const columns = Object.keys(rows[0]);
    const table = el("table", {});
    table.append(el("thead", {}, el("tr", {}, ...columns.map((c) => el("th", { scope: "col" }, c)))));
    const body = el("tbody");
    rows.slice(0, 200).forEach((row) => body.append(el("tr", {}, ...columns.map((c) => el("td", {}, row[c] == null ? "" : String(row[c]))))));
    table.append(body);
    return el("details", { class: "plot-data" }, el("summary", {}, t("pane_plot_data")), table);
  }

  // Vega draws black axes by default; paint them with the pane's own text colour so a dark editor
  // theme keeps them legible. Without a computed colour (a preview), Vega keeps its defaults.
  function vegaThemeConfig() {
    const ink = getComputedStyle(document.body).color;
    if (!ink) return {};
    return {
      background: "transparent",
      axis: { labelColor: ink, titleColor: ink, domainColor: ink, tickColor: ink },
      legend: { labelColor: ink, titleColor: ink },
      title: { color: ink },
      view: { stroke: null },
    };
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
    svg.setAttribute("aria-hidden", "true");
    const axis = document.createElementNS(ns, "line");
    axis.setAttribute("x1", pad); axis.setAttribute("y1", H - pad); axis.setAttribute("x2", W - pad); axis.setAttribute("y2", H - pad);
    axis.setAttribute("class", "axis"); svg.append(axis);
    values.forEach((v, i) => {
      const h = (H - pad * 2) * ((+v[ey] || 0) / max);
      const x = pad + (W - pad * 2) / n * i + ((W - pad * 2) / n - bw) / 2;
      const r = document.createElementNS(ns, "rect");
      r.setAttribute("x", x); r.setAttribute("y", H - pad - h); r.setAttribute("width", bw); r.setAttribute("height", h);
      r.setAttribute("class", "bar"); svg.append(r);
      const tick = document.createElementNS(ns, "text");
      tick.setAttribute("x", x + bw / 2); tick.setAttribute("y", H - pad + 12); tick.setAttribute("class", "tick");
      tick.textContent = String(v[ex]); svg.append(tick);
    });
    return svg;
  }

  function renderImage(a) {
    const src = a.dataUri || a.path || "";
    const kind = imageSource(src);
    if (kind !== "local") {
      return el("span", { class: "image-unresolved" + (kind === "remote" ? " image-remote" : "") },
        t(kind === "remote" ? "pane_image_remote" : "pane_image_unresolved", { path: src }));
    }
    return el("img", { class: "figure", src: src.trim(), alt: a.title || badgeLabel("image") });
  }

  function renderSvg(a) {
    const box = el("div", { class: "svgwrap" });
    const svg = sanitizeSvg(a.payload);
    if (!svg) { box.append(el("p", { class: "svg-invalid" }, t("pane_svg_invalid"))); return box; }
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", a.title || badgeLabel("svg"));
    box.append(svg);
    return box;
  }
  function renderCode(a) {
    const code = el("code", { "data-lang": a.language || "", html: highlightCode(a.payload || "", a.language || "") });
    return el("pre", { class: "code" }, code);
  }
  function renderProtocol(a) { return el("div", { class: "protocol prose", html: renderMarkdown(a.payload || "") }); }

  function renderCsv(a) {
    const rows = (a.payload || "").trim().split(/\r?\n/).map((r) => r.split(","));
    const table = el("table", { class: "csv" });
    rows.forEach((cells, i) => {
      const tr = el("tr");
      cells.forEach((c) => tr.append(el(i === 0 ? "th" : "td", i === 0 ? { scope: "col" } : {}, c)));
      table.append(tr);
    });
    return table;
  }

  function renderExecuted(a) {
    const m = a.meta || {};
    const card = el("div", { class: "exec " + (m.passed ? "exec-pass" : "exec-fail") });
    card.append(el("div", { class: "exec-head" },
      el("span", { class: "exec-dot", "aria-hidden": "true" }, m.passed ? "✓" : "✗"),
      el("strong", {}, t(m.passed ? "pane_run_passed" : "pane_run_failed"))));
    if (a.path || a.dataUri) card.append(renderImage(a));
    if (m.landmark) card.append(el("div", { class: "exec-landmark" }, t("pane_landmark", { value: m.landmark })));
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

  // --- interactive scientific renderers (3Dmol for orbital/molecule; Vega for spectrum) --------
  // 3Dmol needs the container attached + sized before createViewer, so defer to a microtask and
  // give the host an explicit height. Degrades to a written placeholder when $3Dmol is absent.
  function render3D(a, kind) {
    const host = el("div", { class: "mol3d", role: "img", "aria-label": t("pane_3d_label", { title: a.title || badgeLabel(kind) }) });
    const lib = window.$3Dmol;
    if (!lib || !a.payload) {
      host.append(el("p", { class: "mol3d-missing" }, a.payload ? t("pane_3d_unavailable") : t("pane_no_data")));
      return host;
    }
    setTimeout(() => {
      try {
        // The viewer's background is the pane's own surface, never a white box in a dark theme.
        const background = surfaceColor(host);
        const viewer = lib.createViewer(host, background === null ? {} : { backgroundColor: background });
        if (kind === "orbital") {
          const iso = (a.meta && typeof a.meta.iso === "number") ? a.meta.iso : 0.02;
          viewer.addModel(a.payload, "cube");                 // the nucleus (cube carries 1 atom)
          viewer.setStyle({}, { sphere: { scale: 0.18, color: "0x444444" } });
          viewer.addVolumetricData(a.payload, "cube", { isoval: iso, color: "blue", opacity: 0.85 });
          viewer.addVolumetricData(a.payload, "cube", { isoval: -iso, color: "red", opacity: 0.85 });
        } else {
          viewer.addModel(a.payload, a.format || "xyz");
          viewer.setStyle({}, { stick: { radius: 0.13 }, sphere: { scale: 0.27 } });
        }
        viewer.zoomTo();
        viewer.resize();   // ensure the WebGL viewport matches the (now sized) container before drawing
        viewer.render();
      } catch (e) { host.append(el("p", { class: "mol3d-missing" }, t("pane_3d_error", { error: (e && e.message) || "" }))); }
    }, 0);
    return host;
  }
  // The computed background of `node` as a 0xRRGGBB number, or null when it is unknown or transparent.
  function surfaceColor(node) {
    const value = getComputedStyle(node).backgroundColor || "";
    const m = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
    if (!m || m[4] === "0") return null;
    return (Number(m[1]) << 16) | (Number(m[2]) << 8) | Number(m[3]);
  }
  function renderOrbital(a) { return render3D(a, "orbital"); }
  function renderMol3d(a) { return render3D(a, "mol_3d"); }

  const RENDERERS = {
    image: renderImage, svg: renderSvg, equation_latex: renderEquation, plot_spec: renderPlot,
    code: renderCode, data_csv: renderCsv, protocol_md: renderProtocol, executed_result: renderExecuted,
    orbital: renderOrbital, mol_3d: renderMol3d, spectrum: renderPlot, // spectrum = a Vega-Lite spec
  };

  function renderAsset(a) {
    // emphasis ('expanded' | 'normal' | 'compact') comes from the host's modality-adaptive
    // selectRenderOrder: the learner's preferred modality is 'expanded' (lead, full size), the other
    // is 'compact' (collapsed by default — content kept, never hidden, the learner can open it).
    const emph = a.emphasis || "normal";
    const card = el("section", { class: "asset asset-" + a.kind + " emph-" + emph });
    const head = el("header", { class: "asset-head" }, badge(a.kind), el("span", { class: "asset-title" }, a.title || badgeLabel(a.kind)));
    const body = (RENDERERS[a.kind] || ((x) => el("pre", { class: "code" }, JSON.stringify(x, null, 2))))(a);
    if (emph === "compact") {
      // de-emphasized modality → a <details> the learner can expand; content fully preserved.
      const det = el("details", { class: "asset-collapse" });
      det.append(el("summary", {}, head));
      det.append(el("div", { class: "asset-body" }, body));
      card.append(det);
    } else {
      card.append(head);
      card.append(el("div", { class: "asset-body" }, body));
    }
    return card;
  }

  // --- untrusted SVG (ENG-10) ------------------------------------------------------------------------
  // An authored SVG is parsed as XML and rebuilt from an allowlist before it reaches the page. Drawing
  // elements survive; scripts, foreign HTML, styles, animations, links and images go, and so does
  // every event handler, every reference that leaves the document and every url() that is not `#id`.
  const SVG_NS = "http://www.w3.org/2000/svg";
  const SVG_ALLOWED = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
    "text", "tspan", "defs", "lineargradient", "radialgradient", "stop", "clippath", "marker", "symbol", "use",
    "title", "desc"]);
  // Removed together with their content; any other element off the allowlist is unwrapped instead
  // (it disappears, its allowed children and text stay).
  const SVG_DROPPED = new Set(["script", "style", "foreignobject", "iframe", "object", "embed", "image", "img",
    "audio", "video", "canvas", "animate", "animatemotion", "animatetransform", "set", "discard", "handler", "listener"]);

  function sanitizeSvg(payload) {
    if (typeof window.DOMParser !== "function") return null;
    let doc;
    try { doc = new window.DOMParser().parseFromString(withSvgNamespaces(String(payload || "")), "image/svg+xml"); }
    catch { return null; }
    const root = doc && doc.documentElement;
    if (!root || root.localName !== "svg" || root.namespaceURI !== SVG_NS) return null;
    if (doc.getElementsByTagName("parsererror").length) return null;
    cleanSvgAttributes(root);
    cleanSvgChildren(root);
    return document.importNode(root, true);
  }

  // Authors often omit the namespaces an HTML page does not need but an XML parser does; a DOCTYPE
  // (internal entities) is never needed and is dropped before parsing.
  function withSvgNamespaces(source) {
    const body = source.replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/gi, "");
    return body.replace(/<svg\b([^>]*)>/i, (tag, attrs) => {
      let extra = "";
      if (!/\sxmlns\s*=/.test(attrs)) extra += ` xmlns="${SVG_NS}"`;
      if (/xlink:/.test(body) && !/\sxmlns:xlink\s*=/.test(attrs)) extra += ' xmlns:xlink="http://www.w3.org/1999/xlink"';
      return extra ? `<svg${extra}${attrs}>` : tag;
    });
  }

  function cleanSvgChildren(node) {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3 || child.nodeType === 4) continue;        // text and CDATA stay
      if (child.nodeType !== 1) { child.remove(); continue; }            // comments, processing instructions
      const name = child.localName.toLowerCase();
      if (child.namespaceURI !== SVG_NS || SVG_DROPPED.has(name)) { child.remove(); continue; }
      cleanSvgChildren(child);
      if (SVG_ALLOWED.has(name)) cleanSvgAttributes(child);
      else child.replaceWith(...Array.from(child.childNodes));
    }
  }

  function cleanSvgAttributes(element) {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.localName.toLowerCase();
      const value = attr.value;
      if (name.startsWith("on") || name === "base" || /(?:java|vb)script:/i.test(value)) {
        element.removeAttributeNode(attr);
      } else if (name === "href") {
        if (!value.trim().startsWith("#")) element.removeAttributeNode(attr);
      } else if (/url\(/i.test(value)) {
        // Paint servers and clip paths may point inside the drawing (`url(#g)`), never out of it.
        const inside = value.replace(/url\(\s*(?![\s'"]*#)[^)]*\)/gi, "none");
        if (inside !== value) attr.value = inside;
      }
    }
  }

  // --- the scene ----------------------------------------------------------------------------------------
  function renderPane(state) {
    applyLanguage(state);
    if (isObject(state.authoring)) lastAuthoring = state.authoring;
    const scene = isObject(state.scene) ? state.scene : {};
    const total = state.progress && Number(state.progress.total);
    if (total && memory.total && total !== memory.total) memory = freshMemory(); // another lesson
    if (total) memory.total = total;
    remember(scene);
    const verdict = isObject(state.verdict) ? state.verdict : null;
    const rating = selfRatingOf(state, verdict);
    const verdictKey = verdict ? JSON.stringify(verdict) : null;
    const alreadyLeft = sameSceneAwaited && verdictKey !== null && memory.left === verdictKey;
    sameSceneAwaited = false;
    if (verdict && (verdict.graded || rating) && !alreadyLeft) {
      recordOutcome(verdict);
      renderFeedbackStep({
        verdict, rating, calibration: state.calibration, sources: sourcesOf(state, verdict), authoring: lastAuthoring,
        // The scene shown again is the one just answered: its feedback would give the answer away.
        withheld: !!scene.id && scene.id === verdict.scene_id,
        voices: state.voices,
        onContinue: () => { memory.left = verdictKey; renderScene(state); },
      });
      return;
    }
    renderScene(state);
  }

  function applyLanguage(state) {
    if (isObject(state.strings)) strings = { ...DEFAULT_STRINGS, ...state.strings };
    if (state.locale) document.documentElement.lang = state.locale;
  }

  function remember(scene) {
    if (!scene.id) return;
    if (scene.title) memory.titles.set(scene.id, String(scene.title));
    memory.concepts.set(scene.id, (Array.isArray(scene.concept_refs) ? scene.concept_refs : []).map(conceptKey));
  }

  // The end screen's fallback names questions by outcome; a later answer to the same scene wins.
  function recordOutcome(verdict) {
    if (!verdict.scene_id) return;
    memory.outcomes.delete(verdict.scene_id);
    memory.outcomes.set(verdict.scene_id, verdict.correct === true ? "passed" : verdict.correct === false ? "missed" : "open");
  }

  // C4: after a production answer no judge certified, the transition (or its verdict) asks the
  // learner to rate their own recall. Unknown grades are dropped: they would print a raw code.
  function selfRatingOf(holder, verdict) {
    const request = (holder && holder.self_rating) || (verdict && verdict.self_rating) || null;
    if (!isObject(request) || request.requested !== true) return null;
    const grades = (Array.isArray(request.grades) ? request.grades : []).filter((g) => RECALL_GRADES.includes(g));
    const sceneId = request.scene_id || (verdict && verdict.scene_id) || null;
    return grades.length && sceneId ? { sceneId, grades } : null;
  }

  function sourcesOf(holder, verdict) {
    const list = Array.isArray(holder.sources) ? holder.sources : verdict && Array.isArray(verdict.sources) ? verdict.sources : [];
    return list.filter((s) => isObject(s) && (s.title || s.quote));
  }

  function renderScene(state) {
    const root = resetPane();
    const sc = isObject(state.scene) ? state.scene : {};
    const notice = state.authoring && state.authoring.notice;
    if (notice) root.append(noticeBlock(String(notice)));
    const head = sceneHead(state, sc);
    root.append(head);
    const nav = navigationCard(state, sc);
    if (nav) root.append(nav);
    sceneBody(sc).forEach((node) => root.append(node));
    const assets = assetsSection(state);
    if (assets) root.append(assets);
    root.append(renderControls(sc, state));
    const ladder = helpLadder(state);
    if (ladder) root.append(ladder);
    ui.hint = el("div", { id: "hint", class: "hint", "aria-live": "polite" });
    root.append(ui.hint);
    const proposals = promptsRegion(state);
    if (proposals) root.append(proposals);
    const mapButton = conceptMapButton(state);
    if (mapButton) root.append(mapButton);
    const map = conceptMap(state);
    if (map) root.append(map);
    const mastery = masteryPanel(state.mastery);
    if (mastery) root.append(mastery);
    const settings = settingsRegion(state);
    if (settings) root.append(settings);
    // What the server says about the action just taken on this scene (a contest's check questions).
    if (typeof state.message === "string" && state.message) showActionNotice(state.message);
    const wasOpen = memory.mapOpen;
    memory.mapOpen = !!map;
    // The map was just opened: the position goes to its heading; just closed: back to its button.
    if (map && wasOpen === false) { announce(t("pane_map_open")); focusQuietly($(".map-title", map)); return; }
    if (!map && wasOpen === true && mapButton) { focusQuietly(mapButton); return; }
    const title = sc.title || "";
    announce(state.progress
      ? t("pane_live_step", { position: memory.furthest, total: memory.total || state.progress.total, title })
      : t("pane_live_scene", { title }));
    focusHeading($(".scene-title", head));
  }

  // --- the server's proposals (INT-STUDIUM-058 § 2.6) ---------------------------------------------------
  // The server decides what is proposed, when and how often; the panel shows what the view carries,
  // under the scene's own controls, and sends back the answer the learner picks. While an answer or a
  // self-rating is owed only notices show: a proposal made at an earlier pause waits for the next one.
  // Nothing is announced: a proposal is there to be found, not to interrupt.
  function promptsRegion(state) {
    const all = Array.isArray(state.prompts) ? state.prompts.filter((p) => isObject(p) && p.id && typeof p.reason === "string" && p.reason) : [];
    const waiting = isObject(state.orientation) ? state.orientation.waiting : null;
    const busy = waiting === "answer" || waiting === "self_rating";
    const asks = (prompt) => Array.isArray(prompt.actions) && prompt.actions.length > 0;
    const shown = all.filter((prompt) => !busy || !asks(prompt));
    if (!shown.length) return null;
    const offered = Array.isArray(state.actions) ? state.actions : [];
    const region = el("section", { class: "prompts", "aria-label": t("pane_prompts_heading") });
    for (const prompt of shown) {
      const reason = el("p", { class: "prompt-reason", id: nextId("prompt-reason") }, prompt.reason);
      const item = el("div", { class: "prompt", "data-kind": String(prompt.kind || "") }, reason);
      const answers = (asks(prompt) ? prompt.actions : [])
        .filter((answer) => isObject(answer) && answer.label && isObject(answer.action) && offered.includes(answer.action.type));
      if (answers.length) {
        const row = el("div", { class: "prompt-actions" });
        for (const answer of answers) {
          const button = el("button", { type: "button", class: "st-button st-button--quiet prompt-action", "aria-describedby": reason.id }, String(answer.label));
          button.addEventListener("click", () => postAction(answer.action, t("pane_updating")));
          row.append(button);
        }
        item.append(row);
      }
      region.append(item);
    }
    return region;
  }

  // --- the learner's settings (INT-STUDIUM-058 F8) -----------------------------------------------------
  // How much the lesson may propose, the panel's language and « I have N minutes »: each drawn only when
  // the view offers its action. They answer nothing, so they stay usable while an answer is owed.
  const ATTENTION_LEVELS = ["quiet", "normal", "coached"];
  // Language names are not translated: each is written in its own language.
  const PANEL_LANGUAGES = [["fr", "FR", "Français"], ["en", "EN", "English"]];
  const REPLAN_DEFAULT_MINUTES = 10;

  function settingsRegion(state) {
    const offered = Array.isArray(state.actions) ? state.actions : [];
    const groups = [];
    if (offered.includes("setAttention")) {
      const current = ATTENTION_LEVELS.includes(state.attention) ? state.attention : "normal";
      groups.push(settingsGroup(t("pane_attention"), ATTENTION_LEVELS.map((level) => {
        const button = el("button", { type: "button", class: "st-button st-button--quiet attention-level", "data-level": level, "aria-pressed": level === current ? "true" : "false" }, t("pane_attention_" + level));
        button.addEventListener("click", () => postAction({ type: "setAttention", level }, t("pane_updating")));
        return button;
      })));
    }
    if (offered.includes("setLanguage")) {
      groups.push(settingsGroup(t("pane_language"), PANEL_LANGUAGES.map(([code, short, name]) => {
        const button = el("button", { type: "button", class: "st-button st-button--quiet language-choice", "data-language": code, lang: code, "aria-label": name, "aria-pressed": state.locale === code ? "true" : "false" }, short);
        button.addEventListener("click", () => postAction({ type: "setLanguage", presentation_language: code }, t("pane_updating")));
        return button;
      })));
    }
    if (offered.includes("replan")) {
      const inputId = nextId("replan-minutes");
      const minutes = el("input", { type: "number", id: inputId, class: "replan-minutes", min: "1", max: "600", step: "1", value: String(REPLAN_DEFAULT_MINUTES), inputmode: "numeric" });
      const button = el("button", { type: "button", class: "st-button st-button--quiet replan-button" }, t("pane_replan"));
      button.addEventListener("click", () => {
        const value = Math.round(Number(minutes.value));
        // The server refuses anything outside 1 to 600 minutes: nothing is sent, the field takes the focus back.
        if (!Number.isFinite(value) || value < 1 || value > 600) { focusQuietly(minutes); return; }
        postAction({ type: "replan", minutes: value }, t("pane_updating"));
      });
      groups.push(el("div", { class: "settings-group replan" }, el("label", { class: "settings-label", for: inputId }, t("pane_replan_minutes")), minutes, button));
    }
    if (!groups.length) return null;
    return el("section", { class: "settings", "aria-label": t("pane_settings") }, ...groups);
  }

  function settingsGroup(label, buttons) {
    const labelNode = el("span", { class: "settings-label", id: nextId("settings-label") }, label);
    return el("div", { class: "settings-group", role: "group", "aria-labelledby": labelNode.id }, labelNode, el("div", { class: "settings-choices" }, ...buttons));
  }

  // --- the concept map, as a list (INT-STUDIUM-058 § 2.7) -----------------------------------------------
  // The server decides whether the map is offered (the view's actions name openMap or closeMap) and
  // sends it only while it is open. The list says in words what a drawing says with shapes: each
  // concept's state, what it needs, the answers behind the state, what the state establishes and
  // what it does not, and the claim the learner may make. Nothing here is computed from the lesson.
  const MAP_STATES = new Set(["acquired", "to_review", "current", "seen", "upcoming"]);
  const MAP_ASSESSORS = new Set(["key", "judge", "self", "none"]);
  const MAP_RESULTS = new Set(["right", "wrong", "rated", "recorded"]);
  const MAP_OUTCOMES = new Set(["confirmed", "refuted", "partial"]);

  function focusQuietly(node) { try { node.focus(); } catch { /* a node that cannot take the focus */ } }

  function conceptMapButton(state) {
    const offered = Array.isArray(state.actions) ? state.actions : [];
    const open = offered.includes("closeMap");
    if (!open && !offered.includes("openMap")) return null;
    const button = el("button", { type: "button", class: "st-button st-button--quiet map-button", "aria-expanded": open ? "true" : "false" }, t("pane_map_open"));
    button.addEventListener("click", () => postAction({ type: open ? "closeMap" : "openMap" }, t("pane_updating")));
    return button;
  }

  function conceptMap(state) {
    const map = isObject(state.map) ? state.map : null;
    const concepts = map && Array.isArray(map.concepts) ? map.concepts.filter((c) => isObject(c) && c.id) : [];
    if (!map || !concepts.length) return null;
    const offered = Array.isArray(state.actions) ? state.actions : [];
    const titles = new Map(concepts.map((c) => [c.id, String(c.title || conceptKey(c.id))]));
    const edges = Array.isArray(map.edges) ? map.edges.filter((e) => isObject(e) && titles.has(e.from) && titles.has(e.to)) : [];
    const title = el("h3", { class: "map-title", id: nextId("map-title"), tabindex: "-1" }, t("pane_map_open"));
    const close = el("button", { type: "button", class: "st-button st-button--quiet map-close" }, t("pane_map_close"));
    close.addEventListener("click", () => postAction({ type: "closeMap" }, t("pane_updating")));
    const list = el("ul", { class: "map-list" });
    for (const concept of concepts) {
      const needs = edges.filter((e) => e.to === concept.id).map((e) => titles.get(e.from));
      list.append(mapConcept(concept, titles.get(concept.id), needs, offered.includes("contest")));
    }
    return el("section", { class: "concept-map", "aria-labelledby": title.id }, el("div", { class: "map-head" }, title, close), list);
  }

  function mapConcept(concept, titleText, needs, canContest) {
    const state = MAP_STATES.has(concept.state) ? concept.state : "upcoming";
    const title = el("span", { class: "map-concept-title", id: nextId("map-concept") }, titleText);
    const item = el("li", { class: "map-concept", "data-state": state },
      el("div", { class: "map-concept-head" }, title, " ", el("span", { class: "map-state", "data-state": state }, t("pane_map_state_" + state))));
    if (needs.length) item.append(el("p", { class: "map-needs" }, t("pane_map_needs", { list: needs.join(", ") })));
    const contest = isObject(concept.contest) ? concept.contest : null;
    if (contest && contest.check_pending) item.append(el("p", { class: "map-check-pending" }, t("pane_map_check_pending")));
    if (contest && MAP_OUTCOMES.has(contest.outcome)) item.append(el("p", { class: "map-outcome" }, t("pane_map_outcome_" + contest.outcome)));
    item.append(el("details", { class: "map-details" }, el("summary", {}, t("pane_map_details")), mapScope(concept), mapEvidence(concept)));
    const claim = contest && contest.allowed && canContest && (contest.claim === "known" || contest.claim === "unsure") ? contest.claim : null;
    if (claim) {
      const note = el("span", { class: "map-contest-note", id: nextId("map-note") }, t(Number(contest.questions) >= 2 ? "pane_map_contest_two" : "pane_map_contest_one"));
      const button = el("button", { type: "button", class: "st-button st-button--quiet map-claim", "aria-describedby": `${title.id} ${note.id}` }, t("pane_map_claim_" + claim));
      button.addEventListener("click", () => postAction({ type: "contest", concept_id: concept.id, claim }, t("pane_updating")));
      item.append(el("div", { class: "map-contest" }, button, " ", note));
    }
    return item;
  }

  function mapScope(concept) {
    const scope = el("dl", { class: "map-scope" });
    for (const [label, sentence] of [["pane_map_establishes", concept.establishes], ["pane_map_not_established", concept.does_not_establish]]) {
      if (typeof sentence === "string" && sentence) scope.append(el("dt", {}, t(label)), " ", el("dd", {}, sentence), " ");
    }
    return scope;
  }

  function mapEvidence(concept) {
    const evidence = (Array.isArray(concept.evidence) ? concept.evidence : []).filter(isObject);
    if (!evidence.length) return el("p", { class: "map-no-evidence" }, t("pane_map_no_evidence"));
    const list = el("ul", { class: "map-evidence", "aria-label": t("pane_map_evidence") });
    for (const fact of evidence) {
      const hints = Number(fact.hints);
      const parts = [
        typeof fact.day === "string" && fact.day ? fact.day : t("pane_map_day_unknown"),
        t("pane_map_by_" + (MAP_ASSESSORS.has(fact.assessed_by) ? fact.assessed_by : "none")),
        t("pane_map_result_" + (MAP_RESULTS.has(fact.result) ? fact.result : "recorded")),
        hints === 1 ? t("pane_map_hints_one") : hints > 1 ? t("pane_map_hints_many", { count: hints }) : null,
      ].filter(Boolean);
      list.append(el("li", {}, parts.join(" · ")));
    }
    return list;
  }

  // Self-authored lesson: the host's notice in full on the first screen, then one click away.
  function noticeBlock(notice) {
    if (!memory.notices.has(notice)) {
      memory.notices.add(notice);
      return el("div", { class: "authoring-notice st-notice", role: "note" }, notice);
    }
    return el("details", { class: "authoring-notice-compact" }, el("summary", {}, t("pane_about_lesson")), el("p", {}, notice));
  }

  function sceneHead(state, sc) {
    const head = el("header", { class: "scene-head" });
    const help = document.getElementById("studium-help-" + sc.type);
    if (help instanceof HTMLTemplateElement) head.append(help.content.cloneNode(true));
    const meta = el("div", { class: "scene-meta" });
    const chip = typeChip(sc.type);
    if (chip) meta.append(chip);
    const due = dueChip(state.reviewDue);
    if (due) meta.append(due);
    meta.append(paneMenu());
    head.append(meta);
    // INT-STUDIUM-058: a version-2 view says where the learner is in one line (step, time left, reviews
    // due, what is expected); the rail then keeps its segments and drops its own label, so the step is
    // said once. Then who signs the lesson.
    const orientation = hasOrientation(state);
    if (orientation) head.append(el("p", { class: "orientation-line", "data-waiting": state.orientation.waiting }, state.status_line));
    if (state.progress) head.append(progressRail(state.progress, !orientation));
    const voice = voiceText(isObject(state.voices) ? state.voices.scene : null);
    if (voice) head.append(el("p", { class: "voice voice-scene" }, voice));
    head.append(el("h2", { class: "scene-title", tabindex: "-1" }, sc.title || ""));
    return head;
  }

  function hasOrientation(state) {
    return typeof state.status_line === "string" && state.status_line.length > 0 && isObject(state.orientation);
  }

  // Who speaks in a block: the lesson's author over the scene, who assessed the answer over a verdict.
  function voiceText(voice) {
    if (!isObject(voice)) return "";
    if (voice.kind === "key") return t("pane_voice_key");
    if (voice.kind === "judge") return t("pane_voice_judge");
    if (voice.kind === "agent") return t("pane_voice_agent");
    if (voice.kind !== "author") return "";
    if (voice.reviewed) return voice.name ? t("pane_voice_validated_by", { name: voice.name }) : t("pane_voice_validated");
    if (voice.name) return t("pane_voice_changed");
    if (voice.drafted_by === "agent") return t("pane_voice_ai_unreviewed");
    if (voice.drafted_by === "learner") return t("pane_voice_learner_unreviewed");
    return t("pane_voice_unreviewed");
  }

  // The help ladder (F7), in the order to try the rungs: read again, hint, explanation, reference. Every
  // rung is a button that takes the focus, so a closed rung's reason can be read from the keyboard: it
  // is aria-disabled, never disabled, and pressing it says the reason and sends nothing. « Poser une
  // question » hands over to the assistant. A version-1 view has no ladder.
  const RUNG_LABEL = { reread: "pane_help_reread", hint: "pane_hint", explain: "pane_help_explain", reference: "pane_help_reference" };
  function helpLadder(state) {
    const rungs = isObject(state.help) && Array.isArray(state.help.rungs) ? state.help.rungs.filter((r) => isObject(r) && RUNG_LABEL[r.kind]) : [];
    const offered = Array.isArray(state.actions) ? state.actions : [];
    if (!rungs.length) return null;
    const list = el("div", { class: "help-rungs" });
    for (const rung of rungs) {
      const noteText = rung.available ? rung.cost || "" : rung.why_not || "";
      const noteId = noteText ? nextId("help-note") : null;
      const button = el("button", {
        type: "button", class: "st-button st-button--quiet help-rung", "data-rung": rung.kind,
        "aria-disabled": rung.available ? null : "true", "aria-describedby": noteId,
      }, t(RUNG_LABEL[rung.kind]));
      button.addEventListener("click", () => pressRung(rung, noteText, offered));
      list.append(el("div", { class: "help-rung-item" }, button, noteText ? el("span", { id: noteId, class: "help-note" }, noteText) : null));
    }
    const nav = el("nav", { class: "help-ladder", "aria-label": t("pane_help_heading") }, list);
    if (offered.includes("ask")) {
      const ask = el("button", { type: "button", class: "st-button st-button--quiet ask-button" }, t("pane_ask"));
      ask.addEventListener("click", () => postAction({ type: "ask" }, t("pane_updating")));
      nav.append(ask);
    }
    return nav;
  }

  function pressRung(rung, noteText, offered) {
    if (actionPending) return;
    if (!rung.available) { showActionNotice(noteText); return; }
    if (rung.kind === "reread") { const title = $(".scene-title"); if (title) focusHeading(title); return; }
    if (rung.kind === "hint" && offered.includes("hint")) { postAction({ type: "hint" }, t("pane_finding_hint")); return; }
    if (rung.kind === "explain" && offered.includes("ask")) {
      postAction({ type: "ask", text: t("pane_help_explain_question") }, t("pane_updating"));
      return;
    }
    if (rung.kind === "reference") showActionNotice(t("pane_help_reference_note"));
  }

  // The scene type in words, with the basis of its evaluation (design system key classes).
  function typeChip(type) {
    const keyClass = KEY_CLASS[type];
    if (!keyClass) return null;
    return el("span", { class: "scene-type st-chip", "data-key-class": keyClass, "data-scene-type": type },
      el("span", { class: "scene-type-symbol", "aria-hidden": "true" }, KEY_CLASS_SYMBOL[keyClass]),
      el("span", {}, `${t("pane_type_" + type)} · ${t("pane_key_class_" + keyClass)}`));
  }

  // FSRS: concepts whose recall has decayed past threshold (computed host-side). A timing cue, not a score.
  function dueChip(reviewDue) {
    const due = Array.isArray(reviewDue) ? reviewDue : [];
    if (!due.length) return null;
    return el("span", { class: "review-due st-chip st-chip--due", title: t("pane_due_review_title", { list: due.map(conceptName).join(", ") }) },
      t("pane_due_review", { count: due.length }));
  }

  // Right to be forgotten: always one click away, in the header's overflow menu; the host confirms.
  function paneMenu() {
    const forget = el("button", { type: "button", class: "st-button st-button--quiet forget", title: t("pane_forget_title") }, t("pane_forget"));
    forget.addEventListener("click", () => postAction({ type: "end" }, t("pane_forget_pending")));
    return el("details", { class: "pane-menu" },
      el("summary", { "aria-label": t("pane_menu"), title: t("pane_menu") }, el("span", { "aria-hidden": "true" }, "⋯")),
      el("div", { class: "pane-menu-body" }, forget));
  }

  // The rail shows the furthest step reached: a detour to an earlier scene marks the rail and
  // never moves it back, so the learner does not read « 8 sur 25 » after « 15 sur 25 » (VSC-2).
  function progressRail(progress, labelled = true) {
    const total = Math.max(1, Number(progress.total) || 1);
    const index = Math.min(total, Math.max(1, Number(progress.index) || 1));
    memory.furthest = Math.min(total, Math.max(memory.furthest, index));
    const position = memory.furthest;
    const detour = index < position;
    const label = t("pane_progress", { position, total });
    const rail = el("div", {
      class: "progress st-progress", role: "progressbar", "aria-label": t("pane_progress_label"),
      "aria-valuemin": "1", "aria-valuemax": String(total), "aria-valuenow": String(position),
      "aria-valuetext": detour ? t("pane_progress_detour_value", { position, total }) : label,
    });
    if (labelled) {
      rail.append(el("div", { class: "st-progress__label", "aria-hidden": "true" }, el("strong", {}, label),
        detour ? el("span", { class: "progress-detour" }, t("pane_progress_detour")) : null));
    }
    if (total <= 30) {
      const segments = el("div", { class: "st-segments", "aria-hidden": "true" });
      for (let i = 1; i <= total; i++) {
        segments.append(el("span", { "data-state": i < position ? "complete" : i === position ? "current" : null }));
      }
      rail.append(segments);
    } else {
      rail.append(el("div", { class: "progress-track", "aria-hidden": "true" },
        el("span", { class: "progress-fill", style: `width:${Math.round(position / total * 100)}%` })));
    }
    return rail;
  }

  // Why this scene is shown, in learner words. The engine's rule id and reason code serve the
  // teacher's journal; the pane never prints them (VSC-2).
  const NAV_CARDS = {
    replay: { className: "gate gate-replay", symbol: "↻", title: "pane_gate_replay", why: () => t("pane_nav_replay_why") },
    remediate_alt: { className: "gate gate-remediate_alt", symbol: "↻", title: "pane_gate_remediate", why: () => t("pane_nav_remediate_alt_why") },
    remediate: { className: "nav-card nav-detour", symbol: "↳", title: "pane_nav_detour", why: detourWhy },
    gate_passed: { className: "nav-card nav-return", symbol: "↰", title: "pane_nav_return", why: () => t("pane_nav_return_why") },
    gate_released: { className: "nav-card nav-onward", symbol: "→", title: "pane_nav_onward", why: () => t("pane_nav_released_why") },
    gate_unassessable: { className: "nav-card nav-onward", symbol: "→", title: "pane_nav_onward", why: () => t("pane_nav_unassessable_why") },
    skip_mastered: { className: "nav-card nav-skip", symbol: "»", title: "pane_nav_skip", why: skipWhy },
    skip_concept: { className: "nav-card nav-skip", symbol: "»", title: "pane_nav_next_concept", why: () => t("pane_nav_next_concept_why") },
  };

  function navigationKind(state, sc) {
    if (isObject(state.navigation) && typeof state.navigation.kind === "string") return state.navigation.kind;
    // An older host sends only `explanation`, whose rule_id then names the withhold kind.
    const legacy = state.explanation && state.explanation.rule_id;
    if (legacy === "replay" || legacy === "remediate_alt" || legacy === "remediate") return legacy;
    // A verdict on the very scene shown again is a replay, whatever the host called it.
    if (isObject(state.verdict) && sc.id && state.verdict.scene_id === sc.id) return "replay";
    return null;
  }

  function navigationCard(state, sc) {
    const card = NAV_CARDS[navigationKind(state, sc)];
    if (!card) return null;
    const nav = isObject(state.navigation) ? state.navigation : {};
    return el("div", { class: card.className, role: "note" },
      el("p", { class: "gate-title" }, el("span", { class: "gate-symbol", "aria-hidden": "true" }, card.symbol), " ", t(card.title)),
      el("p", { class: "gate-why" }, card.why(nav)));
  }
  function detourWhy(nav) {
    const back = nav.returns_to && memory.titles.get(nav.returns_to);
    return back ? t("pane_nav_detour_why", { title: back }) : t("pane_nav_detour_why_generic");
  }
  function skipWhy(nav) {
    const count = Array.isArray(nav.skipped_scene_ids) ? nav.skipped_scene_ids.length : 0;
    return count > 1 ? t("pane_nav_skip_many", { count }) : count === 1 ? t("pane_nav_skip_one") : t("pane_nav_skip_generic");
  }

  // The learner-facing fields of each scene type. Answer keys (claims, key_points, model_*, choices'
  // `correct`) are stripped server-side by publicScene before the scene reaches the webview.
  function sceneBody(sc) {
    const nodes = [];
    const prose = (source, extra) => el("div", { class: "prose" + (extra ? " " + extra : ""), html: renderMarkdown(String(source)) });
    const label = (text) => el("p", { class: "pane-label st-eyebrow" }, text);
    if (sc.markdown) nodes.push(prose(sc.markdown));
    // quiz / meta_checkpoint carry their prompt in `question` / `pre_question` (NOT markdown).
    if (sc.type === "quiz" && sc.question) nodes.push(prose(sc.question, "question lead"));
    if (sc.type === "meta_checkpoint" && sc.pre_question) nodes.push(prose(sc.pre_question, "question lead"));
    if (sc.type === "spot_the_flaw" && sc.flawed_content) {
      // verdict-deck mode reframes the task: audit an AI READING of your own result, then judge each
      // claim below (flag/sound). Free-text mode is the older "find the errors in this passage".
      const hasDeck = Array.isArray(sc.deck) && sc.deck.length;
      nodes.push(label(t(hasDeck ? "pane_audit_deck" : "pane_find_errors")), prose(sc.flawed_content, "flawed"));
    }
    if (sc.type === "explain_back" && sc.prompt) nodes.push(prose(sc.prompt, "question lead"));
    if (sc.type === "comparison") {
      if (sc.prompt) nodes.push(prose(sc.prompt, "question lead"));
      const columns = [["A", sc.artifact_a], ["B", sc.artifact_b]].filter(([, text]) => text)
        .map(([name, text]) => el("section", { class: "compare-col" }, label(name), prose(text)));
      if (columns.length) nodes.push(el("div", { class: "compare-grid" + (columns.length === 2 ? " two" : "") }, ...columns));
    }
    if (sc.type === "summary_audit") {
      if (sc.source_content) nodes.push(label(t("pane_source_content")), prose(sc.source_content));
      if (sc.ai_summary) nodes.push(label(t("pane_ai_summary")), prose(sc.ai_summary, "ai-summary"));
    }
    if (sc.type === "prompt_practice" && sc.task) nodes.push(label(t("pane_task")), prose(sc.task));
    if (sc.type === "communication_sim") {
      if (sc.scenario) nodes.push(label(t("pane_situation")), prose(sc.scenario));
      if (sc.prompt) nodes.push(prose(sc.prompt, "question lead"));
    }
    // reproduction — the protocol the learner reproduces; expected_output is the per-step answer and
    // is NOT drawn (the executed reference run arrives as a separate executed_result asset).
    if (sc.type === "reproduction" && Array.isArray(sc.steps)) {
      nodes.push(label(t("pane_protocol") + (sc.task_card_id ? " — " + sc.task_card_id : "")));
      const ol = el("ol", { class: "steps" });
      sc.steps.forEach((s) => ol.append(el("li", {}, (s && s.instruction) || "")));
      nodes.push(ol);
    }
    // discussion — a multi-turn Socratic dialogue: topic, seed claim and the transcript the turn
    // loop appends to (learner turn on send, tutor reply on turn_result).
    if (sc.type === "discussion") {
      if (sc.topic) nodes.push(label(t("pane_discussion", { topic: sc.topic })));
      if (sc.seed_claim) nodes.push(prose(sc.seed_claim, "question lead"));
      ui.turns = el("div", { id: "turns", class: "turns" });
      nodes.push(ui.turns);
    }
    return nodes;
  }

  function assetsSection(state) {
    const assets = Array.isArray(state.scene_assets) ? state.scene_assets : [];
    if (!assets.length) return null;
    // Modality-adaptive cue: the pane leads with the learner's preferred modality; nothing is hidden,
    // the other modality is collapsed below and can be opened.
    const pref = state.modalityPreference;
    const view = pref === "visual" ? t("pane_visual_view") : pref === "textual" ? t("pane_textual_view") : null;
    const box = el("section", { class: "assets", "aria-label": t("pane_artifacts") });
    box.append(el("p", { class: "pane-label st-eyebrow" }, view ? t("pane_artifacts_with_view", { view }) : t("pane_artifacts")));
    assets.forEach((a) => box.append(renderAsset(a)));
    return box;
  }

  // Shown only when the host enables studium.showMastery (a teacher's view); the learner's own
  // feedback never shows a mastery number.
  function masteryPanel(mastery) {
    const entries = isObject(mastery) ? Object.entries(mastery).filter(([, v]) => Number.isFinite(v)) : [];
    if (!entries.length) return null;
    const list = el("div", { class: "st-mastery mastery" });
    entries.forEach(([concept, value]) => {
      const id = nextId("mastery");
      list.append(el("div", { class: "mrow" },
        el("label", { class: "mk", for: id }, conceptKey(concept)),
        el("meter", { id, min: "0", max: "1", value: String(value) }),
        el("span", { class: "mv" }, t("pane_mastery_value", { value: Math.round(value * 100) }))));
    });
    return el("details", { class: "mastery-panel" }, el("summary", {}, t("pane_mastery")), list);
  }

  // --- the feedback step (VSC-1) -------------------------------------------------------------------
  // The answer's verdict on its own screen, titled with the scene that was answered, before the next
  // scene. « Continuer » shows the next scene, which the host already sent.
  // The chip never claims more than the evidence: only a key (quiz, deck) or a model judge sets
  // `correct`; an answer nobody measured reads « à comparer toi-même · non certifié ».
  const VERDICT_SYMBOL = { correct: "✓", partial: "◐", incorrect: "×", "keyword-only": "≈" };
  function verdictKind(v) {
    if (v.correct === true) return "correct";
    if (v.correct === false) return isObject(v.detail) && v.detail.caught > 0 ? "partial" : "incorrect";
    return "keyword-only";
  }
  function verdictLabel(v, kind) {
    if (kind === "correct") return t("pane_correct");
    if (kind === "partial") return t("pane_partial", { caught: v.detail.caught, planted: v.detail.planted });
    if (kind === "incorrect") return t("pane_incorrect");
    return t("pane_uncertified");
  }

  function renderFeedbackStep(fb) {
    const root = resetPane();
    const v = fb.verdict;
    const kind = verdictKind(v);
    const titleText = (v.scene_id && memory.titles.get(v.scene_id)) || t("pane_feedback_untitled");
    const title = el("h2", { class: "scene-title", id: nextId("feedback-title"), tabindex: "-1" }, titleText);
    const step = el("section", { class: "feedback-step", "aria-labelledby": title.id },
      el("p", { class: "st-eyebrow" }, t("pane_feedback_eyebrow")), title);
    // INT-STUDIUM-058: who assessed this answer, over its feedback.
    const voice = voiceText(isObject(fb.voices) ? fb.voices.verdict : null);
    if (voice) step.append(el("p", { class: "voice voice-verdict" }, voice));
    step.append(feedbackCard(v, kind, fb.withheld));
    // L-7: an author-keyed verdict of a lesson an AI drafted says whose key it is, and where to check it.
    if (v.assessed_by === "key" && isObject(fb.authoring) && fb.authoring.drafted_by === "agent") {
      step.append(el("p", { class: "feedback-key-note" }, t("pane_ai_key_note")));
    }
    if (!fb.withheld) {
      [keyPointsBlock(v), modelAnswerBlock(v), sourcesBlock(fb.sources)]
        .forEach((node) => { if (node) step.append(node); });
    }
    const calibration = calibrationFor(v.scene_id, fb.calibration);
    if (calibration) step.append(calibration);
    if (fb.rating) step.append(selfRatingBlock(fb.rating));
    const next = el("button", { type: "button", class: "st-button st-button--primary primary continue" }, t("pane_continue"));
    next.addEventListener("click", () => { if (!actionPending) fb.onContinue(); });
    step.append(el("div", { class: "st-actions feedback-actions" }, next));
    ui.status = el("div", { id: "action-status", class: "action-status", role: "status", "aria-live": "polite" });
    step.append(ui.status);
    root.append(step);
    announce(t("pane_live_feedback", { title: titleText, verdict: verdictLabel(v, kind) }));
    focusHeading(title);
  }

  function feedbackCard(v, kind, withheld) {
    const heading = el("div", { class: "st-feedback__heading" },
      el("span", { class: "st-feedback__symbol", "aria-hidden": "true" }, VERDICT_SYMBOL[kind]),
      el("span", { class: "feedback-chip" }, verdictLabel(v, kind)),
      kind === "keyword-only" ? el("span", { class: "st-feedback__qualification" }, t("pane_not_certified")) : null);
    const card = el("div", { class: "feedback-card st-feedback", "data-verdict": kind }, heading);
    if (kind === "keyword-only") card.append(el("p", { class: "feedback-why" }, t("pane_uncertified_why")));
    const detail = deckDetail(v.detail);
    if (detail) card.append(detail);
    if (withheld) card.append(el("p", { class: "feedback-withheld" }, t("pane_feedback_withheld")));
    else if (v.feedback) card.append(el("div", { class: "prose feedback-body", html: renderMarkdown(String(v.feedback)) }));
    return card;
  }

  // A verdict deck's measured counts; false alarms only when the sound claims were measured too.
  function deckDetail(d) {
    if (!isObject(d) || !Number.isFinite(d.planted)) return null;
    const parts = [t("pane_deck_found", { caught: d.caught, planted: d.planted })];
    if (d.sound_total > 0) parts.push(t("pane_deck_false_alarms", { count: d.false_positives, total: d.sound_total }));
    return el("p", { class: "feedback-detail" }, parts.join(" · "));
  }

  // The reference the answer is compared with (I-1), labelled by what it holds (reference_kind): the
  // key points to cover, an audit's planted flaws or a critique's claims that hid a flaw. A point a judge
  // found missing (key_points_missing) is marked in words, once, in this list; the feedback above only
  // gives the count, so nothing is said twice.
  const REFERENCE_LABEL = { key_points: "pane_key_points", planted_flaws: "pane_planted_flaws", flawed_claims: "pane_flawed_claims",
    correct_choice: "pane_correct_choice" };
  function keyPointsBlock(v) {
    const items = (Array.isArray(v.key_points) ? v.key_points : [])
      .map((p) => (typeof p === "string" ? p : isObject(p) ? p.text : "")).filter(Boolean);
    if (!items.length) return null;
    const missing = new Set((Array.isArray(v.key_points_missing) ? v.key_points_missing : []).filter((p) => typeof p === "string"));
    const label = REFERENCE_LABEL[v.reference_kind] || REFERENCE_LABEL.key_points;
    return el("div", { class: "key-points", "data-reference": v.reference_kind || "key_points" }, el("p", { class: "st-eyebrow" }, t(label)),
      el("ul", {}, ...items.map((text) => keyPointItem(String(text), missing.has(text)))));
  }
  function keyPointItem(text, isMissing) {
    const item = el("li", { class: isMissing ? "key-point key-point--missing" : "key-point", "data-missing": isMissing ? "true" : null,
      html: renderMarkdown(text) });
    if (isMissing) {
      const mark = el("span", { class: "key-point__missing" }, t("pane_key_point_missing"));
      const last = item.lastElementChild;
      (last && last.tagName === "P" ? last : item).append(" ", mark);
    }
    return item;
  }

  function modelAnswerBlock(v) {
    const text = v.model_answer;
    if (typeof text !== "string" || !text.trim()) return null;
    const label = v.reference_kind === "planted_flaws" ? "pane_model_correction" : "pane_model_answer";
    return el("details", { class: "model-answer" }, el("summary", {}, t(label)),
      el("div", { class: "prose", html: renderMarkdown(text) }));
  }

  function sourcesBlock(sources) {
    if (!sources || !sources.length) return null;
    const box = el("div", { class: "feedback-sources" }, el("p", { class: "st-eyebrow" }, t("pane_cited_source")));
    sources.forEach((s) => {
      const name = String(s.title || s.url || "");
      const link = s.url && isSafeLink(s.url) ? el("a", { href: String(s.url).trim(), target: "_blank", rel: "noopener" }, name) : name;
      // L-3: the source's licence completes its attribution (« titre, CC BY-SA 4.0 »).
      const licence = typeof s.license === "string" && s.license.trim() ? `, ${s.license.trim()}` : "";
      box.append(el("figure", { class: "source" },
        s.quote ? el("blockquote", {}, String(s.quote)) : null, el("figcaption", {}, link, licence)));
    });
    return box;
  }

  // Calibration mirror (B1), shown once, with the answer on that concept: only the actionable bands
  // (sur/sous), number-free, never a mastery score.
  function calibrationFor(sceneId, calibration) {
    const concepts = sceneId ? memory.concepts.get(sceneId) : null;
    if (!concepts || !concepts.length || !Array.isArray(calibration)) return null;
    const relevant = calibration.filter((c) => isObject(c) && (c.band === "sur" || c.band === "sous")
      && concepts.includes(conceptKey(c.concept_id)));
    if (!relevant.length) return null;
    return el("div", { class: "calibration" }, el("p", { class: "st-eyebrow" }, t("pane_calibration")),
      ...relevant.slice(0, 2).map((c) => el("div", { class: "calib calib-" + c.band },
        el("span", { class: "calib-chip" }, t(c.band === "sur" ? "pane_overconfidence" : "pane_underconfidence")),
        el("span", { class: "calib-msg" }, c.message || ""))));
  }

  // C4: one rating per answer. It goes to the host without blocking the pane (rating is optional and
  // « Continuer » stays available); the host confirms with recall_rated, or an action_error unlocks
  // the grades for a retry.
  function selfRatingBlock(request) {
    const titleId = nextId("self-rating");
    const note = el("p", { class: "self-rating-status", role: "status" });
    const buttons = request.grades.map((grade) =>
      el("button", { type: "button", class: "st-button grade", "data-grade": grade, "aria-pressed": "false" }, t("pane_grade_" + grade)));
    const lock = (on) => buttons.forEach((b) => { b.disabled = on; });
    let inFlight = false;
    buttons.forEach((button) => button.addEventListener("click", () => {
      if (inFlight || memory.rated.has(request.sceneId) || !window.__send) return;
      const grade = button.getAttribute("data-grade");
      inFlight = true;
      memory.rated.add(request.sceneId);
      lock(true);
      button.setAttribute("aria-pressed", "true");
      note.textContent = t("pane_self_rating_pending");
      window.__send({ type: "rateRecall", sceneId: request.sceneId, grade });
    }));
    if (memory.rated.has(request.sceneId)) lock(true);
    ui.rating = {
      sceneId: request.sceneId,
      confirmed(grade) {
        inFlight = false;
        note.textContent = t("pane_self_rating_done", { grade: t("pane_grade_" + grade) });
      },
      failed() {
        if (!inFlight) return;
        inFlight = false;
        memory.rated.delete(request.sceneId);
        lock(false);
        buttons.forEach((b) => b.setAttribute("aria-pressed", "false"));
        note.textContent = "";
      },
    };
    return el("div", { class: "self-rating", role: "group", "aria-labelledby": titleId },
      el("p", { class: "st-eyebrow", id: titleId }, t("pane_self_rating_title")),
      el("p", { class: "self-rating-scope" }, t("pane_self_rating_scope")),
      el("div", { class: "st-actions self-rating-grades" }, ...buttons), note);
  }

  // --- the end of the lesson (VSC-6) -------------------------------------------------------------------
  function showDone(d) {
    applyLanguage(d);
    if (isObject(d.authoring)) lastAuthoring = d.authoring;
    const verdict = isObject(d.verdict) ? d.verdict : null;
    const rating = selfRatingOf(d, verdict);
    if (verdict && (verdict.graded || rating)) {
      recordOutcome(verdict);
      pendingDone = d;
      renderFeedbackStep({ verdict, rating, calibration: d.calibration, sources: sourcesOf(d, verdict), authoring: lastAuthoring, withheld: false,
        onContinue: () => { pendingDone = null; renderCompletion(d); } });
      return;
    }
    renderCompletion(d);
  }

  // What was consolidated and what to revisit, named, never scored; the next review in words; and the
  // next moves the host declared. Without a host summary the pane names the questions it saw.
  const COMPLETION_ACTIONS = {
    review: { type: "reviewNow", label: "pane_review_now" },
    restart: { type: "restartLesson", label: "pane_restart" },
    pick: { type: "pickCourse", label: "pane_pick_course" },
  };
  function renderCompletion(d) {
    const summary = isObject(d.completion) ? d.completion : null;
    const groups = summary ? summaryGroups(summary) : observedGroups();
    const root = resetPane();
    const title = el("h2", { id: "completion-title", tabindex: "-1" }, t("pane_complete"));
    const section = el("section", { class: "completion", "aria-labelledby": "completion-title" },
      el("p", { class: "st-eyebrow" }, t("pane_completion_eyebrow")), title);
    if (d.message) section.append(el("p", { class: "completion-message" }, String(d.message)));
    groups.forEach((g) => section.append(el("div", { class: "completion-group", "data-group": g.name },
      el("h3", {}, g.label), el("ul", {}, ...g.items.map((item) => el("li", {}, String(item)))))));
    if (summary && summary.detours > 0) section.append(el("p", { class: "completion-detours" }, t("pane_completion_detours", { count: summary.detours })));
    const review = reviewLine(summary);
    if (review) section.append(review);
    const actions = completionActions(summary);
    if (actions) section.append(actions);
    ui.status = el("div", { id: "action-status", class: "action-status", role: "status", "aria-live": "polite" });
    section.append(ui.status);
    root.append(section);
    memory = freshMemory();
    announce(t("pane_complete"));
    focusHeading(title);
  }

  // L-6: consolidated only past the host's attempt floor and threshold; below it a concept was practised (named with
  // its number of graded answers); without a graded answer it is not measured yet. An older host's to_revisit list
  // is still shown under its own heading.
  function summaryGroups(summary) {
    const named = (list) => (Array.isArray(list) ? list : []).map(conceptName).filter(Boolean);
    const practised = (Array.isArray(summary.practised) ? summary.practised : []).map((c) => {
      const name = conceptName(c);
      const n = isObject(c) && Number.isFinite(c.answers) ? c.answers : null;
      return n === null || !name ? name : `${name} ${t(n === 1 ? "pane_completion_answers_one" : "pane_completion_answers", { count: n })}`;
    }).filter(Boolean);
    return [
      { name: "consolidated", label: t("pane_completion_consolidated"), items: named(summary.consolidated) },
      { name: "practised", label: t("pane_completion_practised"), items: practised },
      { name: "not-measured", label: t("pane_completion_not_measured"), items: named(summary.not_measured) },
      { name: "to-revisit", label: t("pane_completion_to_revisit"), items: named(summary.to_revisit) },
    ].filter((g) => g.items.length);
  }

  function observedGroups() {
    const by = { passed: [], missed: [], open: [] };
    memory.outcomes.forEach((outcome, sceneId) => {
      const title = memory.titles.get(sceneId);
      if (title && by[outcome]) by[outcome].push(title);
    });
    return [
      { name: "passed", label: t("pane_completion_passed"), items: by.passed },
      { name: "missed", label: t("pane_completion_missed"), items: by.missed },
      { name: "open", label: t("pane_completion_open"), items: by.open },
    ].filter((g) => g.items.length);
  }

  function reviewLine(summary) {
    if (!summary) return null;
    if (summary.due_now > 0) return el("p", { class: "completion-review" }, t("pane_completion_due_now", { count: summary.due_now }));
    const date = summary.next_review_at != null ? new Date(summary.next_review_at) : null;
    if (!date || Number.isNaN(date.getTime())) return null;
    const words = new Intl.DateTimeFormat(pageLocale(), { weekday: "long", day: "numeric", month: "long" }).format(date);
    return el("p", { class: "completion-review" }, t("pane_completion_next", { date: words }));
  }

  function completionActions(summary) {
    const wanted = summary && Array.isArray(summary.actions) ? summary.actions.filter((a) => COMPLETION_ACTIONS[a]) : [];
    if (!wanted.length) return null;
    return el("div", { class: "st-actions completion-actions" }, ...wanted.map((name, i) => {
      const action = COMPLETION_ACTIONS[name];
      const button = el("button", { type: "button", class: "st-button" + (i === 0 ? " st-button--primary primary" : ""), "data-action": name }, t(action.label));
      button.addEventListener("click", () => postAction({ type: action.type }, t("pane_updating")));
      return button;
    }));
  }

  // --- answer controls ------------------------------------------------------------------------------
  // free-text active-learning scenes → { kind submitted, button label, placeholder, optional scene
  // field to prefill the textarea }. The kinds MUST match src/scene-io.ts FREE_TEXT_KIND (and the
  // server-side graders, which reject a mismatched kind); scene-io.driver.ts asserts the parity.
  const FREE_TEXT = {
    ai_critique:       { kind: "critique",          label: "pane_submit_critique",      placeholder: "pane_critique_placeholder" },
    spot_the_flaw:     { kind: "flaw_report",       label: "pane_submit_flaws",         placeholder: "pane_flaws_placeholder" },
    explain_back:      { kind: "explanation",       label: "pane_submit_explanation",   placeholder: "pane_explanation_placeholder" },
    comparison:        { kind: "comparison",        label: "pane_submit_comparison",    placeholder: "pane_comparison_placeholder" },
    summary_audit:     { kind: "summary_audit",     label: "pane_submit_audit",         placeholder: "pane_audit_placeholder" },
    prompt_practice:   { kind: "prompt_submission", label: "pane_submit_prompt",        placeholder: "pane_prompt_placeholder", prefill: "starter_prompt" },
    communication_sim: { kind: "communication",     label: "pane_submit_communication", placeholder: "pane_communication_placeholder" },
  };

  // optional per-answer confidence tap (0..4) — the CONTINUOUS calibration capture: the learner may
  // rate how sure they are, and it rides on the submitted input as `confidence`. A radiogroup whose
  // checked value can be cleared again (the rating is optional). Returns { node, get }.
  function confidenceRow() {
    let value;
    const labelId = nextId("confidence");
    const row = el("div", { class: "confrow", role: "radiogroup", "aria-labelledby": labelId },
      el("span", { class: "conf-label", id: labelId }, t("pane_confidence")));
    const buttons = [0, 1, 2, 3, 4].map((v) => el("button", {
      type: "button", class: "conf", role: "radio", "aria-checked": "false", tabindex: v === 0 ? "0" : "-1",
      title: t("pane_confidence_" + v), "aria-label": `${v} · ${t("pane_confidence_" + v)}`,
    }, String(v)));
    const sync = () => buttons.forEach((b, i) => {
      const on = value === i;
      b.classList.toggle("sel", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.setAttribute("tabindex", (value === undefined ? i === 0 : on) ? "0" : "-1");
    });
    const choose = (v) => { value = v; sync(); if (v !== undefined) buttons[v].focus(); };
    buttons.forEach((b, v) => {
      b.addEventListener("click", () => { value = value === v ? undefined : v; sync(); });
      // Arrow keys move the checked value as in a native radio group; a digit 0-4 picks it.
      b.addEventListener("keydown", (ev) => {
        const step = ev.key === "ArrowRight" || ev.key === "ArrowDown" ? 1 : ev.key === "ArrowLeft" || ev.key === "ArrowUp" ? -1 : 0;
        if (step) { ev.preventDefault(); choose(Math.min(4, Math.max(0, (value ?? v) + step))); }
        else if (/^[0-4]$/.test(ev.key)) { ev.preventDefault(); choose(Number(ev.key)); }
      });
    });
    row.append(...buttons);
    return { node: row, get: () => value };
  }
  // attach the tapped confidence to a submitted input (omitted when the learner didn't rate).
  function withConf(input, cr) { const v = cr && cr.get(); return v == null ? input : Object.assign({}, input, { confidence: v }); }

  // Choice cards: native radios in a fieldset. Picking a card never submits; « Valider » does, so a
  // misclick is not an answer (VSC-8).
  function choiceGroup({ legend, items, onSubmit }) {
    const name = nextId("choice");
    const fieldset = el("fieldset", { class: "st-choices choices" }, el("legend", {}, legend));
    const inputs = items.map((item, index) => {
      const input = el("input", { type: "radio", name, value: String(index) });
      fieldset.append(el("label", { class: "choice st-choice" }, input,
        el("span", { class: "choice-key", "aria-hidden": "true" }, item.key),
        el("span", { class: "choice-text", html: item.html })));
      return input;
    });
    const validate = el("button", { type: "button", class: "st-button st-button--primary primary validate", disabled: true }, t("pane_validate"));
    const selected = () => inputs.findIndex((i) => i.checked);
    const sync = () => { validate.disabled = selected() < 0; };
    inputs.forEach((i) => i.addEventListener("change", sync));
    const submit = () => { const i = selected(); if (i >= 0) onSubmit(i); };
    validate.addEventListener("click", submit);
    return {
      fieldset, validate, submit,
      select(index) {
        const input = inputs[index];
        if (!input || input.disabled) return false;
        input.checked = true;
        sync();
        input.focus();
        return true;
      },
    };
  }
  const letterOf = (index) => String.fromCharCode(65 + index);

  function quizControls(wrap, sc, hasLadder) {
    const choices = Array.isArray(sc.choices) ? sc.choices : [];
    const confidence = confidenceRow();
    const group = choiceGroup({
      legend: t("pane_choices_legend"),
      items: choices.map((c, i) => ({ key: letterOf(i), html: renderMarkdown(String(c.text == null ? "" : c.text)) })),
      onSubmit: (i) => postAction(
        { type: "respond", input: withConf({ kind: "quiz_choice", choiceId: choices[i].id }, confidence) },
        t("pane_sending_response"),
      ),
    });
    wrap.append(group.fieldset);
    if (choices.length > 1) {
      wrap.append(el("p", { class: "shortcut-hint" }, t("pane_choice_shortcuts", { letters: `A–${letterOf(Math.min(choices.length, 26) - 1)}`, count: Math.min(choices.length, 9) })));
    }
    wrap.append(confidence.node);
    ui.keys = { choices: group, digitBase: 1 };
    // A version-2 view has the hint in its help ladder, with its cost.
    if (hasLadder) { wrap.append(el("div", { class: "st-actions" }, group.validate)); return; }
    // The hint's cost is said before it is asked for: a hinted right answer counts less for mastery.
    const costId = nextId("hint-cost");
    const hint = el("button", { type: "button", class: "st-button st-button--quiet hint-button", title: t("pane_hint_cost"), "aria-describedby": costId }, t("pane_hint"));
    hint.addEventListener("click", () => postAction({ type: "hint" }, t("pane_finding_hint")));
    wrap.append(el("div", { class: "st-actions" }, group.validate, hint), el("span", { id: costId, class: "visually-hidden" }, t("pane_hint_cost")));
  }

  function metaControls(wrap, sc) {
    const labels = Array.isArray(sc.scale_labels) ? sc.scale_labels : [];
    const group = choiceGroup({
      legend: t("pane_meta_legend"),
      items: [0, 1, 2, 3, 4].map((v) => ({ key: String(v), html: escapeHtml(labels[v] != null ? labels[v] : t("pane_confidence_" + v)) })),
      onSubmit: (v) => postAction({ type: "respond", input: { kind: "confidence", value: v } }, t("pane_sending_response")),
    });
    wrap.append(group.fieldset, el("p", { class: "shortcut-hint" }, t("pane_meta_shortcuts")), el("div", { class: "st-actions" }, group.validate));
    ui.keys = { choices: group, digitBase: 0 };
  }

  // A labelled answer box; Ctrl/Cmd+Enter sends it (wired by the keyboard handler).
  function answerField(placeholder, prefill) {
    const id = nextId("answer");
    const textarea = el("textarea", { id, class: "critique st-input", placeholder, rows: "6" });
    if (prefill) textarea.value = prefill;
    const node = el("div", { class: "st-field answer-field" },
      el("label", { class: "st-field__label", for: id }, t("pane_answer_label")),
      textarea,
      el("p", { class: "st-field__help" }, t("pane_submit_shortcut")));
    return { node, textarea };
  }

  // multi-turn: each "Envoyer" posts a {type:"turn"} (scored reasoning + Socratic reply, appended to
  // the transcript) WITHOUT advancing; "Terminer" advances the scene with an ack.
  function discussionControls(wrap) {
    const field = answerField(t("pane_discussion_placeholder"));
    const sendBtn = el("button", { type: "button", class: "st-button st-button--primary primary", disabled: true }, t("pane_send"));
    const sync = requireText(field.textarea, sendBtn);
    // UX-07: the turn is shown as pending until the host answers; if it fails, it leaves the transcript and its
    // text returns to the box (showActionError).
    const sendTurn = () => {
      const text = field.textarea.value.trim();
      if (!text || !window.__send) return;
      if (!postAction({ type: "turn", text }, t("pane_tutor_pending"))) return;
      const line = appendTurn("learner", text);
      if (line) line.classList.add("turn-pending");
      ui.pendingTurn = line ? { line, text, textarea: field.textarea, sync } : null;
      field.textarea.value = "";
      sync();
    };
    sendBtn.addEventListener("click", sendTurn);
    const fin = el("button", { type: "button", class: "st-button st-button--quiet" }, t("pane_finish_discussion"));
    fin.addEventListener("click", () => postAction({ type: "respond", input: { kind: "ack" } }, t("pane_next_step")));
    wrap.append(field.node, el("div", { class: "st-actions" }, sendBtn, fin));
    ui.keys = { textarea: field.textarea, submitText: sendTurn };
  }

  // every single-submit free-text active-learning scene → a textarea posting the kind its grader
  // requires (kinds mirror src/scene-io.ts FREE_TEXT_KIND; scene-io.driver.ts guards the parity).
  function freeTextControls(wrap, sc) {
    const f = FREE_TEXT[sc.type];
    const field = answerField(t(f.placeholder), f.prefill ? sc[f.prefill] : "");
    const confidence = confidenceRow();
    const submit = () => postAction(
      { type: "respond", input: withConf({ kind: f.kind, text: field.textarea.value }, confidence) },
      t("pane_sending_response"),
    );
    const button = el("button", { type: "button", class: "st-button st-button--primary primary" }, t(f.label));
    requireText(field.textarea, button);
    button.addEventListener("click", () => { if (field.textarea.value.trim()) submit(); });
    wrap.append(field.node, confidence.node, el("div", { class: "st-actions" }, button));
    ui.keys = { textarea: field.textarea, submitText: () => { if (field.textarea.value.trim()) submit(); } };
  }

  // UX-08: an empty answer box is not an answer — its submit button waits for text, as « Valider » waits for a
  // choice (VSC-8). Returns the sync function (called again when the box is emptied by the pane itself).
  function requireText(textarea, button) {
    const sync = () => { if (!actionPending) button.disabled = !textarea.value.trim(); };
    textarea.addEventListener("input", sync);
    sync();
    return sync;
  }

  // A reproduction the LEARNER must run (run_manifest): the host refuses to advance before the run,
  // so the pane offers the run itself instead of a « Continuer » that would fail (VSC-8).
  function runControls(wrap) {
    const run = el("button", { type: "button", class: "st-button st-button--primary primary run" }, t("pane_run"));
    run.addEventListener("click", () => postAction({ type: "run" }, t("pane_running")));
    wrap.append(el("p", { class: "run-note" }, t("pane_run_note")), el("div", { class: "st-actions" }, run));
  }

  function ackControls(wrap) {
    const next = el("button", { type: "button", class: "st-button st-button--primary primary" }, t("pane_continue"));
    next.addEventListener("click", () => postAction({ type: "respond", input: { kind: "ack" } }, t("pane_next_step")));
    wrap.append(el("div", { class: "st-actions" }, next));
  }

  // interactive controls the learner uses to advance — posts back to the extension host.
  function renderControls(sc, state) {
    const wrap = el("div", { class: "controls" });
    const hasLadder = !!state && isObject(state.help) && Array.isArray(state.help.rungs) && state.help.rungs.length > 0;
    if (sc.type === "quiz") quizControls(wrap, sc, hasLadder);
    else if (sc.type === "meta_checkpoint") metaControls(wrap, sc);
    else if (sc.type === "discussion") discussionControls(wrap);
    else if (sc.type === "spot_the_flaw" && Array.isArray(sc.deck) && sc.deck.length) {
      // VERDICT DECK (D1): the DESTINATION made interactive. The host ships a shuffled, label-stripped
      // deck of opaque-token claims (publicDeck: {token,text} only — the flawed/sound truth stays
      // server-side). The learner makes a forced flag/sound decision PER claim; flagging a sound claim is
      // a false alarm (over-distrust), missing a flawed one is over-trust — the bidirectional signal,
      // captured offline with zero LLM. Replaces the free-text flaw_report so the graded path is
      // unambiguous. LEAK BOUNDARY: render ONLY {token,text}; never echo any ground-truth flag.
      wrap.append(deckControls(sc));
    } else if (FREE_TEXT[sc.type]) freeTextControls(wrap, sc);
    else if (sc.type === "reproduction" && sc.run_manifest) runControls(wrap);
    else ackControls(wrap);
    ui.status = el("div", { id: "action-status", class: "action-status", role: "status", "aria-live": "polite" });
    wrap.append(ui.status);
    return wrap;
  }

  // The verdict-deck control: one flag/sound toggle per opaque-token claim + an optional confidence tap
  // + a single submit. Posts { kind:'flaw_verdicts', verdicts:[{token,flagged}] } — one entry per deck
  // token (unflagged = judged sound). Mirrors ResponseInputSchema.flaw_verdicts; the host re-derives the
  // deck permutation from the scene id (+ server secret) to score hits vs false alarms. Renders ONLY the
  // {token,text} the host shipped — the ground-truth flawed/sound flags never reach the client.
  function deckControls(sc) {
    const box = el("div", { class: "deck" });
    box.append(el("p", { class: "deck-instr" }, t("pane_deck_instruction")));
    const deck = Array.isArray(sc.deck) ? sc.deck : [];
    const verdicts = deck.map((d) => ({ token: d.token, flagged: false }));
    deck.forEach((d, i) => {
      const row = el("div", { class: "deck-row", "data-token": d.token });
      const claimId = nextId("claim");
      const claim = el("div", { class: "deck-claim", id: claimId, html: renderMarkdown(d.text || "") });
      const toggle = el("button", { type: "button", class: "st-button deck-flag", "aria-pressed": "false", "aria-describedby": claimId }, t("pane_flag"));
      toggle.addEventListener("click", () => {
        const on = !verdicts[i].flagged;
        verdicts[i].flagged = on;
        toggle.classList.toggle("on", on);
        toggle.setAttribute("aria-pressed", on ? "true" : "false");
        toggle.textContent = t(on ? "pane_unflag" : "pane_flag");
        row.classList.toggle("flagged", on);
      });
      row.append(claim, toggle);
      box.append(row);
    });
    const cr = confidenceRow();
    const submit = el("button", { type: "button", class: "st-button st-button--primary primary deck-submit" }, t("pane_submit_judgment"));
    submit.addEventListener("click", () => postAction({
      type: "respond",
      input: withConf({ kind: "flaw_verdicts", verdicts: verdicts.map((v) => ({ token: v.token, flagged: v.flagged })) }, cr),
    }, t("pane_sending_judgment")));
    box.append(cr.node, el("div", { class: "st-actions" }, submit));
    return box;
  }

  // append one dialogue turn to the discussion transcript. `meta` is an optional reasoning-signal
  // note shown under a tutor reply. No-op when the scene has no transcript.
  function appendTurn(role, text, meta) {
    if (!ui.turns) return null;
    const line = el("div", { class: "turn turn-" + role });
    line.append(el("span", { class: "turn-who st-eyebrow" }, t(role === "learner" ? "pane_you" : "pane_tutor")));
    line.append(el("div", { class: "turn-text", html: renderMarkdown(text) }));
    if (meta) line.append(el("div", { class: "turn-meta" }, meta));
    ui.turns.append(line);
    return line;
  }

  // --- keyboard (VSC-8) -------------------------------------------------------------------------------
  // A letter (A, B, …) or a digit picks a choice card, Enter on a picked card submits it, and
  // Ctrl/Cmd+Enter sends the answer box. Typing in a text field is never a shortcut.
  function shortcutIndex(key, digitBase) {
    if (/^[a-z]$/i.test(key)) return key.toLowerCase().charCodeAt(0) - 97;
    if (/^[0-9]$/.test(key)) { const index = Number(key) - digitBase; return index >= 0 ? index : null; }
    return null;
  }
  document.addEventListener("keydown", (ev) => {
    const keys = ui.keys;
    if (!keys || ev.defaultPrevented || ev.altKey || actionPending) return;
    const target = ev.target && ev.target.nodeType === 1 ? ev.target : null;
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
      if (keys.textarea && target === keys.textarea) { ev.preventDefault(); keys.submitText(); }
      return;
    }
    if (ev.ctrlKey || ev.metaKey || !keys.choices) return;
    // UX-02 (WCAG 2.1.4): a letter or a digit picks a card only while focus is inside the choices — never from a
    // link, the hint button or the heading, where a dictated word or a screen reader's keys would answer.
    if (!target || !keys.choices.fieldset.contains(target)) return;
    if (target.closest("textarea, select, .confrow, input:not([type=radio])")) return;
    if (ev.key === "Enter") {
      if (target && target.type === "radio" && target.checked) { ev.preventDefault(); keys.choices.submit(); }
      return;
    }
    const index = shortcutIndex(ev.key, keys.digitBase);
    if (index !== null && keys.choices.select(index)) ev.preventDefault();
  });

  const CODE_KEYWORDS = {
    python: new Set("and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield True False None".split(" ")),
    javascript: new Set("as async await break case catch class const continue debugger default delete do else export extends false finally for from function get if import in instanceof let new null of return set static super switch this throw true try typeof var void while with yield interface type enum implements private protected public readonly abstract declare namespace".split(" ")),
    sql: new Set("select from where join inner left right full on as and or not null is insert into update delete create alter drop table values set group by order having limit offset union all distinct case when then else end with recursive primary key foreign references".split(" ")),
    bash: new Set("if then elif else fi for while until do done case esac function in select time coproc local readonly export declare typeset unset shift source return break continue true false".split(" ")),
    json: new Set(["true", "false", "null"]),
  };

  // Small, non-parsing highlighter: token classes only, with every unmatched byte escaped.
  function highlightCode(source, language) {
    const aliases = {
      py: "python", python: "python", js: "javascript", jsx: "javascript", javascript: "javascript",
      ts: "javascript", tsx: "javascript", typescript: "javascript", sql: "sql", sh: "bash",
      shell: "bash", zsh: "bash", bash: "bash", json: "json", jsonc: "json",
    };
    const requested = String(language || "").trim().split(/\s+/)[0].toLowerCase();
    const family = aliases[requested];
    if (!family) return escapeHtml(source);
    const comments = family === "python" || family === "bash" ? "#[^\\n]*"
      : family === "sql" ? "--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/"
      : "\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/";
    const strings = "\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*'|`(?:\\\\.|[^`\\\\])*`";
    const pattern = new RegExp(`(${comments})|(${strings})|(\\b(?:0x[\\da-f]+|\\d+(?:\\.\\d+)?)\\b)|(\\b[A-Za-z_$][\\w$]*\\b)`, "gmi");
    let output = "";
    let cursor = 0;
    for (const match of String(source).matchAll(pattern)) {
      output += escapeHtml(String(source).slice(cursor, match.index));
      const token = match[0];
      const tokenClass = match[1] ? "tok-com" : match[2] ? "tok-str" : match[3] ? "tok-num"
        : CODE_KEYWORDS[family].has(token.toLowerCase()) || CODE_KEYWORDS[family].has(token) ? "tok-kw" : "";
      output += tokenClass ? `<span class="${tokenClass}">${escapeHtml(token)}</span>` : escapeHtml(token);
      cursor = match.index + token.length;
    }
    return output + escapeHtml(String(source).slice(cursor));
  }

  const MARKDOWN_TAGS = new Set([
    "P", "H1", "H2", "H3", "H4", "STRONG", "EM", "CODE", "PRE", "UL", "OL", "LI", "A", "IMG",
    "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "BLOCKQUOTE", "HR", "BR", "SPAN", "DIV",
  ]);

  function isSafeLink(href) { return /^(https?:|mailto:)/i.test(String(href || "").trim()); }

  // Where an image may load from (ENG-10): inline data and the extension's own resources always; a
  // remote image only when the learner chose network assets (paneHtml marks the body), so a lesson
  // cannot fetch from, or beacon to, a server by default. Returns "local", "remote" or "unresolved".
  function imageSource(src) {
    const value = String(src || "").trim();
    if (/^data:image\//i.test(value) || /^(vscode-resource|vscode-webview-resource):/i.test(value)
      || /^https:\/\/[^/?#]+\.vscode-cdn\.net\//i.test(value)) return "local";
    if (/^https:\/\//i.test(value)) return document.body.getAttribute("data-remote-images") === "allowed" ? "local" : "remote";
    return "unresolved";
  }
  function imagePlaceholderHtml(src, kind) {
    const key = kind === "remote" ? "pane_image_remote" : "pane_image_unresolved";
    return `<span class="image-unresolved${kind === "remote" ? " image-remote" : ""}">${escapeHtml(t(key, { path: src }))}</span>`;
  }

  function replaceUnresolvedImages(root) {
    root.querySelectorAll("img").forEach((image) => {
      const src = image.getAttribute("src") || "";
      const kind = imageSource(src);
      if (kind === "local") return;
      const holder = document.createElement("span");
      holder.innerHTML = imagePlaceholderHtml(src, kind);
      image.replaceWith(holder.firstChild);
    });
  }

  function sanitizeMarkdown(root) {
    const sanitizeElement = (node) => {
      if (!MARKDOWN_TAGS.has(node.tagName)) {
        node.replaceWith(document.createTextNode(node.textContent || ""));
        return;
      }
      const href = node.tagName === "A" ? node.getAttribute("href") : null;
      const src = node.tagName === "IMG" ? node.getAttribute("src") : null;
      for (const attr of Array.from(node.attributes)) {
        const allowed = attr.name === "class" || attr.name === "title"
          || (node.tagName === "A" && attr.name === "href")
          || (node.tagName === "IMG" && (attr.name === "src" || attr.name === "alt"))
          || (node.tagName === "CODE" && attr.name === "data-lang")
          || (node.tagName === "OL" && attr.name === "start");
        if (!allowed) node.removeAttribute(attr.name);
      }
      if (node.tagName === "A") {
        if (isSafeLink(href)) { node.setAttribute("href", href.trim()); node.setAttribute("target", "_blank"); }
        else { node.removeAttribute("href"); node.removeAttribute("target"); }
      }
      if (node.tagName === "IMG" && imageSource(src) === "local") node.setAttribute("src", src.trim());
      Array.from(node.children).forEach(sanitizeElement);
    };
    Array.from(root.children).forEach(sanitizeElement);
  }

  // Mathematics is tokenized BEFORE marked's inline pass (backslash escapes, emphasis), so `\{`,
  // `\\` (matrix rows), `a*b*c` and the `\[…\]` / `\(…\)` delimiters reach KaTeX untouched — an
  // auto-render pass over the parsed DOM saw them already mangled. Each token becomes a
  // <span class="math-tex"> holding the raw TeX as text (which survives the allowlist pass); KaTeX
  // then renders those spans AFTER sanitizing, because its MathML output is not allowlisted.
  // Inline `$…$` follows pandoc's rule: no space after the opening `$`, none before the closing
  // one, and the closing `$` is not followed by a digit — so "5$ et 10$" and "$5 et $10" stay text.
  const MATH_INLINE = /^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^\s$](?:[^$\n]*?[^\s$])?)\$(?!\d))/;
  const MATH_BLOCK = /^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])[ \t]*(?:\n+|$)/;
  function mathToken(type, match) {
    const tex = match[1] ?? match[2] ?? match[3] ?? match[4] ?? "";
    const display = match[1] !== undefined || match[2] !== undefined;
    return { type, raw: match[0], tex, display };
  }
  function mathSpan(token) {
    return `<span class="math-tex${token.display ? " math-display" : ""}">${escapeHtml(token.tex)}</span>`;
  }
  const MATH_EXTENSIONS = [
    {
      name: "mathBlock", level: "block",
      start(src) { const i = src.search(/^(?:\$\$|\\\[)/m); return i < 0 ? undefined : i; },
      tokenizer(src) { const m = MATH_BLOCK.exec(src); return m ? mathToken("mathBlock", m) : undefined; },
      renderer(token) { return `<div class="math-block">${mathSpan(token)}</div>\n`; },
    },
    {
      name: "mathInline", level: "inline",
      start(src) { const i = src.search(/\$|\\[[(]/); return i < 0 ? undefined : i; },
      tokenizer(src) { const m = MATH_INLINE.exec(src); return m ? mathToken("mathInline", m) : undefined; },
      renderer(token) { return mathSpan(token); },
    },
  ];
  let markedConfigured = false;
  function configureMarked() {
    if (markedConfigured) return;
    window.marked.use({ extensions: MATH_EXTENSIONS });
    markedConfigured = true;
  }

  function renderMathSpans(root) {
    root.querySelectorAll(".math-tex").forEach((span) => {
      const tex = span.textContent || "";
      const display = span.classList.contains("math-display");
      if (window.katex && typeof window.katex.render === "function") {
        try { window.katex.render(tex, span, { displayMode: display, throwOnError: false }); return; }
        catch (error) { /* fall through to the plain-text fallback */ }
      }
      span.className = display ? "imath imath-display" : "imath";
      span.textContent = tex;
    });
  }

  function renderMarkdown(source) {
    if (!window.marked || typeof window.marked.parse !== "function") return mdLiteFallback(source);
    configureMarked();
    const renderer = new window.marked.Renderer();
    renderer.html = (token) => escapeHtml(token.text || "");
    // An image that may not load never becomes an <img>: assigning innerHTML on a detached node
    // already fires the fetch, so the placeholder is decided at render time, not after.
    renderer.image = (token) => {
      const src = String(token.href || "");
      const kind = imageSource(src);
      if (kind !== "local") return imagePlaceholderHtml(src, kind);
      return `<img src="${escapeHtml(src.trim())}" alt="${escapeHtml(token.text || "")}"${token.title ? ` title="${escapeHtml(token.title)}"` : ""}>`;
    };
    renderer.code = (token) => {
      const info = String(token.lang || "").trim();
      return `<pre class="code"><code data-lang="${escapeHtml(info)}">${highlightCode(token.text || "", info)}</code></pre>`;
    };
    let parsed;
    try { parsed = window.marked.parse(String(source || ""), { renderer, gfm: true, breaks: true, async: false }); }
    catch (error) { return mdLiteFallback(source); }
    if (typeof parsed !== "string") return mdLiteFallback(source);
    const host = document.createElement("div");
    host.innerHTML = parsed;
    replaceUnresolvedImages(host);
    sanitizeMarkdown(host);
    renderMathSpans(host);
    return host.innerHTML;
  }

  // Standalone previews stay readable when the vendored parser is unavailable.
  function mdLiteFallback(s) {
    return String(s).split(/\n{2,}/).map((p) => {
      let h = p.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      h = h.replace(/`([^`]+)`/g, "<code>$1</code>")
           .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
           .replace(/\$([^$]+)\$/g, '<span class="imath">$1</span>');
      if (/^#{1,3}\s/.test(p)) { const lvl = p.match(/^#+/)[0].length; return `<h${lvl}>${h.replace(/^#+\s/, "")}</h${lvl}>`; }
      return `<p>${h}</p>`;
    }).join("");
  }

  // wiring: receive renders from the extension host; (the preview build calls window.__render directly)
  function handleMessage(d) {
    if (d.type === "render") renderPane(d);
    else if (d.type === "hint") {
      setActionPending(false);
      if (!ui.hint) return;
      ui.hint.innerHTML = "";
      if (d.hint) {
        ui.hint.append(el("strong", { class: "hint-heading" }, t("pane_hint_heading")),
          el("div", { class: "hint-body", html: renderMarkdown(String(d.hint)) }),
          d.remaining != null ? el("span", { class: "hint-remaining" }, t("pane_hint_remaining", { count: d.remaining })) : null);
      } else ui.hint.append(t("pane_no_more_hints"));
    }
    else if (d.type === "turn_result") {
      setActionPending(false);
      if (ui.pendingTurn) {
        const turn = ui.pendingTurn;
        ui.pendingTurn = null;
        turn.line.classList.remove("turn-pending");
        turn.sync();
      }
      // the Socratic tutor's reply to the last discussion turn, with the kind of reasoning noticed
      // in words (an unknown signal is not shown: it would print a raw code).
      const signal = d.reasoning && REASONING_SIGNALS.has(d.reasoning.signal)
        ? t("pane_signal_line", { signal: t("pane_signal_" + d.reasoning.signal) }) : "";
      if (d.tutor && d.tutor.text) {
        appendTurn("tutor", d.tutor.text, signal);
        announce(`${t("pane_live_tutor")} ${d.tutor.text}`);
      } else if (signal && ui.turns) ui.turns.append(el("div", { class: "turn-meta" }, signal));
    }
    else if (d.type === "recall_rated") {
      if (ui.rating && ui.rating.sceneId === d.sceneId && RECALL_GRADES.includes(d.grade)) ui.rating.confirmed(d.grade);
      // UX-11: the rating moved the next review; the end screen behind this feedback shows the new date.
      if (pendingDone && isObject(d.completion)) pendingDone.completion = { ...(isObject(pendingDone.completion) ? pendingDone.completion : {}), ...d.completion };
    }
    else if (d.type === "action_pending") setActionPending(true, d.message);
    else if (d.type === "action_settled") setActionPending(false);
    else if (d.type === "action_notice") showActionNotice(d.message);
    else if (d.type === "action_error") {
      // UX-09: a rating's error belongs to the feedback step that asked for it; once that screen is gone it is
      // dropped instead of being shown on an unrelated scene.
      if (d.action === "rateRecall" && !(ui.rating && (!d.sceneId || ui.rating.sceneId === d.sceneId))) return;
      showActionError(d.message);
    }
    else if (d.type === "loading") {
      const r = resetPane();
      memory = freshMemory();
      r.setAttribute("aria-busy", "true");
      r.append(el("div", { class: "loading", role: "status" }, el("span", { class: "loading-mark", "aria-hidden": "true" }),
        el("div", {}, el("strong", {}, t("pane_opening")), el("span", {}, d.message || t("pane_loading")))));
    }
    else if (d.type === "error") {
      const r = resetPane();
      memory = freshMemory();
      r.append(el("section", { class: "error-pane", role: "alert" }, el("div", { class: "error-kicker" }, t("pane_local_service")),
        el("h2", {}, t("pane_connection_interrupted")), el("p", {}, d.message || t("pane_error")),
        el("p", { class: "error-recovery" }, t("pane_error_recovery"))));
    }
    else if (d.type === "done") showDone(d);
  }
  let previousView = null;
  let previousBase = "";
  /** Paint a complete public PanelView, replaying effects once per changed payload. */
  renderView = function (view) {
    // Both versions of the view are painted: version 2 adds fields, it retypes none.
    if (view.schema !== "studium/panel-view/1" && view.schema !== "studium/panel-view/2") { handleMessage(view); return; }
    if (previousView && previousView.session_id !== view.session_id) {
      memory = freshMemory(); previousBase = ""; lastAuthoring = null;
    }
    const { hint, turn_result, recall_rated, pending, ...base } = view;
    const signature = JSON.stringify(base);
    const hasNewBase = signature !== previousBase;
    if (hasNewBase) {
      const type = { scene: "render", done: "done", notice: "action_notice", error: "action_error" }[view.kind];
      handleMessage({ ...base, type });
      previousBase = signature;
    }
    for (const [type, effect] of Object.entries({ hint, turn_result, recall_rated })) {
      if (effect && (hasNewBase || (type === "turn_result" && ui.pendingTurn) || JSON.stringify(effect) !== JSON.stringify(previousView?.[type]))) {
        handleMessage({ type, ...effect, ...(view.completion ? { completion: view.completion } : {}) });
      }
    }
    // Nothing pending and nothing to release: the status line keeps what this paint wrote in it.
    if (pending || actionPending) setActionPending(Boolean(pending), pending);
    previousView = view;
    if (!pending) noteDisplayed();
  };
  window.addEventListener("message", (ev) => {
    if (ev.data?.type !== "view") renderView(ev.data?.view ?? ev.data ?? {});
  });
  window.__render = renderPane;
  window.renderView = renderView;
})();
export { renderView };
