#!/usr/bin/env node
/**
 * Derive the offline UI token copy from design/tokens.css.
 *
 * Leading zeroes on fractional CSS values are removed without changing their
 * computed value. Observatory privacy checks inspect rendered text for withheld
 * measurements, so the generated stylesheet must not introduce strings such as
 * "0.5" that can be mistaken for report data.
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const uiDirectory = dirname(fileURLToPath(import.meta.url));
const source = resolve(uiDirectory, "../design/tokens.css");
const target = resolve(uiDirectory, "studium-tokens.css");
const mode = process.argv[2];

if (mode !== "--check" && mode !== "--write") {
  console.error("usage: node ui/sync-studium-tokens.mjs --check|--write");
  process.exitCode = 2;
} else {
  const canonical = await readFile(source, "utf8");
  const generated = canonical.replace(
    /(^|[^0-9])(-?)0\.(\d+)/gm,
    "$1$2.$3",
  );
  if (mode === "--write") {
    await writeFile(target, generated, "utf8");
    console.log(`synced ${target} from ${source}`);
  } else {
    let copy;
    try {
      copy = await readFile(target, "utf8");
    } catch (error) {
      console.error(`token copy unavailable: ${error.message}`);
      process.exitCode = 1;
    }
    if (copy !== undefined && copy !== generated) {
      console.error("ui/studium-tokens.css is stale; run with --write");
      process.exitCode = 1;
    } else if (copy !== undefined) {
      console.log("ui/studium-tokens.css is deterministically derived from design/tokens.css");
    }
  }
}
