#!/usr/bin/env node
// tools/release/registries.mjs — is a version on the registries? Read-only: it asks, it never sends.
//
//   node tools/release/registries.mjs status            # the four registries, for the extension's version
//   node tools/release/registries.mjs status 0.6.0
//   node tools/release/registries.mjs has npm 0.6.1     # exit 0 if it is there, 1 if not, 2 if the registry did not say
//   node tools/release/registries.mjs wait npm 0.6.1 --minutes 10   # ask every 20 s until it is there
//   node tools/release/registries.mjs unless npm 0.6.1 -- <command>  # run the command unless it is there
//
// The release workflow sends through `unless` and tools/release/send.sh through `has`, so that a second
// run skips what the first one already sent: a registry refuses a version it already has. When a
// registry gives no answer, nothing is sent.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXTENSION = "holobiomicslab.studium-vscode";

/** The registries a release goes to, in the order it is sent. `request(version)` is what to ask;
 * `read(status, body, version)` turns the answer into { present, detail } or undefined (no answer). */
export const REGISTRIES = {
  npm: {
    label: "npm (studium-mcp)",
    request: (v) => ({ url: `https://registry.npmjs.org/studium-mcp/${v}` }),
  },
  "mcp-registry": {
    label: "MCP Registry (io.github.HolobiomicsLab/studium)",
    request: (v) => ({ url: `https://registry.modelcontextprotocol.io/v0/servers/${encodeURIComponent("io.github.HolobiomicsLab/studium")}/versions/${v}` }),
  },
  marketplace: {
    label: `Visual Studio Marketplace (${EXTENSION})`,
    request: () => ({
      url: "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json;api-version=3.0-preview.1" },
        // filterType 7: by extension name; flags 1: include the versions.
        body: JSON.stringify({ filters: [{ criteria: [{ filterType: 7, value: EXTENSION }] }], flags: 1 }),
      },
    }),
    read: (status, body, v) => {
      if (status !== 200) return undefined;
      const found = (body?.results?.[0]?.extensions?.[0]?.versions ?? []).find((x) => x.version === v);
      if (!found) return { present: false, detail: "not published" };
      return { present: true, detail: found.flags === "validated" ? "published" : "uploaded, validation in progress" };
    },
  },
  "open-vsx": {
    label: `Open VSX (${EXTENSION})`,
    request: (v) => ({ url: `https://open-vsx.org/api/holobiomicslab/studium-vscode/${v}` }),
  },
};

const byStatus = (status) => status === 200 ? { present: true, detail: "published" }
  : status === 404 ? { present: false, detail: "not published" } : undefined;

/** Whether `registry` has `version`: { present, detail }. Throws when the registry gives no answer. */
export async function hasVersion(registry, version, fetchImpl = fetch) {
  const entry = REGISTRIES[registry];
  if (!entry) throw new Error(`unknown registry « ${registry} »: one of ${Object.keys(REGISTRIES).join(", ")}`);
  const { url, init } = entry.request(version);
  const response = await fetchImpl(url, init);
  const answer = entry.read ? entry.read(response.status, await response.json().catch(() => null), version) : byStatus(response.status);
  if (!answer) throw new Error(`${entry.label}: unexpected answer, HTTP ${response.status}`);
  return answer;
}

/** The four registries for `version`. A registry that gives no answer has `present: null`. */
export async function statusOf(version, fetchImpl = fetch) {
  return Promise.all(Object.keys(REGISTRIES).map(async (registry) => {
    try { return { registry, label: REGISTRIES[registry].label, ...(await hasVersion(registry, version, fetchImpl)) }; }
    catch (error) { return { registry, label: REGISTRIES[registry].label, present: null, detail: error.message }; }
  }));
}

/** Run `send` unless `registry` already has `version`. Throws, without sending, when the registry
 * gives no answer. */
export async function unlessPresent(registry, version, send, fetchImpl = fetch) {
  const { present, detail } = await hasVersion(registry, version, fetchImpl);
  if (present) return { sent: false, detail };
  await send();
  return { sent: true, detail: "sent" };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const [command, ...args] = process.argv.slice(2);
  const own = () => JSON.parse(readFileSync(resolve(root, "apps/studium-vscode/package.json"), "utf8")).version;
  try {
    if (command === "status" && args.length <= 1) {
      const version = args[0] ?? own();
      for (const row of await statusOf(version)) {
        console.log(`${row.present === true ? "yes" : row.present === false ? "no " : "?  "}  ${row.label} ${version}: ${row.detail}`);
      }
    } else if (command === "has" && args.length === 2) {
      const { present, detail } = await hasVersion(args[0], args[1]);
      console.log(`${REGISTRIES[args[0]].label} ${args[1]}: ${detail}`);
      process.exit(present ? 0 : 1);
    } else if (command === "wait" && (args.length === 2 || (args.length === 4 && args[2] === "--minutes" && Number(args[3]) > 0))) {
      const until = Date.now() + Number(args[3] ?? 10) * 60_000;
      for (;;) {
        const answer = await hasVersion(args[0], args[1]).catch((error) => ({ present: false, detail: error.message }));
        if (answer.present) { console.log(`${REGISTRIES[args[0]].label} ${args[1]}: ${answer.detail}`); break; }
        if (Date.now() >= until) { console.error(`${REGISTRIES[args[0]].label} ${args[1]}: still ${answer.detail}`); process.exit(1); }
        await new Promise((done) => setTimeout(done, 20_000));
      }
    } else if (command === "unless" && args.length >= 4 && args[2] === "--") {
      const [registry, version, , program, ...rest] = args;
      const { sent, detail } = await unlessPresent(registry, version, async () => {
        const run = spawnSync(program, rest, { stdio: "inherit" });
        if (run.error) throw run.error;
        if (run.status !== 0) { console.error(`${REGISTRIES[registry].label} ${version}: the command ended with status ${run.status}`); process.exit(run.status ?? 1); }
      });
      console.log(`${REGISTRIES[registry].label} ${version}: ${sent ? "sent" : `already ${detail}, skipped`}`);
    } else {
      console.error("usage: registries.mjs status [version] | has <registry> <version> | wait <registry> <version> [--minutes N] | unless <registry> <version> -- <command>");
      process.exit(2);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
