// node --test tools/release/registries.test.mjs  (no network: the fetch is a stand-in)
import { test } from "node:test";
import assert from "node:assert/strict";
import { REGISTRIES, hasVersion, statusOf, unlessPresent } from "./registries.mjs";

/** A fetch that answers from a table of [url fragment, status, body]. Records what was asked. */
function fakeFetch(table) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", body: init.body });
    const row = table.find(([fragment]) => String(url).includes(fragment));
    if (!row) throw new Error(`unexpected request: ${url}`);
    const [, status, body] = row;
    return { status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) };
  };
  fn.calls = calls;
  return fn;
}
const marketplace = (versions) => ({ results: [{ extensions: versions === null ? [] : [{ versions: versions.map(([version, flags]) => ({ version, flags })) }] }] });

test("the four registries of a release are known by name", () => {
  // The order a release is sent in: the MCP Registry last, since it checks the npm package.
  assert.deepEqual(Object.keys(REGISTRIES), ["npm", "open-vsx", "marketplace", "mcp-registry"]);
});

test("npm, the MCP Registry and Open VSX: 200 means the version is there, 404 that it is not", async () => {
  for (const registry of ["npm", "mcp-registry", "open-vsx"]) {
    assert.deepEqual(await hasVersion(registry, "0.6.0", fakeFetch([["", 200, {}]])), { present: true, detail: "published" });
    assert.deepEqual(await hasVersion(registry, "9.9.9", fakeFetch([["", 404, {}]])), { present: false, detail: "not published" });
  }
});

test("each registry is asked for the right package and the exact version", async () => {
  const asked = {};
  for (const registry of Object.keys(REGISTRIES)) {
    const fetch = fakeFetch([["marketplace.visualstudio.com", 200, marketplace([["1.2.3", "validated"]])], ["", 200, {}]]);
    await hasVersion(registry, "1.2.3", fetch);
    asked[registry] = fetch.calls[0];
  }
  assert.equal(asked.npm.url, "https://registry.npmjs.org/studium-mcp/1.2.3");
  assert.equal(asked["mcp-registry"].url, "https://registry.modelcontextprotocol.io/v0/servers/io.github.HolobiomicsLab%2Fstudium/versions/1.2.3");
  assert.equal(asked["open-vsx"].url, "https://open-vsx.org/api/holobiomicslab/studium-vscode/1.2.3");
  assert.equal(asked.marketplace.method, "POST");
  assert.match(asked.marketplace.body, /holobiomicslab\.studium-vscode/);
});

test("the Marketplace: a listed version is there; one still being validated says so; an unknown one is absent", async () => {
  const ask = (versions, v) => hasVersion("marketplace", v, fakeFetch([["", 200, marketplace(versions)]]));
  assert.deepEqual(await ask([["0.6.0", "validated"]], "0.6.0"), { present: true, detail: "published" });
  assert.deepEqual(await ask([["0.6.1", "none"], ["0.6.0", "validated"]], "0.6.1"), { present: true, detail: "uploaded, validation in progress" });
  assert.deepEqual(await ask([["0.6.0", "validated"]], "0.6.1"), { present: false, detail: "not published" });
  assert.deepEqual(await ask(null, "0.6.0"), { present: false, detail: "not published" });
});

test("an answer that is neither yes nor no is an error, never read as absent", async () => {
  for (const registry of Object.keys(REGISTRIES)) {
    await assert.rejects(hasVersion(registry, "0.6.0", fakeFetch([["", 503, {}]])), /503/);
  }
  await assert.rejects(hasVersion("pypi", "0.6.0", fakeFetch([])), /unknown registry/);
  // The Marketplace answers 200 to a query: a 200 whose body is not the expected list is no answer either.
  for (const body of [null, {}, { results: "maintenance" }, "<html>"]) {
    await assert.rejects(hasVersion("marketplace", "0.6.0", fakeFetch([["", 200, body]])), /unexpected answer/, JSON.stringify(body));
  }
});

test("statusOf reports the four registries, and an unreachable one without hiding the others", async () => {
  const fetch = fakeFetch([
    ["registry.npmjs.org", 200, {}],
    ["registry.modelcontextprotocol.io", 404, {}],
    ["marketplace.visualstudio.com", 500, {}],
    ["open-vsx.org", 200, {}],
  ]);
  const rows = await statusOf("0.6.0", fetch);
  assert.deepEqual(rows.map((r) => [r.registry, r.present]), [["npm", true], ["open-vsx", true], ["marketplace", null], ["mcp-registry", false]]);
  assert.match(rows[2].detail, /500/);
});

test("unlessPresent sends only a version the registry does not have, and never sends blind", async () => {
  let sent = 0;
  const send = async () => { sent++; };
  assert.deepEqual(await unlessPresent("npm", "0.6.0", send, fakeFetch([["", 200, {}]])), { sent: false, detail: "published" });
  assert.equal(sent, 0, "a version already there is not sent again");
  assert.deepEqual(await unlessPresent("npm", "0.6.1", send, fakeFetch([["", 404, {}]])), { sent: true, detail: "sent" });
  assert.equal(sent, 1);
  await assert.rejects(unlessPresent("npm", "0.6.1", send, fakeFetch([["", 502, {}]])), /502/);
  assert.equal(sent, 1, "no answer from the registry: nothing is sent");
});
