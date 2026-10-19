// @ts-nocheck — plain JS, trusted: runs in the page
/*
 * LOADING AN ASSET — the one way a page gets a build, by its name, `<recipe hash>?its=values` (./builds.js), as
 * anyone's would be got: from this device's cache (./cache.js) when it was built here before, else from the asset box
 * (./box/host.js), which runs the recipe on the frozen engine it was made for. Either way it is checked (its card
 * against the card's schema, its data by ./box/rebuild.js) and built into three.js objects by our own code. The recipe
 * is the only truth, and it is the Maia City vault's (./vault.js): its index names the hash, and its entry's file, read
 * off avenDB's feed and held to that hash, is what the box runs. What it made stays on this device, so a page that
 * finds it in the cache reads no recipe's file and starts no box.
 *
 * What a recipe's entry declares is held (H4, `heldTo`): it runs on the box engine its card names (`engineOf`), in a
 * box of that engine's; it requires of the engine only the modules its manifest names; its contract names only checks
 * the page runs on every build anyway; and its file and its build stay within the bytes and the time its contract
 * gives, where those are less than the box's own.
 */
import { AssetBox, TIMEOUT } from './box/host.js';
import { rebuild } from './box/rebuild.js';
import * as cache from './cache.js';
import { engineAt } from './engines.js';
import { valuesOf } from './params.js';
import { INDEX, buildOf, cardOf, declaredOf, heldAt, loadRecipes, parseBuild, recipeAt } from './vault.js';
import { libsOf } from './sources/avendb.js';
import { checkCard } from './schemas/index.js';

const boxes = new Map();
/** the page's box for an engine, started when a build first needs it @param {number} [v] */
export const boxOf = (v = INDEX.engine) => {
	if (!boxes.has(v)) boxes.set(v, new AssetBox({ engine: v }));
	return boxes.get(v);
};
const running = new Map();
/**
 * The page's box for builds kept running (./box/live.js), an engine's second worker: building the next asset never
 * holds up the steps of the one running, nor the reverse. @param {number} [v]
 */
export const liveBoxOf = (v = INDEX.engine) => {
	if (!running.has(v)) running.set(v, new AssetBox({ engine: v }));
	return running.get(v);
};

/**
 * The frozen box engine a recipe runs on: the one its card names (the card its entry keeps), the index's where it
 * names none. Throws for one that is not frozen. @param {string} hash
 */
export function engineOf(hash) {
	const v = cardOf(hash)?.engine ?? INDEX.engine;
	const e = engineAt(v);
	if (!e) throw new Error(`${heldAt(hash).label} is made for box engine ${String(v).slice(0, 12)}, which is not frozen`);
	return e;
}

/** the checks the page runs on every build of every recipe (./sources/avendb.js `recipeEntryOf`) */
export const CHECKS = {
	hash: 'its file hashes to the name its card gives it',
	card: 'its card fits the card schema and names that recipe',
	budget: 'what the box hands back stays within the budget of nodes, triangles, pictures, lights and bones'
};

/**
 * A recipe's file held to what its entry declares (`declared`: its manifest and contract), on box engine `engine`: the
 * time its build has (ms), or throws why it is refused. Its manifest's `libs` are the modules it requires: every one
 * its file names (a name it computes reaches only the engine's own modules), and each a module of the engine. Its
 * contract's `invariants` are checks the page runs on every build anyway (`CHECKS`), never one it doesn't; its
 * `budgets.bytes` bounds its file and `budgets.ms` its build, where less than the box's own 20 s. Its `memory` and
 * `ops` no box can hold: they are not read. An entry that declares nothing is held to the engine alone.
 * @param {string} code @param {{ manifest?: any, contract?: any } | undefined} declared @param {{ v: number, modules: string[] }} engine
 */
export function heldTo(code, declared, engine) {
	const libs = declared?.manifest?.libs;
	if (Array.isArray(libs)) {
		const unnamed = libsOf(code).filter((l) => !libs.includes(l));
		if (unnamed.length) throw new Error(`refused: it requires ${unnamed.slice(0, 3).join(', ')}, which its manifest doesn't name`);
		const none = libs.filter((l) => !engine.modules.includes(l));
		if (none.length) throw new Error(`refused: its manifest names ${none.slice(0, 3).join(', ')}, which box engine ${engine.v} doesn't have`);
	}
	const c = declared?.contract ?? {};
	const unknown = (Array.isArray(c.invariants) ? c.invariants : []).filter((i) => !Object.hasOwn(CHECKS, i));
	if (unknown.length) throw new Error(`refused: its contract asks for ${unknown.slice(0, 3).join(', ')}, a check the page doesn't run`);
	const b = c.budgets ?? {};
	if (Number.isInteger(b.bytes) && new TextEncoder().encode(code).length > b.bytes) throw new Error(`refused: its file is bigger than the ${b.bytes} bytes its contract gives it`);
	return Number.isInteger(b.ms) ? Math.min(TIMEOUT, Math.max(0, b.ms)) : TIMEOUT;
}

/**
 * A build of one of the vault's recipes, named as it is kept: its hash and every value it takes, its own where not
 * given, so two names of one build are one; and the engine it runs on. Throws for a value its recipe does not take,
 * and NotInVault for a hash the vault doesn't hold (or while its recipes aren't in: ./vault.js `loadRecipes`).
 * @param {string} name `<hash>?its=values`
 */
export function canonical(name) {
	const { hash, params } = parseBuild(name);
	const at = heldAt(hash);
	const values = at.params?.length ? valuesOf(at.params, params) : undefined;
	if (params && !values) throw new Error(`${at.label} takes no parameters`);
	return { hash, at, values, name: buildOf(hash, values), engine: engineOf(hash) };
}

/** the cache key of a build @param {string} name */
export const keyOf = (name) => {
	const c = canonical(name);
	return cache.keyOf({ engine: c.engine.blake3, recipe: c.hash, params: c.values });
};

const now = () => performance.now();

/** the builds the box is making now, by their cache key: one asked for again meanwhile waits for it */
const building = new Map();

/**
 * A build's data copied for another copy of it: its arrays its own (a control may reshape them), its pictures shared
 * (each texture is drawn from its own canvas, and a picture copied would be read back off the graphics card).
 */
function copyOf(v) {
	if (ArrayBuffer.isView(v)) return v instanceof DataView ? new DataView(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)) : v.slice();
	if (v instanceof ArrayBuffer) return v.slice(0);
	if (typeof ImageBitmap !== 'undefined' && v instanceof ImageBitmap) return v;
	if (Array.isArray(v)) return v.map(copyOf);
	if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copyOf(x)]));
	return v;
}

/** a box's or the cache's build, checked and built into objects; throws with the reason it was refused */
function open({ data, card }, hash) {
	const verdict = checkCard(card);
	if (!verdict.ok) throw new Error(`refused: its card does not fit: ${verdict.errors.slice(0, 3).join('; ')}`);
	if (card.recipe !== hash) throw new Error('refused: its card names another recipe');
	return { obj: rebuild(data), card, data };
}

/**
 * A build, ready to put into a scene: `obj`, its `card`, its plain `data`, where it came `from` ('cache' or 'box'),
 * its `name` and `key`, its times in ms, and `stored`, which settles once a box's build is kept in the cache (true) or
 * was not (false).
 * @param {string} name `<recipe hash>?its=values`
 * @param {{ box?: AssetBox, cache?: boolean, store?: Pick<typeof cache, 'get' | 'put' | 'drop'> }} [o] `cache: false`
 *   builds in the box and keeps nothing; `store` the cache it reads and keeps to (this device's; a test's stand-in)
 */
export async function loadAsset(name, { box, cache: useCache = true, store = cache } = {}) {
	const t0 = now();
	// what is no build at all, or a vault's ref, is refused before the recipes are asked for
	parseBuild(name);
	await loadRecipes();
	const c = canonical(name);
	const key = cache.keyOf({ engine: c.engine.blake3, recipe: c.hash, params: c.values });
	const said = { name: c.name, key, label: c.at.label };
	if (useCache) {
		const hit = await store.get(key);
		const t1 = now();
		if (hit) {
			try {
				const got = open(hit, c.hash);
				return { ...got, ...said, from: 'cache', stored: Promise.resolve(true), ms: { read: Math.round(t1 - t0), rebuild: Math.round(now() - t1), total: Math.round(now() - t0) } };
			} catch {
				// spoiled, or kept by an older page: gone, and built anew
				await store.drop(key);
			}
		}
	}
	const t1 = now();
	// the same build asked for again while the box makes it (four backpacks of one world): made once, each its own copy
	const same = useCache ? building.get(key) : undefined;
	if (same) {
		const { built, stored, t2 } = await same;
		const t3 = now();
		const got = open({ ...built, data: copyOf(built.data) }, c.hash);
		const t4 = now();
		return { ...got, ...said, from: 'box', stored, ms: { read: Math.round(t1 - t0), recipe: 0, start: built.ms.start, build: built.ms.build, bake: built.ms.bake, serialize: built.ms.serialize, box: Math.round(t3 - Math.max(t1, t2)), rebuild: Math.round(t4 - t3), total: Math.round(t4 - t0), shared: true } };
	}
	const making = (async () => {
		const recipe = await recipeAt(c.hash);
		const timeout = heldTo(recipe.code, declaredOf(c.hash), c.engine);
		const t2 = now();
		const given = c.values && Object.fromEntries(Object.entries(c.values).map(([k, v]) => [k, String(v)]));
		// a box handed in builds only what its engine runs: a recipe made for another builds in a box of its own engine
		const built = await (box?.engine === c.engine.v ? box : boxOf(c.engine.v)).build(recipe, given, { timeout });
		const stored = useCache ? store.put(key, built).catch(() => false) : Promise.resolve(false);
		return { built, stored, t2 };
	})();
	if (useCache) {
		building.set(key, making);
		making.then(
			() => building.delete(key),
			() => building.delete(key)
		);
	}
	const { built, stored, t2 } = await making;
	const t3 = now();
	const got = open(built, c.hash);
	const t4 = now();
	return { ...got, ...said, from: 'box', stored, ms: { read: Math.round(t1 - t0), recipe: Math.round(t2 - t1), start: built.ms.start, build: built.ms.build, bake: built.ms.bake, serialize: built.ms.serialize, box: Math.round(t3 - t2), rebuild: Math.round(t4 - t3), total: Math.round(t4 - t0) } };
}
