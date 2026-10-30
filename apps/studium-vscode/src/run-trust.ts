// run-trust.ts — ENG-02: what a learner is shown before a bundle's command runs, and the memory of the
// bundles they chose to trust. Pure (node:crypto only, no VS Code import) so a driver can test it; the
// modal itself and the globalState read/write live in extension.ts.
import { createHash } from "node:crypto";
import type { RunManifest, RunTaskSpec } from "./run-task.js";
import { hostPhrase } from "./host-phrases.js";
import type { Locale } from "./phrases.js";

/** The trust memory keeps this many fingerprints, newest last; older ones are forgotten first. */
const MAX_TRUSTED = 200;

/** A digest of everything that decides what a reproduction executes: the bundle file's bytes AND the
 * manifest fields (command, packages, folder, course). Trust is therefore tied to one exact version of
 * the bundle: edit the command, add a package or change the file and the learner is asked again. */
export function runFingerprint(bundleBytes: Uint8Array | null, manifest: RunManifest): string {
  const hash = createHash("sha256");
  hash.update(bundleBytes ?? "no-bundle-file");
  hash.update("\0");
  hash.update(JSON.stringify({
    capsule: manifest.capsule_ref,
    cmd: manifest.cmd,
    requirements: manifest.requirements ?? [],
    working_dir: manifest.working_dir ?? "",
  }));
  return hash.digest("hex");
}

export function isTrusted(trusted: readonly string[], fingerprint: string): boolean {
  return trusted.includes(fingerprint);
}

/** The trust list with `fingerprint` added (once), capped at the most recent MAX_TRUSTED entries. */
export function withTrusted(trusted: readonly string[], fingerprint: string): string[] {
  const next = trusted.includes(fingerprint) ? [...trusted] : [...trusted, fingerprint];
  return next.slice(-MAX_TRUSTED);
}

export interface RunConsent {
  message: string;
  detail: string;
  runLabel: string;
  trustLabel: string;
}

/** The modal text: the exact command, the packages to install and the folder it runs in. */
export function runConsent(manifest: RunManifest, spec: RunTaskSpec, cwdAbsolute: string, locale: Locale): RunConsent {
  const packages = manifest.requirements?.length ? manifest.requirements.join(", ") : hostPhrase("run_confirm_none", {}, locale);
  return {
    message: hostPhrase("run_confirm_message", {}, locale),
    detail: hostPhrase("run_confirm_detail", { command: spec.command, packages, cwd: cwdAbsolute, capsule: manifest.capsule_ref }, locale),
    runLabel: hostPhrase("run_confirm_run", {}, locale),
    trustLabel: hostPhrase("run_confirm_trust", {}, locale),
  };
}
