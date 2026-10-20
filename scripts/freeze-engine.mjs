#!/usr/bin/env node
// Freezes an engine as its next version: bundles it, and if it is not the latest frozen engine of its kind byte for
// byte, writes its file under static/engines/ and its entry in the one list of frozen engines,
// src/lib/sandbox/engines.json. A frozen engine is never changed or removed: what was made for it runs on it for good
// (src/lib/sandbox/engines.test.js).
//
//   node scripts/freeze-engine.mjs "what the new engine brings"            the asset box's engine (src/lib/assets/box/engine.js):
//                                                                          kind box, static/engines/engine-v<n>.js
//   node scripts/freeze-engine.mjs --logic "what the new engine brings"    a kernel engine (src/lib/sandbox/bundle.js SOURCES):
//                                                                          static/engines/<kind>-v<n>.js
//     kinds: --box (the same as none), --logic (the logic host), --view (the view engine in a view's frame),
//     --view-worker (the worker a view's draw script runs in), --lib-three, --lib-d3, --lib-mcp-apps (the libraries a
//     draw script may import)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LIST = `${ROOT}src/lib/sandbox/engines.json`;

const named = process.argv[2]?.startsWith('--');
const kind = named ? process.argv[2].slice(2) : 'box';
const note = process.argv[named ? 3 : 2] ?? '';

const { SOURCES, bundleOf, hashText } = await import(`${ROOT}src/lib/sandbox/bundle.js`);
if (kind !== 'box' && !SOURCES[kind]) {
	console.error(`no engine of kind ${kind}: one of --box, ${Object.keys(SOURCES).map((k) => `--${k}`).join(', ')}`);
	process.exit(1);
}
const manifest = JSON.parse(readFileSync(LIST, 'utf8'));
const list = (manifest[kind] ??= []);
const { code, carries } = await bundleOf(kind);
const blake3 = hashText(code);
if (list.at(-1)?.blake3 === blake3) {
	console.log(`${kind} engine v${list.at(-1).v} is the engine as it is now (${blake3.slice(0, 16)}…): nothing to freeze`);
	process.exit(0);
}
if (!note) {
	console.error(`say what the new engine brings: node scripts/freeze-engine.mjs${named ? ` --${kind}` : ''} "…"`);
	process.exit(1);
}
const v = (list.at(-1)?.v ?? 0) + 1;
const file = kind === 'box' ? `engine-v${v}.js` : `${kind}-v${v}.js`;
mkdirSync(`${ROOT}static/engines`, { recursive: true });
writeFileSync(`${ROOT}static/engines/${file}`, code);
list.push({ v, date: new Date().toISOString().slice(0, 10), blake3, bytes: Buffer.byteLength(code), ...carries, note });
writeFileSync(LIST, JSON.stringify(manifest, null, '\t') + '\n');
console.log(`froze ${kind} engine v${v}: ${blake3}, ${(Buffer.byteLength(code) / 1024).toFixed(0)} KB`);
