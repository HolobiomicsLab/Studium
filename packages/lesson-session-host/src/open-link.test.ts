// D2 (waiting review 2026-11-25): when the Studium VS Code extension serves Studium (STUDIUM_OPEN_LINK), a lesson
// ready to play is offered in the pane first, through a vscode:// link, the chat one word away. The link is the
// extension's prefix and the lesson file's path percent-encoded once (apps/studium-vscode/src/lesson-uri.ts reads
// it back, VS Code having decoded the query once). The pane cannot open a .zip bundle from a link.
import { describe, expect, it } from "vitest";
import { browserOffer, openLessonLink, paneOffer } from "./open-link.js";

const PREFIX = "vscode://holobiomicslab.studium-vscode/open?bundle=";

describe("openLessonLink", () => {
  it("appends the path, percent-encoded once, to the extension's prefix", () => {
    const path = "/Users/zoé/My Lessons/a&b+c #1 50%/lesson.json";
    const link = openLessonLink(PREFIX, path)!;
    expect(link).toBe(PREFIX + encodeURIComponent(path));
    // Nothing in the query a link reader would split on, cut at, or render as a space.
    expect(link.slice(PREFIX.length)).not.toMatch(/[ &+#?]/);
    expect(decodeURIComponent(link.slice(PREFIX.length))).toBe(path);
    expect(openLessonLink(PREFIX, "C:\\Users\\Zoé\\lesson.json")).toBe(PREFIX + "C%3A%5CUsers%5CZo%C3%A9%5Clesson.json");
  });

  // Review of the waiting branch, finding 6: encodeURIComponent leaves ( ) ' ! * as they are, and a ")" in the path (a
  // folder named "smile :)") ended the Markdown link early. They are percent-encoded too (VS Code decodes them once,
  // as it does any escape), so the link holds only unreserved characters and escapes.
  it("percent-encodes ( ) ' ! * as well, so that a Markdown link ends where the link does", () => {
    for (const path of ["/Users/x/smile :)/lesson.json", "/Users/x/Cours (2)/lesson.json", "/tmp/quote'(paren)*!/lesson.json"]) {
      const link = openLessonLink(PREFIX, path)!;
      expect(link.slice(PREFIX.length)).toMatch(/^[A-Za-z0-9%._~-]+$/);
      expect(decodeURIComponent(link.slice(PREFIX.length))).toBe(path);
      // A CommonMark link destination in ( ) ends at the first unbalanced ")": the whole link comes before it.
      for (const locale of ["en", "fr"] as const) {
        const offer = paneOffer(locale, link);
        const start = offer.indexOf("](") + 2;
        expect(offer.slice(start, offer.indexOf(")", start))).toBe(link);
      }
    }
  });

  it("gives no link for what the pane cannot open from one: a .zip bundle, a file that is not .json, no prefix", () => {
    expect(openLessonLink(PREFIX, "/lib/community/pack.zip")).toBeNull();
    expect(openLessonLink(PREFIX, "/lib/notes.md")).toBeNull();
    expect(openLessonLink("", "/lib/a/lesson.json")).toBeNull();
    expect(openLessonLink(PREFIX, "lib/a/lesson.json")).toBeNull(); // a relative path: the handler refuses it
  });
});

describe("paneOffer", () => {
  const link = PREFIX + encodeURIComponent("/lib/a/lesson.json");
  it("offers the pane first, as a markdown link, with the chat one word away and a plain-text fallback", () => {
    const en = paneOffer("en", link);
    expect(en).toContain(`](${link})`);
    expect(en).toMatch(/Studium pane/);
    expect(en).toMatch(/say “here”/);
    expect(en).toMatch(/If the link does not open/);
    const fr = paneOffer("fr", link);
    expect(fr).toContain(`](${link})`);
    expect(fr).toMatch(/panneau Studium/);
    expect(fr).toMatch(/dis «\xa0ici\xa0»/);
    expect(fr).toMatch(/Si le lien ne s'ouvre pas/);
  });
  it("never claims that every answer is checked: a step answers at once", () => {
    for (const locale of ["en", "fr"] as const) expect(paneOffer(locale, link)).not.toMatch(/checked|vérifi/);
  });
});

// Review of decision 4, nit: the browser offer said each step "answers there at once", which a written answer does not
// do when a judge model assesses it (the page waits for the judge). Nor is every answer checked (a written answer no
// judge assesses is rated by the learner), as paneOffer's test says. The offer says what holds in every configuration:
// the learner answers there, without going through the chat.
describe("browserOffer", () => {
  const link = "http://127.0.0.1:5555/play#token=k&from=assistant&lesson=a%2Flesson.json";
  it("offers the address first, says the answers are given there without the chat, and claims no speed or check", () => {
    const en = browserOffer("en", link);
    expect(en).toContain(`<${link}>`);
    expect(en).toMatch(/You answer each step there, without going through this chat/);
    const fr = browserOffer("fr", link);
    expect(fr).toContain(`<${link}>`);
    expect(fr).toMatch(/Tu y réponds à chaque étape sans passer par cette conversation/);
    for (const offer of [en, fr]) expect(offer).not.toMatch(/at once|aussitôt|checked|vérifi/);
  });
});
