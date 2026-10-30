// Types of the lint core of tools/bundle_lint.mjs, a dependency-free JavaScript file without a
// declaration of its own. lint.ts references this file, so every program that compiles lint.ts
// (this package, apps/lesson-mcp) sees these types.
declare module "*/tools/bundle_lint.mjs" {
  export interface LintFinding {
    level: "ERROR" | "WARN" | "INFO";
    code: string;
    message: string;
  }
  export function lintBundleData(
    bundle: unknown,
    options: { bundleDir: string; name?: string },
  ): { findings: LintFinding[]; waiversHit: string[] };
  export function placeholderPaths(value: unknown): string[];
}
