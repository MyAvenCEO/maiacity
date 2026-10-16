// @ts-nocheck — plain JS, run by Vite in Node
/*
 * THE BOX'S CODE, MADE — the engine and our recipes, bundled with rolldown (what Vite 8 builds with), the same in
 * `vite dev` and in the build; in dev every file they were made of is watched, so a changed builder makes them again.
 *
 * - The engine (./engine.js) is bundled only to freeze it (`bundleEngine`, scripts/freeze-engine.mjs): the page boots
 *   a frozen one, static/engines/engine-v<n>.js, checked against its hash (../engines.json).
 * - Our recipes: each asset of an object group (../groups.js) bundled as a library of its own, made of its group's
 *   list narrowed to it (./narrow.js), so it holds that asset's code and what it shares with others, never another
 *   asset's, with three.js and its addons left to the engine (`bundleAsset`). One recipe file per version and variant
 *   is made of it (../engines.js `recipeFile`), named by its BLAKE3 hash, so the hash moves only when the asset's own
 *   code does.
 *
 *   virtual:asset-recipes                  the index: each recipe's hash, what it builds and takes, the labels at it
 *   virtual:asset-recipes/libraries        how to load each asset's library, by `<group>/<id>`: each its own chunk
 *   virtual:asset-recipes/<group>/<id>     that asset's library, as text, loaded when one of its recipes is built
 *   virtual:asset-recipes/trials           recipes made to do harm (./probe.js), as recipe files, for the box's lab
 *
 * To list a group's recipes and hash them, a library is run here in a context of its own (node:vm), with nothing but
 * three.js and stand-ins for a page: it is our own code, and only its list is read, nothing is built. The group's
 * whole library is run first (`bundleGroup`); each asset's own must list the same recipes of it, each with the same
 * meta, or it is refused. Each is made again only when a file it was made of has changed (or a list it read without
 * bundling it lists other ids), the assets a few at once.
 */
import { statSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { rolldown } from 'rolldown';
import { LATEST, RECIPE_END, RECIPE_HEAD, recipeTail } from '../engines.js';
import { listsKeyOf, narrowTo } from './narrow.js';

const ID = 'virtual:asset-recipes';
const LIB = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const ENGINE = fileURLToPath(new URL('./engine.js', import.meta.url));
const PROBE = fileURLToPath(new URL('./probe.js', import.meta.url));
const RECIPE = fileURLToPath(new URL('../recipe.js', import.meta.url));

/** the object groups (../groups.js), loaded when first asked for, so Vite's config, which loads this file, does not take in what their lists load */
const groups = async () => (await import(/* @vite-ignore */ new URL('../groups.js', import.meta.url).href)).OBJECT_GROUPS;

/** a module of three.js: what a recipe leaves to the engine */
const isThree = (id) => id === 'three' || id.startsWith('three/');

/** a module of ours, which narrowing reads and takes to have no side effects but its exports (./narrow.js) */
const isOurs = (id) => id.startsWith(`${LIB}/`) && !id.includes('/node_modules/');

/** a bundle of `input` (a file, or code of its own), and every file it was made of */
async function bundle({ input, code, format, minify, external, plugins = [], ownSideEffects = true }) {
	const entry = '\0entry';
	let files = [];
	const b = await rolldown({
		input: code ? entry : input,
		platform: 'browser',
		resolve: { alias: { $lib: LIB } },
		external,
		// a module of three.js left to the engine is only there for what is taken from it, and so, in an asset's own
		// library, is a module of ours
		...(external && { treeshake: { moduleSideEffects: (id, isExternal) => !isExternal && (ownSideEffects || !isOurs(id)) } }),
		logLevel: 'silent',
		plugins: [
			...(code ? [{ name: 'entry', resolveId: (id) => (id === entry ? id : undefined), load: (id) => (id === entry ? code : undefined) }] : []),
			...plugins,
			// every module read, the ones tree shaking left out too: a change to any of them may change the bundle
			{ name: 'files', buildEnd() { files = [...this.getModuleIds()].filter((id) => id.startsWith('/')); } }
		]
	});
	try {
		const { output } = await b.generate({ format, minify, codeSplitting: false });
		const chunk = output.find((o) => o.type === 'chunk');
		// what the code still requires (a chunk's `imports` also lists what tree shaking took out)
		const imports = [...new Set([...chunk.code.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]))];
		return { code: chunk.code, files, imports };
	} finally {
		await b.close();
	}
}

/** the engine as one script, three.js in it @returns {Promise<{ code: string, files: string[] }>} */
export const bundleEngine = ({ minify = true } = {}) => bundle({ input: ENGINE, format: 'iife', minify });

/** BLAKE3 of a text, in hex @param {string} text */
export const hashText = (text) => bytesToHex(blake3(utf8ToBytes(text)));

/** the code a library is bundled from: its group's list, and the two functions a recipe file and the listing call */
async function entryOf(group, { ids = false } = {}) {
	const g = (await groups())[group];
	return `import { ${g.name} as LIST } from ${JSON.stringify(g.module)};
import { recipeIn, recipesIn } from ${JSON.stringify(RECIPE)};
export const recipe = (id, v, variant) => recipeIn(${JSON.stringify(group)}, LIST, id, v, variant);
export const list = () => recipesIn(LIST);
${ids ? 'export const ids = () => LIST.map((x) => x.id);\n' : ''}`;
}

/** refused if a library needs a module the latest engine does not have */
function lent(what, out) {
	const missing = out.imports.filter((m) => !LATEST.modules.includes(m));
	if (missing.length) throw new Error(`${what}: its recipes need ${missing.join(', ')}, which engine ${LATEST.v} does not have`);
	return out;
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

/** each recipe a library lists, with what its recipe says of it (`meta`, ../recipe.js) */
const listedIn = (lib) => lib.list().map(({ id, v, variant }) => ({ id, v, variant, meta: lib.recipe(id, v, variant).meta }));

/**
 * A group's whole library, run: every asset's id in its list, and every recipe it lists with its meta. What each
 * asset's own library is checked against, and what tells narrowing which lists are the group's.
 * @param {string} group
 */
export async function bundleGroup(group) {
	const out = lent(group, await bundle({ code: await entryOf(group, { ids: true }), format: 'cjs', minify: false, external: isThree }));
	const lib = await runLibrary(out.code);
	return { files: out.files, ids: lib.ids(), listed: listedIn(lib) };
}

/**
 * One asset's library: its group's list narrowed to it (./narrow.js) and only the code that builds it, three.js and
 * its addons left to the engine, as CommonJS (the body of a recipe file, ../engines.js). Refused if it needs a module
 * the latest engine does not have, or if it lists other recipes than the group's whole library lists of it, or any
 * with another meta.
 * @param {string} group @param {string} id @param {{ ids: string[], listed: object[] }} whole the group's (`bundleGroup`)
 * @param {{ minify?: boolean, plugins?: object[] }} [o] `plugins`, run before narrowing (a test's change to a file)
 */
export async function bundleAsset(group, id, whole, { minify = true, plugins = [] } = {}) {
	const { plugin, consulted } = narrowTo({ id, ids: new Set(whole.ids), ours: isOurs });
	const out = lent(`${group}/${id}`, await bundle({ code: await entryOf(group), format: 'cjs', minify, external: isThree, plugins: [...plugins, plugin], ownSideEffects: false }));
	const listed = listedIn(await runLibrary(out.code));
	const want = whole.listed.filter((r) => r.id === id);
	const said = (rs) => JSON.stringify(rs);
	if (said(listed) !== said(want)) {
		const name = (r) => `${r.id}@${r.v}${r.variant ? `:${r.variant}` : ''}`;
		throw new Error(`${group}/${id}: narrowed to its own code, its library lists ${listed.map(name).join(', ') || 'nothing'} where its group lists ${want.map(name).join(', ')}${listed.length === want.length ? ' (or with another meta)' : ''}`);
	}
	return { code: out.code, files: out.files, consulted: Object.fromEntries(consulted), listed };
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

/** when a file was last changed (0 if it is gone) @param {string} f */
const changed = (f) => {
	try {
		return statSync(f).mtimeMs;
	} catch {
		return 0;
	}
};

/** `f` over `xs`, a few at once (rolldown works on every core; our plugins' hooks wait their turn on this one) */
async function each(xs, f, at = Math.max(2, availableParallelism())) {
	const out = new Array(xs.length);
	let next = 0;
	const run = async () => {
		while (next < xs.length) {
			const i = next++;
			out[i] = await f(xs[i], i);
		}
	};
	await Promise.all(Array.from({ length: Math.min(at, xs.length) }, run));
	return out;
}

// what was made, by group and by asset, kept while every file it was made of is as it was
const wholes = new Map();
const assets = new Map();

/** a module whose lists narrowing read without bundling it: as it was, or changed only where narrowing does not read */
function sameLists(c) {
	const at = changed(c.file);
	if (at === c.at) return true;
	if (listsKeyOf(c.file) !== c.key) return false;
	c.at = at;
	return true;
}

/** whether what was made still stands: each file it was made of as it was, each list it read the same */
const fresh = (m) => m.files.every((f, i) => changed(f) === m.at[i]) && Object.values(m.consulted ?? {}).every(sameLists);

/** a group's whole library run (`bundleGroup`), kept while its files are as they were */
async function groupOf(group) {
	const m = wholes.get(group);
	if (m && fresh(m)) return m;
	const made = await bundleGroup(group);
	const kept = { ...made, at: made.files.map(changed) };
	wholes.set(group, kept);
	return kept;
}

/**
 * An asset's own library (`bundleAsset`), its hash, and BLAKE3's state after the recipe head and the library, so each
 * of its recipes hashes in a moment; kept while its files and the lists it read are as they were and its group lists
 * the same recipes of it.
 */
async function assetOf(group, id, whole) {
	const key = `${group}/${id}`;
	const want = JSON.stringify(whole.listed.filter((r) => r.id === id));
	const m = assets.get(key);
	if (m && m.want === want && fresh(m)) return m;
	const made = await bundleAsset(group, id, whole);
	const consulted = Object.fromEntries(Object.entries(made.consulted).map(([file, k]) => [file, { file, key: k, at: changed(file) }]));
	const kept = { ...made, consulted, want, at: made.files.map(changed), head: blake3.create().update(utf8ToBytes(RECIPE_HEAD + made.code)) };
	assets.set(key, kept);
	return kept;
}

/**
 * The index of our recipes and each asset's library, keyed `<group>/<id>`; `sources`, the files each library was
 * made of, and `files`, every file they were made of or read.
 * @returns {Promise<{ index: object, libraries: Record<string, string>, sources: Record<string, string[]>, files: string[] }>}
 */
export async function bundleRecipes() {
	const index = { engine: LATEST.v, recipes: {}, labels: {}, latest: {}, first: {} };
	const libraries = {};
	const sources = {};
	const files = new Set();
	const names = Object.keys(await groups());
	const runs = await Promise.all(names.map(groupOf));
	// every asset of every group, in its group's order
	const all = names.flatMap((group, g) => [...new Set(runs[g].listed.map((r) => r.id))].map((id) => ({ group, id, whole: runs[g] })));
	const made = await each(all, ({ group, id, whole }) => assetOf(group, id, whole));
	runs.forEach((w) => w.files.forEach((f) => files.add(f)));
	for (const [i, lib] of made.entries()) {
		const { group } = all[i];
		lib.files.forEach((f) => files.add(f));
		Object.keys(lib.consulted).forEach((f) => files.add(f));
		const name = `${group}/${all[i].id}`;
		libraries[name] = lib.code;
		sources[name] = lib.files;
		for (const { id, v, variant, meta } of lib.listed) {
			const hash = bytesToHex(lib.head.clone().update(utf8ToBytes(recipeTail(id, v, variant))).digest());
			const label = `${group}/${id}@${v}${variant ? `:${variant}` : ''}`;
			index.recipes[hash] = { group, id, v, variant, label, ...(meta.params && { params: meta.params }) };
			index.labels[label] = hash;
			index.latest[name] = Math.max(index.latest[name] ?? 0, v);
			if (variant) index.first[`${name}@${v}`] ??= variant;
		}
	}
	return { index, libraries, sources, files: [...files] };
}

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
			if (part === 'libraries') return `export default {\n${Object.keys(made.libraries).map((n) => `\t${JSON.stringify(n)}: () => import(${JSON.stringify(`${ID}/${n}`)})`).join(',\n')}\n};`;
			if (!(part in made.libraries)) throw new Error(`no recipes of ${part}`);
			return `export default ${JSON.stringify(made.libraries[part])};`;
		}
	};
}
