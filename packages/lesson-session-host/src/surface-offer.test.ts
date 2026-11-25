// Owner follow-up to decision 4 (2026-11-25, 20:45): « laisser les panneaux natifs de Claude Code, Codex et OpenCode
// GUI quand c'est utilisé, ou modifier le comportement selon décisions de l'utilisateur ». A lesson ready to play is
// offered on the surface this host draws natively first (A), unless the learner last answered a step on another surface
// this host can give, which then comes first (B). The chat is always one word away, and first when the learner last
// answered in the chat: the offer then says the lesson plays here and gives one link. A lesson started in the chat
// gets one short line at the end of its first step naming the better surface, never when the chat was the choice.
import { describe, expect, it } from "vitest";
import { chatStartLine, offerSentences, surfaceOrder, type OfferedSurface, type SurfaceOffer } from "./surface-offer.js";
import { browserOffer, paneOffer } from "./open-link.js";

const can = (...surfaces: OfferedSurface[]) => (surface: OfferedSurface) => surfaces.includes(surface);
const BROWSER = "http://127.0.0.1:5555/play#token=k&from=assistant&lesson=photo%2Flesson.json";
const PANE = "vscode://holobiomicslab.studium-vscode/open?bundle=%2Flib%2Fphoto%2Flesson.json";

describe("surfaceOrder", () => {
  it("A: the native surface first (a pane the client's own app draws, then an MCP Apps panel), the browser after, the chat last", () => {
    expect(surfaceOrder(can("panel", "browser"))).toEqual(["panel", "browser", "chat"]);
    expect(surfaceOrder(can("assistant_pane", "browser"))).toEqual(["assistant_pane", "browser", "chat"]);
    expect(surfaceOrder(can("vscode_pane"))).toEqual(["vscode_pane", "chat"]);
    expect(surfaceOrder(can("browser"))).toEqual(["browser", "chat"]);
  });
  it("offers nothing when the chat is all this host gives", () => {
    expect(surfaceOrder(can())).toEqual([]);
    expect(surfaceOrder(can(), "chat")).toEqual([]);
  });
  it("B: the surface the learner last answered on comes first when this host gives it, else the order of A", () => {
    expect(surfaceOrder(can("panel", "browser"), "browser")).toEqual(["browser", "panel", "chat"]);
    expect(surfaceOrder(can("panel", "browser"), "panel")).toEqual(["panel", "browser", "chat"]);
    expect(surfaceOrder(can("browser"), "vscode_pane")).toEqual(["browser", "chat"]);
    expect(surfaceOrder(can("vscode_pane"), "browser")).toEqual(["vscode_pane", "chat"]);
  });
  it("B: after answers in the chat, the chat first and one other surface, the best this host gives", () => {
    expect(surfaceOrder(can("panel", "browser"), "chat")).toEqual(["chat", "panel"]);
    expect(surfaceOrder(can("vscode_pane"), "chat")).toEqual(["chat", "vscode_pane"]);
  });
});

const offer = (order: SurfaceOffer["order"], extra: Partial<SurfaceOffer> = {}): SurfaceOffer => ({ first: order[0]!, order, ...extra });

describe("offerSentences", () => {
  it("keeps the words of decision 4 and of D2 when the browser or the VS Code pane is first", () => {
    for (const locale of ["en", "fr"] as const) {
      expect(offerSentences(locale, offer(["browser", "chat"], { open_link: BROWSER }))).toBe(browserOffer(locale, BROWSER));
      expect(offerSentences(locale, offer(["vscode_pane", "chat"], { open_link: PANE }))).toBe(paneOffer(locale, PANE));
    }
  });
  it("puts the panel first, then the browser's address, then the chat on “here”", () => {
    const en = offerSentences("en", offer(["panel", "browser", "chat"], { open_link: BROWSER, open_panel: { bundle_ref: "photo/lesson.json" } }));
    expect(en).toMatch(/^The assistant opens it in the Studium panel/);
    expect(en.indexOf("Studium panel")).toBeLessThan(en.indexOf(`<${BROWSER}>`));
    expect(en.indexOf(`<${BROWSER}>`)).toBeLessThan(en.indexOf("say “here”"));
    const fr = offerSentences("fr", offer(["panel", "browser", "chat"], { open_link: BROWSER, open_panel: { bundle_ref: "photo/lesson.json" } }));
    expect(fr).toMatch(/^L'assistant l'ouvre dans le panneau Studium/);
    expect(fr).toContain(`<${BROWSER}>`);
    expect(fr).toMatch(/dis «\xa0ici\xa0»/);
  });
  it("names the command of a pane the assistant's own app draws (the Claude Code mod)", () => {
    const en = offerSentences("en", offer(["assistant_pane", "browser", "chat"], { open_link: BROWSER, command: "/studium photo/lesson.json" }));
    expect(en).toMatch(/^Open it in the Studium pane: type `\/studium photo\/lesson\.json`/);
    expect(en).toContain(`<${BROWSER}>`);
    const fr = offerSentences("fr", offer(["browser", "assistant_pane", "chat"], { open_link: BROWSER, command: "/studium photo/lesson.json" }));
    expect(fr).toMatch(/^Ouvre-la dans ton navigateur/);
    expect(fr).toMatch(/Ou tape `\/studium photo\/lesson\.json`/);
  });
  it("says, after answers in the chat, that the lesson plays here, and gives the link once", () => {
    const en = offerSentences("en", offer(["chat", "browser"], { open_link: BROWSER }));
    // Changed: "As last time, it goes on here" read as going on with a lesson on the start step of a new one (review G,
    // finding 3); the sentence now names the learner's choice, for a lesson started or continued alike.
    expect(en).toMatch(/^It plays here, in this chat, as you chose last time\./);
    expect(en.split(BROWSER)).toHaveLength(2);
    expect(en).not.toMatch(/say “here”/);
    const fr = offerSentences("fr", offer(["chat", "vscode_pane"], { open_link: PANE }));
    // Changed: as above, in French.
    expect(fr).toMatch(/^Tu la suis ici, dans cette conversation, comme tu l'as choisi la dernière fois\./);
    expect(fr).toContain(`](${PANE})`);
    expect(offerSentences("en", offer(["chat", "panel"], { open_panel: { bundle_ref: "photo/lesson.json" } }))).toMatch(/say “panel”/);
  });
});

describe("chatStartLine", () => {
  it("names, in one italic line, the better surface for a lesson started in the chat", () => {
    // Changed: the browser's line promised immediate answers; it now says what holds with a judge model too (review G,
    // finding 2; open-link.test.ts checks every browser text).
    expect(chatStartLine("fr", offer(["browser", "chat"], { open_link: BROWSER })))
      .toBe(`_Pour répondre à chaque étape sans passer par cette conversation, suis-la dans ton navigateur\xa0: <${BROWSER}>_`);
    expect(chatStartLine("en", offer(["browser", "chat"], { open_link: BROWSER })))
      .toBe(`_To answer each step without going through this chat, follow it in your web browser: <${BROWSER}>_`);
    expect(chatStartLine("en", offer(["panel", "browser", "chat"], { open_link: BROWSER, open_panel: { bundle_ref: "x" } }))).toMatch(/^_For immediate answers, say “panel”/);
    expect(chatStartLine("fr", offer(["vscode_pane", "chat"], { open_link: PANE }))).toContain(`[panneau Studium](${PANE})`);
    expect(chatStartLine("en", offer(["assistant_pane", "chat"], { command: "/studium photo/lesson.json" }))).toContain("`/studium photo/lesson.json`");
  });
  it("says nothing when the learner's choice is the chat, or when there is nothing better", () => {
    expect(chatStartLine("en", offer(["chat", "browser"], { open_link: BROWSER }))).toBeNull();
    expect(chatStartLine("en", null)).toBeNull();
  });
});
