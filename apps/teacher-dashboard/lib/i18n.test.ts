import { describe, expect, it } from "vitest";
import { detectLocale, messages } from "./i18n";

describe("teacher locale", () => {
  it.each([
    ["fr", "en-US", "fr"], ["en", "fr-FR", "en"], [undefined, "en-GB,en;q=0.8,fr;q=0.6", "en"],
    [undefined, "en;q=0.3,fr-CA;q=0.9", "fr"], [undefined, "fr;q=0,en;q=1", "en"],
    ["invalid", "de-DE,fr;q=0.8", "fr"], [undefined, "", "fr"],
  ])("honours cookie %s and Accept-Language %s", (cookie, accept, expected) => {
    expect(detectLocale(cookie, accept)).toBe(expected);
  });
  it("has translated library and review labels", () => {
    expect(messages("fr").library).toBe("Bibliothèque de cours");
    expect(messages("en").library).toBe("Course library");
    expect(messages("en").review).toBe("Review");
  });
});
