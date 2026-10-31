// packages/lesson-session-host/src/authoring-draft/slug.ts

/** The ASCII slug of `text` by the rule of `_slug` in tools/self_study_passages.py (NFKD, non-ASCII
 * characters dropped, lower case, every run of anything but a-z and 0-9 one "-", no "-" at either
 * end), then cut to at most `maxChars` characters, which the Python does not do; `fallback`
 * (the caller's, not the Python "passage") when nothing is left. */
export function asciiSlug(text: string, maxChars: number, fallback: string): string {
  const ascii = Array.from(text.normalize("NFKD")).filter((character) => character.charCodeAt(0) < 0x80).join("");
  const slug = ascii.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.slice(0, maxChars).replace(/-+$/g, "") || fallback;
}
