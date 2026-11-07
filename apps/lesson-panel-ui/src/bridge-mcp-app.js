// The host transports actions; the server owns all grading and learner state.
import { browserPhrases, localeFromLanguage } from "../../../packages/lesson-panel/src/phrases.ts";
import { toCytoscape, buildStylesheet, egoFilter } from "@studium/typed-graph-lens";
const ACTIONS = new Set(["respond", "turn", "hint", "rateRecall", "reviewNow", "restartLesson", "end", "pickCourse", "ask", "openMap", "closeMap", "contest", "prompt"]);
/** A display delay the renderer measured (client_ms), when it is one: a whole number of milliseconds, not negative. */
const delayOf = meta => (Number.isInteger(meta?.client_ms) && meta.client_ms >= 0 ? { client_ms: meta.client_ms } : {});

/** What the model reads above a brief (one line: the brief is the last line, as JSON). */
const MODEL_NOTE = "Studium: the learner is following a lesson on a panel, where the server answers them. This is where they are and what they did there since you last looked. Do not show these scenes again, and follow the rules of the brief.";

/** Connect an MCP App to the public renderer, with injected DOM/renderers for tests. */
export async function connectMcpApp(app, env = { window, document, renderView: window.renderView, renderGraph: window.renderGraph }) {
  const { window: win, document: doc } = env;
  let current = null, busy = false, hostContext = {}, graph = null;
  const locale = () => hostContext.locale ? localeFromLanguage(hostContext.locale) : current?.locale ?? "en";
  const words = () => browserPhrases(locale());
  const resize = () => { void app.sendSizeChanged({ width: doc.documentElement.scrollWidth, height: doc.documentElement.scrollHeight }); };
  function paint() {
    if (current) env.renderView({ ...current, locale: locale(), strings: words(), ...(busy ? { pending: words().pane_updating } : {}) });
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
  function confirmErase() {
    status("action_settled");
    const section = doc.createElement("section");
    section.setAttribute("role", "alertdialog"); section.setAttribute("aria-modal", "true");
    const warning = doc.createElement("p"); warning.textContent = words().extension_forget_prompt;
    const erase = doc.createElement("button"); erase.textContent = words().extension_forget_action;
    const cancel = doc.createElement("button"); cancel.textContent = words().pane_cancel;
    section.append(warning, erase, cancel); doc.body.append(section); cancel.focus(); resize();
    return new Promise(resolve => {
      erase.onclick = () => { section.remove(); resolve(true); };
      cancel.onclick = () => { section.remove(); resolve(false); };
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
  /** A small form for the learner's question; resolves to their words, or null when they give up. */
  function askQuestion() {
    status("action_settled");
    const form = doc.createElement("form"); form.className = "st-field ask-question";
    const label = doc.createElement("label"); label.className = "st-field__label"; label.htmlFor = "ask-question-text"; label.textContent = words().pane_ask_prompt;
    const field = doc.createElement("textarea"); field.id = "ask-question-text"; field.className = "st-input"; field.rows = 3;
    const send = doc.createElement("button"); send.type = "submit"; send.className = "st-button st-button--primary"; send.textContent = words().pane_send;
    const cancel = doc.createElement("button"); cancel.type = "button"; cancel.className = "st-button"; cancel.textContent = words().pane_cancel;
    const buttons = doc.createElement("div"); buttons.className = "ask-question-buttons"; buttons.append(send, cancel);
    form.append(label, field, buttons);
    doc.querySelector("form.ask-question")?.remove(); doc.body.append(form); field.focus(); resize();
    return new Promise(resolve => {
      form.addEventListener("submit", event => {
        event.preventDefault();
        const text = field.value.trim();
        if (!text) { field.focus(); return; }
        form.remove(); resize(); resolve(text);
      });
      cancel.onclick = () => { form.remove(); resize(); resolve(null); };
    });
  }
  async function pickCourse() {
    const result = await app.callServerTool({ name: "list_lessons", arguments: {} });
    if (result.isError) throw new Error(result.content?.[0]?.text ?? words().pane_retry);
    const catalog = result.structuredContent ?? JSON.parse(result.content?.find(c => c.type === "text")?.text ?? "{}");
    const section = doc.createElement("section"); section.className = "course-picker";
    const heading = doc.createElement("h2"); heading.textContent = words().picker_choose; section.append(heading);
    for (const lesson of catalog.lessons ?? []) {
      const button = doc.createElement("button"); button.textContent = lesson.title;
      button.onclick = async () => {
        if (busy) return;
        busy = true; section.querySelectorAll("button").forEach(control => { control.disabled = true; });
        try {
          const opened = await app.callServerTool({ name: "open_lesson_panel", arguments: { bundle_ref: lesson.bundle_ref, learner_id: current.learner_id, locale: locale() } });
          if (opened.isError) throw new Error(opened.content?.[0]?.text ?? words().pane_retry);
          busy = false; section.remove(); receive(opened);
        } catch (error) { busy = false; section.querySelectorAll("button").forEach(control => { control.disabled = false; }); status("action_error", error.message); }
      };
      section.append(button);
    }
    if (!catalog.lessons?.length) { const empty = doc.createElement("p"); empty.textContent = words().picker_empty; section.append(empty); }
    const cancel = doc.createElement("button"); cancel.textContent = words().pane_cancel; cancel.onclick = () => section.remove(); section.append(cancel);
    doc.querySelector(".course-picker")?.remove(); doc.body.append(section); status("action_settled"); resize();
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
    if (!ACTIONS.has(action.type) || !current.actions.includes(action.type)) { status("action_error", words().pane_retry); return; }
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
