import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileMasteryClaimSink } from "./mastery-claim-sink";

describe("FileMasteryClaimSink", () => {
  it("writes each emitted doc to <dir>/<sanitized @id>.jsonld on flush", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mastery-"));
    const sink = new FileMasteryClaimSink(dir);
    const doc = { "@context": { asb: "x" }, "@id": "urn:studium:mastery-set:L1:sess-1", "@graph": [{ "@type": "asb:Claim", id: "c1" }] };
    sink.emit(doc as any);
    await sink.flush();
    const files = await readdir(dir);
    expect(files).toEqual(["urn_studium_mastery-set_L1_sess-1.jsonld"]);
    const written = JSON.parse(await readFile(join(dir, files[0]!), "utf8"));
    expect(written["@graph"][0].id).toBe("c1");
  });
  it("flush with no emitted docs writes nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mastery-"));
    await new FileMasteryClaimSink(dir).flush();
    // dir may not exist or be empty; either is fine
    const files = await readdir(dir).catch(() => []);
    expect(files).toEqual([]);
  });
});
