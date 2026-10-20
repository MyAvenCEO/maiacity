// @ts-nocheck — plain JS, run by node only (scripts/freeze-engine.mjs, the tests)
/*
 * A kernel engine (./engines.js) as one script: its file bundled with everything it imports, as the frame or worker
 * runs it. Only to freeze it: the page boots a frozen one, checked against its hash.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hashText } from '../../../game/hash.js';
import { LIBS } from '../../../game/code/limits.js';
import { rolldown } from 'rolldown';

const LIB = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** each kernel engine's source */
export const SOURCES = {
	logic: here('./logic-engine.js'),
	math: here('./math-engine.js'),
	view: here('./view/engine.js'),
	'view-worker': here('./view/worker.js'),
	// the libraries a view's script may load, one engine each (game/code/limits.js LIBS)
	...Object.fromEntries(Object.entries(LIBS).map(([name, l]) => [l.engine, here(`./view/libs/${name}.js`)]))
};

/** the npm package each library engine carries, and so its version */
export const PACKAGES = { ...Object.fromEntries(Object.values(LIBS).map((l) => [l.engine, l.package])), logic: 'quickjs-emscripten-core', math: 'katex', 'view-worker': 'linkedom' };
export const versionOf = (kind) => (PACKAGES[kind] ? JSON.parse(readFileSync(`${ROOT}node_modules/${PACKAGES[kind]}/package.json`, 'utf8')).version : undefined);

/** our two fonts, inline in the view engine (./view/theme.js) */
const fonts = {
	name: 'view-fonts',
	resolveId: (id) => (id === 'virtual:view-fonts' ? '\0view-fonts' : undefined),
	load(id) {
		if (id !== '\0view-fonts') return;
		const b64 = (p) => readFileSync(`${ROOT}node_modules/${p}`).toString('base64');
		return `export const DM_SANS = ${JSON.stringify(b64('@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2'))};\nexport const FRAUNCES = ${JSON.stringify(b64('@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2'))};\n`;
	}
};

/** BLAKE3 of a text, in hex (game/hash.js, the one hash) */
export { hashText };

/** engine `kind` as one script @param {keyof typeof SOURCES} kind @returns {Promise<string>} */
export async function bundleKernel(kind) {
	const b = await rolldown({ input: SOURCES[kind], platform: 'browser', resolve: { alias: { $lib: LIB } }, plugins: [fonts], logLevel: 'silent' });
	try {
		const { output } = await b.generate({ format: 'iife', minify: true, codeSplitting: false });
		return output.find((o) => o.type === 'chunk').code;
	} finally {
		await b.close();
	}
}

/**
 * Engine `kind` as it is now, as scripts/freeze-engine.mjs freezes it: its code, and what its entry says it carries
 * (a box engine: three.js and the modules it lends recipes; a library or the math engine: its package's version, KaTeX's
 * for math; the logic engine: QuickJS's). Every kind of the one list, the box's with them (../assets/box/plugin.js
 * bundles it).
 * @param {string} kind @returns {Promise<{ code: string, carries: Record<string, unknown> }>}
 */
export async function bundleOf(kind) {
	if (kind === 'box') {
		const { bundleEngine } = await import('../assets/box/plugin.js');
		const { MODULES } = await import('../assets/box/modules.js');
		const { code } = await bundleEngine();
		const three = JSON.parse(readFileSync(`${ROOT}node_modules/three/package.json`, 'utf8')).version;
		return { code, carries: { three, modules: Object.keys(MODULES) } };
	}
	const code = await bundleKernel(/** @type {keyof typeof SOURCES} */ (kind));
	const v = versionOf(kind);
	return { code, carries: v ? { [kind === 'logic' ? 'quickjs' : 'version']: v } : {} };
}
