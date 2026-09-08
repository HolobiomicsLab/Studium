// INT-STUDIUM-004 — the fixture corpus must be able to measure over-distrust OFFLINE.
//
// `flaw-verdicts.test.ts` proves the MECHANISM on a scene it builds itself. That is not the same
// claim as: any lesson a learner can actually be given exercises it. When this file was written,
// none did — four `spot_the_flaw` scenes across three bundles, not one with `verdict_deck`, not one
// with `sound_claims`. The only carrier corpus-wide was `fixtures/metabo-judgment-demo/judgment.json`,
// a loose scene file that belongs to no bundle, so no lesson could reach it.
//
// -004 asked for `sound_claims` on every `spot_the_flaw` fixture. Measured against `graders.ts`,
// that alone changes nothing: without `verdict_deck: true` the grader takes the free-text branch and
// hard-codes `false_positives = 0; sound_total = 0` unless a live LLM AuditJudge is injected, and
// live runs are owner-gated. The offline requirement is all three of
//
//   verdict_deck: true  +  non-empty sound_claims  +  reference_result (grounded)
//
// which is what this file asserts, over every bundle in `fixtures/` rather than one named one — so
// the invariant survives a bundle being renamed, retired or replaced.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Scene } from "@studium/lesson-bundle-schema";
import { grade } from "./index.js";
import { verdictDeck } from "./deck.js";
import type { CritiqueEvaluator } from "../ports.js";
import type { ResponseInput } from "../types.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = resolve(here, "..", "..", "..", "..", "fixtures");

type SpotScene = Extract<Scene, { type: "spot_the_flaw" }>;

/** Every `lesson.json` under fixtures/, with its repo-relative path. */
function bundles(dir: string, out: Array<[string, unknown]> = []): Array<[string, unknown]> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) bundles(p, out);
    else if (entry === "lesson.json") {
      try {
        out.push([relative(FIXTURES, p), JSON.parse(readFileSync(p, "utf8"))]);
      } catch {
        // A bundle that does not parse is m6/demo-atomistique's known quarantine, not this test's
        // subject; bundle_lint owns that one.
      }
    }
  }
  return out;
}

/** Scenes that can produce a false-alarm count with no LLM and feed it to trust calibration. */
function offlineOverDistrustScenes(): Array<[string, SpotScene]> {
  const found: Array<[string, SpotScene]> = [];
  for (const [path, bundle] of bundles(FIXTURES)) {
    const scenes = (bundle as { scenes?: unknown[] }).scenes ?? [];
    for (const s of scenes as SpotScene[]) {
      if (s?.type !== "spot_the_flaw") continue;
      if (s.verdict_deck === true && (s.sound_claims?.length ?? 0) > 0 && s.reference_result != null) {
        found.push([`${path}::${s.id}`, s]);
      }
    }
  }
  return found;
}

/** The scene the three measurement tests below run against. Throws rather than destructuring
 *  `undefined`, so an empty corpus fails as the first test's message, not as a TypeError. */
function firstDeckScene(): [string, SpotScene] {
  const found = offlineOverDistrustScenes();
  if (found.length === 0) throw new Error("fixtures/ carries no grounded verdict deck with sound claims");
  return found[0]!;
}

const evalStub: CritiqueEvaluator = { async evaluate() { return { score: 1, feedback: "" }; } };

/** A learner who catches every planted flaw AND wrongly flags `flagSound` of the sound items. */
function verdicts(scene: SpotScene, flagSound: number) {
  const deck = verdictDeck(scene.claims, scene.sound_claims ?? [], scene.id);
  const out = [
    ...deck.filter((d) => d.flawed).map((d) => ({ token: d.token, flagged: true })),
    ...deck.filter((d) => !d.flawed).slice(0, flagSound).map((d) => ({ token: d.token, flagged: true })),
  ];
  return { kind: "flaw_verdicts", verdicts: out } as Extract<ResponseInput, { kind: "flaw_verdicts" }>;
}

describe("the fixture corpus can measure over-distrust offline (INT-STUDIUM-004)", () => {
  it("at least one lesson bundle carries a grounded verdict deck with sound claims", () => {
    const found = offlineOverDistrustScenes();
    expect(found.map(([id]) => id)).not.toEqual([]);
  });

  it("a wrongly-flagged sound claim in that bundle is COUNTED, with no LLM", async () => {
    const [id, scene] = firstDeckScene();
    const soundTotal = scene.sound_claims!.length;
    const r = await grade(scene, verdicts(scene, 1), { critiqueEvaluator: evalStub });
    expect({ id, ...(r.signal as { judgment_audit?: unknown }).judgment_audit as object }).toMatchObject({
      grounded: true, false_positives: 1, sound_total: soundTotal,
    });
  });

  it("and a clean audit of the same scene reports no false alarm — the count tracks the answer", async () => {
    // Guards against the reading where `false_positives` is 1 for some reason other than the flag:
    // the same scene, the same path, one input difference.
    const [, scene] = firstDeckScene();
    const r = await grade(scene, verdicts(scene, 0), { critiqueEvaluator: evalStub });
    expect(r.signal).toMatchObject({ judgment_audit: { false_positives: 0 } });
  });

  it("the sound claims never reach the deck the learner sees", () => {
    // The deck is the reason this works offline; it is also the reason the answer key is one
    // projection away from the client. Tokens are positional, the labels stay server-side.
    const [, scene] = firstDeckScene();
    const deck = verdictDeck(scene.claims, scene.sound_claims ?? [], scene.id);
    for (const sound of scene.sound_claims!) {
      expect(deck.map((d) => d.token)).not.toContain(sound.id);
    }
  });
});
