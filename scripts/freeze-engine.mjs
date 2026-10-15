#!/usr/bin/env node
// Freezes the asset box's engine (src/lib/assets/box/engine.js) as its next version: bundles it, and if it is not
// the latest frozen engine byte for byte, writes static/engines/engine-v<n>.js and its entry in
// src/lib/assets/engines.json (BLAKE3 hash, size, the three.js in it, the modules it lends a recipe). A frozen engine is
// never changed or removed: recipes made for it build on it for good (src/lib/assets/engines.test.js).
//
//   node scripts/freeze-engine.mjs "what the new engine brings"
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST = `${ROOT}src/lib/assets/engines.json`;

const { bundleEngine, hashText } = await import(`${ROOT}src/lib/assets/box/plugin.js`);
const { MODULES } = await import(`${ROOT}src/lib/assets/box/modules.js`);
const three = JSON.parse(readFileSync(`${ROOT}node_modules/three/package.json`, 'utf8')).version;

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const latest = manifest.engines.at(-1);
const { code } = await bundleEngine();
const blake3 = hashText(code);
if (latest?.blake3 === blake3) {
	console.log(`engine v${latest.v} is the engine as it is now (${blake3.slice(0, 16)}…): nothing to freeze`);
	process.exit(0);
}
const v = (latest?.v ?? 0) + 1;
const note = process.argv[2] ?? '';
if (!note) {
	console.error('say what the new engine brings: node scripts/freeze-engine.mjs "…"');
	process.exit(1);
}
mkdirSync(`${ROOT}static/engines`, { recursive: true });
writeFileSync(`${ROOT}static/engines/engine-v${v}.js`, code);
manifest.engines.push({ v, date: new Date().toISOString().slice(0, 10), blake3, bytes: Buffer.byteLength(code), three, modules: Object.keys(MODULES), note });
writeFileSync(MANIFEST, JSON.stringify(manifest, null, '\t') + '\n');
console.log(`froze engine v${v}: ${blake3}, ${(Buffer.byteLength(code) / 1024).toFixed(0)} KB, three ${three}`);
