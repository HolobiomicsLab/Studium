import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it } from "vitest";

it("loads the shared deck module without a Node process global in the learner browser", () => {
  const source = readFileSync(new URL("./deck.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const browser = { exports: {} as Record<string, unknown>, crypto: webcrypto };

  expect(() => runInNewContext(outputText, browser)).not.toThrow();
  expect(typeof browser.exports.verdictDeck).toBe("function");
  expect(typeof browser.exports.publicDeck).toBe("function");
});
