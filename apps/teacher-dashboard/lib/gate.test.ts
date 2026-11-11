/**
 * @vitest-environment node
 */
import { describe, it, expect, vi } from "vitest";
import { exemptPath, gate } from "./gate";
import { ACCESS_CODE_ENV, SESSION_COOKIE, signSession } from "./session";
import { middleware, config } from "../middleware";
import { NextRequest } from "next/server";

/** Generated per run: a test code is never a value written in the repository. */
const CODE = `code-${crypto.randomUUID()}`;
const ENV = { [ACCESS_CODE_ENV]: CODE };
const NOW = () => Date.parse("2026-11-10T09:00:00Z");

const req = (path: string, cookie = "") =>
  new Request(`http://localhost:3001${path}`, { headers: cookie ? { cookie } : {} });

describe("middleware gate", () => {
  it("redirects a page request without a session to /login with the path in next", async () => {
    const response = await gate(req("/courses/atomistique-l1/submissions?tab=2"), ENV, NOW);
    expect(response?.status).toBe(307);
    const location = new URL(response?.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/courses/atomistique-l1/submissions?tab=2");
  });

  it("answers an API request without a session with 401 JSON, one French line, no-store", async () => {
    const response = await gate(req("/api/learner-items/it-1/decide"), ENV, NOW);
    expect(response?.status).toBe(401);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    const { error } = await response!.json();
    expect(error).toMatch(/connectez-vous/);
    expect(error).not.toContain("\n");
  });

  it("lets a valid session through, and refuses one signed with another code", async () => {
    const cookie = `${SESSION_COOKIE}=${await signSession(CODE, NOW)}`;
    expect(await gate(req("/library", cookie), ENV, NOW)).toBeNull();
    expect(await gate(req("/api/learner-items/it-1/decide", cookie), ENV, NOW)).toBeNull();
    const other = `${SESSION_COOKIE}=${await signSession(`${CODE}-old`, NOW)}`;
    expect((await gate(req("/library", other), ENV, NOW))?.status).toBe(307);
  });

  it.each(["/login", "/api/session", "/_next/static/chunks/app.js", "/_next/image", "/favicon.ico", "/robots.txt"])(
    "lets the exempt path %s through without a session", async (path) => {
      expect(exemptPath(path)).toBe(true);
      expect(await gate(req(path), ENV, NOW)).toBeNull();
    });

  it.each(["/", "/library", "/login/extra", "/api/sessions", "/api/session-x", "/library/abc/review"])(
    "does not exempt %s", async (path) => {
      expect(exemptPath(path)).toBe(false);
      expect(await gate(req(path), ENV, NOW)).not.toBeNull();
    });

  it("lets everything through when no access code is configured (pages stay readable)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const env of [{}, { [ACCESS_CODE_ENV]: "too-short" }]) {
      expect(await gate(req("/library"), env, NOW)).toBeNull();
      expect(await gate(req("/api/learner-items/it-1/decide"), env, NOW)).toBeNull();
    }
    spy.mockRestore();
  });

  it("is what middleware.ts runs, with a matcher that skips Next's static output", async () => {
    vi.stubEnv(ACCESS_CODE_ENV, CODE);
    const redirected = await middleware(new NextRequest("http://localhost:3001/library"));
    expect(redirected.status).toBe(307);
    vi.unstubAllEnvs();
    const open = await middleware(new NextRequest("http://localhost:3001/library"));
    expect(open.headers.get("x-middleware-next")).toBe("1");
    expect(config.matcher[0]).toContain("_next/static");
  });
});
