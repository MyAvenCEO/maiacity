// @ts-nocheck — plain JS
// Phase 5 of the asset pipeline: every asset's levels of detail (./lod.js, ./simplify.js, ./lower.js) — what each
// level may cost, and real builds (a machine of many parts, a thing, an actor, the biggest machine) brought within it
// by simplifying the geometry the page has, as the renderer does, keeping their outline; and a plant, whose recipe's
// own details are its levels.
// Run: bun test src/lib/assets/render/levels.test.js
import { expect, test } from 'bun:test';

// outside a page: textures draw on a stand-in canvas, and a module's runes are plain values
const noop = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) };
globalThis.$state ??= (x) => x;
const THREE = await import('three');
const { objectAt } = await import('../index.js');
const { serialize } = await import('../box/serialize.js');
const { rebuild } = await import('../box/rebuild.js');
const { prepare } = await import('./prepare.js');
const { createPresets } = await import('./presets.js');
const { BUDGETS, LEVELS, SCREEN, STRETCH, budgetOf, errorOf, smallestOf } = await import('./lod.js');
const { CREASE, TINY, lowerDraws, reshade, weldCorners } = await import('./simplify.js');
const { createLowering, levelOf, plainOf } = await import('./lower.js');

test('what each level may cost: a share of the finest, never under its floor, never over its ceiling', () => {
	expect(budgetOf(0, 123456)).toBe(123456);
	expect(budgetOf(1, 100000)).toBe(30000);
	expect(budgetOf(2, 100000)).toBe(8000);
	// a ceiling: no more triangles than the pixels of the square it fills where it hands over
	expect(budgetOf(1, 1e6)).toBe(Math.round((LEVELS[1] * SCREEN) ** 2));
	expect(budgetOf(2, 1e6)).toBe(Math.round((LEVELS[2] * SCREEN) ** 2));
	expect(budgetOf(2, Infinity)).toBe(budgetOf(2, 1e6));
	// a floor: a light thing is not made lighter than it
	expect(budgetOf(1, 2000)).toBe(BUDGETS[1].floor);
	expect(budgetOf(2, 2000)).toBe(BUDGETS[2].floor);
	// how far a level may stray: its pixels on the screen where it is drawn biggest; the parts it leaves out, under one
	expect((errorOf(1, 2) / 4) * LEVELS[0] * SCREEN).toBeCloseTo(BUDGETS[1].px);
	expect((errorOf(2, 2) / 4) * LEVELS[1] * SCREEN).toBeCloseTo(BUDGETS[2].px);
	expect((smallestOf(2, 2) / 4) * LEVELS[1] * SCREEN).toBeCloseTo(1);
	expect(errorOf(0, 2)).toBe(0);
});

/** a shape of loose triangles, each with corners of its own, as a build often comes */
const loose = (g) => {
	const s = g.toNonIndexed();
	return { attributes: Object.fromEntries(Object.entries(s.attributes).map(([k, a]) => [k, { array: a.array, itemSize: a.itemSize, normalized: a.normalized }])), index: Uint32Array.from({ length: s.attributes.position.count }, (_, i) => i) };
};

test('loose triangles welded where their corners are the same corner: a seam where the normal turns is kept', () => {
	// a box: 36 loose corners, 24 once welded (each face's own four: its normal is its own)
	const box = weldCorners(loose(new THREE.BoxGeometry(1, 1, 1)));
	expect(box.count).toBe(24);
	expect(box.index.length).toBe(36);
	// a smooth ball: as many as it was made with
	const ball = new THREE.SphereGeometry(1, 24, 16);
	const welded = weldCorners(loose(ball));
	expect(welded.count).toBeLessThanOrEqual(ball.attributes.position.count);
	expect(welded.count).toBeGreaterThan(ball.attributes.position.count * 0.9);
	// what is left out: the bones' weights
	const g = ball.clone();
	g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(g.attributes.position.count * 4), 4));
	expect(Object.keys(weldCorners(loose(g)).attributes)).not.toContain('skinIndex');
});

test('a shape simplified across its seams shaded again: a hard edge kept hard, a smooth one smooth', () => {
	const normalsOf = (shape) => {
		const N = shape.attributes.normal.array;
		return Array.from({ length: N.length / 3 }, (_, i) => new THREE.Vector3(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]));
	};
	// a box welded into one corner at each of its eight (its normals averaged, as a fold across its seams leaves it):
	// each face flat again, four corners of its own
	const box = new THREE.BoxGeometry(1, 1, 1).deleteAttribute('normal').deleteAttribute('uv');
	const P = box.attributes.position.array, I = box.index.array;
	const welded = weldCorners({ attributes: { position: { array: P, itemSize: 3 }, normal: { array: new Float32Array(P.length), itemSize: 3 } }, index: I });
	const shaded = reshade(welded, welded.index);
	expect(shaded.attributes.position.array.length / 3).toBe(24);
	for (const n of normalsOf(shaded)) expect(Math.max(Math.abs(n.x), Math.abs(n.y), Math.abs(n.z))).toBeCloseTo(1, 5);
	// a ball whose normals were lost: its faces meet at far less than CREASE, so every corner is one, its normal
	// pointing out from the middle
	const ball = new THREE.SphereGeometry(1, 32, 24);
	const bare = weldCorners({ attributes: { position: { array: ball.attributes.position.array, itemSize: 3 }, normal: { array: new Float32Array(ball.attributes.position.count * 3), itemSize: 3 } }, index: ball.index.array });
	const s = reshade(bare, bare.index);
	const at = s.attributes.position.array;
	normalsOf(s).forEach((n, i) => expect(n.dot(new THREE.Vector3(at[i * 3], at[i * 3 + 1], at[i * 3 + 2]).normalize())).toBeGreaterThan(Math.cos(CREASE / 4)));
	// and one whose normals still fit its faces keeps them: the corners it was made with
	const w = weldCorners(loose(ball));
	const kept = reshade(w, w.index);
	expect(kept.attributes.position.array.length / 3).toBe(w.count);
	expect(Array.from(kept.attributes.normal.array).every((v, i) => Math.abs(v - w.attributes.normal.array[i]) < 1e-6)).toBe(true);
});

test('a level of parts: a tiny one kept, one too small to see left out, the rest within the budget', async () => {
	const presets = createPresets();
	const root = new THREE.Group();
	const m = new THREE.MeshStandardMaterial();
	const red = new THREE.MeshStandardMaterial({ color: 0xff0000 });
	root.add(new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), m));
	const box = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), red);
	box.position.x = 1.2;
	root.add(box);
	// a bolt drawn many times, a millimetre across
	const bolt = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0005, 0.0005, 0.001, 12), new THREE.MeshStandardMaterial({ color: 0x777777 }), 20);
	root.add(bolt);
	const level = prepare(root, presets);
	const plans = [1, 2].map((L) => ({ budget: budgetOf(L, level.tris), error: errorOf(L, level.radius), smallest: smallestOf(L, level.radius) }));
	const made = await lowerDraws(level.draws.map(plainOf), plans);
	const at = (d) => level.draws.indexOf(d);
	const sphere = level.draws.find((d) => d.tris > 1000), cube = level.draws.find((d) => d.tris === 12), bolts = level.draws.find((d) => d.n === 20);
	for (const [j, m] of made.entries()) {
		expect(m.tris).toBeLessThanOrEqual(plans[j].budget);
		expect(m.draws[at(cube)]).toBe('same');
		expect(m.draws[at(bolts)]).toBe(null);
		expect(m.draws[at(sphere)].tris).toBeLessThan(sphere.tris);
		const lv = levelOf(level, m);
		expect(lv.draws.length).toBe(2);
		expect(lv.radius).toBe(level.radius);
		expect(lv.same).toBe(false);
	}
	// a thing lighter than the floor: nothing taken away, drawn as the level it was made from
	const light = prepare(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m), presets);
	const [same] = await lowerDraws(light.draws.map(plainOf), [{ budget: budgetOf(1, light.tris), error: errorOf(1, light.radius), smallest: smallestOf(1, light.radius) }]);
	expect(levelOf(light, same).same).toBe(true);
	expect(TINY).toBeGreaterThanOrEqual(12);
});

/** a build as the page has it: built, sent out of the box as data, checked and rebuilt, prepared */
async function built(ref) {
	const obj = await objectAt(ref);
	const { data } = await serialize(obj);
	return prepare(rebuild(data), createPresets());
}

/** a level's box, from its drawings at their places */
function boxOf(level) {
	const box = new THREE.Box3(), b = new THREE.Box3(), m = new THREE.Matrix4();
	for (const d of level.draws) {
		d.geometry.boundingBox ?? d.geometry.computeBoundingBox();
		for (let k = 0; k < d.n; k++) box.union(b.copy(d.geometry.boundingBox).applyMatrix4(m.fromArray(d.locals, k * 16)));
	}
	return box;
}

/** levels 1 and 2 of a kind built once, made as the renderer makes them */
async function lowered(L0) {
	const plans = [1, 2].map((L) => ({ budget: budgetOf(L, L0.tris), error: errorOf(L, L0.radius), smallest: smallestOf(L, L0.radius) }));
	const t0 = performance.now();
	const made = await lowerDraws(L0.draws.map(plainOf), plans);
	return { levels: made.map((m) => levelOf(L0, m)), ms: performance.now() - t0 };
}

/** each level within its budget and its error, its outline the finest's within its error */
function check(L0, levels) {
	const whole = boxOf(L0).getSize(new THREE.Vector3());
	for (const [j, lv] of levels.entries()) {
		const L = j + 1;
		expect(lv.tris).toBeLessThanOrEqual(budgetOf(L, L0.tris));
		expect(lv.tris).toBeLessThan(L0.tris);
		expect(lv.made.error).toBeLessThanOrEqual(errorOf(L, L0.radius) * STRETCH * 1.01);
		const size = boxOf(lv).getSize(new THREE.Vector3());
		// nothing of its outline lost or grown beyond what the level may stray by (and the parts too small to see)
		for (const c of ['x', 'y', 'z']) expect(Math.abs(size[c] - whole[c])).toBeLessThanOrEqual(2 * (errorOf(L, L0.radius) * STRETCH + smallestOf(L, L0.radius)) + 1e-6);
	}
	expect(levels[1].tris).toBeLessThan(levels[0].tris);
}

for (const [ref, what] of [
	['machines/pickup', 'a machine of many parts (69 drawings, 8 of them instanced)'],
	['things/bell-tent', 'a thing (27 drawings)'],
	['actors/goat:goat-saanen', 'an actor (a skinned body and its eyes)']
])
	test(`${what}: ${ref}, each level within its budget, its outline kept`, async () => {
		const L0 = await built(ref);
		const { levels, ms } = await lowered(L0);
		console.log(`${ref}: ${L0.tris} → ${levels.map((l, j) => `${l.tris} (${((l.made.error / (2 * L0.radius)) * LEVELS[j] * SCREEN).toFixed(1)} px where it takes over)`).join(', ')} in ${Math.round(ms)} ms`);
		check(L0, levels);
	}, 120000);

test('the biggest one-shape machine (the LifeTrac, 437,713 corners) made in a few seconds at most', async () => {
	const L0 = await built('machines/lifetrac');
	const { levels, ms } = await lowered(L0);
	console.log(`machines/lifetrac: ${L0.tris} → ${levels.map((l) => l.tris).join(', ')} in ${Math.round(ms)} ms`);
	check(L0, levels);
	expect(ms).toBeLessThan(15000);
}, 120000);

test('a plant keeps its own detail: each level its recipe at a lower detail, within its share', async () => {
	const { plantAt } = await import('$lib/plants/index.js');
	const presets = createPresets();
	for (const name of ['walnut', 'apple', 'strawberry']) {
		const plant = plantAt(name);
		const [L0, L1, L2] = [1, 0.25, 0.1].map((d) => prepare(plant.grow(9, 'maia', d), presets));
		console.log(`plants/${name}: ${[L0, L1, L2].map((l) => l.tris).join(', ')} (level 2's ceiling ${budgetOf(2, Infinity)}, held to its share alone)`);
		expect(L1.tris).toBeLessThanOrEqual(budgetOf(1, L0.tris));
		expect(L2.tris).toBeLessThanOrEqual(Math.ceil(BUDGETS[2].share * L0.tris));
		expect(L2.tris).toBeLessThan(L1.tris);
	}
}, 120000);

test('the renderer\'s maker of levels: one kind at a time, beside the page, the same levels', async () => {
	const presets = createPresets();
	const level = prepare(new THREE.Mesh(new THREE.TorusKnotGeometry(1, 0.3, 256, 32), new THREE.MeshStandardMaterial()), presets);
	const plans = [1, 2].map((L) => ({ budget: budgetOf(L, level.tris), error: errorOf(L, level.radius), smallest: smallestOf(L, level.radius) }));
	for (const worker of [true, false]) {
		const lowering = createLowering({ worker });
		const job = lowering.lower(level, plans);
		expect(lowering.busy).toBe(1);
		const [a, b] = await job;
		expect(a.tris).toBeLessThanOrEqual(plans[0].budget);
		expect(b.tris).toBeLessThanOrEqual(plans[1].budget);
		expect(a.draws[0].geometry.attributes.position.count).toBeLessThan(level.draws[0].geometry.attributes.position.count);
		await new Promise((ok) => setTimeout(ok, 0));
		expect(lowering.busy).toBe(0);
		lowering.dispose();
	}
}, 60000);
