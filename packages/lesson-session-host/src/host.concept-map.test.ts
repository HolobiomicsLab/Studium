// The concept map as the host serves it on fixtures/atomistique-l1, with a labelled synthetic learner
// (test-only key reads). Pins the case measured on 6 Nov 2026: at step 16 get_workflow_graph reported
// the first concept as current and every other as locked.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionHost } from "./host.js";
import { operatorContext } from "./operator-context.js";

const root = resolve(__dirname, "../../../fixtures");
const ref = "atomistique-l1/lesson.json";
const bundle = JSON.parse(readFileSync(`${root}/${ref}`, "utf8")) as {
  scenes: { id: string; choices?: { text: string; correct: boolean }[] }[];
};
const keyOf = (id: string) => bundle.scenes.find((s) => s.id === id)!.choices!.filter((c) => c.correct).map((c) => c.text);

/** Play until `stopAt` is on screen (or the lesson ends), wrong on the first visit of `wrongOn`. */
async function play(stopAt: string | null, wrongOn: string[] = []) {
  const host = new SessionHost({ bundlesRoot: root, live: false });
  const start = await host.create(ref, "auto-test-concept-map");
  const sid = start.sessionId;
  const visits: Record<string, number> = {};
  const transitions = [];
  for (let step = 0; step < 90; step++) {
    const scene = host.currentPresentation(sid).scene as { id: string; type: string; choices?: { id: string; text: string }[] };
    if (scene.id === stopAt) break;
    visits[scene.id] = (visits[scene.id] ?? 0) + 1;
    const wrong = wrongOn.includes(scene.id) && visits[scene.id] === 1;
    const key = scene.type === "quiz" ? keyOf(scene.id) : [];
    const input = scene.type === "quiz"
      ? { kind: "quiz_choice" as const, choiceId: scene.choices!.find((c) => key.includes(c.text) !== wrong)!.id, confidence: 2 }
      : operatorContext(host, sid).response.example;
    const transition = await host.respond(sid, input as never);
    transitions.push({ from: scene.id, transition });
    if (transition.kind === "complete") break;
  }
  return { host, sid, start, transitions };
}

describe("concept map on atomistique-l1", () => {
  it("opens the lesson with the plan: the first concept ahead, the rest upcoming", async () => {
    const { start } = await play("s0-intro");
    expect(start.concept_map?.moment).toBe("start");
    expect(start.concept_map?.nodes.map((n) => n.state)).toEqual(Array(8).fill("upcoming"));
    expect(start.presentation.display_markdown).toContain("**Carte des notions**");
    expect(start.presentation.display_markdown.indexOf("**Carte des notions**"))
      .toBeLessThan(start.presentation.display_markdown.indexOf("### "));
  });

  it("at step 16 says where the learner is, from the session's answers", async () => {
    const { host, sid } = await play("s5-quiz-carbone", ["s2-quiz-4f", "s4-quiz-balmer"]);
    const map = host.conceptMap(sid)!;
    expect(Object.fromEntries(map.nodes.map((n) => [n.id, n.state]))).toEqual({
      "c-particules": "acquired", "c-nombres-quantiques": "acquired", "c-orbitales-formes": "acquired",
      "c-spectres": "to_review", "c-remplissage": "current",
      "c-configuration": "upcoming", "c-periodicite": "upcoming", "c-geometrie": "upcoming",
    });
    expect(map.step).toBe(16);
    expect(map.nodes.find((n) => n.id === "c-nombres-quantiques")!.questions.map((q) => `${q.step}:${q.result}`))
      .toEqual(["6:wrong", "7:correct"]);
    expect(map.nodes.find((n) => n.id === "c-periodicite")!.requires).toEqual(["c-spectres"]);
    expect(map.position).toEqual({ from: "c-spectres", at: "c-remplissage", next: "c-configuration" });
    // Written answers nobody assessed are counted, not listed one by one.
    expect(map.display_markdown).toContain("- Forme des orbitales atomiques (`c-orbitales-formes`) : acquise (Q9 juste, 3 réponses enregistrées)");
    expect(map.display_markdown).toContain("- Particules de l'atome (`c-particules`) : acquise (Q3 juste, Q4 enregistrée)");
  });

  it("shows the map at a detour, its return, a synthesis scene and the end; a line at a new concept", async () => {
    const { transitions } = await play(null, ["s2-quiz-4f"]);
    const moments = transitions.filter((t) => t.transition.concept_map).map((t) => `${t.from}>${t.transition.concept_map!.moment}`);
    expect(moments).toContain("s0-intro>new_concept");
    expect(moments).toContain("s2-quiz-4f>detour");
    expect(moments).toContain("s9-rappel-3d>detour_return");
    expect(moments).toContain("s5-concept-remplissage>synthesis");
    expect(moments.at(-1)).toMatch(/>complete$/);
    // Not on every question: far fewer maps than steps.
    const whole = transitions.filter((t) => t.transition.concept_map?.show === "map").length;
    expect(whole).toBeLessThanOrEqual(8);
    const detour = transitions.find((t) => t.from === "s2-quiz-4f")!.transition;
    expect(detour.display_markdown).toContain("- **Nombres quantiques (`c-nombres-quantiques`) : en cours** (Q6 faux)");
    const opened = transitions.find((t) => t.from === "s0-intro")!.transition;
    expect(opened.display_markdown).toContain("Tu es sur « Particules de l'atome », ensuite « Nombres quantiques ».");
    expect(opened.display_markdown).not.toContain("**Carte des notions**");
    const end = transitions.at(-1)!.transition;
    expect(end.concept_map!.position.at).toBeNull();
    expect(end.concept_map!.nodes.every((n) => n.state !== "current" && n.state !== "upcoming")).toBe(true);
  });
});
