/**
 * @vitest-environment node
 */
import { describe, it, expect, vi } from "vitest";
import {
  FAILURE_WINDOW_MS,
  FailureThrottle,
  handleSignIn,
  handleSignOut,
  MAX_SIGN_IN_BODY,
  WRONG_CODE,
} from "./session-route";
import { ACCESS_CODE_ENV, SESSION_COOKIE, verifySession } from "./session";

/** Generated per run: a test code is never a value written in the repository. */
const CODE = `code-${crypto.randomUUID()}`;
const ENV = { [ACCESS_CODE_ENV]: CODE };
const T0 = Date.parse("2026-11-10T09:00:00Z");

function post(body: unknown, headers: Record<string, string> = {}, url = "http://localhost:3001/api/session"): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", host: new URL(url).host, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function setup(start = T0) {
  let clock = start;
  const now = () => clock;
  return { now, advance: (ms: number) => { clock += ms; }, throttle: new FailureThrottle(now) };
}

function cookieValue(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  return header.slice(`${SESSION_COOKIE}=`.length).split(";")[0];
}

describe("POST /api/session", () => {
  it("sets the session cookie with its attributes and returns the sanitised next path", async () => {
    const { now, throttle } = setup();
    const response = await handleSignIn(post({ code: CODE, next: "/library" }), { env: ENV, now, throttle });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ next: "/library" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    const header = response.headers.get("set-cookie") ?? "";
    expect(header.startsWith(`${SESSION_COOKIE}=v1.`)).toBe(true);
    expect(header).toContain("; Path=/");
    expect(header).toContain("; HttpOnly");
    expect(header).toContain("; SameSite=Strict");
    expect(header).toContain("; Max-Age=43200");
    expect(header).not.toContain("Secure");
    expect(await verifySession(cookieValue(response), CODE, now)).toBe(true);
  });

  it("marks the cookie Secure over https, and accepts a form body", async () => {
    const { now, throttle } = setup();
    const body = new URLSearchParams({ code: CODE, next: "//evil.example" }).toString();
    const response = await handleSignIn(post(body, { "content-type": "application/x-www-form-urlencoded", "x-forwarded-proto": "https" }), { env: ENV, now, throttle });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ next: "/" });
    expect(response.headers.get("set-cookie")).toMatch(/; Secure$/);
  });

  it("answers a wrong code with 401 and one fixed message that never echoes the value", async () => {
    const { now, throttle } = setup();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrong = `wrong-${crypto.randomUUID()}`;
    const response = await handleSignIn(post({ code: wrong }), { env: ENV, now, throttle });
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: WRONG_CODE });
    expect(text).not.toContain(wrong);
    expect(text).not.toContain(CODE);
    for (const call of [...log.mock.calls, ...err.mock.calls]) expect(String(call)).not.toContain(wrong);
    log.mockRestore();
    err.mockRestore();
  });

  it.each([
    [{ origin: "http://localhost:3000" }],
    [{ "sec-fetch-site": "cross-site" }],
    [{ "sec-fetch-site": "same-site" }],
  ])("refuses a request from another origin (%o) with 403", async (headers) => {
    const { now, throttle } = setup();
    const response = await handleSignIn(post({ code: CODE }, headers), { env: ENV, now, throttle });
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("answers 503 when no access code is configured (unset or shorter than 16)", async () => {
    const { now, throttle } = setup();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const env of [{}, { [ACCESS_CODE_ENV]: "too-short" }]) {
      const response = await handleSignIn(post({ code: "anything-at-all-here" }), { env, now, throttle });
      expect(response.status).toBe(503);
      expect((await response.json()).error).toContain(ACCESS_CODE_ENV);
    }
    spy.mockRestore();
  });

  it("refuses other content types, an oversized body and a missing code", async () => {
    const { now, throttle } = setup();
    expect((await handleSignIn(post(CODE, { "content-type": "text/plain" }), { env: ENV, now, throttle })).status).toBe(415);
    const big = JSON.stringify({ code: CODE, next: `/${"a".repeat(MAX_SIGN_IN_BODY)}` });
    expect((await handleSignIn(post(big), { env: ENV, now, throttle })).status).toBe(413);
    expect((await handleSignIn(post({ next: "/" }), { env: ENV, now, throttle })).status).toBe(400);
    expect((await handleSignIn(post("not json"), { env: ENV, now, throttle })).status).toBe(400);
  });

  it("throttles after 10 failures in 5 minutes, even for the right code, and recovers after the window", async () => {
    const { now, advance, throttle } = setup();
    for (let i = 0; i < 10; i += 1) {
      expect((await handleSignIn(post({ code: `wrong-${i}` }), { env: ENV, now, throttle })).status).toBe(401);
      advance(1000);
    }
    expect((await handleSignIn(post({ code: "wrong-again" }), { env: ENV, now, throttle })).status).toBe(429);
    expect((await handleSignIn(post({ code: CODE }), { env: ENV, now, throttle })).status).toBe(429);
    advance(FAILURE_WINDOW_MS - 11_000); // the first failure is still 1 s inside the window
    expect((await handleSignIn(post({ code: CODE }), { env: ENV, now, throttle })).status).toBe(429);
    advance(1000);
    const response = await handleSignIn(post({ code: CODE }), { env: ENV, now, throttle });
    expect(response.status).toBe(200);
  });

  it("does not count successes or nine failures as a reason to throttle", async () => {
    const { now, throttle } = setup();
    for (let i = 0; i < 9; i += 1) await handleSignIn(post({ code: `wrong-${i}` }), { env: ENV, now, throttle });
    expect((await handleSignIn(post({ code: CODE }), { env: ENV, now, throttle })).status).toBe(200);
    expect((await handleSignIn(post({ code: CODE }), { env: ENV, now, throttle })).status).toBe(200);
  });
});

describe("DELETE /api/session", () => {
  it("clears the cookie", async () => {
    const response = await handleSignOut(new Request("http://localhost:3001/api/session", { method: "DELETE", headers: { host: "localhost:3001" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(new RegExp(`^${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict$`));
  });

  it("refuses a cross-origin sign-out", async () => {
    const response = await handleSignOut(new Request("http://localhost:3001/api/session", { method: "DELETE", headers: { host: "localhost:3001", origin: "http://evil.example" } }));
    expect(response.status).toBe(403);
  });
});
