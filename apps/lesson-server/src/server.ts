// apps/lesson-server/src/server.ts
import Fastify, { type FastifyInstance } from "fastify";
import { LessonSession, enrichEvent, bundleVersionOf, type ResponseInput } from "@studium/lesson-session";
import { randomUUID } from "node:crypto";
import { ok, err } from "./envelope.js";
import { resolveBundle } from "./bundle-resolver.js";
import { buildServerDeps } from "./server-deps.js";
import { SessionRegistry } from "./registry.js";
import { CreateSessionBody, RespondBody, TurnBody } from "./schemas.js";

export interface ServerOptions { bundlesRoot: string; live: boolean; }

export function buildServer(opts: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const registry = new SessionRegistry();

  app.setErrorHandler((error, _req, reply) => {
    reply.code(error.statusCode ?? 500).send(err(error.message));
  });

  app.post("/sessions", async (req, reply) => {
    const parsed = CreateSessionBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(err(`invalid body: ${parsed.error.message}`));
    let bundle;
    try { bundle = await resolveBundle(opts.bundlesRoot, parsed.data.bundle_ref); }
    catch (e) { return reply.code(400).send(err((e as Error).message)); }
    const deps = buildServerDeps(opts.live);
    const session = new LessonSession(bundle, deps);
    const presentation = await session.start();
    const session_id = randomUUID();
    registry.create(session_id, { session, deps, bundle });
    return reply.code(201).send(ok({ session_id, presentation }));
  });

  app.get<{ Params: { id: string } }>("/sessions/:id", async (req, reply) => {
    const entry = registry.get(req.params.id);
    if (!entry) return reply.code(404).send(err("session not found"));
    return reply.send(ok({ presentation: entry.session.currentPresentation() }));
  });

  app.post<{ Params: { id: string } }>("/sessions/:id/respond", async (req, reply) => {
    const entry = registry.get(req.params.id);
    if (!entry) return reply.code(404).send(err("session not found"));
    const parsed = RespondBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(err(`invalid input: ${parsed.error.message}`));
    try {
      const transition = await entry.session.respond(parsed.data.input as ResponseInput);
      return reply.send(ok({ transition }));
    } catch (e) {
      return reply.code(409).send(err((e as Error).message)); // SceneGradingError / AlreadyComplete
    }
  });

  // Note: the reasoning_signal (if any) is emitted to the telemetry sink, not returned in the HTTP body (spec §11 prose vs v1 impl).
  app.post<{ Params: { id: string } }>("/sessions/:id/turns", async (req, reply) => {
    const entry = registry.get(req.params.id);
    if (!entry) return reply.code(404).send(err("session not found"));
    const parsed = TurnBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(err(`invalid body: ${parsed.error.message}`));
    await entry.session.submitTurn(parsed.data.text);
    return reply.send(ok({ accepted: true }));
  });

  app.get<{ Params: { id: string } }>("/sessions/:id/state", async (req, reply) => {
    const entry = registry.get(req.params.id);
    if (!entry) return reply.code(404).send(err("session not found"));
    return reply.send(ok({ state: entry.session.getState() }));
  });

  app.delete<{ Params: { id: string } }>("/sessions/:id", async (req, reply) => {
    const entry = registry.get(req.params.id);
    if (!entry) return reply.code(404).send(err("session not found"));
    // right-to-be-forgotten hook: emit forget_requested, then drop the session's state.
    const lessonId = entry.session.getState().lesson_id;
    const pseudonym = await entry.deps.pseudonym.get(lessonId);
    entry.deps.telemetry.emit(
      enrichEvent(
        { type: "forget_requested" },
        { learnerPseudonym: pseudonym, lessonId, bundleVersion: bundleVersionOf(entry.bundle) },
        entry.deps.clock, entry.deps.idGen,
      ),
    );
    await entry.deps.telemetry.flush();
    registry.delete(req.params.id);
    return reply.send(ok({ forgotten: true }));
  });

  return app;
}
