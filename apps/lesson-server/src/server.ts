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

  // routes added in Tasks 7–8 (respond, turns, state, delete) go here

  return app;
}
