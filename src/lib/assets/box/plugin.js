// @ts-nocheck — plain JS, run by Vite in Node
/*
 * THE BOX'S BUNDLE — `virtual:asset-box` is the asset box's worker (./worker.js) bundled into one script, with three.js,
 * the kit and every group built as one object (../groups.js), as a string. The page hands that string to the box
 * (./host.js), which starts it as a worker inside a frame with no origin: the box can load nothing by itself, so its
 * code has to come in whole. Built on demand with rolldown (what Vite 8 builds with), the same in `vite dev` and in the
 * build; in dev every file it took in is watched, so a changed builder rebuilds it.
 */
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

const ID = 'virtual:asset-box';
const RESOLVED = '\0' + ID;
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

export function assetBox() {
	return {
		name: 'asset-box',
		resolveId: (id) => (id === ID ? RESOLVED : undefined),
		async load(id) {
			if (id !== RESOLVED) return;
			const { code, files } = await bundleBox();
			for (const f of files) this.addWatchFile(f);
			return `export default ${JSON.stringify(code)};`;
		}
	};
}
