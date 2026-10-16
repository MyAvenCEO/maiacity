// @ts-nocheck — plain JS
// Engine 4 of the asset pipeline: what a viewer needs of a build read in the box (./view.js), carried out as data
// (./serialize.js, format 3), checked and rebuilt in the page (./rebuild.js); a skinned actor bound to its own bones;
// and a build kept running in the box (./live.js), its steps handed back as numbers the page's copy follows.
// Run: bun test src/lib/assets/box/view.test.js
import { expect, test } from 'bun:test';

const noop = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) };
globalThis.$state ??= (x) => x;
const { OBJECT_GROUPS } = await import('../groups.js');
const { recipeIn } = await import('../recipe.js');
const { buildWith, refOf, parseRef } = await import('../refs.js');
const { bake } = await import('./bake.js');
const { catalogOf, viewOf } = await import('./view.js');
const { cardOf } = await import('../card.js');
const { checkCard } = await import('../schemas/index.js');
const { serialize } = await import('./serialize.js');
const { rebuild } = await import('./rebuild.js');
const live = await import('./live.js');
const { walk } = await import('../controls.js');

/** a build as the engine makes it (./engine.js `made`): its object and the rig it came in */
async function made(label) {
	const { group, id, v, variant, params } = parseRef(label);
	const list = await OBJECT_GROUPS[group].list();
	const item = list.find((x) => x.id === id);
	const { meta, build } = recipeIn(group, list, id, v ?? item.version, variant);
	let cast = null;
	const keep = async (...a) => {
		const m = await build(...a);
		cast = m && !m.isObject3D && m.rig?.object?.isObject3D ? m : null;
		return m;
	};
	const obj = await buildWith({ build: keep, params: meta.params, ref: refOf(meta.group, meta.id, meta.version, meta.variant) }, params);
	if (cast?.catalog && !obj.userData.catalog) obj.userData.catalog = catalogOf(cast.catalog);
	return { obj, cast, meta };
}

/** through the box's side and the page's: the rebuilt root, its view, and the box's own build */
async function through(label) {
	const { obj, cast } = await made(label);
	const baked = bake(obj);
	const view = viewOf(obj, cast);
	const { data } = await serialize(obj, { controls: baked.controls, view });
	return { obj, cast, view, data, root: rebuild(data) };
}

test('a Power Cube: its parts, labels, shells, cut and solver leave as data and come back on the same nodes', async () => {
	const { obj, root } = await through('machines/powercube@3');
	const v = root.userData.view;
	const asset = obj.userData.asset;
	expect(v.parts.length).toBe(asset.parts.length);
	const nodes = walk(root), theirs = walk(obj);
	// each part on the node its builder made it
	for (const p of v.parts.slice(0, 50)) expect(nodes[p.node].name).toBe(theirs[p.node].name);
	expect(v.labels.length).toBe(asset.labels.length);
	expect(v.shells.length).toBeGreaterThan(0);
	expect(v.size).toBeCloseTo(asset.size, 5);
	expect(v.lab.hero.label).toBe(asset.lab.hero.label);
	expect(typeof v.lab.read.value).toBe('number');
	expect(v.ticks).toBe(true);
	// its own moves, each its sliders' values at 49 steps
	for (const m of Object.values(v.lab.moves ?? {})) expect(m.table.length).toBe(49 * m.ids.length);
});

test('a running Power Cube: one step in the box moves its parts on the page copy as its solver moved them', async () => {
	const { obj, cast, root } = await through('machines/powercube@3');
	const box = await made('machines/powercube@3');
	const { session, nodes } = live.open(box.obj, box.cast, walk(root).length);
	expect(nodes).toBe(walk(root).length);
	const out = live.tick(session, { dt: 0.05, explode: 1, build: 1 });
	// drawn apart: its parts moved
	expect(out.nodes.length).toBeGreaterThan(10);
	expect(out.trs.length).toBe(out.nodes.length * 10);
	expect(typeof out.read.value).toBe('number');
	expect(out.labels.length).toBe(obj.userData.asset.labels.length);
	// a second step with nothing new moves nothing it did not move
	const again = live.tick(session, { dt: 0, explode: 1, build: 1 });
	expect(again.nodes.length).toBeLessThan(out.nodes.length);
	live.end(session);
	expect(() => live.tick(session, {})).toThrow();
	void cast;
});

test('the stand-in: skinned, bound to its own bones, its clips and poses named, a clip step bends it', async () => {
	const { cast, root, view } = await through('actors/stand-in');
	expect(cast).toBeTruthy();
	let skinned = null;
	root.traverse((o) => (skinned ??= o.isSkinnedMesh ? o : null));
	expect(skinned).toBeTruthy();
	expect(skinned.skeleton.bones.length).toBe(cast.rig.names.length);
	expect(view.clips.clips.length).toBeGreaterThan(0);
	expect(root.userData.view.clips.first).toBe(cast.first);
	const box = await made('actors/stand-in');
	const { session } = live.open(box.obj, box.cast, walk(root).length);
	const clip = view.clips.clips[0];
	const out = live.tick(session, { dt: 0.1, clip, t: 0.7 });
	expect(out.nodes.length).toBeGreaterThan(0);
	// every node it moved is a bone
	const nodes = walk(root);
	for (const n of out.nodes) expect(nodes[n].isBone).toBe(true);
	live.end(session);
});

test('the LifeTrac: its parts are the groups of its skinned mesh, its catalog on its card', async () => {
	const { root, obj } = await through('machines/lifetrac');
	const v = root.userData.view;
	expect(v.parts?.length).toBeGreaterThan(20);
	expect(v.parts.every((p) => Array.isArray(p.groups) && p.groups.length > 0)).toBe(true);
	expect(obj.userData.catalog.parts.length).toBeGreaterThan(20);
});

test('a refused view: a node it names that is not there, or a move table of the wrong length', async () => {
	const { data } = await through('machines/powercube@3');
	const bad = structuredClone(data);
	bad.view.parts[0].node = 1e6;
	expect(() => rebuild(bad)).toThrow(/refused/);
	const move = Object.keys(data.view.lab.moves ?? {})[0];
	if (move) {
		const short = structuredClone(data);
		short.view.lab.moves[move].table = new Float32Array(3);
		expect(() => rebuild(short)).toThrow(/refused/);
	}
});

test('a plant in its fruit view: one fruit on its own, or a note when it bears none', async () => {
	const { root, obj } = await through('plants/apple@2?seed=maia&stage=9&fruit=1');
	let meshes = 0;
	root.traverse((o) => (meshes += o.isMesh ? 1 : 0));
	expect(meshes).toBeGreaterThan(0);
	// a fruit is small: an apple is a hand across
	const size = new (await import('three')).Box3().setFromObject(obj).getSize(new (await import('three')).Vector3());
	expect(Math.max(size.x, size.y, size.z)).toBeLessThan(0.3);
	const none = await through('plants/basil?fruit=1');
	expect(none.root.userData.view.note).toMatch(/no fruit|not set/);
});

test('a running build on the page: the stage asks, the box steps, the page copy follows, checked', async () => {
	const { heroOf } = await import('../hero.js');
	const { root, data } = await through('machines/powercube@3');
	const card = { catalog: (await made('machines/powercube@3')).obj.userData.catalog, controls: [] };
	const box = await made('machines/powercube@3');
	const start = async (nodes) => {
		const { session } = live.open(box.obj, box.cast, nodes);
		return { tick: async (ask) => live.tick(session, structuredClone(ask)), breakIt: async (on) => live.breakIt(session, on), end: async () => live.end(session) };
	};
	const hero = heroOf({ obj: root, card }, { start });
	await new Promise((r) => setTimeout(r, 0));
	expect(hero.live).toBe(true);
	hero.pose(1, 1);
	hero.tick(0.05, {});
	await new Promise((r) => setTimeout(r, 0));
	// drawn apart in the box, and so on the page: the same places, node by node
	box.obj.updateMatrixWorld(true);
	root.updateMatrixWorld(true);
	const theirs = walk(box.obj), ours = walk(root);
	let far = 0;
	ours.forEach((o, i) => (far = Math.max(far, o.getWorldPosition(new (o.position.constructor)()).distanceTo(theirs[i].getWorldPosition(new (o.position.constructor)())))));
	expect(far).toBeLessThan(1e-4);
	expect(hero.parts.length).toBe(data.view.parts.length);
	// a step that names a node there is not is refused, and the copy stands
	const bad = heroOf({ obj: root, card }, { start: async () => ({ tick: async () => ({ nodes: Uint32Array.of(1e7), trs: new Float32Array(10), visible: new Uint8Array(1), morph: [], instances: [] }), breakIt: async () => {}, end: async () => {} }) });
	await new Promise((r) => setTimeout(r, 0));
	bad.tick(0.05, {});
	await new Promise((r) => setTimeout(r, 0));
	expect(bad.live).toBe(false);
	hero.dispose();
});

test('every rigged machine and actor, every version and variant: the card its catalog goes on fits', async () => {
	const failed = [];
	let n = 0;
	for (const group of ['machines', 'actors']) {
		const list = await OBJECT_GROUPS[group].list();
		for (const item of list)
			for (const ver of item.versions ?? [])
				for (const variant of Array.isArray(ver.build) ? ver.build.map((b) => b.id) : [undefined]) {
					if (!ver.build) continue;
					const { obj, cast, meta } = await made(refOf(group, item.id, ver.v, variant));
					if (!cast?.catalog) continue;
					n++;
					const verdict = checkCard(cardOf(obj, meta, { recipe: 'ab'.repeat(32), engine: 4 }));
					if (!verdict.ok) failed.push(`${group}/${item.id}@${ver.v}${variant ? ':' + variant : ''}: ${verdict.errors.slice(0, 2).join('; ')}`);
				}
	}
	expect(n).toBeGreaterThan(5);
	expect(failed).toEqual([]);
}, 600000);
