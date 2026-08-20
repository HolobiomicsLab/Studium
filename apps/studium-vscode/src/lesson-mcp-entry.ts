// Bundle entry for the VSIX-embedded lesson-mcp server. index.ts only starts itself behind an
// import.meta main-module guard, which cannot fire inside a CJS bundle — so the bundle calls
// main() unconditionally. Dev mode never uses this file (it runs src/index.ts via tsx).
import { main } from "../../lesson-mcp/src/index.js";

main().catch((e) => { process.stderr.write(`${String(e)}\n`); process.exit(1); });
