// INT-STUDIUM-004 item 2 — a `discussion` scene a lesson can actually reach.
//
// `session.discussion.test.ts` proves the MECHANISM on a bundle it builds itself, and
// `SceneRouter.test.tsx` renders one. Neither is the claim this file makes: that some lesson a
// learner can be GIVEN carries the type. When it was written, no bundle under `fixtures/` had a
// single `discussion` scene — it was the one scene type with zero corpus coverage.
//
// The sibling `corpus-over-distrust.test.ts` records why a fixture that merely EXISTS is not
// coverage: adding `sound_claims` alone would have produced scenes that look like they close the
// gap while measuring nothing offline. So this file does not assert that a discussion scene is
// present; it DRIVES every one it finds through the real `LessonSession`, and asserts the turn
// channel reaches the scorer and emits the signal. A scene declared but unplayable fails here.
//
// Discovered, not named: a bundle renamed, retired or replaced keeps the invariant.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { LessonBundleSchema } from "@studium/lesson-bundle-schema";
import type { LessonBundle, Scene } from "@studium/lesson-bundle-schema";
import { LessonSession } from "../session.js";
import { buildTestDeps, InMemoryTelemetrySink } from "../testing.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = resolve(here, "..", "..", "..", "..", "fixtures");

type DiscussionScene = Extract<Scene, { type: "discussion" }>;

/** Every `lesson.json` under fixtures/ that PARSES AS A BUNDLE, with its repo-relative path.
 *  Parsed through the real schema: a document this reader accepted but a session would reject
 *  is not a lesson a learner can be given, which is the whole subject here. */
function bundles(dir: string, out: Array<[string, LessonBundle]> = []): Array<[string, LessonBundle]> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) bundles(p, out);
    else if (entry === "lesson.json") {
      const parsed = LessonBundleSchema.safeParse(JSON.parse(readFileSync(p, "utf8")));
      if (parsed.success) out.push([relative(FIXTURES, p), parsed.data]);
      // A bundle that does not parse belongs to `bundle_lint`'s quarantine, not to this test.
    }
  }
  return out;
}

function discussionScenes(): Array<[string, LessonBundle, DiscussionScene]> {
  const found: Array<[string, LessonBundle, DiscussionScene]> = [];
  for (const [path, bundle] of bundles(FIXTURES)) {
    for (const scene of bundle.scenes) {
      if (scene.type === "discussion") found.push([`${path}::${scene.id}`, bundle, scene]);
    }
  }
  return found;
}

const SCENES = discussionScenes();

describe("fixture corpus — the discussion type is reachable from a real lesson", () => {
  it("at least one bundle under fixtures/ carries a discussion scene", () => {
    expect(SCENES.map(([id]) => id)).not.toEqual([]);
  });

  it.each(SCENES.map(([id, bundle, scene]) => [id, bundle, scene] as const))(
    "%s — a learner turn reaches the scorer and emits its signal",
    async (_id, bundle, scene) => {
      const deps = buildTestDeps();
      const session = new LessonSession(bundle, deps);
      await session.start();
      // Advance to the discussion scene through the real path: an ack per preceding scene, so
      // a bundle that cannot be walked as far as its own discussion fails here.
      const index = bundle.scenes.findIndex((s) => s.id === scene.id);
      for (let i = 0; i < index; i++) await session.respond({ kind: "ack" });

      await session.submitTurn(
        "Je ne suis pas d'accord : la fenetre mesuree ne couvre pas le regime tardif.");

      // `submitTurn` is a no-op outside a discussion scene, so an event carrying THIS scene's
      // id is also the proof that the walk above arrived where it meant to.
      const signals = (deps.telemetry as InMemoryTelemetrySink).events
        .filter((e) => e.type === "reasoning_signal");
      expect(signals.length).toBe(1);
      expect(signals[0]).toMatchObject({ scene_id: scene.id, turn_index: 0 });
      // The scene declares which signals it is FOR, and a scene whose targets no scorer can
      // produce would collect turns that count for nothing.
      expect(scene.target_signals.length).toBeGreaterThan(0);
      expect(scene.max_turns).toBeGreaterThan(0);
    });

  it.each(SCENES.map(([id, bundle, scene]) => [id, bundle, scene] as const))(
    "%s — the scene's own turn cap is enforced, not merely declared",
    async (_id, bundle, scene) => {
      const deps = buildTestDeps();
      const session = new LessonSession(bundle, deps);
      await session.start();
      const index = bundle.scenes.findIndex((s) => s.id === scene.id);
      for (let i = 0; i < index; i++) await session.respond({ kind: "ack" });

      for (let i = 0; i < scene.max_turns + 2; i++) await session.submitTurn(`tour ${i}`);
      const signals = (deps.telemetry as InMemoryTelemetrySink).events
        .filter((e) => e.type === "reasoning_signal");
      expect(signals.length).toBe(scene.max_turns);
    });
});
