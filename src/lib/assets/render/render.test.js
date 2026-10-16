// @ts-nocheck — plain JS
// Phase 4 of the asset pipeline: the universal renderer's own parts, off the page (./lod.js, ./prepare.js,
// ./presets.js) — a level chosen by size on screen and held near its line, a build welded and instanced into few
// drawings with its measure kept, the same materials kept once — and a plant's detail as Sandbox 4 grows it.
// Run: bun test src/lib/assets/render/render.test.js
import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { BAND, HEAVY, LEVELS, PICTURE, choose, levelAt, sizeOn, thresholdsOf } from './lod.js';
import { prepare } from './prepare.js';
import { createPresets, keyOf } from './presets.js';

test('a level by its size on screen: the finest it reaches, its picture past the last', () => {
	const t = thresholdsOf(3);
	expect(t).toEqual(LEVELS);
	expect(levelAt(10, t)).toBe(0);
	expect(levelAt(LEVELS[1], t)).toBe(1);
	expect(levelAt(LEVELS[2] * 0.99, t)).toBe(3);
	// a kind with one shape: its picture at the last threshold if it is heavy, much later if it is light
	expect(thresholdsOf(1, HEAVY)).toEqual([LEVELS[2]]);
	expect(thresholdsOf(1, HEAVY * 4)).toEqual([LEVELS[2]]);
	expect(thresholdsOf(1, HEAVY / 4)[0]).toBeCloseTo(LEVELS[2] / 2);
	expect(thresholdsOf(1, 10)).toEqual([PICTURE]);
	// how big it looks: twice as far, half as big
	expect(sizeOn(2, 10, 0.5)).toBeCloseTo(2 * sizeOn(2, 20, 0.5));
});

test('a level held near its line, and the coarser one fading in under it before it takes over', () => {
	const t = [1, 0.5];
	expect(choose(2, t)).toEqual({ level: 0, fade: 0 });
	// in the band above the line: still level 0, level 1 coming in
	const near = choose(1 + BAND * 0.5, t);
	expect(near.level).toBe(0);
	expect(near.fade).toBeCloseTo(0.5);
	// just under the line: held at 0 if it was there, else 1
	expect(choose(0.98, t, 0).level).toBe(0);
	expect(choose(0.98, t, 0).fade).toBe(1);
	expect(choose(0.98, t).level).toBe(1);
	expect(choose(0.9, t, 0).level).toBe(1);
	// just over it from below: held at 1
	expect(choose(1.02, t, 1).level).toBe(1);
	// past the last: the picture, nothing under it
	expect(choose(0.1, t)).toEqual({ level: 2, fade: 0 });
});

/** a chair-like build: a seat and a back of one material, four legs of one shape, a cushion in another material */
function chair() {
	const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.7 });
	const cloth = new THREE.MeshStandardMaterial({ color: 0x3355aa, roughness: 0.9 });
	const root = new THREE.Group();
	const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.5), wood);
	seat.position.y = 0.45;
	const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.05), wood.clone());
	back.position.set(0, 0.7, -0.225);
	const leg = new THREE.CylinderGeometry(0.02, 0.02, 0.45);
	for (const [x, z] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]]) {
		const l = new THREE.Mesh(leg, wood);
		l.position.set(x, 0.225, z);
		root.add(l);
	}
	const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.04, 0.45), cloth);
	cushion.position.y = 0.495;
	const hidden = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5), cloth);
	hidden.visible = false;
	root.add(seat, back, cushion, hidden);
	return root;
}

test('a build as few drawings: what is drawn once welded by material, what is drawn often instanced, its measure kept', () => {
	const presets = createPresets();
	const level = prepare(chair(), presets);
	// the seat and the back (the same wood, cloned) welded; the legs one shape at four places; the cushion its own
	expect(presets.size).toBe(2);
	expect(level.draws.length).toBe(3);
	const legs = level.draws.find((d) => d.n === 4);
	expect(legs).toBeTruthy();
	const welded = level.draws.find((d) => d.n === 1 && d.material.color.getHex() === 0x8a6a4a);
	expect(welded.tris).toBe(24);
	// the hidden part is left out: the chair stays chair-sized
	expect(level.height).toBeCloseTo(0.95, 2);
	expect(level.bottom).toBeCloseTo(0, 5);
	expect(level.reach).toBeLessThan(0.4);
	expect(level.tris).toBe(12 + 12 + 12 + legs.tris * 4);
	// welded corners are where the parts stood
	const pos = welded.geometry.attributes.position;
	let top = 0;
	for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i));
	expect(top).toBeCloseTo(0.95, 5);
});

test('a part mirrored by its place keeps its faces outward, and a pose of blend shapes is baked in', () => {
	const presets = createPresets();
	const m = new THREE.MeshStandardMaterial();
	const g = new THREE.PlaneGeometry(1, 1);
	g.morphAttributes.position = [new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3)];
	g.morphTargetsRelative = true;
	const face = new THREE.Mesh(g, m);
	face.morphTargetInfluences = [0.5];
	const mirrored = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
	mirrored.scale.x = -1;
	mirrored.position.x = 3;
	const root = new THREE.Group().add(face, mirrored);
	const level = prepare(root, presets);
	expect(level.draws.length).toBe(1);
	const d = level.draws[0];
	const P = d.geometry.attributes.position, I = d.geometry.index.array;
	// the face pushed out by half its blend shape
	expect(P.getZ(0)).toBeCloseTo(0.5);
	// the mirrored plane's first triangle still faces +z
	const a = new THREE.Vector3().fromBufferAttribute(P, I[6]), b = new THREE.Vector3().fromBufferAttribute(P, I[7]), c = new THREE.Vector3().fromBufferAttribute(P, I[8]);
	const n = b.sub(a).cross(c.sub(a));
	expect(n.z).toBeGreaterThan(0);
});

test('materials the same are kept once; a different setting is another; the kit\'s capped solids are told apart', () => {
	const presets = createPresets();
	const a = new THREE.MeshStandardMaterial({ color: 0x336699, roughness: 0.5 });
	const b = new THREE.MeshStandardMaterial({ color: 0x336699, roughness: 0.5 });
	const c = new THREE.MeshStandardMaterial({ color: 0x336699, roughness: 0.6 });
	expect(keyOf(a)).toBe(keyOf(b));
	expect(presets.of(a)).toBe(presets.of(b));
	expect(presets.of(c)).not.toBe(presets.of(a));
	const steel = new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide });
	steel.userData.custom = true;
	const kept = presets.of(steel);
	expect(kept.customProgramCacheKey()).toBe('asset-preset-cap');
	expect(presets.of(a).customProgramCacheKey()).toBe('asset-preset');
	// cut open: every material clipped by the plane, closed again: none
	const plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
	presets.cut(plane);
	expect(kept.clippingPlanes).toEqual([plane]);
	expect(presets.of(a).clippingPlanes).toEqual([plane]);
	presets.cut(null);
	expect(kept.clippingPlanes).toBe(null);
	// our shader: the fade on every one, the cap only on the capped
	const sh = (m) => {
		const s = { vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader, uniforms: {} };
		m.onBeforeCompile(s);
		return s;
	};
	expect(sh(kept).fragmentShader).toContain('labCap');
	expect(sh(kept).fragmentShader).toContain('discard');
	const plain = sh(presets.of(a));
	expect(plain.fragmentShader).not.toContain('labCap');
	expect(plain.vertexShader).toContain('vFade = aFade');
});

test('a plant takes a detail: at 0.25 and 0.1 grown as Sandbox 4 grows its near and far plants', async () => {
	const { detailAt } = await import('$lib/plants/grow.js');
	const { TIERS } = await import('$lib/sandbox-2/interior/flora.grow.js');
	for (const tier of [TIERS.near, TIERS.mid, TIERS.look]) {
		const d = detailAt(tier.level);
		expect(d.roots).toBe(tier.roots);
		for (const k of ['level', 'thin', 'fill', 'finest']) expect(d[k]).toBeCloseTo(tier[k], 6);
	}
	expect(detailAt(1)).toEqual({ level: 1, roots: true, thin: 1, fill: 1, finest: 0 });
	const { PLANTS, plantAt } = await import('$lib/plants/index.js');
	expect(PLANTS.every((p) => p.params.at(-1).id === 'detail')).toBe(true);
	// fewer triangles at a lower detail, the same at 1 as before
	const apple = plantAt('apple', 2);
	const tris = (o) => {
		let n = 0;
		o.traverse((m) => m.isMesh && (n += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3));
		return n;
	};
	const whole = tris(apple.grow(9, 'maia')), one = tris(apple.grow(9, 'maia', 1)), coarse = tris(apple.grow(9, 'maia', 0.1));
	expect(one).toBe(whole);
	expect(coarse).toBeLessThan(whole / 4);
}, 60000);
