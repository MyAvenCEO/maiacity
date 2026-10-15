// @ts-nocheck — plain JS, run by Vite in Node
/*
 * THE BOX'S CODE, MADE — the engine and our recipes, bundled with rolldown (what Vite 8 builds with), the same in
 * `vite dev` and in the build; in dev every file they were made of is watched, so a changed builder makes them again.
 *
 * - The engine (./engine.js) is bundled only to freeze it (`bundleEngine`, scripts/freeze-engine.mjs): the page boots
 *   a frozen one, static/engines/engine-v<n>.js, checked against its hash (../engines.json).
 * - Our recipes: each object group's list (../groups.js) bundled as one library, three.js and its addons left to the
 *   engine (`bundleLibrary`), and one recipe file per asset, version and variant made of it (../engines.js
 *   `recipeFile`), named by its BLAKE3 hash.
 *
 *   virtual:asset-recipes             the index: each recipe's hash, what it builds and takes, the labels at it
 *   virtual:asset-recipes/<group>     that group's library, as text
 *   virtual:asset-recipes/trials      recipes made to do harm (./probe.js), as recipe files, for the box's lab
 *
 * To list a group's recipes and hash them, its library is run here in a context of its own (node:vm), with nothing
 * but three.js and stand-ins for a page: it is our own code, and only its list is read, nothing is built.
 */
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { rolldown } from 'rolldown';
import { LATEST, RECIPE_END, RECIPE_HEAD, recipeTail } from '../engines.js';

const ID = 'virtual:asset-recipes';
const LIB = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const ENGINE = fileURLToPath(new URL('./engine.js', import.meta.url));
const PROBE = fileURLToPath(new URL('./probe.js', import.meta.url));
const RECIPE = fileURLToPath(new URL('../recipe.js', import.meta.url));

/** the object groups (../groups.js), loaded when first asked for, so Vite's config, which loads this file, does not take in what their lists load */
const groups = async () => (await import(/* @vite-ignore */ new URL('../groups.js', import.meta.url).href)).OBJECT_GROUPS;

/** a module of three.js: what a recipe leaves to the engine */
const isThree = (id) => id === 'three' || id.startsWith('three/');

/** a bundle of `input` (a file, or code of its own), and every file it was made of */
async function bundle({ input, code, format, minify, external }) {
	const entry = '\0entry';
	const b = await rolldown({
		input: code ? entry : input,
		platform: 'browser',
		resolve: { alias: { $lib: LIB } },
		external,
		// a module of three.js left to the engine is only there for what is taken from it
		...(external && { treeshake: { moduleSideEffects: (_, isExternal) => !isExternal } }),
		logLevel: 'silent',
		plugins: code ? [{ name: 'entry', resolveId: (id) => (id === entry ? id : undefined), load: (id) => (id === entry ? code : undefined) }] : []
	});
	try {
		const { output } = await b.generate({ format, minify, codeSplitting: false });
		const chunk = output.find((o) => o.type === 'chunk');
		// what the code still requires (a chunk's `imports` also lists what tree shaking took out)
		const imports = [...new Set([...chunk.code.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]))];
		return { code: chunk.code, files: chunk.moduleIds.filter((id) => !id.startsWith('\0')), imports };
	} finally {
		await b.close();
	}
}

/** the engine as one script, three.js in it @returns {Promise<{ code: string, files: string[] }>} */
export const bundleEngine = ({ minify = true } = {}) => bundle({ input: ENGINE, format: 'iife', minify });

/** BLAKE3 of a text, in hex @param {string} text */
export const hashText = (text) => bytesToHex(blake3(utf8ToBytes(text)));

/**
 * A group's library: its list and every builder in it, three.js and its addons left to the engine, as CommonJS (the
 * body of a recipe file, ../engines.js). Refused if it needs a module the latest engine does not have.
 * @param {string} group
 */
export async function bundleLibrary(group, { minify = true } = {}) {
	const g = (await groups())[group];
	const code = `import { ${g.name} as LIST } from ${JSON.stringify(g.module)};
import { recipeIn, recipesIn } from ${JSON.stringify(RECIPE)};
export const recipe = (id, v, variant) => recipeIn(${JSON.stringify(group)}, LIST, id, v, variant);
export const list = () => recipesIn(LIST);
`;
	const out = await bundle({ code, format: 'cjs', minify, external: isThree });
	const missing = out.imports.filter((m) => !LATEST.modules.includes(m));
	if (missing.length) throw new Error(`${group}: its recipes need ${missing.join(', ')}, which engine ${LATEST.v} does not have`);
	return out;
}

/** the recipes made to do harm (./probe.js), each as a recipe file */
async function bundleTrials({ minify = true } = {}) {
	const out = {};
	const files = new Set();
	for (const name of ['probe', 'spin']) {
		const code = `import { ${name}Recipe } from ${JSON.stringify(PROBE)};\nexport const recipe = () => ${name}Recipe();\n`;
		const b = await bundle({ code, format: 'cjs', minify, external: isThree });
		b.files.forEach((f) => files.add(f));
		const text = RECIPE_HEAD + b.code + RECIPE_END;
		out[name] = { hash: hashText(text), code: text };
	}
	return { trials: out, files: [...files] };
}

/** a library run to be listed: stand-ins for a page, enough for a group's modules to load (the same as the tests'), and the engine's modules to require */
async function runLibrary(code) {
	const { MODULES } = await import('./modules.js');
	const noop = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
	const context = vm.createContext({
		console,
		performance,
		setTimeout,
		clearTimeout,
		queueMicrotask,
		structuredClone,
		URL,
		TextEncoder,
		TextDecoder,
		$state: (x) => x,
		document: { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) }
	});
	const module = { exports: {} };
	const require = (id) => {
		if (Object.hasOwn(MODULES, id)) return MODULES[id];
		throw new Error(`a library asked for ${id} while it was listed`);
	};
	vm.runInContext(`(function (require, module, exports) {\n${code}\n})`, context)(require, module, module.exports);
	return module.exports;
}

/** the index of our recipes and each group's library @returns {Promise<{ index: object, libraries: Record<string, string>, files: string[] }>} */
export async function bundleRecipes({ minify = true } = {}) {
	const index = { engine: LATEST.v, recipes: {}, labels: {}, latest: {}, first: {}, libraries: {} };
	const libraries = {};
	const files = new Set();
	for (const group of Object.keys(await groups())) {
		const lib = await bundleLibrary(group, { minify });
		lib.files.forEach((f) => files.add(f));
		libraries[group] = lib.code;
		index.libraries[group] = hashText(lib.code);
		const head = blake3.create().update(utf8ToBytes(RECIPE_HEAD + lib.code));
		const listed = await runLibrary(lib.code);
		for (const { id, v, variant } of listed.list()) {
			const hash = bytesToHex(head.clone().update(utf8ToBytes(recipeTail(id, v, variant))).digest());
			const label = `${group}/${id}@${v}${variant ? `:${variant}` : ''}`;
			const { params } = listed.recipe(id, v, variant).meta;
			index.recipes[hash] = { group, id, v, variant, label, ...(params && { params }) };
			index.labels[label] = hash;
			const name = `${group}/${id}`;
			index.latest[name] = Math.max(index.latest[name] ?? 0, v);
			if (variant) index.first[`${name}@${v}`] ??= variant;
		}
	}
	return { index, libraries, files: [...files] };
}


/** when a file was last changed (0 if it is gone) @param {string} f */
const changed = (f) => {
	try {
		return statSync(f).mtimeMs;
	} catch {
		return 0;
	}
};

/** made once, and again when any file it was made of has changed since */
function memo(make) {
	let made = null;
	return async () => {
		const m = made && (await made);
		if (m && m.files.every((f, i) => changed(f) === m.at[i])) return m;
		made = make().then((x) => ({ ...x, at: x.files.map(changed) }));
		made.catch(() => (made = null));
		return made;
	};
}

export function assetBox() {
	const recipes = memo(() => bundleRecipes());
	const trials = memo(() => bundleTrials());
	return {
		name: 'asset-box',
		resolveId: (id) => (id === ID || id.startsWith(`${ID}/`) ? '\0' + id : undefined),
		async load(id) {
			if (!id.startsWith('\0' + ID)) return;
			const part = id.slice(ID.length + 2);
			const made = part === 'trials' ? await trials() : await recipes();
			for (const f of made.files) this.addWatchFile(f);
			if (part === '') return `export default ${JSON.stringify(made.index)};`;
			if (part === 'trials') return `export default ${JSON.stringify(made.trials)};`;
			if (!(part in made.libraries)) throw new Error(`no recipes of ${part}`);
			return `export default ${JSON.stringify(made.libraries[part])};`;
		}
	};
}
