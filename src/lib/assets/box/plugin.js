// @ts-nocheck — plain JS, run by Vite in Node
/*
 * THE BOX'S BUNDLE — `virtual:asset-box` is the asset box's worker (./worker.js) bundled into one script, with three.js,
 * the kit and every group built as one object (../groups.js), as a string. The page hands that string to the box
 * (./host.js), which starts it as a worker inside a frame with no origin: the box can load nothing by itself, so its
 * code has to come in whole. Built on demand with rolldown (what Vite 8 builds with), the same in `vite dev` and in the
 * build; in dev every file it took in is watched, so a changed builder rebuilds it.
 *
 * `virtual:asset-box/engine` is that script's BLAKE3 hash and nothing else: the name of the engine and of every recipe
 * of ours in it, which the page's cache keys what the box built by (../load.js), so a page can find an asset it built
 * before without loading the box's code at all. Both come from one bundle, made again once a file it was made of
 * changes.
 */
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { rolldown } from 'rolldown';

const ID = 'virtual:asset-box';
const ENGINE = 'virtual:asset-box/engine';
const LIB = fileURLToPath(new URL('../../', import.meta.url));
const ENTRY = fileURLToPath(new URL('./worker.js', import.meta.url));

/** the box's worker as one script, and every file it was made of */
export async function bundleBox({ minify = true } = {}) {
	const bundle = await rolldown({
		input: ENTRY,
		platform: 'browser',
		resolve: { alias: { $lib: LIB.replace(/\/$/, '') } },
		logLevel: 'silent'
	});
	try {
		const { output } = await bundle.generate({ format: 'iife', minify, codeSplitting: false });
		const chunk = output.find((o) => o.type === 'chunk');
		return { code: chunk.code, files: chunk.moduleIds.filter((id) => !id.startsWith('\0')) };
	} finally {
		await bundle.close();
	}
}

/** the name of an engine: the BLAKE3 hash of its script, in hex @param {string} code */
export const engineOf = (code) => bytesToHex(blake3(new TextEncoder().encode(code)));

/** when a file was last changed (0 if it is gone) @param {string} f */
const changed = (f) => {
	try {
		return statSync(f).mtimeMs;
	} catch {
		return 0;
	}
};

export function assetBox() {
	/** @type {Promise<{ code: string, files: string[], engine: string, at: number[] }> | null} */
	let built = null;
	// one bundle for both modules, made again when any file it was made of has changed since
	const bundle = async () => {
		const b = built && (await built);
		if (b && b.files.every((f, i) => changed(f) === b.at[i])) return b;
		built = bundleBox().then(({ code, files }) => ({ code, files, engine: engineOf(code), at: files.map(changed) }));
		built.catch(() => (built = null));
		return built;
	};
	return {
		name: 'asset-box',
		resolveId: (/** @type {string} */ id) => (id === ID || id === ENGINE ? '\0' + id : undefined),
		async load(/** @type {string} */ id) {
			if (id !== '\0' + ID && id !== '\0' + ENGINE) return;
			const { code, files, engine } = await bundle();
			for (const f of files) this.addWatchFile(f);
			return `export default ${JSON.stringify(id === '\0' + ID ? code : engine)};`;
		}
	};
}
