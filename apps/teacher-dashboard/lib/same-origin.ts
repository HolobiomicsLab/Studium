/** Only this dashboard's own pages may post to its write routes (a decision, a sign-in): a
 * cross-origin form or script (the learner app on another port included) is refused before
 * anything else. Shared by lib/decide-route.ts and lib/session-route.ts. */
export function crossOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return true;
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  try { return new URL(origin).host !== request.headers.get("host"); }
  catch { return true; }
}
