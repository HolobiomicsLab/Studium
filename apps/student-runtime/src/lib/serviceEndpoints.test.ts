/**
 * @vitest-environment jsdom
 *
 * Un seul point de configuration, et un diagnostic qui dit ce qui ne va pas.
 *
 * L'URL du service d'évaluation de critique était un littéral dans le corps de `submit`
 * (`AICritiqueScene.tsx`), et la propriété censée la configurer n'était passée par personne.
 * Ces tests fixent les deux moitiés de la réparation : d'où vient l'URL, et ce que
 * l'apprenant lit quand l'appel échoue.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CRITIQUE_EVAL_ENDPOINT,
  classifyEndpointFailure,
  describeEndpointFailure,
  getCritiqueEvalEndpoint,
  isDefaultCritiqueEvalEndpoint,
} from "./serviceEndpoints";

declare global {
  interface Window {
    __critique_eval_endpoint?: string;
  }
}

afterEach(() => {
  delete window.__critique_eval_endpoint;
});

describe("getCritiqueEvalEndpoint", () => {
  it("retombe sur le défaut de développement quand rien n'est configuré", () => {
    expect(getCritiqueEvalEndpoint()).toBe(DEFAULT_CRITIQUE_EVAL_ENDPOINT);
    expect(getCritiqueEvalEndpoint(null)).toBe(DEFAULT_CRITIQUE_EVAL_ENDPOINT);
    expect(getCritiqueEvalEndpoint(undefined)).toBe(DEFAULT_CRITIQUE_EVAL_ENDPOINT);
  });

  it("préfère la configuration de l'application au défaut", () => {
    expect(getCritiqueEvalEndpoint("http://critique.example/eval")).toBe(
      "http://critique.example/eval",
    );
  });

  it("l'override de test prime sur la configuration — même idiome que la télémétrie", () => {
    window.__critique_eval_endpoint = "http://127.0.0.1:9999/eval";
    expect(getCritiqueEvalEndpoint("http://critique.example/eval")).toBe(
      "http://127.0.0.1:9999/eval",
    );
  });

  it("un override vide n'est pas un override", () => {
    window.__critique_eval_endpoint = "";
    expect(getCritiqueEvalEndpoint("http://critique.example/eval")).toBe(
      "http://critique.example/eval",
    );
  });

  it("sait dire que l'URL utilisée est le défaut, donc que rien n'est configuré", () => {
    expect(isDefaultCritiqueEvalEndpoint(getCritiqueEvalEndpoint())).toBe(true);
    expect(isDefaultCritiqueEvalEndpoint("http://critique.example/eval")).toBe(false);
  });
});

describe("le diagnostic d'accessibilité", () => {
  it("distingue injoignable, erreur HTTP et réponse illisible", () => {
    expect(classifyEndpointFailure(new TypeError("Failed to fetch"))).toBe("unreachable");
    expect(classifyEndpointFailure(new Error("status 502"))).toBe("http_error");
    expect(classifyEndpointFailure(new Error("Unexpected token < in JSON"))).toBe("bad_response");
  });

  it("nomme l'URL tentée — « Failed to fetch » ne la nommait pas", () => {
    const msg = describeEndpointFailure(
      "http://critique.example/eval",
      new TypeError("Failed to fetch"),
    );
    expect(msg).toContain("http://critique.example/eval");
    expect(msg).toContain("injoignable");
  });

  it("dit qu'aucune URL n'est configurée quand c'est le défaut qui a échoué", () => {
    const msg = describeEndpointFailure(
      DEFAULT_CRITIQUE_EVAL_ENDPOINT,
      new TypeError("Failed to fetch"),
    );
    expect(msg).toMatch(/aucune url n'est configurée/i);
  });

  it("ne prétend pas que l'URL est injoignable quand le service a répondu", () => {
    const msg = describeEndpointFailure(DEFAULT_CRITIQUE_EVAL_ENDPOINT, new Error("status 500"));
    expect(msg).not.toMatch(/injoignable/i);
    expect(msg).toContain("status 500");
    expect(msg).not.toMatch(/aucune url n'est configurée/i);
  });
});
