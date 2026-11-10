// The host transports actions; the server owns all grading and learner state.
import { browserPhrases, localeFromLanguage } from "../../../packages/lesson-panel/src/phrases.ts";
import { PANEL_ACTION_TYPES } from "../../../packages/lesson-panel/src/transport.ts";
import { toCytoscape, buildStylesheet, egoFilter } from "@studium/typed-graph-lens";
/** Panel audit 2026-11-10 (A1, C3): the bridge carries every action type the shared list names, no other. */
const ACTIONS = new Set(PANEL_ACTION_TYPES);
/** Language names are written in their own language, as the panel's settings write them. */
const LANGUAGE_NAMES = { fr: "Français", en: "English" };
/** A display delay the renderer measured (client_ms), when it is one: a whole number of milliseconds, not negative. */
const delayOf = meta => (Number.isInteger(meta?.client_ms) && meta.client_ms >= 0 ? { client_ms: meta.client_ms } : {});

/** What the model reads above a brief (one line: the brief is the last line, as JSON). */
const MODEL_NOTE = "Studium: the learner is following a lesson on a panel, where the server answers them. This is where they are and what they did there since you last looked. Do not show these scenes again, and follow the rules of the brief.";

/** Connect an MCP App to the public renderer, with injected DOM/renderers for tests. */
export async function connectMcpApp(app, env = { window, document, renderView: window.renderView, renderGraph: window.renderGraph }) {
  const { window: win, document: doc } = env;
  let current = null, busy = false, hostContext = {}, graph = null;
  // While the learner answers a question of the bridge (erase, which course, their question), nothing is
  // pending on the server: a repaint must not lock the panel under the question.
  let prompting = false;
  const locale = () => hostContext.locale ? localeFromLanguage(hostContext.locale) : current?.locale ?? "en";
  const words = () => browserPhrases(locale());
  const resize = () => { void app.sendSizeChanged({ width: doc.documentElement.scrollWidth, height: doc.documentElement.scrollHeight }); };
  function paint() {
    if (current) env.renderView({ ...current, locale: locale(), strings: words(), ...(busy && !prompting ? { pending: words().pane_updating } : {}) });
    if (graph) env.renderGraph({ elements: toCytoscape(egoFilter(graph)), style: buildStylesheet(), title: graph.title, legend: graph.legend, focus: graph.focus, mode: "student", locale: locale(), strings: words() });
    resize();
  }
  function contextChanged(context) {
    hostContext = { ...hostContext, ...context };
    const theme = hostContext.theme === "dark" ? "dark" : "light";
    doc.documentElement.dataset.theme = theme;
    doc.documentElement.classList.toggle("dark", theme === "dark");
    doc.documentElement.classList.toggle("light", theme === "light");
    doc.documentElement.lang = locale();
    const width = hostContext.containerDimensions?.width ?? hostContext.containerDimensions?.maxWidth;
    if (typeof width === "number") doc.body.style.maxWidth = `${Math.max(0, width)}px`;
    paint();
  }
  function receive(result) {
    if (result.isError) throw new Error(result.content?.find(c => c.type === "text")?.text ?? "Tool failed");
    const payload = result.structuredContent ?? JSON.parse(result.content?.find(c => c.type === "text")?.text ?? "{}");
    // Both versions of the view are read: version 2 adds fields, it retypes none.
    if (["studium/panel-view/1", "studium/panel-view/2"].includes(payload.panel?.schema)) current = payload.panel;
    if (Object.prototype.hasOwnProperty.call(payload, "graph")) {
      graph = payload.graph;
      if (!graph && doc.getElementById("graph")) doc.getElementById("graph").textContent = words().graph_unavailable;
    }
    paint();
  }
  function status(type, message) { env.renderView?.({ type, message }); resize(); }
  /** Where a question of the bridge is drawn: inside the panel, under the scene's header when there is one. */
  function placeInPane(node) {
    const pane = doc.getElementById("pane");
    if (!pane) { doc.body.append(node); return; }
    const head = pane.querySelector(".scene-head");
    if (head) head.after(node); else pane.prepend(node);
  }
  const element = (tag, attrs = {}, ...kids) => {
    const node = doc.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) if (value !== undefined && value !== null) node.setAttribute(name, value);
    node.append(...kids.filter(kid => kid !== null && kid !== undefined));
    return node;
  };
  const menuSummary = () => doc.querySelector("#pane .pane-menu summary");
  /** Panel audit 2026-11-10, A7: the erase confirmation, in the panel, named by its title, « Cancel » first and
   * focused, the destructive button marked; Escape cancels; the « ⋯ » menu takes the focus back. */
  function confirmErase() {
    status("action_settled");
    prompting = true;
    const title = element("h2", { id: "erase-title", class: "confirm-title" }, words().pane_erase_title);
    const warning = element("p", { id: "erase-warning" }, words().extension_forget_prompt);
    const cancel = element("button", { type: "button", class: "st-button confirm-cancel" }, words().pane_cancel);
    const erase = element("button", { type: "button", class: "st-button confirm-erase", "data-destructive": "true" }, words().extension_forget_action);
    const section = element("section", { role: "alertdialog", class: "confirm-dialog", "aria-labelledby": title.id, "aria-describedby": warning.id },
      title, warning, element("div", { class: "st-actions" }, cancel, erase));
    doc.querySelector("#pane .confirm-dialog")?.remove();
    placeInPane(section); cancel.focus(); section.scrollIntoView?.({ block: "nearest" }); resize();
    return new Promise(resolve => {
      // Escape cancels wherever the focus is while the question is open; nothing else is caught.
      const onKey = event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(false); } };
      const close = (confirmed) => {
        doc.removeEventListener("keydown", onKey, true);
        prompting = false; section.remove(); resize();
        if (!confirmed) menuSummary()?.focus();
        resolve(confirmed);
      };
      erase.onclick = () => close(true);
      cancel.onclick = () => close(false);
      doc.addEventListener("keydown", onKey, true);
    });
  }
  /** What the host said it supports (`updateModelContext`, `message`); nothing for a host that says nothing. */
  const hostCan = capability => Boolean(app.getHostCapabilities?.()?.[capability]);
  /** INT-STUDIUM-058 § 2.5: put the companion brief in the model's context, so that an assistant the
   * learner turns to knows what they did on the panel. `peek` reads it without moving its cursor (after
   * an act); a question moves it, since the assistant is told now. Never fails the panel. */
  async function inform(peek) {
    if (!current || !hostCan("updateModelContext")) return;
    try {
      const result = await app.callServerTool({ name: "get_companion_brief", arguments: { session_id: current.session_id, ...(peek ? { peek: true } : {}) } });
      if (result.isError) return;
      const payload = result.structuredContent ?? JSON.parse(result.content?.find(c => c.type === "text")?.text ?? "{}");
      if (payload.brief) await app.updateModelContext({ content: [{ type: "text", text: `${MODEL_NOTE}\n${JSON.stringify({ brief: payload.brief })}` }] });
    } catch { /* the lesson goes on without the assistant's context */ }
  }
  /** A small form for the learner's question, in place in the help ladder (panel audit A9, C4); resolves to
   * their words, or null when they give up. */
  function askQuestion() {
    status("action_settled");
    prompting = true;
    const form = doc.createElement("form"); form.className = "st-field ask-question";
    const label = doc.createElement("label"); label.className = "st-field__label"; label.htmlFor = "ask-question-text"; label.textContent = words().pane_ask_prompt;
    const field = doc.createElement("textarea"); field.id = "ask-question-text"; field.className = "st-input"; field.rows = 3;
    const send = doc.createElement("button"); send.type = "submit"; send.className = "st-button st-button--primary"; send.textContent = words().pane_send;
    const cancel = doc.createElement("button"); cancel.type = "button"; cancel.className = "st-button"; cancel.textContent = words().pane_cancel;
    const buttons = doc.createElement("div"); buttons.className = "st-actions ask-question-buttons"; buttons.append(send, cancel);
    form.append(label, field, buttons);
    doc.querySelector("form.ask-question")?.remove();
    const slot = doc.querySelector("#pane .ask-slot");
    if (slot) slot.append(form); else placeInPane(form);
    field.focus(); resize();
    return new Promise(resolve => {
      const done = (text) => { prompting = false; form.remove(); resize(); resolve(text); };
      form.addEventListener("submit", event => {
        event.preventDefault();
        const text = field.value.trim();
        if (!text) { field.focus(); return; }
        done(text);
      });
      cancel.onclick = () => { done(null); doc.querySelector("#pane .ask-button")?.focus(); };
      form.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel.onclick(); } });
    });
  }
  /** Panel audit 2026-11-10, A8: the course picker, a list in the panel; each course says what the catalogue
   * gives of it: its title, its language, its number of steps, and whether a teacher approved it. */
  async function pickCourse() {
    const result = await app.callServerTool({ name: "list_lessons", arguments: {} });
    if (result.isError) throw new Error(result.content?.[0]?.text ?? words().pane_retry);
    const catalog = result.structuredContent ?? JSON.parse(result.content?.find(c => c.type === "text")?.text ?? "{}");
    const heading = element("h2", { id: "course-picker-title", class: "course-picker-title", tabindex: "-1" }, words().picker_choose);
    const section = element("section", { class: "course-picker", "aria-labelledby": heading.id }, heading);
    const list = element("ul", { class: "course-list" });
    const lock = (on) => section.querySelectorAll("button").forEach(control => { control.disabled = on; });
    for (const lesson of catalog.lessons ?? []) {
      const facts = [
        typeof lesson.language === "string" && lesson.language ? LANGUAGE_NAMES[lesson.language.slice(0, 2).toLowerCase()] ?? lesson.language : null,
        Number.isInteger(lesson.scene_count) && lesson.scene_count > 0 ? words().pane_course_steps.replace("{count}", String(lesson.scene_count)) : null,
        lesson.validated === true ? words().pane_course_validated : null,
      ].filter(Boolean);
      const button = element("button", { type: "button", class: "st-button course-choice", lang: lesson.language || null },
        element("span", { class: "course-choice-title" }, String(lesson.title ?? lesson.bundle_ref ?? "")),
        facts.length ? element("span", { class: "course-choice-facts", lang: locale() }, facts.join(" · ")) : null);
      button.onclick = async () => {
        if (busy) return;
        busy = true; lock(true);
        try {
          const opened = await app.callServerTool({ name: "open_lesson_panel", arguments: { bundle_ref: lesson.bundle_ref, learner_id: current.learner_id, locale: locale() } });
          if (opened.isError) throw new Error(opened.content?.[0]?.text ?? words().pane_retry);
          busy = false; prompting = false; section.remove(); receive(opened);
        } catch (error) { busy = false; lock(false); status("action_error", error.message); }
      };
      list.append(element("li", {}, button));
    }
    section.append(list);
    if (!catalog.lessons?.length) section.append(element("p", { class: "course-picker-empty" }, words().picker_empty));
    const cancel = element("button", { type: "button", class: "st-button course-picker-cancel" }, words().pane_cancel);
    cancel.onclick = () => { prompting = false; section.remove(); resize(); menuSummary()?.focus(); };
    section.append(element("div", { class: "st-actions" }, cancel));
    doc.querySelector(".course-picker")?.remove();
    status("action_settled");
    prompting = true;
    placeInPane(section); heading.focus(); section.scrollIntoView?.({ block: "nearest" }); resize();
  }
  /** Walkthrough 2026-11-07: the server lost the session (it restarted, or the session was closed). The renderer's
   * notice offers to reopen: the same lesson for the same learner, from the view the panel last had, on the learner's
   * click only. The server resumes the learner's progress.
   * INT-STUDIUM-058 § 2.1: `surface` (« Play here » on the notice of a conversation or forms surface) asks for
   * that surface on the session the view names: open_lesson_panel renegotiates a live session's surface when a
   * call gives one, and the interaction log records the change of rank. */
  async function reopen(surface) {
    busy = true;
    try {
      const asked = surface ? { surface } : typeof current.surface?.kind === "string" ? { surface: current.surface.kind } : {};
      const session = surface ? { session_id: current.session_id } : {};
      const opened = await app.callServerTool({ name: "open_lesson_panel", arguments: { ...session, bundle_ref: current.bundle_ref, learner_id: current.learner_id, locale: locale(), ...asked } });
      busy = false;
      receive(opened);
    } catch (error) { busy = false; status("action_error", error.message); }
    finally { busy = false; }
  }
  async function act(action, meta) {
    if (action.type === "nodeClick") {
      const details = doc.getElementById("graph-node-details") ?? doc.createElement("p");
      details.id = "graph-node-details"; details.textContent = action.label ?? action.id; doc.body.append(details); resize(); return;
    }
    if (busy || !current) return;
    if (action.type === "run") { status("action_notice", words().pane_native_run_required); return; }
    if (action.type === "reopen") { await reopen(); return; }
    if (action.type === "playHere") { await reopen("panel"); return; }
    // An action this view does not offer cannot succeed on a second try: the line says so, without « try again ».
    if (!ACTIONS.has(action.type) || !current.actions.includes(action.type)) { status("action_error", words().pane_action_unavailable); return; }
    busy = true;
    try {
      if (action.type === "pickCourse") { await pickCourse(); return; }
      if (action.type === "end") {
        if (!(await confirmErase())) return;
        action = { type: "end", confirmed: true };
      }
      // A host that takes messages: the question goes to its conversation, in the learner's words,
      // after the brief; the ask action then marks the hand-over on the server. A host that refuses the
      // message changes nothing here: the action's notice sends the learner to the conversation.
      const asks = action.type === "ask" && hostCan("message");
      // Without a conversation to put them in, the learner's words were never sent: the hand-over goes without
      // them, so the server's notice sends the learner to the conversation instead of saying they went there.
      if (action.type === "ask" && !asks && action.text !== undefined) action = { type: "ask" };
      if (asks) {
        const text = action.text ?? await askQuestion();
        if (!text) return;
        action = { type: "ask", text };
        await inform(false);
        try { await app.sendMessage({ role: "user", content: [{ type: "text", text }] }); } catch { /* see above */ }
      }
      paint();
      const result = await app.callServerTool({ name: "panel_action", arguments: { session_id: current.session_id, action, ...delayOf(meta) } });
      busy = false;
      receive(result);
      if (!asks) await inform(true);
    } catch (error) { busy = false; status("action_error", error.message); }
    finally { busy = false; }
  }
  app.ontoolresult = result => { try { receive(result); } catch (error) { status("action_error", error.message); } };
  app.onhostcontextchanged = contextChanged;
  win.__send = act;
  doc.addEventListener("click", event => {
    const anchor = event.target.closest?.("a[href]");
    if (!anchor) return;
    event.preventDefault();
    const url = anchor.getAttribute("href");
    if (/^(https?:|mailto:)/i.test(url)) void app.openLink({ url });
  });
  const refreshGraph = () => { if (graph) paint(); };
  win.addEventListener("load", refreshGraph);
  for (const script of doc.querySelectorAll("script[src]")) script.addEventListener("load", refreshGraph);
  await app.connect();
  contextChanged(app.getHostContext?.() ?? {});
  if (win.ResizeObserver) new win.ResizeObserver(resize).observe(doc.body);
  return { receive, act, contextChanged };
}
