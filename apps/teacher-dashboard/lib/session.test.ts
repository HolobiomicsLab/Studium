/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ACCESS_CODE_ENV,
  accessCode,
  clearSessionCookie,
  codeMatches,
  overHttps,
  safeNextPath,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookieValue,
  sessionSetCookie,
  sessionState,
  signSession,
  verifySession,
} from "./session";

/** Generated per run: a test code is never a value written in the repository. */
const CODE = `code-${crypto.randomUUID()}`;
const T0 = Date.parse("2026-11-10T09:00:00Z");
const at = (ms: number) => () => ms;

describe("access code", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("is the trimmed value when it has at least 16 characters", () => {
    expect(accessCode({ [ACCESS_CODE_ENV]: `  ${CODE}  ` })).toBe(CODE);
    expect(accessCode({ [ACCESS_CODE_ENV]: "x".repeat(16) })).toBe("x".repeat(16));
  });

  it("counts unset, blank and short values as unset, and never prints the value", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(accessCode({})).toBeNull();
    expect(accessCode({ [ACCESS_CODE_ENV]: "   " })).toBeNull();
    const short = "fifteen-chars!!";
    expect(short).toHaveLength(15);
    expect(accessCode({ [ACCESS_CODE_ENV]: ` ${short} ` })).toBeNull();
    expect(accessCode({ [ACCESS_CODE_ENV]: `${"y".repeat(15)}   ` })).toBeNull();
    for (const call of spy.mock.calls) expect(String(call[0])).not.toContain(short);
  });
});

describe("session cookie value", () => {
  it("has the v1 format and verifies until it expires 12 hours later", async () => {
    const value = await signSession(CODE, at(T0));
    expect(value).toMatch(/^v1\.\d+\.[A-Za-z0-9_-]{43}$/);
    expect(Number(value.split(".")[1])).toBe(Math.floor(T0 / 1000) + SESSION_TTL_SECONDS);
    expect(await verifySession(value, CODE, at(T0))).toBe(true);
    expect(await verifySession(value, CODE, at(T0 + (SESSION_TTL_SECONDS - 1) * 1000))).toBe(true);
  });

  it("refuses an expired session", async () => {
    const value = await signSession(CODE, at(T0));
    expect(await verifySession(value, CODE, at(T0 + SESSION_TTL_SECONDS * 1000))).toBe(false);
    expect(await verifySession(value, CODE, at(T0 + 13 * 3600 * 1000))).toBe(false);
  });

  it("refuses a tampered signature", async () => {
    const value = await signSession(CODE, at(T0));
    const last = value.at(-2) === "A" ? "B" : "A";
    const tampered = `${value.slice(0, -2)}${last}${value.slice(-1)}`;
    expect(await verifySession(tampered, CODE, at(T0))).toBe(false);
  });

  it("refuses a tampered expiry", async () => {
    const value = await signSession(CODE, at(T0));
    const [version, expiry, signature] = value.split(".");
    const later = `${version}.${Number(expiry) + 86400}.${signature}`;
    expect(await verifySession(later, CODE, at(T0))).toBe(false);
  });

  it("refuses another version and malformed values", async () => {
    const value = await signSession(CODE, at(T0));
    for (const bad of [value.replace(/^v1/, "v2"), `${value}.x`, value.slice(3), "", "v1..", "v1.abc.def", null, undefined]) {
      expect(await verifySession(bad, CODE, at(T0))).toBe(false);
    }
  });

  it("refuses every session once the code changes", async () => {
    const value = await signSession(CODE, at(T0));
    expect(await verifySession(value, `${CODE}-changed`, at(T0))).toBe(false);
  });

  it("reads the session state from a request, with a short code counting as unset", async () => {
    const value = await signSession(CODE, at(T0));
    const signedIn = new Request("http://localhost:3001/", { headers: { cookie: `a=b; ${SESSION_COOKIE}=${value}; c=d` } });
    expect(sessionCookieValue(signedIn)).toBe(value);
    expect(await sessionState(signedIn, { [ACCESS_CODE_ENV]: CODE }, at(T0))).toBe("valid");
    expect(await sessionState(new Request("http://localhost:3001/"), { [ACCESS_CODE_ENV]: CODE }, at(T0))).toBe("missing");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sessionState(signedIn, { [ACCESS_CODE_ENV]: "short" }, at(T0))).toBe("unset");
    expect(await sessionState(signedIn, {}, at(T0))).toBe("unset");
    spy.mockRestore();
  });
});

describe("code comparison", () => {
  it("accepts the code (surrounding spaces trimmed) and refuses anything else", async () => {
    expect(await codeMatches(CODE, CODE)).toBe(true);
    expect(await codeMatches(` ${CODE}\n`, CODE)).toBe(true);
    for (const wrong of ["", CODE.slice(0, -1), `${CODE}x`, CODE.toUpperCase()]) {
      expect(await codeMatches(wrong, CODE)).toBe(false);
    }
  });
});

describe("cookie attributes", () => {
  it("is HttpOnly, SameSite=Strict, Path=/, 12 hours, Secure only over https", () => {
    expect(sessionSetCookie("v", false)).toBe(`${SESSION_COOKIE}=v; Path=/; Max-Age=43200; HttpOnly; SameSite=Strict`);
    expect(sessionSetCookie("v", true)).toMatch(/; Secure$/);
    expect(clearSessionCookie(false)).toContain("Max-Age=0");
  });

  it("detects https from the request URL or x-forwarded-proto", () => {
    expect(overHttps(new Request("https://teach.example/"))).toBe(true);
    expect(overHttps(new Request("http://localhost:3001/"))).toBe(false);
    expect(overHttps(new Request("http://localhost:3001/", { headers: { "x-forwarded-proto": "https" } }))).toBe(true);
    expect(overHttps(new Request("https://teach.example/", { headers: { "x-forwarded-proto": "http" } }))).toBe(false);
  });
});

describe("next path after signing in", () => {
  it.each([
    ["/", "/"],
    ["/library", "/library"],
    ["/courses/atomistique-l1/submissions?x=1#top", "/courses/atomistique-l1/submissions?x=1#top"],
  ])("keeps the same-site path %s", (next, expected) => {
    expect(safeNextPath(next)).toBe(expected);
  });

  it.each([
    "//evil.example/", "/\\evil.example", "\\\\evil.example", "https://evil.example/", "javascript:alert(1)",
    "library", "", "/a//b", "/\nfoo", "/\tfoo", " /library", undefined, null, 42, ["/library"], `/${"a".repeat(3000)}`,
  ])("falls back to / for %o", (next) => {
    expect(safeNextPath(next)).toBe("/");
  });
});
