// prompt.ts
import type { TutorInput, TutorMove, TutorMoveKind } from "./types.js";

const MOVE_KINDS: readonly TutorMoveKind[] = [
  "invite_test", "acknowledge_extend", "redirect_question",
  "probe_justification", "probe_synthesis", "scaffold_hint",
];

export function buildTutorPrompt(input: TutorInput): string {
  const hist = input.history.map((h) => `${h.role}: ${h.text}`).join("\n");
  return `Tu es un tuteur socratique. Sujet : ${input.topic}
Affirmation de départ : ${input.seedClaim}
Historique :
${hist}
Tour de l'étudiant (signal détecté : ${input.signal}, confiance ${input.confidence.toFixed(2)}) : ${input.learnerTurn}

Réponds par une SEULE relance qui guide sans donner la solution (guidance estompée).
Tu ne révèles JAMAIS la réponse ni l'affirmation de départ. Si l'étudiant est bloqué,
propose le plus petit indice vers l'étape suivante de son raisonnement.
Réponds en JSON STRICT : {"text":"<ta relance>","move_kind":"<un de: ${MOVE_KINDS.join(", ")}>","revealed":false}`;
}

export function parseTutorMove(raw: string): TutorMove | null {
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return null; }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;
  if (typeof o["text"] !== "string") return null;
  if (typeof o["move_kind"] !== "string" || !MOVE_KINDS.includes(o["move_kind"] as TutorMoveKind)) return null;
  if (typeof o["revealed"] !== "boolean") return null;
  return { text: o["text"], move_kind: o["move_kind"] as TutorMoveKind, revealed: o["revealed"] };
}
