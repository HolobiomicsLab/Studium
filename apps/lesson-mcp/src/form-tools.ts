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
import { SessionHost, publicPresentation, publicTransition } from "@studium/lesson-session-host";
import type { ResponseInput } from "@studium/lesson-session";

export const FORM_TOOL_NAMES = ["play_in_forms"] as const;

/** A learner may think for a long time on a form; the SDK's default request timeout is one minute. */
const FORM_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_MAX_STEPS = 20;
const SEPARATOR = "\n\n---\n\n";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
type PublicScene = { id: string; type: string; choices?: Array<{ id: string }> };
type Presentation = { locale?: string; scene: PublicScene; display_markdown?: string };
type Transition = {
  kind: string; presentation?: Presentation; display_markdown?: string;
  verdict?: { correct?: boolean; display_markdown?: string };
};
type Step = { scene_id: string; scene_type: string; correct?: boolean; confidence?: number };
type FormSchema = { type: "object"; properties: Record<string, Record<string, unknown>>; required?: string[] };
type Form = { schema: FormSchema; toInput: (content: Record<string, unknown>) => { input: ResponseInput; confidence?: number } };

const LABELS = {
  fr: {
    choice: "Ton choix", confidence: "Ta confiance, de 0 (au hasard) à 4 (certain) ; facultatif",
    unsupported: "ce client n'affiche pas de formulaires : continuer dans la conversation",
  },
  en: {
    choice: "Your choice", confidence: "Your confidence, from 0 (a guess) to 4 (certain); optional",
    unsupported: "this client does not show forms: go on in the conversation",
  },
};

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

export async function playInForms(server: McpServer, host: SessionHost, sessionId: string, maxSteps: number): Promise<Record<string, unknown>> {
  let presentation: Presentation | undefined = publicPresentation(host.currentPresentation(sessionId)) as Presentation;
  const labels = (presentation.locale ?? "fr").toLowerCase().startsWith("fr") ? LABELS.fr : LABELS.en;
  let screen = presentation.display_markdown ?? "";
  let unseen = ""; // the verdict of the last answer, which no form has shown yet
  const steps: Step[] = [];
  const out = (status: string, reason?: string) => ({
    status, ...(reason ? { reason } : {}), session_id: sessionId, steps,
    ...(presentation ? { presentation } : {}),
    display_markdown: [unseen, screen].filter(Boolean).join(SEPARATOR),
    note: "The learner saw and answered the listed steps in forms: do not show them again. Show display_markdown, " +
      "go on in the conversation, and call play_in_forms again once the scene that needed the conversation is done.",
  });

  if (!server.server.getClientCapabilities()?.elicitation) return out("unsupported", labels.unsupported);

  for (let step = 0; step < maxSteps; step++) {
    const scene: PublicScene = presentation.scene;
    const form = formFor(scene, labels);
    if (!form) return out("needs_conversation", `a ${scene.type} scene takes the learner's own words, in the conversation`);

    let answer;
    try {
      answer = await server.server.elicitInput(
        { mode: "form", message: [unseen, screen].filter(Boolean).join(SEPARATOR), requestedSchema: form.schema },
        { timeout: FORM_TIMEOUT_MS },
      );
    } catch (error) {
      return out("paused", `the form was not shown or not answered: ${(error as Error).message}`);
    }
    if (answer.action !== "accept") {
      unseen = ""; // that form showed it
      return out("paused", answer.action === "decline" ? "declined" : "cancelled");
    }

    let transition: Transition;
    let confidence: number | undefined;
    try {
      const built = form.toInput(answer.content ?? {});
      confidence = built.confidence;
      transition = publicTransition(await host.respond(sessionId, built.input)) as Transition;
    } catch (error) {
      unseen = "";
      return out("needs_conversation", (error as Error).message);
    }
    steps.push({
      scene_id: scene.id, scene_type: scene.type,
      ...(typeof transition.verdict?.correct === "boolean" ? { correct: transition.verdict.correct } : {}),
      ...(confidence === undefined ? {} : { confidence }),
    });
    unseen = transition.verdict?.display_markdown ?? "";
    screen = transition.display_markdown ?? transition.presentation?.display_markdown ?? "";
    presentation = transition.presentation;
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
      "the verdict of an answer opens the next form. It hands back to the conversation when a scene needs written " +
      "words, when the learner declines or closes a form (they want to talk, or a hint), at the end of the lesson, " +
      "or after max_steps. Returns {status: complete | needs_conversation | paused | limit | unsupported, reason?, " +
      "steps[{scene_id, scene_type, correct?, confidence?}], presentation?, display_markdown, note}. Show " +
      "display_markdown, do not replay the listed steps (the learner saw them), and call it again once the " +
      "conversation step is done. Offer it once, on the learner's yes; status unsupported means this client shows " +
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
