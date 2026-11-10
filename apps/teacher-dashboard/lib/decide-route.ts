/**
 * Server side of a moderation decision: the browser posts here (same origin), and this
 * handler calls scene-synth with the teacher review token it alone holds
 * (`STUDIUM_REVIEW_TOKEN`, read from the environment of the dashboard's server). The token
 * never reaches a browser and never appears in a response.
 *
 * The browser sends only what the teacher chose (course, decision, note code, and the name they
 * typed). The decision time is set here, on the server. Learners read the reviewer of an approved
 * contribution, so `approve` needs a name a person typed (`reviewer_name`); `reject` and
 * `request_revision` publish nothing and fall back to the course IRI when no name is given.
 */
import {
  decideLearnerItem,
  ReviewTokenMissingError,
  teacherIriForToken,
  type LADecision,
  type LAReviewNoteCode,
} from "./api";

const DECISIONS: readonly LADecision[] = ["approve", "reject", "request_revision"];
const NOTE_CODES: readonly LAReviewNoteCode[] = ["factual_error", "ambiguous_distractor", "off_topic", "ok"];
const COURSE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** Same bound as scene-synth's MAX_REVIEWER_LENGTH. */
export const MAX_REVIEWER_NAME = 200;
/** True when `text` holds a C0 or C1 control character, DEL included. */
function hasControlCharacter(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** What the browser posts to /api/learner-items/{itemId}/decide. */
export type DecisionRequest = {
  course_id: string;
  decision: LADecision;
  note_code?: LAReviewNoteCode;
  /** The name the teacher typed, as learners will read it; required for `approve`. */
  reviewer_name?: string;
};

/** Why a typed reviewer name is refused, or null when it is usable. Trimmed before the checks. */
export function reviewerNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Décision refusée : saisissez votre nom.";
  if (trimmed.length > MAX_REVIEWER_NAME) return `Décision refusée : le nom dépasse ${MAX_REVIEWER_NAME} caractères.`;
  if (hasControlCharacter(trimmed)) return "Décision refusée : le nom contient un caractère de contrôle.";
  if (trimmed.toLowerCase().startsWith("urn:")) return "Décision refusée : saisissez un nom de personne, pas un identifiant (urn:…).";
  return null;
}

function refusal(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Only this dashboard's own pages may ask for a decision: a cross-origin form or script
 * (the learner app on another port included) is refused before anything else. */
function crossOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return true;
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  try { return new URL(origin).host !== request.headers.get("host"); }
  catch { return true; }
}

function parse(body: unknown): DecisionRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const { course_id: courseId, decision, note_code: noteCode, reviewer_name: name } = body as Record<string, unknown>;
  if (typeof courseId !== "string" || !COURSE_ID.test(courseId)) return null;
  if (!DECISIONS.includes(decision as LADecision)) return null;
  if (noteCode !== undefined && !NOTE_CODES.includes(noteCode as LAReviewNoteCode)) return null;
  if (name !== undefined && typeof name !== "string") return null;
  return {
    course_id: courseId, decision: decision as LADecision, note_code: noteCode as LAReviewNoteCode | undefined,
    reviewer_name: name as string | undefined,
  };
}

export async function handleDecision(
  request: Request,
  itemId: string,
  now: () => string = () => new Date().toISOString(),
): Promise<Response> {
  if (crossOrigin(request)) return refusal(403, "Décision refusée : elle ne peut venir que des pages du tableau de bord.");
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return refusal(415, "Décision refusée : corps JSON attendu.");
  }
  let decision: DecisionRequest | null;
  try { decision = parse(await request.json()); }
  catch { decision = null; }
  if (!decision || !itemId) return refusal(400, "Décision refusée : cours, décision ou motif invalide.");
  const typed = decision.reviewer_name;
  const named = typed !== undefined && typed.trim() !== "";
  if (decision.decision === "approve" || named) {
    const problem = reviewerNameProblem(typed ?? "");
    if (problem) return refusal(400, problem);
  }
  try {
    const item = await decideLearnerItem(decision.course_id, itemId, {
      decision: decision.decision,
      // An approval names the person who typed their name; the other decisions publish nothing.
      reviewer: named ? (typed as string).trim() : teacherIriForToken(decision.course_id),
      reviewed_at: now(),
      note_code: decision.note_code,
    });
    return Response.json(item, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ReviewTokenMissingError) return refusal(503, error.message);
    // serviceFailure messages carry no URL, token or upstream body (lib/api.ts).
    return refusal(502, error instanceof Error ? error.message : "scene-synth n’a pas pu enregistrer la décision.");
  }
}
