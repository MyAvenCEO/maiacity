// @ts-nocheck — plain JS, run by node only (scripts/freeze-engine.mjs, the tests)
/*
 * A kernel engine (./engines.js) as one script: its file bundled with everything it imports, as the frame or worker
 * runs it. Only to freeze it: the page boots a frozen one, checked against its hash.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hashText } from '../../../game/hash.js';
import { rolldown } from 'rolldown';

const LIB = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** each kernel engine's source */
export const SOURCES = {
	logic: here('./logic-engine.js'),
	view: here('./view/engine.js'),
	'view-worker': here('./view/worker.js'),
	'lib-three': here('./view/libs/three.js'),
	'lib-d3': here('./view/libs/d3.js'),
	'lib-mcp-apps': here('./view/libs/mcp-apps.js')
};

/** the npm package each library engine carries, and so its version */
export const PACKAGES = { 'lib-three': 'three', 'lib-d3': 'd3', 'lib-mcp-apps': '@modelcontextprotocol/ext-apps', logic: 'quickjs-emscripten-core', 'view-worker': 'linkedom' };
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
