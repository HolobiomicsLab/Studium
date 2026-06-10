// apps/lesson-server/src/index.ts
import { buildServer } from "./server.js";

export const SERVER_NAME = "@studium/lesson-server";

export async function main(): Promise<void> {
  const bundlesRoot = process.env["BUNDLES_ROOT"] ?? process.cwd();
  const live = process.env["LITELLM_BASE_URL"] !== undefined && process.env["LITELLM_BASE_URL"] !== "";
  const port = Number(process.env["PORT"] ?? 8010);
  const app = buildServer({ bundlesRoot, live });
  await app.listen({ port, host: "127.0.0.1" });
  // eslint-disable-next-line no-console
  console.log(`lesson-server listening on http://127.0.0.1:${port} (bundlesRoot=${bundlesRoot}, live=${live})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
