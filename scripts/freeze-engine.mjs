#!/usr/bin/env node
// Freezes an engine as its next version: bundles it, and if it is not the latest frozen engine of its kind byte for
// byte, writes its file under static/engines/ and its entry in its manifest. A frozen engine is never changed or
// removed: what was made for it runs on it for good (src/lib/assets/engines.test.js, src/lib/sandbox/logic.test.js).
//
//   node scripts/freeze-engine.mjs "what the new engine brings"            the asset box's engine (src/lib/assets/box/engine.js):
//                                                                          static/engines/engine-v<n>.js, src/lib/assets/engines.json
//   node scripts/freeze-engine.mjs --logic "what the new engine brings"    the logic host's engine (src/lib/sandbox/logic-engine.js):
//                                                                          static/engines/logic-v<n>.js, src/lib/sandbox/engines.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST = `${ROOT}src/lib/assets/engines.json`;
const KERNEL = `${ROOT}src/lib/sandbox/engines.json`;

if (process.argv[2]?.startsWith('--')) {
	const kind = process.argv[2].slice(2);
	const { SOURCES, bundleKernel, hashText } = await import(`${ROOT}src/lib/sandbox/bundle.js`);
	if (!SOURCES[kind]) {
		console.error(`no engine of kind ${kind}: one of ${Object.keys(SOURCES).map((k) => `--${k}`).join(', ')}`);
		process.exit(1);
	}
	const manifest = JSON.parse(readFileSync(KERNEL, 'utf8'));
	const list = (manifest[kind] ??= []);
	const code = await bundleKernel(kind);
	const blake3 = hashText(code);
	if (list.at(-1)?.blake3 === blake3) {
		console.log(`${kind} engine v${list.at(-1).v} is the engine as it is now (${blake3.slice(0, 16)}…): nothing to freeze`);
		process.exit(0);
	}
	const note = process.argv[3] ?? '';
	if (!note) {
		console.error(`say what the new engine brings: node scripts/freeze-engine.mjs --${kind} "…"`);
		process.exit(1);
	}
	const v = (list.at(-1)?.v ?? 0) + 1;
	const quickjs = JSON.parse(readFileSync(`${ROOT}node_modules/quickjs-emscripten-core/package.json`, 'utf8')).version;
	mkdirSync(`${ROOT}static/engines`, { recursive: true });
	writeFileSync(`${ROOT}static/engines/${kind}-v${v}.js`, code);
	list.push({ v, date: new Date().toISOString().slice(0, 10), blake3, bytes: Buffer.byteLength(code), quickjs, note });
	writeFileSync(KERNEL, JSON.stringify(manifest, null, '\t') + '\n');
	console.log(`froze ${kind} engine v${v}: ${blake3}, ${(Buffer.byteLength(code) / 1024).toFixed(0)} KB`);
	process.exit(0);
}

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
