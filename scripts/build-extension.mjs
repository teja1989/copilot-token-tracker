#!/usr/bin/env node
// Bundles src/extension.ts into a single CommonJS file for the VS Code extension host.
//
// `vscode` is external — it's provided by the host at runtime and can't be bundled.
// `sql.js` is deliberately NOT external: its JS wrapper is small and bundles fine, and
// bundling it means the packaged extension never needs to ship node_modules/sql.js at
// all. That matters because sql.js's own npm package ships ~23MB of build variants we
// don't need (asm.js fallback, browser builds, web-worker builds, debug builds, zip
// archives) — we only need the one Node/wasm pairing. We copy exactly that one .wasm
// file below and point sql.js at it via the `wasmBinaryPath` param threaded through
// UsageDb (see src/storage/db.ts) — the packaged bundle passes it, dev/test code
// doesn't, and sql.js's own default resolution keeps working there via its real
// node_modules location.
//
// Output is named .cjs explicitly (not .js) because the project root package.json sets
// "type": "module" for the library/test side of things — Node/VS Code would otherwise
// interpret a plain .js file here as ESM and fail on the CommonJS output esbuild writes.

import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

await build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile: 'dist-ext/extension.cjs',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info'
});

// sql.js's package.json declares an "exports" map that doesn't expose "./package.json"
// or "./dist/*" as resolvable subpaths, so `require.resolve` can't be used to locate
// this file — hence the plain relative path. This script only ever runs via `npm run`
// from the repository root, so that's a safe assumption here, not a general one.
mkdirSync('dist-ext', { recursive: true });
const wasmSource = path.join('node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
copyFileSync(wasmSource, 'dist-ext/sql-wasm.wasm');
console.log(`Copied ${wasmSource} -> dist-ext/sql-wasm.wasm`);
