// Security + caching tests for inlineFileAsset (the get_scene_artifacts text-inline path).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, symlinkSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inlineFileAsset } from "./host.js";
import type { RenderAsset } from "@studium/lesson-bundle-schema";

let root: string;
let baseDir: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "studium-assets-"));
  baseDir = join(root, "bundle");
  mkdirSync(baseDir, { recursive: true });
  writeFileSync(join(baseDir, "mol.xyz"), "3\nwater\nO 0 0 0\n");
  writeFileSync(join(root, "secret.txt"), "TOP SECRET");
  // a symlink INSIDE the bundle that points OUTSIDE it (the attack)
  symlinkSync(join(root, "secret.txt"), join(baseDir, "evil.xyz"));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const asset = (over: Partial<RenderAsset>): RenderAsset => ({ kind: "mol_3d", ...over } as RenderAsset);

describe("inlineFileAsset", () => {
  it("inlines a text asset's file content as payload", () => {
    const r = inlineFileAsset(asset({ path: "mol.xyz" }), baseDir, new Map());
    expect(r.payload).toContain("water");
  });

  it("REFUSES a symlink that escapes the bundle dir (no leak)", () => {
    const r = inlineFileAsset(asset({ path: "evil.xyz" }), baseDir, new Map());
    expect(r.payload).toBeUndefined(); // canonical path is outside baseDir → not inlined
  });

  it("refuses a plain ../ traversal path", () => {
    const r = inlineFileAsset(asset({ path: "../secret.txt" }), baseDir, new Map());
    expect(r.payload).toBeUndefined();
  });

  it("serves from cache on the second call (no re-read)", () => {
    const cache = new Map<string, string>();
    inlineFileAsset(asset({ path: "mol.xyz" }), baseDir, cache);
    expect(cache.size).toBe(1);
    // remove the file; a cache hit must still return the payload
    rmSync(join(baseDir, "mol.xyz"));
    const r2 = inlineFileAsset(asset({ path: "mol.xyz" }), baseDir, cache);
    expect(r2.payload).toContain("water");
    writeFileSync(join(baseDir, "mol.xyz"), "3\nwater\nO 0 0 0\n"); // restore for other tests
  });

  it("leaves non-text-inline kinds (image) untouched", () => {
    const r = inlineFileAsset(asset({ kind: "image", path: "mol.xyz" }), baseDir, new Map());
    expect(r.payload).toBeUndefined();
  });

  it("leaves an asset that already has an inline payload untouched", () => {
    const r = inlineFileAsset(asset({ kind: "spectrum", payload: "{}" }), baseDir, new Map());
    expect(r.payload).toBe("{}");
  });
});
