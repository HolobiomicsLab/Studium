/**
 * What the middleware decides for one request, in plain `Request` / `Response` terms so it is unit
 * tested without Next. With an access code configured, every page and API route needs a valid
 * teacher session except the sign-in page, the session route and Next's own static assets: a page
 * request without one is redirected to `/login?next=<path>`, an API request gets `401`. Without an
 * access code, everything passes (single-teacher use on localhost); the decision route still
 * refuses on its own (lib/decide-route.ts).
 */
import { sessionState, type Clock, type Env } from "./session";

export const SIGN_IN_PATH = "/login";
export const SESSION_ROUTE = "/api/session";
export const API_SIGN_IN_REQUIRED = "Accès refusé : connectez-vous au tableau de bord.";

/** Paths that never need a session. */
export function exemptPath(pathname: string): boolean {
  return pathname === SIGN_IN_PATH
    || pathname === SESSION_ROUTE || pathname.startsWith(`${SESSION_ROUTE}/`)
    || pathname.startsWith("/_next/")
    || pathname === "/favicon.ico" || pathname === "/robots.txt";
}

/** null: let the request through; otherwise the response to send instead. */
export async function gate(request: Request, env: Env = process.env, now: Clock = Date.now): Promise<Response | null> {
  const url = new URL(request.url);
  if (exemptPath(url.pathname)) return null;
  const state = await sessionState(request, env, now);
  if (state !== "missing") return null;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    return Response.json({ error: API_SIGN_IN_REQUIRED }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const target = new URL(SIGN_IN_PATH, url);
  target.searchParams.set("next", `${url.pathname}${url.search}`);
  return new Response(null, { status: 307, headers: { Location: target.toString(), "Cache-Control": "no-store" } });
}
