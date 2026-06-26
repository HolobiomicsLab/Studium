/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// The app uses the Next.js "@/*" path alias (tsconfig: "@/*" -> "./*"). Mirror
// it here so lib/* imports resolve under vitest. Per-file jsdom is opted into
// via the `@vitest-environment jsdom` pragma (component tests only); pure
// lib/* tests stay in the default node environment.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    include: ["lib/**/*.test.{ts,tsx}", "app/**/*.test.{ts,tsx}"],
  },
});
