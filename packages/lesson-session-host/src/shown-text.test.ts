// shownText: every string taken from a lesson archive is cleaned by this one function before a person reads it, in the
// VS Code modals and in the `studium-mcp import` command alike.
import { describe, it, expect } from "vitest";
import { shownText } from "./shown-text.js";

describe("shownText", () => {
  it("keeps ordinary text, accents included", () => {
    expect(shownText("Les orbitales d'Élise")).toBe("Les orbitales d'Élise");
  });
  it("turns line breaks into spaces first, so two words on two lines stay two words", () => {
    expect(shownText("one\ntwo\r\nthree\u{2028}four\u{2029}five")).toBe("one two three four five");
  });
  it("removes controls, bidi and invisible formatting, tags, U+034F and U+180E", () => {
    expect(shownText("a\x07b\u{202E}c\u{200B}d\u{E0041}e\u{34F}f\u{180E}g")).toBe("abcdefg");
  });
  it("collapses whitespace and trims", () => {
    expect(shownText("  a \t  b  ")).toBe("a b");
  });
  it("caps at max characters (200 by default) with an ellipsis, counting code points", () => {
    expect(shownText("x".repeat(250))).toBe("x".repeat(199) + "…");
    expect(shownText("😀".repeat(10), 5)).toBe("😀".repeat(4) + "…");
    expect(shownText("abc", 3)).toBe("abc");
  });
});
