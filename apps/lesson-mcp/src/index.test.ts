import { describe, it, expect } from "vitest";
import { MCP_SERVER_NAME } from "./index.js";
describe("lesson-mcp", () => {
  it("exposes its server name", () => { expect(MCP_SERVER_NAME).toBe("studium-lesson"); });
});
