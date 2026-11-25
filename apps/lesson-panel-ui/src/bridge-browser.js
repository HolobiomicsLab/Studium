// The browser player's side of the transport (docs/design-records/specs/2026-11-25-browser-player.md).
// The page has no MCP host: `fetchApp` has the shape of an MCP App and carries each tool call to the
// player routes of the local server, so the MCP Apps bridge (bridge-mcp-app.js) and the shared renderer
// run unchanged. The server owns grading and learner state; the page holds only its token and the id of
// the session on screen, both in sessionStorage (this tab, until it closes).
import { browserPhrases, localeFromLanguage } from "../../../packages/lesson-panel/src/phrases.ts";

export const TOKEN_KEY = "studium-player-token";
export const SESSION_KEY = "studium-player-session";
/** D4 (owner decision 4): "assistant" when the address came from the server an assistant runs, not from
 * `studium-mcp play`: the page then says, once that server is gone, to ask the assistant for a new address. */
export const FROM_KEY = "studium-player-from";

/** The address the server gave, taken out of the address bar at once: its token (`#token=…`), the lesson it opens
 * (`&lesson=…`, a bundle_ref) and who gave it (`&from=assistant`). The token and who gave it stay in this tab's
 * storage; the lesson is opened once. */
export function takeAddress(win) {
  const fragment = new URLSearchParams(win.location.hash.slice(1));
  const token = fragment.get("token");
  let lesson = null;
  if (token) {
    win.sessionStorage.setItem(TOKEN_KEY, token);
    if (fragment.get("from") === "assistant") win.sessionStorage.setItem(FROM_KEY, "assistant");
    else win.sessionStorage.removeItem(FROM_KEY);
    lesson = fragment.get("lesson") || null;
    win.history.replaceState(null, "", win.location.pathname + win.location.search);
  }
  return { token: win.sessionStorage.getItem(TOKEN_KEY), lesson, fromAssistant: win.sessionStorage.getItem(FROM_KEY) === "assistant" };
}

/** The token of the address the server printed (`#token=…`), taken out of the address bar at once. */
export function takeToken(win) {
  return takeAddress(win).token;
}

/** An error the page explains in its own words, not in the server's. */
class PlayerUnavailable extends Error {}

/** An MCP App over fetch: same-origin calls, the token as a header, no cookie, nothing the host does not do. */
export function fetchApp(win, token, words) {
  const dark = win.matchMedia?.("(prefers-color-scheme: dark)");
  const app = {
    connect: async () => {},
    getHostContext: () => ({ theme: dark?.matches ? "dark" : "light" }),
    // No assistant: no model context to update, no conversation to send a message to.
    getHostCapabilities: () => ({}),
    sendSizeChanged: () => {},
    openLink: ({ url }) => { win.open(url, "_blank", "noopener,noreferrer"); },
    async callServerTool({ name, arguments: args = {} }) {
      let response;
      try {
        response = await win.fetch(`/play/api/tools/${encodeURIComponent(name)}`, {
          method: "POST", credentials: "omit", cache: "no-store",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ arguments: args }),
        });
      } catch { throw new PlayerUnavailable(words.player_unreachable); }
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) throw new PlayerUnavailable(words.player_token_rejected);
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      const session = body.structuredContent?.panel?.session_id;
      if (typeof session === "string") win.sessionStorage.setItem(SESSION_KEY, session);
      return body;
    },
  };
  dark?.addEventListener?.("change", () => app.onhostcontextchanged?.({ theme: dark.matches ? "dark" : "light" }));
  return app;
}

/** Start the player: open the lesson of the address, else resume the session of this tab, else list the lessons. */
export async function startBrowserPlayer({ window: win, document: doc, connectMcpApp, renderView }) {
  const locale = localeFromLanguage(win.navigator?.language);
  const words = browserPhrases(locale);
  const { token, lesson, fromAssistant } = takeAddress(win);
  if (fromAssistant) {
    // The server an assistant runs ends with the assistant's session: a new address comes from asking it again.
    words.player_unreachable = words.player_assistant_unreachable;
    words.player_token_rejected = words.player_assistant_token_rejected;
  }
  doc.documentElement.lang = locale;
  const pane = doc.getElementById("pane");
  const say = (text) => {
    const notice = doc.createElement("p");
    notice.className = "player-notice";
    notice.setAttribute("role", "alert");
    notice.textContent = text;
    pane.replaceChildren(notice);
  };
  if (!token) { say(words.player_no_token); return null; }
  const app = fetchApp(win, token, words);
  const bridge = await connectMcpApp(app, { window: win, document: doc, renderView });
  const failed = (error) => { if (error instanceof PlayerUnavailable) say(error.message); else renderView({ type: "action_error", message: error.message }); };
  const open = async (args) => {
    try { bridge.receive(await app.callServerTool({ name: "open_lesson_panel", arguments: { ...args, locale } })); }
    catch (error) { failed(error); }
  };
  // The address names a lesson: open it, where this learner is (the server resumes it); one it does not open, the list.
  if (lesson) {
    try { bridge.receive(await app.callServerTool({ name: "open_lesson_panel", arguments: { bundle_ref: lesson, locale } })); return bridge; }
    catch (error) { if (error instanceof PlayerUnavailable) { say(error.message); return bridge; } }
  }
  const resumed = lesson ? null : win.sessionStorage.getItem(SESSION_KEY);
  if (resumed) {
    try { bridge.receive(await app.callServerTool({ name: "get_panel_view", arguments: { session_id: resumed } })); return bridge; }
    catch (error) {
      win.sessionStorage.removeItem(SESSION_KEY);
      if (error instanceof PlayerUnavailable) { say(error.message); return bridge; }
    }
  }
  const listLessons = async () => {
    const listed = await app.callServerTool({ name: "list_lessons", arguments: { language: locale } });
    return JSON.parse(listed.content?.find(part => part.type === "text")?.text ?? "{}");
  };
  let catalog;
  try { catalog = await listLessons(); } catch (error) { failed(error); return bridge; }
  const heading = doc.createElement("h1");
  heading.className = "course-picker-title player-title"; heading.textContent = words.player_title; heading.tabIndex = -1;
  const intro = doc.createElement("p");
  intro.textContent = words.player_intro;
  const section = doc.createElement("section");
  section.className = "course-picker player-lessons";
  section.setAttribute("aria-labelledby", "player-title");
  heading.id = "player-title";
  const list = doc.createElement("ul");
  list.className = "course-list";
  section.append(heading, intro, list);
  let opening = false;
  let drawn = null;
  /** Draw the lessons of a catalog, unless the same ones are on screen; the lesson in focus keeps it. */
  const draw = (catalog) => {
    // The learner's own lessons first; those shipped with Studium (the demo) after them, labelled as such.
    const shipped = Array.isArray(catalog.shipped_lessons) ? catalog.shipped_lessons.map(lesson => ({ ...lesson, shipped: true })) : [];
    const lessons = [...(Array.isArray(catalog.lessons) ? catalog.lessons : []), ...shipped];
    const shown = JSON.stringify(lessons.map(lesson => [lesson.bundle_ref, lesson.title, lesson.scene_count, lesson.validated, lesson.shipped, lesson.status]));
    if (shown === drawn) return;
    drawn = shown;
    const focused = list.contains(doc.activeElement) ? doc.activeElement.dataset.bundleRef : undefined;
    section.querySelector(".course-picker-empty")?.remove();
    if (!lessons.length) {
      const empty = doc.createElement("p");
      empty.className = "course-picker-empty"; empty.textContent = words.player_empty;
      list.before(empty);
    }
    list.replaceChildren(...lessons.map(lesson => {
      const facts = [
        Number.isInteger(lesson.scene_count) && lesson.scene_count > 0 ? words.pane_course_steps.replace("{count}", String(lesson.scene_count)) : null,
        lesson.validated === true ? words.pane_course_validated : null,
        lesson.shipped === true ? words.player_shipped : null,
        lesson.status?.state === "in_progress"
          ? words.player_status_in_progress.replace("{done}", String(lesson.status.scenes_completed)).replace("{total}", String(lesson.status.total_scenes)) : null,
        lesson.status?.state === "completed" ? words.player_status_completed : null,
      ].filter(Boolean);
      const button = doc.createElement("button");
      button.type = "button"; button.className = "st-button course-choice";
      button.dataset.bundleRef = String(lesson.bundle_ref ?? "");
      const title = doc.createElement("span");
      title.className = "course-choice-title"; title.textContent = String(lesson.title ?? lesson.bundle_ref ?? "");
      button.append(title);
      if (facts.length) {
        const detail = doc.createElement("span");
        detail.className = "course-choice-facts"; detail.textContent = facts.join(" · ");
        button.append(detail);
      }
      button.addEventListener("click", () => {
        opening = true; stopListening();
        for (const choice of list.querySelectorAll("button")) choice.disabled = true;
        void open({ bundle_ref: lesson.bundle_ref });
      });
      const item = doc.createElement("li");
      item.append(button);
      return item;
    }));
    if (focused !== undefined) ([...list.querySelectorAll("button")].find(button => button.dataset.bundleRef === focused) ?? heading).focus();
  };
  // A lesson the assistant saves while this list is open appears when the learner comes back to it: the tab
  // shown again (visibilitychange) or the window focused again (from VS Code beside it). No polling; events
  // that come together share one call; nothing is listed once a lesson is chosen or the list is gone.
  let listing = false;
  const listAgain = async () => {
    if (listing || opening || !section.isConnected || doc.visibilityState === "hidden") return;
    listing = true;
    try {
      const again = await listLessons();
      if (!opening && section.isConnected) draw(again);
    } catch (error) {
      // A server that stopped is worth saying; any other failure leaves the list as it is.
      if (error instanceof PlayerUnavailable && !opening && section.isConnected) { stopListening(); say(error.message); }
    } finally { listing = false; }
  };
  const stopListening = () => {
    doc.removeEventListener("visibilitychange", listAgain);
    win.removeEventListener("focus", listAgain);
  };
  draw(catalog);
  pane.replaceChildren(section);
  heading.focus();
  doc.addEventListener("visibilitychange", listAgain);
  win.addEventListener("focus", listAgain);
  return bridge;
}
