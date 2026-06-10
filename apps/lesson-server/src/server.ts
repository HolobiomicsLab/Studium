// apps/lesson-server/src/server.ts
import Fastify, { type FastifyInstance } from "fastify";
import type { ResponseInput } from "@studium/lesson-session";
import { SessionHost, SessionHostNotFoundError } from "@studium/lesson-session-host";
import { ok, err } from "./envelope.js";
import { CreateSessionBody, RespondBody, TurnBody } from "./schemas.js";

export interface ServerOptions { bundlesRoot: string; live: boolean; }

export function buildServer(opts: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const host = new SessionHost({ bundlesRoot: opts.bundlesRoot, live: opts.live });

  app.setErrorHandler((error, _req, reply) => {
    reply.code(error.statusCode ?? 500).send(err(error.message));
  });

  app.post("/sessions", async (req, reply) => {
    const parsed = CreateSessionBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(err(`invalid body: ${parsed.error.message}`));
    try {
      const { sessionId, presentation } = await host.create(parsed.data.bundle_ref, parsed.data.learner_id);
      return reply.code(201).send(ok({ session_id: sessionId, presentation }));
    } catch (e) {
      return reply.code(400).send(err((e as Error).message)); // bad bundle_ref / load failure
    }
  });

  app.get<{ Params: { id: string } }>("/sessions/:id", async (req, reply) => {
    try { return reply.send(ok({ presentation: host.currentPresentation(req.params.id) })); }
    catch (e) { return reply.code(notFound(e)).send(err((e as Error).message)); }
  });

  app.post<{ Params: { id: string } }>("/sessions/:id/respond", async (req, reply) => {
    const parsed = RespondBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(err(`invalid input: ${parsed.error.message}`));
    try { return reply.send(ok({ transition: await host.respond(req.params.id, parsed.data.input as ResponseInput) })); }
    catch (e) {
      if (e instanceof SessionHostNotFoundError) return reply.code(404).send(err(e.message));
      return reply.code(409).send(err((e as Error).message)); // grading / already-complete
    }
  });

  // Note: the reasoning_signal (if any) is emitted to the telemetry sink, not returned in the HTTP body (spec §11 prose vs v1 impl).
  app.post<{ Params: { id: string } }>("/sessions/:id/turns", async (req, reply) => {
    const parsed = TurnBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(err(`invalid body: ${parsed.error.message}`));
    try { await host.submitTurn(req.params.id, parsed.data.text); return reply.send(ok({ accepted: true })); }
    catch (e) { return reply.code(notFound(e)).send(err((e as Error).message)); }
  });

  app.get<{ Params: { id: string } }>("/sessions/:id/state", async (req, reply) => {
    try { return reply.send(ok({ state: host.getState(req.params.id) })); }
    catch (e) { return reply.code(notFound(e)).send(err((e as Error).message)); }
  });

  app.delete<{ Params: { id: string } }>("/sessions/:id", async (req, reply) => {
    try { await host.forget(req.params.id); return reply.send(ok({ forgotten: true })); }
    catch (e) { return reply.code(notFound(e)).send(err((e as Error).message)); }
  });

  return app;
}

function notFound(e: unknown): number { return e instanceof SessionHostNotFoundError ? 404 : 500; }
