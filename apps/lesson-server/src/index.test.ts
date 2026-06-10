import { describe, it, expect } from "vitest";
import { SERVER_NAME } from "./index.js";

describe("lesson-server", () => {
  it("exposes its name", () => {
    expect(SERVER_NAME).toBe("@studium/lesson-server");
  });
});
