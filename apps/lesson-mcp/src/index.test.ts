import { describe, it, expect } from "vitest";
import { MCP_SERVER_NAME, hostFromEnvironment } from "./index.js";

describe("lesson-mcp", () => {
  it("exposes its server name", () => { expect(MCP_SERVER_NAME).toBe("studium-lesson"); });
});

// C6 / D4: the stdio entry point keeps lessons and progress under ~/.studium unless told otherwise.
describe("hostFromEnvironment", () => {
  it("defaults to a durable ~/.studium, the library as bundles root, and the anonymous learner", () => {
    const { host, config, live } = hostFromEnvironment({}, "/home/ada");
    expect(host.persistence()).toEqual({
      durable: true, data_dir: "/home/ada/.studium/data", library_root: "/home/ada/.studium/library", learner_id_default: "anonymous",
    });
    expect(host.bundlesRoot).toBe("/home/ada/.studium/library");
    expect(config.home).toBe("/home/ada/.studium");
    expect(live).toBe(false);
  });

  it("lets explicit variables win, and STUDIUM_EPHEMERAL=1 keep everything in memory", () => {
    const explicit = hostFromEnvironment({
      BUNDLES_ROOT: "/courses", STUDIUM_DATA_DIR: "/var/studium", STUDIUM_LEARNER_ID: "ada", STUDIUM_HOME: "/st",
    }, "/home/ada").host;
    expect(explicit.bundlesRoot).toBe("/courses");
    expect(explicit.persistence()).toEqual({ durable: true, data_dir: "/var/studium", library_root: "/st/library", learner_id_default: "ada" });

    const ephemeral = hostFromEnvironment({ STUDIUM_EPHEMERAL: "1" }, "/home/ada").host.persistence();
    expect(ephemeral).toMatchObject({ durable: false, data_dir: null });
    expect(ephemeral.warning).toMatch(/lost when this server restarts/);
  });
});
