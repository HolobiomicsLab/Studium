/* artifact-pane.js — renders a scene's normalized render-manifest (scene_assets[]) "pair by pair".
 *
 * One renderer, two homes:
 *   - inside the VS Code webview, marked + KaTeX + Vega-Lite are loaded → prose, equations and plots are rich;
 *   - anywhere they are absent (e.g. a quick preview), every renderer DEGRADES GRACEFULLY
 *     (equation → styled code, plot_spec → a minimal inline-SVG bar chart from the spec's data).
 * The render path is identical; only fidelity changes. Drives off window.postMessage from the
 * extension host: { type: 'render', scene, scene_assets, progress, mastery, explanation, verdict }.
 */
(function () {
  "use strict";
  const DEFAULT_STRINGS = {
    pane_image_unresolved: "image : {path} (non résolue)",
  };
  let strings = { ...DEFAULT_STRINGS };
  function t(key, params) {
    const template = strings[key] || key;
    return template.replace(/\{([a-z_]+)\}/gi, (token, name) =>
      params && params[name] !== undefined ? String(params[name]) : token);
  }
  const $ = (sel, root) => (root || document).querySelector(sel);
  const escapeHtml = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
      image: "figure", svg: "diagram", equation_latex: "equation", plot_spec: "interactive plot",
      code: "code", data_csv: "table", protocol_md: "protocol", executed_result: "executed ✓",
      orbital: "orbital (3D)", mol_3d: "molecule (3D)", spectrum: "spectrum",
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
  function renderCode(a) {
    const code = el("code", { "data-lang": a.language || "", html: highlightCode(a.payload || "", a.language || "") });
    return el("pre", { class: "code" }, code);
  }
  function renderProtocol(a) { return el("div", { class: "protocol", html: renderMarkdown(a.payload || "") }); }

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

  // --- interactive scientific renderers (3Dmol for orbital/molecule; Vega for spectrum) --------
  // 3Dmol needs the container attached + sized before createViewer, so defer to a microtask and
  // give the host an explicit height. Degrades to the raw payload when $3Dmol is absent.
  function render3D(a, kind) {
    const host = el("div", { class: "mol3d" });
    const lib = window.$3Dmol;
    if (!lib || !a.payload) {
      host.append(el("pre", { class: "code" }, a.payload ? "(3Dmol not loaded — set studium.assets)" : "(no data)"));
      return host;
    }
    setTimeout(() => {
      try {
        const viewer = lib.createViewer(host, { backgroundColor: "white" });
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
      } catch (e) { host.append(el("pre", { class: "code" }, "3Dmol error: " + (e && e.message))); }
    }, 0);
    return host;
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
    const head = el("header", { class: "asset-head" }, badge(a.kind), el("span", { class: "asset-title" }, a.title || a.kind));
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

  // Render the adaptation line. A WITHHOLD (the gate held the learner on a step: replay / remediate_alt)
  // becomes a calm, NON-PUNITIVE gate card framed at the dimension level — being held back is an
  // invitation to re-examine one's judgment, not a sanction (this is how calibrated skepticism is
  // cultivated rather than discouraged). A normal advance keeps the terse adaptation-rationale banner.
  // BOUNDARY: names only the action + the engine's short reason; never a number, a threshold, or which
  // specific claim/choice was wrong. Copy is safe to ship; a pedagogy pass can refine the wording.
  const GATE_COPY = {
    replay:        { icon: "↻", title: "pane_gate_replay" },
    remediate_alt: { icon: "↻", title: "pane_gate_remediate" },
  };
  function renderAdapt(ex) {
    const g = GATE_COPY[ex && ex.rule_id];
    if (g) {
      const card = el("div", { class: "gate gate-" + ex.rule_id });
      card.append(el("div", { class: "gate-title" }, g.icon + " " + t(g.title)));
      card.append(el("div", { class: "gate-why" },
        ex.explanation_short || t("pane_gate_reason")));
      return card;
    }
    return el("div", { class: "adapt" }, "⟳ " + ((ex && ex.rule_id) || "") + " — " + ((ex && ex.explanation_short) || ""));
  }

  // The verdict of the answer that brought the learner here: for a graded scene, right or wrong
  // plus the ONE feedback branch the engine released; for an ungraded scene, a plain
  // acknowledgement. The other branch and the key never reach this pane (audit 2026-10-29, P1/P2).
  function renderVerdict(v) {
    if (!v || typeof v !== "object") return document.createDocumentFragment();
    if (!v.graded) return el("div", { class: "verdict verdict-ack" }, t("pane_answer_recorded"));
    const ok = v.correct === true;
    const line = el("div", { class: "verdict " + (ok ? "verdict-ok" : "verdict-ko") });
    line.append(el("span", { class: "verdict-mark" }, t(ok ? "pane_correct" : "pane_incorrect")));
    if (v.feedback) line.append(el("span", { class: "verdict-feedback" }, " — " + v.feedback));
    return line;
  }

  // --- whole pane ----------------------------------------------------------
  function renderPane(state) {
    if (state.strings && typeof state.strings === "object") strings = { ...DEFAULT_STRINGS, ...state.strings };
    const root = $("#pane"); root.innerHTML = "";
    const sc = state.scene || {};
    const head = el("div", { class: "scene-head" });
    const crumbs = el("div", { class: "crumbs" },
      el("span", { class: "stype" }, sc.type || ""),
      state.progress ? el("span", { class: "prog" }, `${state.progress.index}/${state.progress.total}`) : "");
    // Right to be forgotten: a subtle, always-available control that asks the host to end_session
    // (purges the durable per-learner state). The host confirms before erasing.
    const forget = el("button", { class: "ghost forget", title: t("pane_forget_title") }, t("pane_forget"));
    forget.addEventListener("click", () => window.__send && window.__send({ type: "end" }));
    crumbs.append(forget);
    head.append(crumbs);
    head.append(el("h2", { class: "scene-title" }, sc.title || ""));
    if (state.verdict) head.append(renderVerdict(state.verdict));
    if (state.explanation) head.append(renderAdapt(state.explanation));
    // Calibration mirror (B1): the metacognitive "am I as sure as I should be?" verdict per concept,
    // computed host-side (calibration[]). Show only the ACTIONABLE bands (sur/sous) to avoid noise —
    // number-free, never a mastery score, so safe to show. Capped to keep the header compact.
    const calib = (Array.isArray(state.calibration) ? state.calibration : []).filter((c) => c && c.band !== "bien");
    if (calib.length) {
      const box = el("div", { class: "calibration" });
      calib.slice(0, 3).forEach((c) => box.append(el("div", { class: "calib calib-" + c.band },
        el("span", { class: "calib-chip" }, t(c.band === "sur" ? "pane_overconfidence" : "pane_underconfidence")),
        el("span", { class: "calib-msg" }, c.message))));
      head.append(el("div", { class: "pane-label" }, t("pane_calibration")));
      head.append(box);
    }
    // "À réviser / Due for review": concepts whose retrievability has decayed past threshold per the
    // FSRS scheduler (computed host-side, posted as reviewDue[]). A recall-timing cue, not a score.
    const due = Array.isArray(state.reviewDue) ? state.reviewDue : [];
    if (due.length) {
      const n = due.length;
      head.append(el("div", { class: "review-due", title: due.join(", ") },
        t("pane_due_review", { count: n, suffix: n > 1 ? "s" : "" })));
    }
    root.append(head);

    if (sc.markdown) root.append(el("div", { class: "prose", html: renderMarkdown(sc.markdown) }));
    // quiz / meta_checkpoint carry their prompt in `question` / `pre_question` (NOT markdown) — draw
    // it so the learner sees what they're answering (the choice buttons live in renderControls).
    if (sc.type === "quiz" && sc.question) root.append(el("div", { class: "prose question", html: renderMarkdown(sc.question) }));
    if (sc.type === "meta_checkpoint" && sc.pre_question) root.append(el("div", { class: "prose question", html: renderMarkdown(sc.pre_question) }));
    // spot_the_flaw shows the deliberately-flawed lesson (find the errors); explain_back shows the
    // prompt. The answer keys (claims / sound_claims / key_points + the model_* reveals) are stripped
    // SERVER-SIDE by publicScene (lesson-session-host) before the scene reaches the webview — including
    // the verdict deck, which arrives as {token,text} only — so there is nothing to leak here.
    if (sc.type === "spot_the_flaw" && sc.flawed_content) {
      // verdict-deck mode reframes the task: audit an AI READING of your own result, then judge each
      // claim below (flag/sound). Free-text mode is the older "find the errors in this passage".
      const hasDeck = Array.isArray(sc.deck) && sc.deck.length;
      root.append(el("div", { class: "pane-label" }, hasDeck
        ? t("pane_audit_deck")
        : t("pane_find_errors")));
      root.append(el("div", { class: "prose flawed", html: renderMarkdown(sc.flawed_content) }));
    }
    if (sc.type === "explain_back" && sc.prompt) {
      root.append(el("div", { class: "prose", html: renderMarkdown(sc.prompt) }));
    }
    // Wave-1 active-learning scenes — render only the learner-facing fields (key_points/claims/model_*
    // answer keys are stripped server-side by publicScene, so there is nothing to leak here).
    if (sc.type === "comparison") {
      if (sc.prompt) root.append(el("div", { class: "prose", html: renderMarkdown(sc.prompt) }));
      if (sc.artifact_a) { root.append(el("div", { class: "pane-label" }, "A")); root.append(el("div", { class: "prose", html: renderMarkdown(sc.artifact_a) })); }
      if (sc.artifact_b) { root.append(el("div", { class: "pane-label" }, "B")); root.append(el("div", { class: "prose", html: renderMarkdown(sc.artifact_b) })); }
    }
    if (sc.type === "summary_audit") {
      if (sc.source_content) { root.append(el("div", { class: "pane-label" }, "Source")); root.append(el("div", { class: "prose", html: renderMarkdown(sc.source_content) })); }
      if (sc.ai_summary) { root.append(el("div", { class: "pane-label" }, t("pane_ai_summary"))); root.append(el("div", { class: "prose ai-summary", html: renderMarkdown(sc.ai_summary) })); }
    }
    if (sc.type === "prompt_practice" && sc.task) {
      root.append(el("div", { class: "pane-label" }, t("pane_task")));
      root.append(el("div", { class: "prose", html: renderMarkdown(sc.task) }));
    }
    if (sc.type === "communication_sim") {
      if (sc.scenario) { root.append(el("div", { class: "pane-label" }, t("pane_situation"))); root.append(el("div", { class: "prose", html: renderMarkdown(sc.scenario) })); }
      if (sc.prompt) root.append(el("div", { class: "prose", html: renderMarkdown(sc.prompt) }));
    }
    // reproduction — the protocol the learner reproduces. Show the ordered step instructions (the
    // executed reference run, when present, arrives as a separate executed_result render asset).
    // expected_output is NOT drawn (it is the per-step answer).
    if (sc.type === "reproduction" && Array.isArray(sc.steps)) {
      root.append(el("div", { class: "pane-label" }, t("pane_protocol") + (sc.task_card_id ? " — " + sc.task_card_id : "")));
      const ol = el("ol", { class: "steps" });
      sc.steps.forEach((s) => ol.append(el("li", {}, (s && s.instruction) || "")));
      root.append(ol);
    }
    // discussion — a multi-turn Socratic dialogue. Render the topic + seed_claim and an (initially
    // empty) transcript the turn loop appends to (learner turn on send, tutor reply on turn_result).
    if (sc.type === "discussion") {
      if (sc.topic) root.append(el("div", { class: "pane-label" }, t("pane_discussion", { topic: sc.topic })));
      if (sc.seed_claim) root.append(el("div", { class: "prose", html: renderMarkdown(sc.seed_claim) }));
      root.append(el("div", { id: "turns", class: "turns" }));
    }

    const assets = state.scene_assets || [];
    if (assets.length) {
      // Modality-adaptive cue: when a non-'balanced' preference is active, tell the learner the
      // pane is leading with their preferred modality (and that nothing is hidden — the other
      // modality is collapsed below, openable).
      const pref = state.modalityPreference;
      const prefLabel = pref === "visual" ? t("pane_visual_view")
        : pref === "textual" ? t("pane_textual_view") : null;
      root.append(el("div", { class: "pane-label" },
        prefLabel ? t("pane_artifacts_with_view", { view: prefLabel }) : t("pane_artifacts")));
      assets.forEach((a) => root.append(renderAsset(a)));
    } else {
      root.append(el("div", { class: "empty" }, t("pane_no_artifact")));
    }

    root.append(renderControls(sc));
    const hint = el("div", { id: "hint", class: "hint" }); root.append(hint);

    if (state.mastery && Object.keys(state.mastery).length) {
      const bar = el("div", { class: "mastery" });
      Object.entries(state.mastery).forEach(([k, v]) => {
        bar.append(el("div", { class: "mrow" },
          el("span", { class: "mk" }, k.replace(/^concept:/, "").slice(0, 26)),
          el("span", { class: "mbar" }, el("span", { class: "mfill", style: `width:${Math.round(v * 100)}%` })),
          el("span", { class: "mv" }, v.toFixed(2))));
      });
      root.append(el("div", { class: "pane-label" }, t("pane_mastery")));
      root.append(bar);
    }
  }

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
  // rate how sure they are, and it rides on the submitted input as `confidence`. Returns { node, get }.
  function confidenceRow() {
    let value;
    const row = el("div", { class: "confrow" });
    row.append(el("span", { class: "conf-label" }, t("pane_confidence")));
    const btns = [];
    const titles = [0, 1, 2, 3, 4].map((v) => t("pane_confidence_" + v));
    [0, 1, 2, 3, 4].forEach((v) => {
      const b = el("button", { class: "conf", type: "button", title: titles[v] }, String(v));
      b.addEventListener("click", () => {
        value = value === v ? undefined : v;                 // re-click toggles off (optional)
        btns.forEach((x, i) => x.classList.toggle("sel", value === i));
      });
      btns.push(b); row.append(b);
    });
    return { node: row, get: () => value };
  }
  // attach the tapped confidence to a submitted input (omitted when the learner didn't rate).
  function withConf(input, cr) { const v = cr && cr.get(); return v == null ? input : Object.assign({}, input, { confidence: v }); }

  // interactive controls the learner uses to advance — posts back to the extension host.
  function renderControls(sc) {
    const wrap = el("div", { class: "controls" });
    const send = (msg) => () => (window.__send ? window.__send(msg) : null);
    if (sc.type === "quiz") {
      const cr = confidenceRow(); wrap.append(cr.node);
      (sc.choices || []).forEach((c) => {
        const b = el("button", { class: "choice" }, c.id + ") " + c.text);
        b.addEventListener("click", () => window.__send && window.__send({ type: "respond", input: withConf({ kind: "quiz_choice", choiceId: c.id }, cr) }));
        wrap.append(b);
      });
      const hb = el("button", { class: "ghost" }, t("pane_hint")); hb.addEventListener("click", send({ type: "hint" })); wrap.append(hb);
    } else if (sc.type === "meta_checkpoint") {
      const labels = Array.isArray(sc.scale_labels) ? sc.scale_labels : [];
      [0, 1, 2, 3, 4].forEach((v) => { const b = el("button", { class: "choice" }, labels[v] != null ? `${v} · ${labels[v]}` : t("pane_confidence_fallback", { value: v })); b.addEventListener("click", send({ type: "respond", input: { kind: "confidence", value: v } })); wrap.append(b); });
    } else if (sc.type === "discussion") {
      // multi-turn: each "Envoyer" posts a {type:"turn"} (scored reasoning + Socratic reply, appended
      // to the transcript) WITHOUT advancing; "Terminer" advances the scene with an ack.
      const ta = el("textarea", { class: "critique", placeholder: t("pane_discussion_placeholder") });
      const sendBtn = el("button", { class: "primary" }, t("pane_send"));
      sendBtn.addEventListener("click", () => {
        const t = ta.value.trim(); if (!t || !window.__send) return;
        appendTurn("learner", t); ta.value = "";
        window.__send({ type: "turn", text: t });
      });
      const fin = el("button", { class: "ghost" }, t("pane_finish_discussion"));
      fin.addEventListener("click", send({ type: "respond", input: { kind: "ack" } }));
      wrap.append(ta, sendBtn, fin);
    } else if (sc.type === "spot_the_flaw" && Array.isArray(sc.deck) && sc.deck.length) {
      // VERDICT DECK (D1): the DESTINATION made interactive. The host ships a shuffled, label-stripped
      // deck of opaque-token claims (publicDeck: {token,text} only — the flawed/sound truth stays
      // server-side). The learner makes a forced flag/sound decision PER claim; flagging a sound claim is
      // a false alarm (over-distrust), missing a flawed one is over-trust — the bidirectional signal,
      // captured offline with zero LLM. Replaces the free-text flaw_report so the graded path is
      // unambiguous. LEAK BOUNDARY: render ONLY {token,text}; never echo any ground-truth flag.
      wrap.append(deckControls(sc));
    } else if (FREE_TEXT[sc.type]) {
      // every single-submit free-text active-learning scene → a textarea posting the kind its grader
      // requires (kinds mirror src/scene-io.ts FREE_TEXT_KIND; scene-io.driver.ts guards the parity).
      const f = FREE_TEXT[sc.type];
      const ta = el("textarea", { class: "critique", placeholder: t(f.placeholder) });
      if (f.prefill && sc[f.prefill]) ta.value = sc[f.prefill];
      const cr = confidenceRow();
      const b = el("button", { class: "primary" }, t(f.label));
      b.addEventListener("click", () => window.__send && window.__send({ type: "respond", input: withConf({ kind: f.kind, text: ta.value }, cr) }));
      wrap.append(ta, cr.node, b);
    } else {
      const b = el("button", { class: "primary" }, t("pane_continue")); b.addEventListener("click", send({ type: "respond", input: { kind: "ack" } })); wrap.append(b);
    }
    return wrap;
  }

  // The verdict-deck control: one flag/sound toggle per opaque-token claim + an optional confidence tap
  // + a single submit. Posts { kind:'flaw_verdicts', verdicts:[{token,flagged}] } — one entry per deck
  // token (unflagged = judged sound). Mirrors ResponseInputSchema.flaw_verdicts; the host re-derives the
  // deck permutation from the scene id (+ server secret) to score hits vs false alarms. Renders ONLY the
  // {token,text} the host shipped — the ground-truth flawed/sound flags never reach the client.
  function deckControls(sc) {
    const box = el("div", { class: "deck" });
    box.append(el("div", { class: "deck-instr" }, t("pane_deck_instruction")));
    const deck = Array.isArray(sc.deck) ? sc.deck : [];
    const verdicts = deck.map((d) => ({ token: d.token, flagged: false }));
    deck.forEach((d, i) => {
      const row = el("div", { class: "deck-row", "data-token": d.token });
      const claim = el("div", { class: "deck-claim", html: renderMarkdown(d.text || "") });
      const toggle = el("button", { class: "deck-flag", type: "button", "aria-pressed": "false" }, t("pane_flag"));
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
    const submit = el("button", { class: "primary deck-submit" }, t("pane_submit_judgment"));
    submit.addEventListener("click", () => window.__send && window.__send({
      type: "respond",
      input: withConf({ kind: "flaw_verdicts", verdicts: verdicts.map((v) => ({ token: v.token, flagged: v.flagged })) }, cr),
    }));
    box.append(cr.node, submit);
    return box;
  }

  // append one dialogue turn to the discussion transcript (#turns). `meta` is an optional
  // reasoning-signal note shown under a tutor reply. No-op if the transcript box is absent.
  function appendTurn(role, text, meta) {
    const box = document.getElementById("turns");
    if (!box) return;
    const line = el("div", { class: "turn turn-" + role });
    line.append(el("span", { class: "turn-who" }, t(role === "learner" ? "pane_you" : "pane_tutor") + " : "));
    line.append(el("span", { class: "turn-text", html: renderMarkdown(text) }));
    if (meta) line.append(el("div", { class: "turn-meta" }, meta));
    box.append(line);
  }

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
  function isSafeImage(src) {
    return /^(data:|https:|vscode-resource:|vscode-webview-resource:)/i.test(String(src || "").trim());
  }

  function replaceUnresolvedImages(root) {
    root.querySelectorAll("img").forEach((image) => {
      const src = image.getAttribute("src") || "";
      if (isSafeImage(src)) return;
      image.replaceWith(el("span", { class: "image-unresolved" }, t("pane_image_unresolved", { path: src })));
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
      if (node.tagName === "IMG" && isSafeImage(src)) node.setAttribute("src", src.trim());
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
    // An unresolvable image never becomes an <img>: assigning innerHTML on a detached node already
    // fires the fetch, so the placeholder is decided at render time, not after.
    renderer.image = (token) => {
      const src = String(token.href || "");
      if (!isSafeImage(src)) return `<span class="image-unresolved">${escapeHtml(t("pane_image_unresolved", { path: src }))}</span>`;
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
    else if (d.type === "hint") { const h = document.getElementById("hint"); if (h) h.textContent = d.hint ? ("💡 " + d.hint + (d.remaining != null ? t("pane_hint_remaining", { count: d.remaining }) : "")) : t("pane_no_more_hints"); }
    else if (d.type === "turn_result") {
      // the Socratic tutor's reply to the last discussion turn (+ the scored reasoning signal).
      const meta = d.reasoning ? t("pane_signal", { signal: d.reasoning.signal, confidence: d.reasoning.confidence != null ? " (" + d.reasoning.confidence.toFixed(2) + ")" : "" }) : "";
      if (d.tutor && d.tutor.text) appendTurn("tutor", d.tutor.text, meta);
      else if (meta) { const box = document.getElementById("turns"); if (box) box.append(el("div", { class: "turn-meta" }, meta)); }
    }
    else if (d.type === "loading") { const r = $("#pane"); r.innerHTML = ""; r.append(el("div", { class: "loading" }, "⏳ " + (d.message || t("pane_loading")))); }
    else if (d.type === "error") { const r = $("#pane"); r.innerHTML = ""; r.append(el("div", { class: "error-pane" }, "⚠ " + (d.message || t("pane_error")))); }
    else if (d.type === "done") { const r = $("#pane"); r.innerHTML = ""; r.append(el("div", { class: "done" }, "✔ " + (d.message || t("pane_complete")))); }
  });
  window.__render = renderPane;
  const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;
  window.__send = (msg) => { if (vscode) vscode.postMessage(msg); };
})();
