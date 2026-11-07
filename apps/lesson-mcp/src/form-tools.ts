// apps/lesson-mcp/src/form-tools.ts
//
// play_in_forms (prototype, 2026-11-06): the fast lane of a lesson.
//
// Why. The server grades an answer and picks the next screen in a few milliseconds; a learner turn
// relayed by a model takes 5 to 27 s (tools/latency_bench.py), because the model retypes a screen
// the server already holds. For a screen to read and for a keyed question the model has nothing to
// decide. MCP elicitation lets the server ask the learner directly: the client shows a form, the
// learner answers, the server grades and shows the next one. No model turn in between.
//
// What goes into a form: the public screen only (the same display_markdown the conversation would
// show), preceded by the verdict of the answer just given. Nothing a learner must not see before
// answering can leak here, because the form is built from publicPresentation and publicTransition.
//
// A client that declares forms but cannot show one (a headless run) cancels it: the tool then
// answers `paused` and has answered nothing.
//
// When it stops and hands back to the conversation: a scene needs written words (the model relays
// them), the learner declines or closes a form (they want to talk, or a hint), the lesson ends, or
// max_steps is reached. The learner answers every form themself; a form left unanswered answers
// nothing.
//
// What is not established (prototype): how each client draws a long screen, a formula or Markdown in
// an elicitation dialog, and how long it keeps a tool call open while a learner thinks. To be tried
// in real clients before this becomes a default.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ElicitRequestFormParams } from "@modelcontextprotocol/sdk/types.js";
import {
  SessionHost, contestOpenedMarkdown, publicPresentation, publicTransition, replyHintMarkdown,
  type ConceptMap, type ContestClaim,
} from "@studium/lesson-session-host";
import type { ResponseInput } from "@studium/lesson-session";

export const FORM_TOOL_NAMES = ["play_in_forms"] as const;

/** A learner may think for a long time on a form; the SDK's default request timeout is one minute. */
const FORM_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_MAX_STEPS = 20;
const SEPARATOR = "\n\n---\n\n";
/** Forms are rank 2 of the surface ladder (panel-tools.ts negotiateSurface). */
const FORMS_RANK = 2;
/** The screens forms show: the session's book is fed there at rank 2 (prompts.ts), forms being on. */
const IN_FORMS = { promptSurface: { rank: FORMS_RANK, formsAvailable: true } } as const;

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
type PublicScene = { id: string; type: string; choices?: Array<{ id: string }> };
type Presentation = { locale?: string; scene: PublicScene; display_markdown?: string };
type Transition = {
  kind: string; presentation?: Presentation; display_markdown?: string;
  verdict?: { correct?: boolean; display_markdown?: string };
};
type Step =
  | { scene_id: string; scene_type: string; correct?: boolean; confidence?: number }
  | { scene_id: string; scene_type: "map" }
  | { scene_id: string; scene_type: "contest"; concept_id: string; claim: ContestClaim };
/** The SDK's own form shape: a flat object of primitive fields. Typed from the SDK so that `tsc` checks each field. */
type FormSchema = ElicitRequestFormParams["requestedSchema"];
type Form = { schema: FormSchema; toInput: (content: Record<string, unknown>) => { input: ResponseInput; confidence?: number } };
type MapFlow = { kind: "back" | "contest" } | { kind: "stop"; reason: string };

const LABELS = {
  fr: {
    choice: "Ton choix", confidence: "Ta confiance, de 0 (au hasard) à 4 (certain) ; facultatif",
    map: "Voir la carte des notions", mapIntro: "Carte des notions — là où tu en es.",
    contest: "Contester une notion (je la connais déjà / j'ai un doute)",
    claim: "Déclaration : known = je la connais déjà ; unsure = j'ai un doute",
    choiceMissing: "Choisis une réponse, ou ouvre la carte.",
    contestIncomplete: "Choisis une notion et une déclaration pour contester.",
    unsupported: "ce client n'affiche pas de formulaires : continuer dans la conversation",
    // A form takes no spoken words: what the conversation asks to say, the form asks to do.
    continue: "_Valide le formulaire pour continuer._",
    help: "_Pour un indice, une question ou une proposition : refuse ce formulaire et dis-le dans la conversation._",
  },
  en: {
    choice: "Your choice", confidence: "Your confidence, from 0 (a guess) to 4 (certain); optional",
    map: "Show the concept map", mapIntro: "Concept map — where you are.",
    contest: "Contest a concept (I already know it / I doubt it)",
    claim: "Claim: known = I already know it; unsure = I doubt it",
    choiceMissing: "Choose an answer, or open the map.",
    contestIncomplete: "Choose a concept and a claim to contest.",
    unsupported: "this client does not show forms: go on in the conversation",
    continue: "_Submit the form to continue._",
    help: "_For a hint, a question or a proposal: decline this form and say it in the conversation._",
  },
};

/** The text of a form: the verdict not yet shown, the screen with the form's own way to go on in place
 * of « say "continue" », then how to reach what a form cannot do (walkthrough of 7 Nov, finding 3). */
function formMessage(unseen: string, screen: string, scene: PublicScene, locale: "fr" | "en", labels: typeof LABELS.fr): string {
  const spoken = replyHintMarkdown(scene, locale);
  const continueHint = replyHintMarkdown({ type: "concept" }, locale);
  const shown = spoken === continueHint ? screen.replace(spoken, labels.continue) : screen;
  return [unseen, shown, labels.help].filter(Boolean).join(SEPARATOR);
}

/** The form of a scene the server can settle alone, or null when the scene needs the conversation. */
function formFor(scene: PublicScene, labels: typeof LABELS.fr): Form | null {
  if (scene.type === "intro" || scene.type === "concept") {
    // Nothing to fill in: accepting the form is "continue", declining it is "I want to talk".
    return { schema: { type: "object", properties: {} }, toInput: () => ({ input: { kind: "ack" } as ResponseInput }) };
  }
  if (scene.type === "quiz" && scene.choices?.length) {
    const ids = scene.choices.map((choice) => choice.id);
    return {
      schema: {
        type: "object",
        properties: {
          choice: { type: "string", title: labels.choice, enum: ids },
          confidence: { type: "integer", title: labels.confidence, minimum: 0, maximum: 4 },
        },
        required: ["choice"],
      },
      toInput: (content) => {
        const choiceId = String(content.choice);
        if (!ids.includes(choiceId)) throw new Error(`choice must be one of ${ids.join(", ")}`);
        const confidence = Number.isInteger(content.confidence) && Number(content.confidence) >= 0 && Number(content.confidence) <= 4
          ? Number(content.confidence) : undefined;
        return {
          input: { kind: "quiz_choice", choiceId, ...(confidence === undefined ? {} : { confidence }) } as ResponseInput,
          ...(confidence === undefined ? {} : { confidence }),
        };
      },
    };
  }
  return null;
}

/** Add the map switch to a scene form. Required answer fields are omitted because `map: true` alone
 * must be valid; `toInput` still validates an answer when the learner does not open the map. */
function withMap(form: Form, labels: typeof LABELS.fr): Form {
  return {
    ...form,
    schema: {
      type: "object",
      properties: { ...form.schema.properties, map: { type: "boolean", title: labels.map } },
    },
  };
}

function mapSchema(map: ConceptMap, labels: typeof LABELS.fr): FormSchema {
  const contestable = map.nodes.filter((node) => node.state !== "upcoming").map((node) => node.id);
  // An upcoming concept takes no claim until the session has shown it. With none contestable, the
  // map form carries no fields and only returns to the scene.
  if (contestable.length === 0) return { type: "object", properties: {} };
  return {
    type: "object",
    properties: {
      contest_concept: { type: "string", title: labels.contest, enum: contestable },
      claim: { type: "string", title: labels.claim, enum: ["known", "unsure"] },
    },
  };
}

/** The map's own heading and the same Markdown list as the conversation. A refusal, when present,
 * is the first line and is shown once before the map form is offered again. */
function mapMessage(prefix: string, map: ConceptMap, labels: typeof LABELS.fr): string {
  return [prefix, labels.mapIntro, map.display_markdown].filter(Boolean).join(SEPARATOR);
}

export async function playInForms(server: McpServer, host: SessionHost, sessionId: string, maxSteps: number): Promise<Record<string, unknown>> {
  // A client that shows no forms gets this screen back in the conversation, which is where it is read.
  const forms = Boolean(server.server.getClientCapabilities()?.elicitation);
  const firstOn = forms ? IN_FORMS : { promptSurface: { rank: 1, formsAvailable: false } } as const;
  let presentation: Presentation | undefined = publicPresentation(host.currentPresentation(sessionId, firstOn)) as Presentation;
  const locale = (presentation.locale ?? "fr").toLowerCase().startsWith("fr") ? "fr" : "en";
  const labels = LABELS[locale];
  let screen = presentation.display_markdown ?? "";
  let unseen = ""; // the verdict of the last answer, which no form has shown yet
  const steps: Step[] = [];
  const out = (status: string, reason?: string) => ({
    status, ...(reason ? { reason } : {}), session_id: sessionId, steps,
    ...(presentation ? { presentation } : {}),
    display_markdown: [unseen, screen].filter(Boolean).join(SEPARATOR),
    note: "The learner saw and answered the listed steps in forms: do not show them again. Show display_markdown, " +
      "go on in the conversation, and call play_in_forms again once the scene that needed the conversation is done. " +
      "The brief of these acts is in brief: do not call get_companion_brief for them.",
    ...(status === "unsupported" ? {} : { brief: host.companionBrief(sessionId) }),
  });

  if (!forms) return out("unsupported", labels.unsupported);

  /** Open one map and keep its form open until the learner returns empty, starts a contest, or
   * declines it. Re-showing after a refusal is still the same opening and logs no second openMap. */
  const openMap = async (sceneId: string, firstLine = ""): Promise<MapFlow> => {
    if (!host.conceptMap(sessionId)) return { kind: "back" };
    const settledMap = await host.settleAct(
      sessionId,
      { act: "openMap", lane: "fast", surfaceRank: FORMS_RANK },
      () => host.conceptMap(sessionId),
    );
    if (!settledMap) return { kind: "back" };
    const map = settledMap;
    steps.push({ scene_id: sceneId, scene_type: "map" });
    let prefix = firstLine;

    for (;;) {
      let answer;
      try {
        answer = await server.server.elicitInput(
          { mode: "form", message: mapMessage(prefix, map, labels), requestedSchema: mapSchema(map, labels) },
          { timeout: FORM_TIMEOUT_MS },
        );
      } catch (error) {
        return { kind: "stop", reason: `the form was not shown or not answered: ${(error as Error).message}` };
      }
      if (answer.action !== "accept") {
        unseen = "";
        return { kind: "stop", reason: answer.action === "decline" ? "declined" : "cancelled" };
      }

      const content = answer.content ?? {};
      const conceptId = typeof content.contest_concept === "string" ? content.contest_concept : undefined;
      const claim = content.claim === "known" || content.claim === "unsure" ? content.claim : undefined;
      if (content.contest_concept === undefined && content.claim === undefined) return { kind: "back" };
      if (conceptId === undefined || claim === undefined) {
        prefix = labels.contestIncomplete;
        continue;
      }

      const title = map.nodes.find((node) => node.id === conceptId)?.title ?? conceptId;
      try {
        const started = await host.settleAct(
          sessionId,
          { act: "contest", lane: "fast", surfaceRank: FORMS_RANK },
          () => host.contest(sessionId, conceptId, claim, "fast"),
        );
        steps.push({ scene_id: sceneId, scene_type: "contest", concept_id: conceptId, claim });
        const contestedPresentation = host.currentPresentation(sessionId, IN_FORMS);
        if (!contestedPresentation) return { kind: "back" };
        presentation = publicPresentation(contestedPresentation) as Presentation;
        screen = contestedPresentation.display_markdown ?? presentation.display_markdown ?? "";
        unseen = contestOpenedMarkdown(title, started.questions, locale);
        return { kind: "contest" };
      } catch (error) {
        prefix = (error as Error).message.split(/\r?\n/, 1)[0] ?? labels.contestIncomplete;
      }
    }
  };

  let settledSteps = 0;
  while (settledSteps < maxSteps) {
    const scene: PublicScene = presentation.scene;
    const baseForm = formFor(scene, labels);
    if (!baseForm) return out("needs_conversation", `a ${scene.type} scene takes the learner's own words, in the conversation`);
    const mapAvailable = host.conceptMap(sessionId) !== null;
    const form = mapAvailable ? withMap(baseForm, labels) : baseForm;

    let answer;
    try {
      answer = await server.server.elicitInput(
        { mode: "form", message: formMessage(unseen, screen, scene, locale, labels), requestedSchema: form.schema },
        { timeout: FORM_TIMEOUT_MS },
      );
    } catch (error) {
      return out("paused", `the form was not shown or not answered: ${(error as Error).message}`);
    }
    if (answer.action !== "accept") {
      unseen = ""; // that form showed it
      return out("paused", answer.action === "decline" ? "declined" : "cancelled");
    }

    const content = answer.content ?? {};
    const wantsMap = mapAvailable && content.map === true;
    if (scene.type === "quiz" && !wantsMap && content.choice === undefined) {
      unseen = labels.choiceMissing;
      continue;
    }
    // Intro/concept forms have no separate answer control: selecting their map leaves them untouched.
    // A quiz can carry both a choice and map:true; its answer is settled before the refreshed map opens.
    const answersScene = !wantsMap || (scene.type === "quiz" && content.choice !== undefined);
    if (!answersScene) {
      unseen = ""; // the scene form just showed any pending verdict
      const flow = await openMap(scene.id);
      if (flow.kind === "stop") return out("paused", flow.reason);
      continue;
    }

    let transition: Transition;
    let confidence: number | undefined;
    try {
      const built = form.toInput(content);
      confidence = built.confidence;
      // Timed around the server's answer only, never the learner's time on the form.
      const served = await host.settleAct(sessionId, { act: "respond", lane: "fast", surfaceRank: FORMS_RANK }, () => host.respond(sessionId, built.input, "fast", IN_FORMS));
      transition = publicTransition(served) as Transition;
    } catch (error) {
      unseen = "";
      return out("needs_conversation", (error as Error).message);
    }
    settledSteps++;
    steps.push({
      scene_id: scene.id, scene_type: scene.type,
      ...(typeof transition.verdict?.correct === "boolean" ? { correct: transition.verdict.correct } : {}),
      ...(confidence === undefined ? {} : { confidence }),
    });
    unseen = transition.verdict?.display_markdown ?? "";
    screen = transition.display_markdown ?? transition.presentation?.display_markdown ?? "";
    presentation = transition.presentation;
    if (wantsMap) {
      // The answer's verdict has not appeared on a form yet: show it once above the refreshed map.
      const firstLine = unseen;
      unseen = "";
      const flow = await openMap(presentation?.scene.id ?? scene.id, firstLine);
      if (flow.kind === "stop") return out("paused", flow.reason);
      if (flow.kind === "contest") {
        if (!presentation) return out("complete");
        continue;
      }
    }
    if (transition.kind === "complete" || !presentation) {
      presentation = undefined;
      return out("complete");
    }
  }
  return out("limit", `stopped after ${maxSteps} forms`);
}

/** Register the form tools on the MCP server; returns their names. MCP-only: a form needs the client. */
export function registerFormTools(server: McpServer, host: SessionHost): string[] {
  server.registerTool("play_in_forms", {
    description: "Play the next scenes of a session in forms the client shows to the learner (MCP elicitation), " +
      "with no model turn between an answer and its verdict (a prototype). A screen to read is acknowledged; a quiz " +
      "is answered with a displayed choice and an optional confidence. Each form carries the public screen only, and " +
      "the verdict of an answer opens the next form. When a concept map exists, every scene form offers map:true; its " +
      "map form accepts contest_concept:<concept id> with claim:known|unsure, or accepts empty to return to the scene. " +
      "A contest asks its check questions in forms and then resumes the scene. It hands back to the conversation when a scene needs written " +
      "words, when the learner declines or closes a form (they want to talk, or a hint), at the end of the lesson, " +
      "or after max_steps. Returns {status: complete | needs_conversation | paused | limit | unsupported, reason?, " +
      "steps[{scene_id, scene_type, correct?, confidence?} | {scene_id, scene_type:\"map\"} | " +
      "{scene_id, scene_type:\"contest\", concept_id, claim}], presentation?, display_markdown, note, brief?}. Show " +
      "display_markdown, do not replay the listed steps (the learner saw them), and call it again once the " +
      "conversation step is done. Every hand-back except unsupported carries brief, the get_companion_brief object " +
      "with its cursor moved: do not call get_companion_brief for these acts. Offer it once, on the learner's yes; status unsupported means this client shows " +
      "no forms: relay in the conversation.",
    inputSchema: {
      session_id: z.string(),
      max_steps: z.number().int().min(1).max(40).optional().describe(`forms to show at most; default ${DEFAULT_MAX_STEPS}`),
    },
  }, async ({ session_id, max_steps }): Promise<ToolResult> => {
    try {
      const result = await playInForms(server, host, session_id, max_steps ?? DEFAULT_MAX_STEPS);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
      return { content: [{ type: "text", text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
    }
  });
  return [...FORM_TOOL_NAMES];
}
