// @ts-nocheck — plain JS, the box's own code
/*
 * THE ENGINE — what runs in the asset box (./host.js): three.js and the addons below, the box's second lock, and the
 * one way a recipe is built and handed back. No recipe is in it. It is frozen by version: `scripts/freeze-engine.mjs`
 * bundles this file into static/engines/engine-v<n>.js and writes its BLAKE3 hash into ../engines.json, and a frozen
 * engine never changes (../engines.test.js), so a recipe made for engine 1 builds on engine 1 the same for good. A
 * new capability is a new engine, beside the old ones.
 *
 * What an engine promises a recipe (version 1):
 * - a recipe is a script, handed in as its code and named by the BLAKE3 hash of its bytes (../recipe.js). It calls
 *   `defineRecipe(f)` once, with a function that takes `require` and gives back `{ meta, build }`; `require` hands
 *   out the modules in ./modules.js, and nothing else;
 * - `build` is called with its declared parameters in their order (../params.js), and may give back its object, or a
 *   rig that carries it, at once or in time;
 * - what leaves is plain data (./serialize.js) and the asset's card (../card.js), and nothing else.
 *
 * Messages: { id, op: 'build', recipe: { hash, code }, given?, args?, engine } is answered with
 * { id, ok: true, data, card, ms } or { id, ok: false, error }.
 */
import { load } from './loader.js';
import './lockdown.js';
import './shim.js';
import { cardOf } from '../card.js';
import { buildWith, refOf } from '../refs.js';
import { MODULES } from './modules.js';
import { serialize } from './serialize.js';

const require = (id) => {
	if (!Object.hasOwn(MODULES, id)) throw new Error(`this engine has no module ${String(id).slice(0, 80)}`);
	return MODULES[id];
};

// the last few recipes started, by their hash: building one again needs no new start
const started = new Map();
async function recipeOf({ hash, code }) {
	if (started.has(hash)) return started.get(hash);
	const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
	let made;
	self.defineRecipe = (f) => (made ??= f);
	try {
		load(url);
	} finally {
		URL.revokeObjectURL(url);
		delete self.defineRecipe;
	}
	const recipe = typeof made === 'function' ? made(require) : undefined;
	if (typeof recipe?.build !== 'function' || !recipe.meta || typeof recipe.meta !== 'object') throw new Error('not a recipe: no { meta, build }');
	started.set(hash, recipe);
	if (started.size > 8) started.delete(started.keys().next().value);
	return recipe;
}

const reply = (msg, transfer = []) => self.postMessage([msg, transfer], transfer);

self.onmessage = async (e) => {
	const { id, op, recipe, given, args, engine } = e.data ?? {};
	try {
		if (op !== 'build') throw new Error(`no op ${op}`);
		const t0 = performance.now();
		const { meta, build } = await recipeOf(recipe);
		const t1 = performance.now();
		const obj = await buildWith({ build, params: meta.params, ref: refOf(meta.group, meta.id, meta.version, meta.variant) }, given, args ?? []);
		const t2 = performance.now();
		const card = cardOf(obj, meta, { recipe: recipe.hash, engine });
		const { data, transfer } = await serialize(obj);
		reply({ id, ok: true, data, card, ms: { start: Math.round(t1 - t0), build: Math.round(t2 - t1), serialize: Math.round(performance.now() - t2) } }, transfer);
	} catch (err) {
		reply({ id, ok: false, error: String(err?.message ?? err) });
	}
};
reply({ op: 'ready' });
