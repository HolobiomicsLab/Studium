/**
 * Server side of signing in and out (`/api/session`). Plain `Request` in, `Response` out, so it is
 * unit tested without Next.
 *
 * POST: same-origin only (the decision route's test, lib/same-origin.ts), a JSON or form body of at
 * most 4 KiB holding `code` and an optional `next`, the code compared in constant time
 * (lib/session.ts). Failures are throttled in memory, per process: after 10 failed attempts in 5
 * minutes every attempt gets 429 until the oldest failure leaves the window. A failure answers 401
 * with one fixed message; the submitted value is never echoed or logged.
 * DELETE: clears the cookie.
 */
import { crossOrigin } from "./same-origin";
import {
  ACCESS_CODE_ENV,
  accessCode,
  clearSessionCookie,
  codeMatches,
  overHttps,
  safeNextPath,
  sessionSetCookie,
  signSession,
  type Clock,
  type Env,
} from "./session";

export const MAX_SIGN_IN_BODY = 4096;
export const MAX_FAILURES = 10;
export const FAILURE_WINDOW_MS = 5 * 60 * 1000;
export const WRONG_CODE = "Code d’accès incorrect.";
export const NO_ACCESS_CODE =
  `Connexion impossible : aucun code d’accès n’est configuré. Définissez ${ACCESS_CODE_ENV} ` +
  "(16 caractères au moins) sur le serveur du tableau de bord, puis redémarrez-le.";
export const TOO_MANY_ATTEMPTS = "Trop de tentatives échouées : réessayez dans quelques minutes.";

/** Failed sign-in attempts in a sliding window, in this process's memory only. */
export class FailureThrottle {
  private failures: number[] = [];
  constructor(private readonly now: Clock = Date.now, private readonly limit = MAX_FAILURES, private readonly windowMs = FAILURE_WINDOW_MS) {}
  private prune(): void {
    const since = this.now() - this.windowMs;
    this.failures = this.failures.filter((at) => at > since);
  }
  blocked(): boolean { this.prune(); return this.failures.length >= this.limit; }
  record(): void { this.prune(); this.failures.push(this.now()); }
}

const processThrottle = new FailureThrottle();

export type SessionRouteOptions = { env?: Env; now?: Clock; throttle?: FailureThrottle };

function json(status: number, body: Record<string, unknown>, cookie?: string): Response {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (cookie) headers.set("Set-Cookie", cookie);
  return Response.json(body, { status, headers });
}

/** The body as text, or null when it exceeds `max` bytes (stops reading past the bound). */
async function boundedText(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

function fields(contentType: string, text: string): { code: unknown; next: unknown } | null {
  if (contentType.startsWith("application/json")) {
    try {
      const body = JSON.parse(text) as unknown;
      if (typeof body !== "object" || body === null) return null;
      const { code, next } = body as Record<string, unknown>;
      return { code, next };
    } catch { return null; }
  }
  const form = new URLSearchParams(text);
  return { code: form.get("code") ?? undefined, next: form.get("next") ?? undefined };
}

export async function handleSignIn(request: Request, options: SessionRouteOptions = {}): Promise<Response> {
  const { env = process.env, now = Date.now, throttle = processThrottle } = options;
  if (crossOrigin(request)) return json(403, { error: "Connexion refusée : elle ne peut venir que des pages du tableau de bord." });
  const code = accessCode(env);
  if (!code) return json(503, { error: NO_ACCESS_CODE });
  if (throttle.blocked()) return json(429, { error: TOO_MANY_ATTEMPTS });
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("application/json") && !contentType.startsWith("application/x-www-form-urlencoded")) {
    return json(415, { error: "Connexion refusée : corps JSON ou formulaire attendu." });
  }
  const text = await boundedText(request, MAX_SIGN_IN_BODY);
  if (text === null) return json(413, { error: "Connexion refusée : requête trop longue." });
  const submitted = fields(contentType, text);
  if (!submitted || typeof submitted.code !== "string" || submitted.code === "") {
    return json(400, { error: "Connexion refusée : saisissez le code d’accès." });
  }
  if (!(await codeMatches(submitted.code, code))) {
    throttle.record();
    return json(401, { error: WRONG_CODE });
  }
  const value = await signSession(code, now);
  return json(200, { next: safeNextPath(submitted.next) }, sessionSetCookie(value, overHttps(request)));
}

export async function handleSignOut(request: Request): Promise<Response> {
  if (crossOrigin(request)) return json(403, { error: "Déconnexion refusée : elle ne peut venir que des pages du tableau de bord." });
  return json(200, { next: "/login" }, clearSessionCookie(overHttps(request)));
}
