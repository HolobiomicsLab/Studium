import { defineConfig } from "vitest/config";

const runtime = new URL("./test-support/claude-code-runtime.js", import.meta.url).pathname;

export default defineConfig({
  resolve: {
    alias: [{ find: /^claude-code$/, replacement: runtime }],
  },
  test: {
    include: ["hooks/**/*.spec.ts", "hooks/**/*.spec.tsx"],
    setupFiles: ["./test-support/setup.js"],
  },
});
