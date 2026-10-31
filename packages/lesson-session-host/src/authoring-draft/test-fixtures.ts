// Shared test data of the authoring-draft tests: a short original French text on Durkheim's two
// solidarities, with typographic apostrophes and no-break spaces as a real source has them.
import type { SourceInput } from "./source-set.js";

export const FRENCH_SOURCE: SourceInput = {
  title: "Deux formes de solidarité",
  url: "https://example.org/solidarite",
  license: "CC-BY-4.0",
  text: [
    "# Deux formes de solidarité",
    "Dans une société où chacun ressemble à son voisin, la cohésion vient de ce que tous partagent les mêmes " +
      "croyances et les mêmes sentiments. On peut appeler mécanique cette solidarité : elle tient les individus " +
      "comme les molécules d’un corps inerte, sans qu’ils aient besoin de se distinguer les uns des autres.",
    "À mesure que le travail se divise, les fonctions se spécialisent et les individus deviennent différents. " +
      "La cohésion change alors de nature : chacun dépend des autres parce qu’il ne fait pas ce qu’ils font. " +
      "Cette solidarité, que l’on dira organique, ressemble à celle des organes d’un être vivant, dont chacun a sa fonction propre.",
    "Le droit permet d’observer ce passage. Là où domine la solidarité mécanique, le droit est surtout répressif : " +
      "il punit ce qui offense la conscience commune. Là où domine la solidarité organique, le droit devient " +
      "restitutif : il remet les choses en l’état et règle les rapports entre fonctions différentes.",
  ].join("\n\n"),
};

/** The ids prepareSources gives the three passages of FRENCH_SOURCE. */
export const P1 = "p:deux-formes-de-solidarite:1";
export const P2 = "p:deux-formes-de-solidarite:2";
export const P3 = "p:deux-formes-de-solidarite:3";
