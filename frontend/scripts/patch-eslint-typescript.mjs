/**
 * typescript-eslint v8 requires the TypeScript 6 programmatic API, which
 * TypeScript 7 no longer ships (TS7 is a native Go binary with no JS API).
 *
 * This postinstall script patches TS7's CJS entry point to re-export the
 * full TS6 API from "typescript6" (aliased devDependency → typescript@6.0.3).
 * The native tsc binary is unaffected — it doesn't go through Node.js require.
 *
 * Remove this workaround once typescript-eslint ships TS7 support.
 */
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const nodeModules = resolve(__dirname, "../node_modules");
const ts6Path = resolve(nodeModules, "typescript6");
const ts7VersionCjs = resolve(nodeModules, "typescript/lib/version.cjs");

if (!existsSync(ts6Path) || !existsSync(ts7VersionCjs)) {
  process.exit(0);
}

const original = readFileSync(ts7VersionCjs, "utf8");
if (original.includes("typescript6")) {
  process.exit(0);
}

writeFileSync(
  ts7VersionCjs,
  `// Patched by patch-eslint-typescript.mjs — re-exports TS6 API for eslint compatibility
module.exports = require("typescript6");
`
);
