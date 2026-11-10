"use client";

import { useState, type FormEvent } from "react";
import { messages, type Locale } from "@/lib/i18n";

/**
 * The sign-in form: posts the code to this dashboard's /api/session as JSON, then goes to the path
 * the server returns (already restricted to a same-site path). The code never leaves this form
 * except in that request, and the page never shows it back.
 */
export default function SignInForm({ next, locale = "fr" }: { next: string; locale?: Locale }) {
  const t = messages(locale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, next }),
      });
      const body = (await response.json().catch(() => ({}))) as { next?: string; error?: string };
      if (response.ok) {
        window.location.assign(body.next ?? "/");
        return;
      }
      setError(body.error ?? t.signInFailed);
    } catch {
      setError(t.signInFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="sign-in" onSubmit={submit} method="post" action="/api/session">
      <input type="hidden" name="next" value={next} />
      <label className="approval-name">{t.accessCodeLabel}
        <input type="password" name="code" required autoComplete="current-password" autoFocus />
      </label>
      <button className="primary-button" type="submit" disabled={busy}>{busy ? t.signingIn : t.signInSubmit}</button>
      {error && <p className="inline-error" role="alert">{error}</p>}
    </form>
  );
}
