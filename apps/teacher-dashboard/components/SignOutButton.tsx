"use client";

/** Clears the teacher session (DELETE /api/session), then goes to the sign-in page. */
export default function SignOutButton({ label }: { label: string }) {
  async function signOut() {
    try { await fetch("/api/session", { method: "DELETE", cache: "no-store" }); }
    finally { window.location.assign("/login"); }
  }
  return <button type="button" className="site-nav__link sign-out" onClick={signOut}>{label}</button>;
}
