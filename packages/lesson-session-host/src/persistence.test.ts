// packages/lesson-session-host/src/persistence.test.ts
//
// Contract C6 / decision D4: with nothing configured, lessons live in ~/.studium/library and learner
// state in ~/.studium/data, so progress survives a restart by default. Explicit variables win and
// STUDIUM_EPHEMERAL=1 restores the old behaviour (durable only when STUDIUM_DATA_DIR is set).
// The home directory is passed in: these tests never touch the real ~/.studium.
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { resolvePersistence, persistenceInfo } from "./persistence.js";

const HOME = "/home/learner";

describe("resolvePersistence", () => {
  it("defaults to ~/.studium/library and ~/.studium/data with the anonymous learner", () => {
    expect(resolvePersistence({}, HOME)).toEqual({
      home: join(HOME, ".studium"),
      libraryRoot: join(HOME, ".studium", "library"),
      bundlesRoot: join(HOME, ".studium", "library"),
      dataDir: join(HOME, ".studium", "data"),
      learnerIdDefault: "anonymous",
    });
  });

  it("STUDIUM_HOME moves both the library and the data", () => {
    const p = resolvePersistence({ STUDIUM_HOME: "/srv/studium" }, HOME);
    expect(p.libraryRoot).toBe(join("/srv/studium", "library"));
    expect(p.dataDir).toBe(join("/srv/studium", "data"));
  });

  it("explicit BUNDLES_ROOT, STUDIUM_DATA_DIR and STUDIUM_LEARNER_ID win", () => {
    const p = resolvePersistence({
      BUNDLES_ROOT: "/repo/fixtures", STUDIUM_DATA_DIR: "/tmp/data", STUDIUM_LEARNER_ID: "ada",
    }, HOME);
    expect(p.bundlesRoot).toBe("/repo/fixtures");
    expect(p.libraryRoot).toBe(join(HOME, ".studium", "library")); // the library is still searched
    expect(p.dataDir).toBe("/tmp/data");
    expect(p.learnerIdDefault).toBe("ada");
  });

  it("STUDIUM_EPHEMERAL=1 keeps state in memory unless STUDIUM_DATA_DIR names a directory", () => {
    expect(resolvePersistence({ STUDIUM_EPHEMERAL: "1" }, HOME).dataDir).toBeNull();
    expect(resolvePersistence({ STUDIUM_EPHEMERAL: "1", STUDIUM_DATA_DIR: "/tmp/d" }, HOME).dataDir).toBe("/tmp/d");
    // Only an explicit truthy value opts out; an empty or "0" value keeps the durable default.
    expect(resolvePersistence({ STUDIUM_EPHEMERAL: "0" }, HOME).dataDir).toBe(join(HOME, ".studium", "data"));
    expect(resolvePersistence({ STUDIUM_EPHEMERAL: "" }, HOME).dataDir).toBe(join(HOME, ".studium", "data"));
  });

  it("blank variables count as unset (a harness that exports VAR= does not disable a default)", () => {
    const p = resolvePersistence({ BUNDLES_ROOT: "  ", STUDIUM_DATA_DIR: "", STUDIUM_LEARNER_ID: " " }, HOME);
    expect(p.bundlesRoot).toBe(join(HOME, ".studium", "library"));
    expect(p.dataDir).toBe(join(HOME, ".studium", "data"));
    expect(p.learnerIdDefault).toBe("anonymous");
  });
});

describe("persistenceInfo", () => {
  it("reports a durable configuration without a warning", () => {
    expect(persistenceInfo({ dataDir: "/d", libraryRoot: "/l", learnerIdDefault: "ada" })).toEqual({
      durable: true, data_dir: "/d", library_root: "/l", learner_id_default: "ada",
    });
  });

  it("warns, in one sentence, when progress will not survive a restart", () => {
    const info = persistenceInfo({ dataDir: null, libraryRoot: null, learnerIdDefault: "anonymous" });
    expect(info).toMatchObject({ durable: false, data_dir: null, library_root: null, learner_id_default: "anonymous" });
    expect(info.warning).toMatch(/restart/);
  });
});
