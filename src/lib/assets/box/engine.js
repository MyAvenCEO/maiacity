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
 * Version 3 adds: the controls a built object offers (a tent's pitch, a pickup's doors, a sealed asset's explode and
 * build: the functions ./bake.js knows on its userData) are played in the box from 0 to 1 and leave as numbers, with
 * the object as built put back first (format 2).
 *
 * Version 4 adds: what a viewer needs of a build (./view.js, format 3: its parts, labels, shells, cut, its solver's
 * readings and moves, an actor's clips and poses), a skinned actor with its skin, so it bends in the page as it does
 * here, and builds kept running (./live.js): a viewer asks for one (`live`), ticks it frame by frame (`tick`: its
 * sliders, controls, clip or pose set, one step run, what moved handed back as numbers), breaks or mends it, and lets
 * it go (`end`). A rig's catalog (the LifeTrac's parts) goes on its card as a sealed asset's does.
 *
 * Messages: { id, op: 'build', recipe: { hash, code }, given?, args?, engine } is answered with
 * { id, ok: true, data, card, ms } or { id, ok: false, error }; { id, op: 'live', recipe, given?, nodes } with
 * { id, ok: true, session, nodes }; { id, op: 'tick', session, ask } with { id, ok: true, nodes, trs, visible, morph,
 * instances, read?, labels?, sliders? }; { id, op: 'break' | 'mend' | 'end', session } with { id, ok: true }.
 */
import { load } from './loader.js';
import './lockdown.js';
import './shim.js';
import { cardOf } from '../card.js';
import { buildWith, refOf } from '../refs.js';
import { bake } from './bake.js';
import * as live from './live.js';
import { MODULES } from './modules.js';
import { serialize } from './serialize.js';
import { catalogOf, viewOf } from './view.js';

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

/**
 * A recipe's build, and the rig it came in if it came in one (its clips, its poses, a machine's catalog), which
 * ../refs.js `buildWith` leaves behind as it hands back the object.
 */
async function made(recipe, given, args) {
	const { meta, build } = await recipeOf(recipe);
	let cast = null;
	const keep = async (...a) => {
		const m = await build(...a);
		cast = m && !m.isObject3D && m.rig?.object?.isObject3D ? m : null;
		return m;
	};
	const obj = await buildWith({ build: keep, params: meta.params, ref: refOf(meta.group, meta.id, meta.version, meta.variant) }, given, args ?? []);
	// a rigged machine's catalog, on its object as a sealed asset's is, so its card lists its parts
	if (cast?.catalog && !obj.userData.catalog) obj.userData.catalog = catalogOf(cast.catalog);
	return { meta, obj, cast };
}

async function buildOne({ recipe, given, args, engine }) {
	const t0 = performance.now();
	await recipeOf(recipe);
	const t1 = performance.now();
	let { meta, obj, cast } = await made(recipe, given, args);
	const t2 = performance.now();
	const card = cardOf(obj, meta, { recipe: recipe.hash, engine });
	let baked;
	try {
		baked = bake(obj);
	} catch {
		// a control that broke midway left the object as it was then: it leaves with none, as built a second time
		baked = { controls: [], intact: false };
	}
	// a control that changed its tree left it changed: it leaves as built, a second time
	if (!baked.intact) ({ obj, cast } = await made(recipe, given, args));
	const t3 = performance.now();
	let view;
	try {
		view = viewOf(obj, cast);
	} catch {
		view = undefined;
	}
	const { data, transfer } = await serialize(obj, { controls: baked.controls, view });
	return { msg: { ok: true, data, card, ms: { start: Math.round(t1 - t0), build: Math.round(t2 - t1), bake: Math.round(t3 - t2), serialize: Math.round(performance.now() - t3) } }, transfer };
}

self.onmessage = async (e) => {
	const { id, op } = e.data ?? {};
	try {
		if (op === 'build') {
			const { msg, transfer } = await buildOne(e.data);
			return reply({ id, ...msg }, transfer);
		}
		if (op === 'live') {
			const { recipe, given, args, nodes } = e.data;
			const { obj, cast } = await made(recipe, given, args);
			return reply({ id, ok: true, ...live.open(obj, cast, nodes) });
		}
		if (op === 'tick') {
			const out = live.tick(e.data.session, e.data.ask ?? {});
			return reply({ id, ok: true, ...out }, live.moved(out));
		}
		if (op === 'break' || op === 'mend') return reply({ id, ok: true, ...live.breakIt(e.data.session, op === 'break') });
		if (op === 'end') return reply({ id, ok: true, ...live.end(e.data.session) });
		throw new Error(`no op ${op}`);
	} catch (err) {
		reply({ id, ok: false, error: String(err?.message ?? err) });
	}
};
reply({ op: 'ready' });
