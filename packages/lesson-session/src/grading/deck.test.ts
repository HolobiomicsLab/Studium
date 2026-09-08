import { describe, it, expect, beforeEach } from "vitest";
import { verdictDeck, publicDeck, scoreVerdictDeck, __setDeckSecretForTest } from "./deck.js";

const claims = [{ id: "f1", text: "wrong electron count" }, { id: "f2", text: "paired not parallel" }];
const sound = [{ id: "s1", text: "k is a first-order rate" }, { id: "s2", text: "fit by regression" }];

// Pin the server deck secret so every assertion below is deterministic regardless of the per-process default.
beforeEach(() => __setDeckSecretForTest("deck-test-secret"));

describe("verdictDeck", () => {
  it("is deterministic in scene.id (identical order across calls)", () => {
    expect(verdictDeck(claims, sound, "sceneA")).toEqual(verdictDeck(claims, sound, "sceneA"));
  });

  it("carries every claim + sound item with correct labels and opaque d0..dN tokens", () => {
    const d = verdictDeck(claims, sound, "sceneA");
    expect(d).toHaveLength(4);
    expect(d.map((i) => i.token).sort()).toEqual(["d0", "d1", "d2", "d3"]);
    expect(d.filter((i) => i.flawed).map((i) => i.text).sort()).toEqual(["paired not parallel", "wrong electron count"]);
    expect(d.filter((i) => !i.flawed).map((i) => i.text).sort()).toEqual(["fit by regression", "k is a first-order rate"]);
  });

  it("actually interleaves — flawed items are not always the naive claims-first order", () => {
    const naive = [...claims.map((c) => c.text), ...sound.map((s) => s.text)].join("|");
    const anyShuffled = ["sceneA", "sceneB", "sceneC", "sceneD", "flaw1"].some(
      (id) => verdictDeck(claims, sound, id).map((i) => i.text).join("|") !== naive,
    );
    expect(anyShuffled).toBe(true);
  });
});

describe("publicDeck", () => {
  it("drops the flawed/sound label — client sees only token + text", () => {
    for (const item of publicDeck(verdictDeck(claims, sound, "sceneA"))) {
      expect(Object.keys(item).sort()).toEqual(["text", "token"]);
      expect("flawed" in item).toBe(false);
    }
  });

  it("preserves the server deck order so tokens map back at grade time", () => {
    const server = verdictDeck(claims, sound, "sceneA");
    expect(publicDeck(server).map((i) => i.token)).toEqual(server.map((i) => i.token));
    expect(publicDeck(server).map((i) => i.text)).toEqual(server.map((i) => i.text));
  });
});

describe("scoreVerdictDeck — the confusion matrix from per-token verdicts", () => {
  const flawedTokens = (id: string) => verdictDeck(claims, sound, id).filter((i) => i.flawed).map((i) => i.token);
  const soundTokens = (id: string) => verdictDeck(claims, sound, id).filter((i) => !i.flawed).map((i) => i.token);

  it("flagging exactly the flawed items -> all caught, zero false alarms", () => {
    const v = flawedTokens("sceneA").map((token) => ({ token, flagged: true }));
    const s = scoreVerdictDeck(claims, sound, "sceneA", v);
    expect(s).toMatchObject({ planted: 2, caught: 2, falsePositives: 0, soundTotal: 2 });
    expect(s.accuracy).toBeCloseTo(1, 6);
  });

  it("flagging a SOUND item is a false alarm — over-distrust counted with zero LLM", () => {
    const s = scoreVerdictDeck(claims, sound, "sceneA", [{ token: soundTokens("sceneA")[0]!, flagged: true }]);
    expect(s).toMatchObject({ caught: 0, falsePositives: 1 });
  });

  it("flagging nothing misses every flaw and raises no false alarm", () => {
    expect(scoreVerdictDeck(claims, sound, "sceneA", [])).toMatchObject({ caught: 0, falsePositives: 0 });
  });

  it("ignores unknown tokens", () => {
    expect(scoreVerdictDeck(claims, sound, "sceneA", [{ token: "d999", flagged: true }]).caught).toBe(0);
  });
});

describe("verdictDeck — leak resistance (server secret salt)", () => {
  const manyClaims = Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, text: `flaw ${i}` }));
  const manySound = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, text: `sound ${i}` }));

  it("the server order is NOT what a secret-less client would reconstruct from scene.id", () => {
    __setDeckSecretForTest("SERVER-ONLY-SECRET");
    const server = verdictDeck(manyClaims, manySound, "sceneA").map((i) => (i.flawed ? "F" : "s"));
    __setDeckSecretForTest(""); // a client without the secret can only try scene.id alone
    const publicGuess = verdictDeck(manyClaims, manySound, "sceneA").map((i) => (i.flawed ? "F" : "s"));
    expect(server).not.toEqual(publicGuess);
  });

  it("changing the secret reshuffles the flawed/sound positions", () => {
    __setDeckSecretForTest("secretA");
    const a = verdictDeck(manyClaims, manySound, "sceneA").map((i) => i.flawed);
    __setDeckSecretForTest("secretB");
    const b = verdictDeck(manyClaims, manySound, "sceneA").map((i) => i.flawed);
    expect(a).not.toEqual(b);
  });
});
