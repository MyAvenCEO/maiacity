// @ts-nocheck — plain JS
// Phase 4b of the asset pipeline: an asset's controls played in the box and written down (./bake.js), carried out as
// data (./serialize.js, format 2), checked and rebuilt in the page (./rebuild.js), and played back from the numbers
// (../controls.js) where its builder's own function would have put it.
// Run: bun test src/lib/assets/box/bake.test.js
import { expect, test } from 'bun:test';

// outside a page: textures draw on a stand-in canvas, and a module's runes are plain values
const noop = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) };
globalThis.$state ??= (x) => x;
const THREE = await import('three');
const { objectAt } = await import('../index.js');
const { bake, SAMPLES } = await import('./bake.js');
const { serialize } = await import('./serialize.js');
const { rebuild } = await import('./rebuild.js');
const { poserOf, walk, labelOf } = await import('../controls.js');

/** every node's place in its root, as one list of numbers */
const placesOf = (root) => {
	root.updateMatrixWorld(true);
	return walk(root).flatMap((o) => [...o.matrixWorld.elements, o.visible ? 1 : 0]);
};
const near = (a, b, eps = 1e-4) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < eps);

/** an asset baked, sent through the page's side, and its poser */
async function through(ref) {
	const obj = await objectAt(ref);
	const before = placesOf(obj);
	const baked = bake(obj);
	expect(baked.intact).toBe(true);
	// put back as it was built
	expect(near(placesOf(obj), before)).toBe(true);
	const { data } = await serialize(obj, { controls: baked.controls });
	const root = rebuild(data);
	return { obj, baked, root, poser: poserOf(root) };
}

test('a pickup: its doors and its tailgate, each shut as built, opened as its own function opens them', async () => {
	const { baked, root, poser } = await through('things/pickup');
	const ids = baked.controls.map((c) => c.id);
	expect(ids).toContain('tailgate');
	expect(ids).toContain('door.driver');
	expect(poser.get('tailgate')).toBe(0);
	expect(labelOf('door.driver')).toBe("Driver's door open");
	// played back at a sample and between two: where the builder puts it
	for (const v of [1, 0.5, 0.37]) {
		const fresh = await objectAt('things/pickup');
		fresh.userData.setTailgate(v);
		fresh.userData.setDoor('driver', v);
		poser.set('tailgate', v);
		poser.set('door.driver', v);
		// a turn between two samples is near the builder's, not exact
		expect(near(placesOf(root), placesOf(fresh), v === 0.37 ? 2e-3 : 1e-4)).toBe(true);
	}
	poser.reset();
	expect(poser.moved).toBe(false);
	expect(near(placesOf(root), placesOf(await objectAt('things/pickup')))).toBe(true);
});

test('a sealed machine: drawn apart and built up from its parts, its rest where it was built', async () => {
	const { baked, poser, root } = await through('machines/powercube@3');
	const ids = baked.controls.map((c) => c.id);
	expect(ids).toEqual(expect.arrayContaining(['explode', 'build']));
	expect(poser.get('explode')).toBe(0);
	expect(poser.get('build')).toBe(1);
	const fresh = await objectAt('machines/powercube@3');
	fresh.userData.explode(0.5);
	poser.set('explode', 0.5);
	expect(near(placesOf(root), placesOf(fresh))).toBe(true);
	// half built: the parts not yet come are hidden, as the builder hides them
	const half = await objectAt('machines/powercube@3');
	half.userData.setBuild(0.25);
	poser.reset();
	poser.set('build', 0.25);
	expect(near(placesOf(root), placesOf(half))).toBe(true);
	const c = baked.controls.find((x) => x.id === 'build');
	expect(c.samples).toBe(SAMPLES);
	expect(c.trs.length).toBe(SAMPLES * c.nodes.length * 10);
});

test('a bell tent pitched from its groundsheet up', async () => {
	const { baked, poser, root } = await through('things/bell-tent');
	expect(baked.controls.map((c) => c.id)).toContain('pitch');
	expect(poser.get('pitch')).toBe(1);
	const fresh = await objectAt('things/bell-tent');
	fresh.userData.setPitch(0.5);
	poser.set('pitch', 0.5);
	expect(near(placesOf(root), placesOf(fresh), 1e-3)).toBe(true);
});

test('what the page refuses: a control naming a node there is not, or numbers that do not fit', async () => {
	const obj = await objectAt('things/pickup');
	const { controls } = bake(obj);
	const { data } = await serialize(obj, { controls });
	const bad = (f) => {
		const d = structuredClone(data);
		f(d.controls[0]);
		return () => rebuild(d);
	};
	expect(bad((c) => (c.nodes[0] = 1e6))).toThrow('refused');
	expect(bad((c) => (c.trs = c.trs.subarray(1)))).toThrow('refused');
	expect(bad((c) => (c.trs[0] = NaN))).toThrow('refused');
	expect(bad((c) => (c.id = '__proto__'))).toThrow('refused');
	expect(bad((c) => (c.rest = 2))).toThrow('refused');
	// an older engine's build has none, and is read as before
	const old = structuredClone(data);
	old.format = 1;
	delete old.controls;
	expect(rebuild(old).userData.controls).toEqual([]);
});

test("the kit's cut faces cross with the colours it gave them, not one red for all", async () => {
	const obj = await objectAt('machines/powercube@3');
	const { data } = await serialize(obj, { controls: bake(obj).controls });
	const root = rebuild(data);
	const caps = new Map();
	root.traverse((o) => {
		for (const m of [o.material].flat().filter(Boolean)) if (m.userData.cap) caps.set(m.userData.cap.color, m.userData.cap);
	});
	// the museum red the kit gives by default, and the colours its machines name for their own cut faces
	expect(caps.has(new THREE.Color(0.56, 0.085, 0.045).getHex())).toBe(true);
	expect(caps.size).toBeGreaterThan(1);
	for (const c of caps.values()) {
		expect(c.rough).toBeGreaterThanOrEqual(0);
		expect(c.rough).toBeLessThanOrEqual(1);
	}
});

test('a bag whose canvas unrolls as it opens: its moves kept, and the bag left packed, as it was built', async () => {
	for (const ref of ['things/bell-tent-bag', 'things/tent-bag']) {
		const obj = await objectAt(ref);
		const size = () => new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3()).toArray();
		const packed = size();
		const baked = bake(obj);
		expect(baked.controls.map((c) => c.id)).toContain('open');
		// its canvas shaped back by its own function at its rest, not only its nodes put back
		expect(baked.intact).toBe(true);
		expect(near(size(), packed, 1e-6)).toBe(true);
	}
});

test('engine 5: what else a control changes goes with it, and plays back as its builder sets it', async () => {
	const meshes = (root, nodes) => nodes.map((i) => Array.from(walk(root)[i].geometry.attributes.position.array));
	const lookAt = (root, x) => [walk(root)[x.node].material].flat()[x.slot];
	// a bell tent's canvas hung and draped as its pole goes up: the meshes it reshapes, at each step
	{
		const { baked, root, poser } = await through('things/bell-tent');
		const pitch = baked.controls.find((c) => c.id === 'pitch');
		expect(pitch.shapes.length).toBeGreaterThan(0);
		const at = pitch.shapes.map((x) => x.node);
		const fresh = await objectAt('things/bell-tent');
		fresh.userData.setPitch(0.5);
		poser.set('pitch', 0.5);
		const [a, b] = [meshes(root, at), meshes(fresh, at)];
		expect(a.every((m, k) => near(m, b[k], 1e-4))).toBe(true);
		// and as built again at its rest
		poser.reset();
		const built = meshes(await objectAt('things/bell-tent'), at);
		expect(meshes(root, at).every((m, k) => near(m, built[k], 1e-4))).toBe(true);
	}
	// a fire put out and lit: its light (a light still), its flames' opacity, its embers' glow
	{
		const { baked, root, poser } = await through('things/fire-place');
		const lit = baked.controls.find((c) => c.id === 'lit');
		expect(lit.lights.length).toBeGreaterThan(0);
		expect(lit.looks.length).toBeGreaterThan(0);
		const lights = [], theirs = [];
		root.traverse((o) => o.isPointLight && lights.push(o));
		expect(lights.length).toBeGreaterThan(0);
		const fresh = await objectAt('things/fire-place');
		fresh.traverse((o) => o.isPointLight && theirs.push(o));
		for (const v of [0, 1]) {
			fresh.userData.fire.setLit(v);
			poser.set('lit', v);
			expect(near(lights.map((l) => l.intensity), theirs.map((l) => l.intensity), 1e-5)).toBe(true);
			for (const x of lit.looks) {
				const mine = lookAt(root, x), made = lookAt(fresh, x);
				expect(near([mine.opacity, mine.emissiveIntensity], [made.opacity, made.emissiveIntensity], 1e-5)).toBe(true);
			}
		}
	}
	// earth darkening as it is watered: its colour and roughness
	{
		const { baked, root, poser } = await through('things/dug-earth');
		const wet = baked.controls.find((c) => c.id === 'wet');
		expect(wet?.looks.length).toBeGreaterThan(0);
		const fresh = await objectAt('things/dug-earth');
		fresh.userData.setWet(1);
		poser.set('wet', 1);
		const mine = lookAt(root, wet.looks[0]), made = lookAt(fresh, wet.looks[0]);
		expect(near([mine.color.r, mine.color.g, mine.color.b, mine.roughness], [made.color.r, made.color.g, made.color.b, made.roughness], 1e-5)).toBe(true);
	}
});
