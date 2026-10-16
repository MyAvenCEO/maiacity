// @ts-nocheck — plain JS, run by node only (scripts/freeze-engine.mjs, the tests)
/*
 * A kernel engine (./engines.js) as one script: its file bundled with everything it imports, as the worker runs it.
 * Only to freeze it: the page boots a frozen one, checked against its hash.
 */
import { fileURLToPath } from 'node:url';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { rolldown } from 'rolldown';

const LIB = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
/** each kernel engine's source */
export const SOURCES = { logic: fileURLToPath(new URL('./logic-engine.js', import.meta.url)) };

/** BLAKE3 of a text, in hex @param {string} text */
export const hashText = (text) => bytesToHex(blake3(utf8ToBytes(text)));

/** engine `kind` as one script @param {keyof typeof SOURCES} kind @returns {Promise<string>} */
export async function bundleKernel(kind) {
	const b = await rolldown({ input: SOURCES[kind], platform: 'browser', resolve: { alias: { $lib: LIB } }, logLevel: 'silent' });
	try {
		const { output } = await b.generate({ format: 'iife', minify: true, codeSplitting: false });
		return output.find((o) => o.type === 'chunk').code;
	} finally {
		await b.close();
	}
}
