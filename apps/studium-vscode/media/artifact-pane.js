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
    replay:        { icon: "↻", title: "On refait cette étape ensemble" },
    remediate_alt: { icon: "↻", title: "On reprend cette notion autrement" },
  };
  function renderAdapt(ex) {
    const g = GATE_COPY[ex && ex.rule_id];
    if (g) {
      const card = el("div", { class: "gate gate-" + ex.rule_id });
      card.append(el("div", { class: "gate-title" }, g.icon + " " + g.title));
      card.append(el("div", { class: "gate-why" },
        ex.explanation_short || "Ta lecture de ce résultat mérite un second regard — pas une sanction, une invitation à réexaminer."));
      return card;
    }
    return el("div", { class: "adapt" }, "⟳ " + ((ex && ex.rule_id) || "") + " — " + ((ex && ex.explanation_short) || ""));
  }

  // --- whole pane ----------------------------------------------------------
  function renderPane(state) {
    const root = $("#pane"); root.innerHTML = "";
    const sc = state.scene || {};
    const head = el("div", { class: "scene-head" });
    const help = document.getElementById("studium-help-" + sc.type);
    if (help instanceof HTMLTemplateElement) head.append(help.content.cloneNode(true));
    const crumbs = el("div", { class: "crumbs" },
      el("span", { class: "stype" }, sc.type || ""),
      state.progress ? el("span", { class: "prog" }, `${state.progress.index}/${state.progress.total}`) : "");
    // Right to be forgotten: a subtle, always-available control that asks the host to end_session
    // (purges the durable per-learner state). The host confirms before erasing.
    const forget = el("button", { class: "ghost forget", title: "Effacer mes données de session (droit à l'oubli)" }, "🗑 M'oublier");
    forget.addEventListener("click", () => window.__send && window.__send({ type: "end" }));
    crumbs.append(forget);
    head.append(crumbs);
    head.append(el("h2", { class: "scene-title" }, sc.title || ""));
    if (state.explanation) head.append(renderAdapt(state.explanation));
    // Calibration mirror (B1): the metacognitive "am I as sure as I should be?" verdict per concept,
    // computed host-side (calibration[]). Show only the ACTIONABLE bands (sur/sous) to avoid noise —
    // number-free, never a mastery score, so safe to show. Capped to keep the header compact.
    const calib = (Array.isArray(state.calibration) ? state.calibration : []).filter((c) => c && c.band !== "bien");
    if (calib.length) {
      const box = el("div", { class: "calibration" });
      calib.slice(0, 3).forEach((c) => box.append(el("div", { class: "calib calib-" + c.band },
        el("span", { class: "calib-chip" }, c.band === "sur" ? "Surconfiance" : "Sous-confiance"),
        el("span", { class: "calib-msg" }, c.message))));
      head.append(el("div", { class: "pane-label" }, "🎯 Calibration"));
      head.append(box);
    }
    // "À réviser / Due for review": concepts whose retrievability has decayed past threshold per the
    // FSRS scheduler (computed host-side, posted as reviewDue[]). A recall-timing cue, not a score.
    const due = Array.isArray(state.reviewDue) ? state.reviewDue : [];
    if (due.length) {
      const n = due.length;
      head.append(el("div", { class: "review-due", title: due.join(", ") },
        "🔁 À réviser / Due for review : " + n + " concept" + (n > 1 ? "s" : "")));
    }
    root.append(head);

    if (sc.markdown) root.append(el("div", { class: "prose", html: mdLite(sc.markdown) }));
    // quiz / meta_checkpoint carry their prompt in `question` / `pre_question` (NOT markdown) — draw
    // it so the learner sees what they're answering (the choice buttons live in renderControls).
    if (sc.type === "quiz" && sc.question) root.append(el("div", { class: "prose question", html: mdLite(sc.question) }));
    if (sc.type === "meta_checkpoint" && sc.pre_question) root.append(el("div", { class: "prose question", html: mdLite(sc.pre_question) }));
    // spot_the_flaw shows the deliberately-flawed lesson (find the errors); explain_back shows the
    // prompt. The answer keys (claims / sound_claims / key_points + the model_* reveals) are stripped
    // SERVER-SIDE by publicScene (lesson-session-host) before the scene reaches the webview — including
    // the verdict deck, which arrives as {token,text} only — so there is nothing to leak here.
    if (sc.type === "spot_the_flaw" && sc.flawed_content) {
      // verdict-deck mode reframes the task: audit an AI READING of your own result, then judge each
      // claim below (flag/sound). Free-text mode is the older "find the errors in this passage".
      const hasDeck = Array.isArray(sc.deck) && sc.deck.length;
      root.append(el("div", { class: "pane-label" }, hasDeck
        ? "⚠️ Audite cette lecture IA de ton résultat — puis juge chaque affirmation ci-dessous"
        : "⚠️ Ce passage contient des erreurs — repère-les"));
      root.append(el("div", { class: "prose flawed", html: mdLite(sc.flawed_content) }));
    }
    if (sc.type === "explain_back" && sc.prompt) {
      root.append(el("div", { class: "prose", html: mdLite(sc.prompt) }));
    }
    // Wave-1 active-learning scenes — render only the learner-facing fields (key_points/claims/model_*
    // answer keys are stripped server-side by publicScene, so there is nothing to leak here).
    if (sc.type === "comparison") {
      if (sc.prompt) root.append(el("div", { class: "prose", html: mdLite(sc.prompt) }));
      if (sc.artifact_a) { root.append(el("div", { class: "pane-label" }, "A")); root.append(el("div", { class: "prose", html: mdLite(sc.artifact_a) })); }
      if (sc.artifact_b) { root.append(el("div", { class: "pane-label" }, "B")); root.append(el("div", { class: "prose", html: mdLite(sc.artifact_b) })); }
    }
    if (sc.type === "summary_audit") {
      if (sc.source_content) { root.append(el("div", { class: "pane-label" }, "Source")); root.append(el("div", { class: "prose", html: mdLite(sc.source_content) })); }
      if (sc.ai_summary) { root.append(el("div", { class: "pane-label" }, "Résumé IA à auditer")); root.append(el("div", { class: "prose ai-summary", html: mdLite(sc.ai_summary) })); }
    }
    if (sc.type === "prompt_practice" && sc.task) {
      root.append(el("div", { class: "pane-label" }, "Tâche"));
      root.append(el("div", { class: "prose", html: mdLite(sc.task) }));
    }
    if (sc.type === "communication_sim") {
      if (sc.scenario) { root.append(el("div", { class: "pane-label" }, "Situation")); root.append(el("div", { class: "prose", html: mdLite(sc.scenario) })); }
      if (sc.prompt) root.append(el("div", { class: "prose", html: mdLite(sc.prompt) }));
    }
    // reproduction — the protocol the learner reproduces. Show the ordered step instructions (the
    // executed reference run, when present, arrives as a separate executed_result render asset).
    // expected_output is NOT drawn (it is the per-step answer).
    if (sc.type === "reproduction" && Array.isArray(sc.steps)) {
      root.append(el("div", { class: "pane-label" }, "Protocole" + (sc.task_card_id ? " — " + sc.task_card_id : "")));
      const ol = el("ol", { class: "steps" });
      sc.steps.forEach((s) => ol.append(el("li", {}, (s && s.instruction) || "")));
      root.append(ol);
    }
    // discussion — a multi-turn Socratic dialogue. Render the topic + seed_claim and an (initially
    // empty) transcript the turn loop appends to (learner turn on send, tutor reply on turn_result).
    if (sc.type === "discussion") {
      if (sc.topic) root.append(el("div", { class: "pane-label" }, "Discussion : " + sc.topic));
      if (sc.seed_claim) root.append(el("div", { class: "prose", html: mdLite(sc.seed_claim) }));
      root.append(el("div", { id: "turns", class: "turns" }));
    }

    const assets = state.scene_assets || [];
    if (assets.length) {
      // Modality-adaptive cue: when a non-'balanced' preference is active, tell the learner the
      // pane is leading with their preferred modality (and that nothing is hidden — the other
      // modality is collapsed below, openable).
      const pref = state.modalityPreference;
      const prefLabel = pref === "visual" ? "🎨 Vue visuelle — figures & 3D en premier"
        : pref === "textual" ? "📝 Vue textuelle — équations & texte en premier" : null;
      root.append(el("div", { class: "pane-label" },
        prefLabel ? "Artifacts paired with this scene · " + prefLabel : "Artifacts paired with this scene"));
      assets.forEach((a) => root.append(renderAsset(a)));
    } else {
      root.append(el("div", { class: "empty" }, "— no artifact for this scene —"));
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
      root.append(el("div", { class: "pane-label" }, "Mastery"));
      root.append(bar);
    }
  }

  // free-text active-learning scenes → { kind submitted, button label, placeholder, optional scene
  // field to prefill the textarea }. The kinds MUST match src/scene-io.ts FREE_TEXT_KIND (and the
  // server-side graders, which reject a mismatched kind); scene-io.driver.ts asserts the parity.
  const FREE_TEXT = {
    ai_critique:       { kind: "critique",         label: "Submit critique",          placeholder: "Write your critique…" },
    spot_the_flaw:     { kind: "flaw_report",      label: "Soumettre les erreurs",    placeholder: "Quelles sont les erreurs ? Justifie…" },
    explain_back:      { kind: "explanation",      label: "Soumettre l'explication",  placeholder: "Explique avec tes propres mots…" },
    comparison:        { kind: "comparison",       label: "Soumettre la comparaison", placeholder: "Quelles différences / quelle valeur ajoutée entre A et B ?…" },
    summary_audit:     { kind: "summary_audit",    label: "Soumettre l'audit",        placeholder: "Quelles omissions / distorsions dans le résumé ? Justifie…" },
    prompt_practice:   { kind: "prompt_submission", label: "Soumettre le prompt",     placeholder: "Écris (ou affine) ton prompt…", prefill: "starter_prompt" },
    communication_sim: { kind: "communication",    label: "Soumettre",                placeholder: "Rédige ta communication professionnelle…" },
  };

  // optional per-answer confidence tap (0..4) — the CONTINUOUS calibration capture: the learner may
  // rate how sure they are, and it rides on the submitted input as `confidence`. Returns { node, get }.
  function confidenceRow() {
    let value;
    const row = el("div", { class: "confrow" });
    row.append(el("span", { class: "conf-label" }, "Ta confiance :"));
    const btns = [];
    const titles = ["Pas sûr·e", "Peu sûr·e", "Moyen", "Plutôt sûr·e", "Très sûr·e"];
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
      const hb = el("button", { class: "ghost" }, "💡 Hint"); hb.addEventListener("click", send({ type: "hint" })); wrap.append(hb);
    } else if (sc.type === "meta_checkpoint") {
      const labels = Array.isArray(sc.scale_labels) ? sc.scale_labels : [];
      [0, 1, 2, 3, 4].forEach((v) => { const b = el("button", { class: "choice" }, labels[v] != null ? `${v} · ${labels[v]}` : "conf " + v); b.addEventListener("click", send({ type: "respond", input: { kind: "confidence", value: v } })); wrap.append(b); });
    } else if (sc.type === "discussion") {
      // multi-turn: each "Envoyer" posts a {type:"turn"} (scored reasoning + Socratic reply, appended
      // to the transcript) WITHOUT advancing; "Terminer" advances the scene with an ack.
      const ta = el("textarea", { class: "critique", placeholder: "Ta réponse à l'affirmation…" });
      const sendBtn = el("button", { class: "primary" }, "Envoyer");
      sendBtn.addEventListener("click", () => {
        const t = ta.value.trim(); if (!t || !window.__send) return;
        appendTurn("learner", t); ta.value = "";
        window.__send({ type: "turn", text: t });
      });
      const fin = el("button", { class: "ghost" }, "Terminer la discussion ▸");
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
      const ta = el("textarea", { class: "critique", placeholder: f.placeholder });
      if (f.prefill && sc[f.prefill]) ta.value = sc[f.prefill];
      const cr = confidenceRow();
      const b = el("button", { class: "primary" }, f.label);
      b.addEventListener("click", () => window.__send && window.__send({ type: "respond", input: withConf({ kind: f.kind, text: ta.value }, cr) }));
      wrap.append(ta, cr.node, b);
    } else {
      const b = el("button", { class: "primary" }, "Continue ▸"); b.addEventListener("click", send({ type: "respond", input: { kind: "ack" } })); wrap.append(b);
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
    box.append(el("div", { class: "deck-instr" },
      "Juge chaque affirmation : signale celles que tu estimes erronées, laisse les autres. " +
      "Signaler une affirmation correcte compte comme une méfiance excessive."));
    const deck = Array.isArray(sc.deck) ? sc.deck : [];
    const verdicts = deck.map((d) => ({ token: d.token, flagged: false }));
    deck.forEach((d, i) => {
      const row = el("div", { class: "deck-row", "data-token": d.token });
      const claim = el("div", { class: "deck-claim", html: mdLite(d.text || "") });
      const toggle = el("button", { class: "deck-flag", type: "button", "aria-pressed": "false" }, "⚑ Signaler comme erronée");
      toggle.addEventListener("click", () => {
        const on = !verdicts[i].flagged;
        verdicts[i].flagged = on;
        toggle.classList.toggle("on", on);
        toggle.setAttribute("aria-pressed", on ? "true" : "false");
        toggle.textContent = on ? "⚑ Erronée — annuler" : "⚑ Signaler comme erronée";
        row.classList.toggle("flagged", on);
      });
      row.append(claim, toggle);
      box.append(row);
    });
    const cr = confidenceRow();
    const submit = el("button", { class: "primary deck-submit" }, "Soumettre mon jugement");
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
    line.append(el("span", { class: "turn-who" }, (role === "learner" ? "Toi" : "Tuteur") + " : "));
    line.append(el("span", { class: "turn-text", html: mdLite(text) }));
    if (meta) line.append(el("div", { class: "turn-meta" }, meta));
    box.append(line);
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
    else if (d.type === "turn_result") {
      // the Socratic tutor's reply to the last discussion turn (+ the scored reasoning signal).
      const meta = d.reasoning ? ("signal : " + d.reasoning.signal + (d.reasoning.confidence != null ? " (" + d.reasoning.confidence.toFixed(2) + ")" : "")) : "";
      if (d.tutor && d.tutor.text) appendTurn("tutor", d.tutor.text, meta);
      else if (meta) { const box = document.getElementById("turns"); if (box) box.append(el("div", { class: "turn-meta" }, meta)); }
    }
    else if (d.type === "loading") { const r = $("#pane"); r.innerHTML = ""; r.append(el("div", { class: "loading" }, "⏳ " + (d.message || "Chargement…"))); }
    else if (d.type === "error") { const r = $("#pane"); r.innerHTML = ""; r.append(el("div", { class: "error-pane" }, "⚠ " + (d.message || "Une erreur est survenue."))); }
    else if (d.type === "done") { const r = $("#pane"); r.innerHTML = ""; r.append(el("div", { class: "done" }, "✔ " + (d.message || "Lesson complete"))); }
  });
  window.__render = renderPane;
  const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;
  window.__send = (msg) => { if (vscode) vscode.postMessage(msg); };
})();
