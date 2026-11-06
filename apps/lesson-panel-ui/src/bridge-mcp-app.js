// The host transports actions; the server owns all grading and learner state.
import { browserPhrases, localeFromLanguage } from "../../../packages/lesson-panel/src/phrases.ts";
import { toCytoscape, buildStylesheet, egoFilter } from "@studium/typed-graph-lens";
const ACTIONS = new Set(["respond", "turn", "hint", "rateRecall", "reviewNow", "restartLesson", "end", "pickCourse"]);

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
    if (payload.panel?.schema === "studium/panel-view/1") current = payload.panel;
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
  async function act(action) {
    if (action.type === "nodeClick") {
      const details = doc.getElementById("graph-node-details") ?? doc.createElement("p");
      details.id = "graph-node-details"; details.textContent = action.label ?? action.id; doc.body.append(details); resize(); return;
    }
    if (busy || !current) return;
    if (action.type === "run") { status("action_notice", words().pane_native_run_required); return; }
    if (!ACTIONS.has(action.type) || !current.actions.includes(action.type)) { status("action_error", words().pane_retry); return; }
    busy = true;
    try {
      if (action.type === "pickCourse") { await pickCourse(); return; }
      if (action.type === "end") {
        if (!(await confirmErase())) return;
        action = { type: "end", confirmed: true };
      }
      paint();
      const result = await app.callServerTool({ name: "panel_action", arguments: { session_id: current.session_id, action } });
      busy = false;
      receive(result);
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
