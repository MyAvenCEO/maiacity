// @ts-nocheck — plain JS
// Engine 4 of the asset pipeline: what a viewer needs of a build read in the box (./view.js), carried out as data
// (./serialize.js, format 3), checked and rebuilt in the page (./rebuild.js); a skinned actor bound to its own bones;
// and a build kept running in the box (./live.js), its steps handed back as numbers the page's copy follows; a
// building's roof and walk, and every building built as one object (the domes are not: worlds in disguise); a biome's
// cover, each kind built as one object and laid where the biome's stream lays it (a biome itself is not: data).
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

/** a build's data as the box hands it back */
async function serializeOf(label) {
	const { obj, cast } = await made(label);
	const { data } = await serialize(obj, { controls: bake(obj).controls, view: viewOf(obj, cast) });
	return data;
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

test('engine 5: an animal’s clips written down in the box, played in the page as its own clips pose it', async () => {
	const THREE = await import('three');
	const { playerOf } = await import('../clips.js');
	const { cast, root } = await through('actors/goat:goat-saanen');
	const c = root.userData.view.clips;
	expect(c.motion.bones).toBe(cast.rig.names.length);
	const play = playerOf(c.motion, c.bones);
	expect(Object.keys(play).sort()).toEqual(Object.keys(cast.clips).sort());
	const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), e = new THREE.Euler();
	/** how far its table turns a bone from where its clip does, at the worst bone (rad) */
	const strays = (a, b, skip) => {
		let worst = 0;
		for (const k of Object.keys(a)) {
			if (k === 'root' || skip.has(k)) continue;
			const x = a[k], y = b[k] ?? [0, 0, 0];
			qa.setFromEuler(e.set(x[0], x[1], x[2]));
			qb.setFromEuler(e.set(y[0], y[1], y[2]));
			worst = Math.max(worst, qa.angleTo(qb));
		}
		return worst;
	};
	for (const [name, gear] of [['graze', 0], ['walk', cast.gears.walk]]) {
		// (a tail that beats faster the faster it goes beats as at the nearest pace written down: in time with
		// itself, not with the clip's own beat between two paces)
		const m = c.motion.clips[name];
		const skip = new Set(m.t.flatMap((T) => [...T.list].filter((_, q) => T.snap[q]).map((j) => c.bones[Math.floor(m.channels[j] / 7)])));
		const errs = [];
		for (let s = 0; s < 120; s++) {
			// within the time a table holds before it repeats (a gait's 16 s, a clip's 32: the wander in an ear does not)
			const t = s * (gear ? 0.1171 : 0.2371);
			// a gait at its own pace and a little either side of it, going on, as a herd walks it
			const mo = gear ? { dist: 0.31 + s * 0.047, speed: gear * [1, 0.92, 0.85][s % 3], turn: 0 } : undefined;
			errs.push(strays(cast.clips[name](t, mo), play[name](t, mo), skip));
		}
		errs.sort((a, b) => a - b);
		// half within a degree, nearly all within a few
		expect(errs[60]).toBeLessThan(0.02);
		expect(errs[108]).toBeLessThan(0.08);
	}
	// a refused table: one of the wrong length
	const bad = await serializeOf('actors/goat:goat-saanen');
	const first = Object.values(bad.view.clips.motion.clips)[0];
	first.base = first.base.subarray(1);
	expect(() => rebuild(bad)).toThrow('refused');
});

test('engine 5: a fire kept running hands back its light’s flicker, a light on the page', async () => {
	const { root } = await through('things/fire-place');
	const box = await made('things/fire-place');
	const { session } = live.open(box.obj, box.cast, walk(root).length);
	live.tick(session, { dt: 0.1 });
	const out = live.tick(session, { dt: 0.1 });
	expect(out.lights.length).toBeGreaterThan(0);
	const nodes = walk(root);
	for (const l of out.lights) expect(nodes[l.node].isLight).toBe(true);
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

test('a container: its roof and where it is walked in from leave as data, on the same nodes, and its card says it is a building', async () => {
	const { obj, root, view, meta } = { ...(await through('buildings/container-kitchen')), meta: (await made('buildings/container-kitchen')).meta };
	expect(meta.group).toBe('buildings');
	const nodes = walk(root), theirs = walk(obj);
	// the roof the viewer lifts off: its builder's roof, node for node
	expect(view.roof?.length).toBeGreaterThan(0);
	for (const n of view.roof) expect(nodes[n].name).toBe(theirs[n].name);
	expect(theirs[view.roof[0]]).toBe(obj.userData.roof);
	// walked in from where its builder says, its lamps lit inside
	const w = obj.userData.walk;
	expect(root.userData.view.walk).toEqual({ x: w.x, z: w.z, yaw: w.yaw, lamps: w.lamps.map((l) => [...l]) });
	const verdict = checkCard(cardOf(obj, meta, { recipe: 'ab'.repeat(32), engine: 4 }));
	expect(verdict.ok ? [] : verdict.errors).toEqual([]);
});

test('every building built as one object: built through the box’s side and the page’s, its card fits; the tent and the domes are worlds in disguise, never a recipe', async () => {
	const list = await OBJECT_GROUPS.buildings.list();
	const failed = [];
	for (const item of list) {
		const label = `buildings/${item.id}`;
		const { obj, meta, view, root } = { ...(await through(label)), meta: (await made(label)).meta };
		let meshes = 0;
		root.traverse((o) => (meshes += o.isMesh ? 1 : 0));
		if (!meshes) failed.push(`${label}: nothing drawn`);
		const verdict = checkCard(cardOf(obj, meta, { recipe: 'ab'.repeat(32), engine: 4 }));
		if (!verdict.ok) failed.push(`${label}: ${verdict.errors.slice(0, 2).join('; ')}`);
		// a container is walked and its roof lifted, as it always was
		if (item.id.startsWith('container-') && !(view.walk && view.roof?.length)) failed.push(`${label}: no walk or roof`);
	}
	expect(failed).toEqual([]);
	expect(list.map((x) => x.id)).toEqual(['container-kitchen', 'container-workshop', 'container-tech', 'container-sanitary', 'bus-stop', 'gas-station', 'old-shed', 'maia-centre', 'village-store']);
	// every building, the domes too, in the page's group; only those built as one object in the box's
	const { GROUPS, objectAt } = await import('../index.js');
	const all = await GROUPS.buildings.list();
	expect(all.length).toBe(16);
	const domes = all.filter((b) => 'dome' in b);
	expect(domes.map((d) => d.id)).toEqual(['dome-tent', 'dome-glamp', 'dome-home', 'dome-large', 'dome-grand', 'dome-master', 'dome-factory']);
	expect(all.filter((b) => !('dome' in b)).map((b) => b.id)).toEqual(list.map((x) => x.id));
	await expect(objectAt('buildings/dome-grand@2')).rejects.toThrow(/not built as one object/);
}, 600000);

test('a biome’s cover: every kind built through the box’s side and the page’s as its builder builds it, casting its shadow; a biome itself is never a recipe', async () => {
	const THREE = await import('three');
	const { COVER } = await import('$lib/biomes/cover.js');
	const { BIOMES, coverSeed } = await import('$lib/biomes');
	const { coverRef } = await import('$lib/biomes/built.js');
	const list = await OBJECT_GROUPS.biomes.list();
	expect(list.map((x) => x.id)).toEqual(['cover']);
	expect(list[0].versions.at(-1).build.map((k) => k.id)).toEqual(Object.keys(COVER));
	/** every mesh's corners, in the order the tree holds them */
	const corners = (root) => {
		const out = [];
		root.updateMatrixWorld(true);
		root.traverse((o) => o.isMesh && out.push({ position: [...o.geometry.attributes.position.array], color: [...(o.geometry.attributes.color?.array ?? [])], cast: o.castShadow, receive: o.receiveShadow }));
		return out;
	};
	const failed = [];
	for (const [kind, c] of Object.entries(COVER)) {
		const seed = coverSeed(3, kind);
		const label = coverRef(kind, seed);
		const { obj, root, meta } = { ...(await through(label)), meta: (await made(label)).meta };
		const theirs = corners(c.build(seed)), ours = corners(root);
		if (!ours.length) failed.push(`${label}: nothing drawn`);
		if (JSON.stringify(ours.map((m) => [m.position, m.color])) !== JSON.stringify(theirs.map((m) => [m.position, m.color]))) failed.push(`${label}: not its builder's shape`);
		if (!ours.every((m) => m.cast && m.receive)) failed.push(`${label}: casts no shadow`);
		const verdict = checkCard(cardOf(obj, meta, { recipe: 'ab'.repeat(32), engine: 4 }));
		if (!verdict.ok) failed.push(`${label}: ${verdict.errors.slice(0, 2).join('; ')}`);
		expect(obj.userData.ref).toBe(`biomes/cover@1:${kind}?seed=${seed}`);
	}
	expect(failed).toEqual([]);
	// a biome is its recipe of numbers, in the page's group beside its cover, and not built as one object
	const { GROUPS, objectAt } = await import('../index.js');
	expect((await GROUPS.biomes.list()).map((b) => b.id)).toEqual([...BIOMES.map((b) => b.id), 'cover']);
	await expect(objectAt('biomes/meadow@1')).rejects.toThrow(/not built as one object/);
	expect(new THREE.Box3().setFromObject(await objectAt(coverRef('fern', 7139))).isEmpty()).toBe(false);
}, 600000);

test('a biome’s cover laid round an eye that stays (the Biomes explorer): the plants the stream draws there, each grown as its shader grows it', async () => {
	const { BIOMES, mix } = await import('$lib/biomes');
	const { coverLaid, coverStream } = await import('$lib/biomes/stream.js');
	const o = { tile: 8, reach: 26, near: 22 };
	const recipes = [
		[BIOMES[0], new Set()],
		[mix(BIOMES[4], BIOMES[2], 0.4), new Set([1, 5])]
	];
	for (const [recipe, hidden] of recipes) {
		const stream = coverStream({ recipe, ...o, hidden });
		stream.update(0, 0, 999);
		// each kind's instances, as the stream draws them: its meshes share one list of places and ranks
		const kinds = [];
		for (const m of stream.object.children) if (!kinds.some((k) => k.instanceMatrix === m.instanceMatrix)) kinds.push(m);
		expect(kinds.length).toBe(recipe.cover.length);
		const laid = coverLaid(recipe, { ...o, hidden });
		let n = 0;
		kinds.forEach((mesh, k) => {
			// the fading shader's sums, in the page: how far each plant grows where it stands
			const want = [];
			const M = mesh.instanceMatrix.array, R = mesh.geometry.attributes.bRank.array;
			for (let i = 0; i < mesh.count; i++) {
				const d = Math.hypot(M[i * 16 + 12], M[i * 16 + 14]);
				const keepAt = d <= o.near ? 1 : 1 - 0.7 * Math.min(1, (d - o.near) / (o.reach - o.near));
				const t = Math.min(1, Math.max(0, (d - (o.reach - 4)) / 4));
				const grow = Math.min(1, Math.max(0, (keepAt - R[i]) / 0.08)) * (1 - t * t * (3 - 2 * t));
				if (grow > 0) want.push([...M.subarray(i * 16, i * 16 + 16)].map((x, j) => (j % 4 < 3 && j < 12 ? x * grow : x)));
			}
			const got = [];
			for (let i = 0; i < laid[k].length / 16; i++) got.push([...laid[k].subarray(i * 16, i * 16 + 16)]);
			const key = (m) => `${m[12].toFixed(4)},${m[14].toFixed(4)}`;
			want.sort((a, b) => key(a).localeCompare(key(b)));
			got.sort((a, b) => key(a).localeCompare(key(b)));
			expect(got.length).toBe(want.length);
			got.forEach((m, i) => m.forEach((x, j) => expect(Math.abs(x - want[i][j])).toBeLessThan(1e-5)));
			n += got.length;
		});
		expect(n).toBeGreaterThan(500);
		// the kinds hidden stand nowhere
		for (const i of hidden) expect(laid[i].length).toBe(0);
	}
}, 120000);

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
