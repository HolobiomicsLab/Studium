/**
 * Teacher sign-in for the dashboard: one access code per dashboard and a signed session cookie.
 *
 * The access code (`STUDIUM_DASHBOARD_ACCESS_CODE`) is read on the server only. The session cookie
 * holds `v1.<expiry epoch seconds>.<base64url HMAC-SHA256 of "v1.<expiry>">`, signed with a key
 * derived from the access code, so changing the code ends every session and no second secret is
 * needed. The session carries no identity: it proves that the browser knew the code, not who the
 * teacher is.
 *
 * Web Crypto only (`crypto.subtle`, `btoa`, `atob`), so the same module runs in the middleware
 * (Edge runtime) and in the route handlers (Node runtime). The clock is injectable everywhere.
 */

export const ACCESS_CODE_ENV = "STUDIUM_DASHBOARD_ACCESS_CODE";
export const ACCESS_CODE_MIN_LENGTH = 16;
export const SESSION_COOKIE = "studium_teacher_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
const VERSION = "v1";
const SIGNING_LABEL = "studium-dashboard-session/v1";
const COMPARE_LABEL = "studium-dashboard-access-code-compare/v1";
const SESSION_VALUE = /^v1\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/;

/** Milliseconds since the epoch, like `Date.now`. */
export type Clock = () => number;
export type Env = Record<string, string | undefined>;

let shortCodeReported = false;

/**
 * The configured access code, trimmed, or null when it is unset or shorter than 16 characters.
 * A short value is reported once on stderr (never the value itself) and counts as unset.
 */
export function accessCode(env: Env = process.env): string | null {
  const code = (env[ACCESS_CODE_ENV] ?? "").trim();
  if (!code) return null;
  if (code.length < ACCESS_CODE_MIN_LENGTH) {
    if (!shortCodeReported) {
      shortCodeReported = true;
      console.error(
        `${ACCESS_CODE_ENV} est ignoré : il compte moins de ${ACCESS_CODE_MIN_LENGTH} caractères. ` +
        "Le tableau de bord reste ouvert et les décisions restent désactivées.",
      );
    }
    return null;
  }
  return code;
}

const encoder = new TextEncoder();

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function hmacKey(secret: BufferSource): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** A key derived from the access code for one purpose: HMAC(code, label). */
async function derivedKey(code: string, label: string): Promise<CryptoKey> {
  const material = await crypto.subtle.sign("HMAC", await hmacKey(encoder.encode(code)), encoder.encode(label));
  return hmacKey(material);
}

/** A session cookie value valid for 12 hours from `now`. */
export async function signSession(code: string, now: Clock = Date.now): Promise<string> {
  const expiry = Math.floor(now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${VERSION}.${expiry}`;
  const signature = await crypto.subtle.sign("HMAC", await derivedKey(code, SIGNING_LABEL), encoder.encode(payload));
  return `${payload}.${toBase64Url(signature)}`;
}

/** True when `value` has the v1 format, has not expired and carries the signature of this code. */
export async function verifySession(value: string | null | undefined, code: string, now: Clock = Date.now): Promise<boolean> {
  if (!value) return false;
  const match = SESSION_VALUE.exec(value);
  if (!match) return false;
  const expiry = Number(match[1]);
  if (!(expiry > Math.floor(now() / 1000))) return false;
  const signature = fromBase64Url(match[2]);
  if (!signature || signature.length !== 32) return false;
  return crypto.subtle.verify("HMAC", await derivedKey(code, SIGNING_LABEL), signature, encoder.encode(`${VERSION}.${match[1]}`));
}

/**
 * Compare a submitted code with the configured one in constant time: the HMAC of the configured
 * code is checked against the submitted bytes by `crypto.subtle.verify`, never with `===`.
 */
export async function codeMatches(submitted: string, code: string): Promise<boolean> {
  const key = await derivedKey(code, COMPARE_LABEL);
  const expected = await crypto.subtle.sign("HMAC", key, encoder.encode(code));
  return crypto.subtle.verify("HMAC", key, expected, encoder.encode(submitted.trim()));
}

/** The value of the session cookie in a request's `Cookie` header, or null. */
export function sessionCookieValue(request: Request): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === SESSION_COOKIE) return part.slice(index + 1).trim();
  }
  return null;
}

/** "unset": no usable access code; "valid": a session signed with the current code; "missing": none. */
export type SessionState = "unset" | "valid" | "missing";

export async function sessionState(request: Request, env: Env = process.env, now: Clock = Date.now): Promise<SessionState> {
  const code = accessCode(env);
  if (!code) return "unset";
  return (await verifySession(sessionCookieValue(request), code, now)) ? "valid" : "missing";
}

/** The request arrived over https, directly or through a proxy that says so. */
export function overHttps(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0].trim().toLowerCase() === "https";
  try { return new URL(request.url).protocol === "https:"; }
  catch { return false; }
}

/** `Set-Cookie` for a new session. */
export function sessionSetCookie(value: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

/** `Set-Cookie` that removes the session. */
export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

/**
 * A same-site path to go to after signing in: it starts with a single `/`, has no `//`, no
 * backslash and no control character. Anything else, a scheme or another host included, gives `/`.
 */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string" || next.length > 2048) return "/";
  if (!next.startsWith("/") || next.includes("//") || next.includes("\\")) return "/";
  for (const ch of next) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return "/";
  }
  try {
    const url = new URL(next, "http://dashboard.invalid");
    if (url.origin !== "http://dashboard.invalid") return "/";
  } catch {
    return "/";
  }
  return next;
}
