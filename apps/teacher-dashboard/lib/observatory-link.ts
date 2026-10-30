import { basename } from "node:path";

/** Probe only the configured service, never a URL supplied by lesson content. */
export async function observatoryLink(ref: string): Promise<{ state: "ready" | "missing" | "unavailable"; href?: string }> {
  try {
    const base = new URL(process.env.OBSERVATORY_BASE_URL ?? "http://localhost:8004");
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) return { state: "unavailable" };
    const path = `/courses/${encodeURIComponent(basename(ref))}/mystra`;
    const response = await fetch(new URL(`/api${path}`, base), { cache: "no-store", signal: AbortSignal.timeout(800) });
    await response.body?.cancel();
    if (response.ok) return { state: "ready", href: new URL(path, base).href };
    if (response.status === 404) return { state: "missing", href: base.origin };
    return { state: "unavailable" };
  } catch { return { state: "unavailable" }; }
}
