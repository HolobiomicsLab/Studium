import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
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

describe("FileMasteryClaimSink — RGPD erasure (#4)", () => {
  it("erase() removes ONLY this session's flushed .jsonld and leaves other learners' files intact", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mastery-"));
    // a foreign learner's file already living in the shared mastery dir
    await writeFile(join(dir, "urn_studium_mastery-set_L1_other-sess.jsonld"), "{}", "utf8");
    const sink = new FileMasteryClaimSink(dir);
    sink.emit({ "@context": {}, "@id": "urn:studium:mastery-set:L1:my-sess", "@graph": [{ "@type": "asb:Claim" }] } as any);
    await sink.flush();
    expect((await readdir(dir)).sort()).toEqual([
      "urn_studium_mastery-set_L1_my-sess.jsonld",
      "urn_studium_mastery-set_L1_other-sess.jsonld",
    ]);
    await sink.erase();
    // only my file removed; the foreign learner's file survives (no cross-learner data loss)
    expect(await readdir(dir)).toEqual(["urn_studium_mastery-set_L1_other-sess.jsonld"]);
  });
  it("erase() drops the unflushed buffer so a later flush writes nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mastery-"));
    const sink = new FileMasteryClaimSink(dir);
    sink.emit({ "@context": {}, "@id": "urn:studium:mastery-set:L1:buffered", "@graph": [{ "@type": "asb:Claim" }] } as any);
    await sink.erase();          // before any flush
    await sink.flush();          // should be a no-op now
    expect(await readdir(dir).catch(() => [])).toEqual([]);
  });
});
