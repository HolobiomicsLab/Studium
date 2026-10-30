import { LessonPanelLifecycle } from "./panel-lifecycle.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

async function main() {

const failures: string[] = [];
let checks = 0;
function expect(condition: boolean, message: string) {
  checks++;
  if (!condition) failures.push(message);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

// A panel closed while its MCP connection is still opening must close the late connection.
{
  const lifecycle = new LessonPanelLifecycle<{ close: () => void }>();
  const pending = deferred<{ close: () => void }>();
  let closes = 0;
  const connection = lifecycle.connect(() => pending.promise);
  lifecycle.dispose();
  pending.resolve({ close: () => { closes++; } });
  expect(await connection === null, "a connection resolved after disposal is not exposed");
  expect(closes === 1, `a late connection is closed exactly once (got ${closes})`);
}

// Only one learner action may mutate the current scene at a time.
{
  const lifecycle = new LessonPanelLifecycle<{ close: () => void }>();
  const action = deferred<string>();
  const first = lifecycle.runExclusive(() => action.promise);
  const second = await lifecycle.runExclusive(async () => "duplicate");
  expect(second.status === "busy", "a second action is rejected while the first is pending");
  action.resolve("advanced");
  const completed = await first;
  expect(completed.status === "completed" && completed.value === "advanced", "the accepted action completes normally");
  const third = await lifecycle.runExclusive(async () => "next");
  expect(third.status === "completed" && third.value === "next", "the gate reopens after an action settles");
}

// The native reproduction command uses this same gate, rather than a separate boolean.
{
  const here = fileURLToPath(new URL(".", import.meta.url));
  const extension = readFileSync(resolve(here, "extension.ts"), "utf8");
  expect(/runExclusive:\s*<TResult>/.test(extension), "the active lesson exposes its panel lifecycle gate");
  expect(/lesson\.runExclusive\([^]*runReproductionForLesson\(lesson\)/.test(extension), "the full native reproduction flow runs through the panel gate");
}

// Disposal is idempotent and prevents new work.
{
  let closes = 0;
  const lifecycle = new LessonPanelLifecycle<{ close: () => void }>();
  await lifecycle.connect(async () => ({ close: () => { closes++; } }));
  lifecycle.dispose();
  lifecycle.dispose();
  const result = await lifecycle.runExclusive(async () => "should not run");
  expect(closes === 1, `dispose closes an established connection once (got ${closes})`);
  expect(result.status === "disposed", "disposed panels reject new actions");
}

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} panel lifecycle assertions failed:`);
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}
console.log(`OK — panel lifecycle passed all ${checks} assertions.`);
}

main().catch((error) => { console.error(error); process.exit(1); });
