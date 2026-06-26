import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// JSX is compiled via esbuild's automatic runtime so component render tests
// (renderToStaticMarkup) work without a separate Babel/SWC step. The api.test
// stays node-env via its @vitest-environment docblock.
export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    // Mirror tsconfig's "@/*" -> app root alias so component tests can import
    // "@/lib/api" the same way Next does.
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    // tests/integration/*.spec.ts are Playwright e2e specs (run via
    // `pnpm test:e2e`); Vitest must not collect them — Playwright's
    // test.describe() throws when invoked under a non-Playwright runner.
    exclude: ["**/node_modules/**", "**/tests/integration/**"],
  },
});
