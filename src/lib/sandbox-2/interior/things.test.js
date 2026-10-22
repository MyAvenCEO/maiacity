// @ts-nocheck — plain JS
// Phase 8c of the asset pipeline and C8: the library's Things the village and the master dome put down (./things.js)
// stand where they always stood, in the walker's way as their builders say, at the version they have them.
// Run: bun test src/lib/sandbox-2/interior/things.test.js
import { expect, test } from 'bun:test';
import { pinnedAs } from '$lib/assets/pins.fixture.js';

/** the workshop a Thing of the library is, as the village's config names it (./things.js `THINGS`) */
const KEYS = { 'art-studio': 'studio', 'repair-cafe': 'repair' };

test('what of each Thing stands in the walker’s way is what its builder hands back with it', async () => {
	const { WALK, THINGS } = await import('./things.js');
	const { henDome, rabbitDome, playDome } = await import('$lib/models/minidomes.js');
	const { playground } = await import('./spaces');
	const near = (a, b) => {
		expect(a.length).toBe(b.length);
		a.forEach((p, i) => ['x', 'z', 'r'].forEach((k) => expect(p[k]).toBeCloseTo(b[i][k], 9)));
	};
	// at the library's seed, and at every seed the village once gave its own (their footprints never moved with it)
	for (const s of [3, 5, 7, 9]) near(WALK[THINGS.hens], henDome(s).colliders);
	for (const s of [4, 6, 8, 10]) near(WALK[THINGS.rabbits], rabbitDome(s).colliders);
	for (const s of [90, 91, 92]) near(WALK[THINGS.playDome], playDome(s).colliders);
	for (const s of [90, 91, 92]) near(WALK[THINGS.playground], playground(s).colliders);
});

test('the coops stand where Sandbox 4 stood its mini domes, turned as they were, in the way as they were', async () => {
	const { coopsOf, collidersAt } = await import('./things.js');
	const { coops } = await import('./spaces');
	const kit = new Proxy({}, { get: () => () => null });
	const R = 57.3;
	const ours = coopsOf(R), theirs = coops(kit, R, true);
	expect(ours.length).toBe(theirs.length);
	ours.forEach((t, i) => {
		const g = theirs[i].group;
		expect(t.x).toBeCloseTo(g.position.x, 9);
		expect(t.z).toBeCloseTo(g.position.z, 9);
		expect(t.turn).toBeCloseTo(g.rotation.y, 9);
		expect(pinnedAs(t.ref)).toBe(i % 2 === 1 ? 'things/rabbit-hutch@2' : 'things/chicken-coop@2');
		const mine = collidersAt(t.ref, t.x, t.z, t.turn);
		mine.forEach((p, j) => ['x', 'z', 'r'].forEach((k) => expect(p[k]).toBeCloseTo(theirs[i].colliders[j][k], 9)));
	});
});

// outside a page: the workshops' paintings and the domes' surfaces draw on a stand-in canvas, a module's runes are plain
const noop = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) };
globalThis.$state ??= (x) => x;

/** the master dome's workshops as it built them in the page, round its ground floor: each at its angle, by its builder */
async function builtWorkshops() {
	const S = await import('./spaces');
	const { box, mats, table, sofa, lantern } = await import('./interior');
	const m = mats();
	const kit = { box, table: (l, c) => table(m, l, c), sofa: (l) => sofa(m, l), lantern: (r, y) => lantern(m, r, y), oak: m.oak(1), lime: m.lime(1), stone: (rep) => m.stone(rep), dark: m.dark, steel: m.steel, counter: m.counter, timber: m.timberFrame, linen: m.linen, cushion: m.cushion, rug: m.rug, paper: m.paper };
	return [
		[0.36, 'coworking', () => S.cowork(kit, 1)],
		[1.2, 'woodshop', () => S.woodshop(kit)],
		[1.95, 'art-studio', () => S.studio(kit, 10)],
		[2.55, 'pottery', () => S.pottery(kit)],
		[2.92, 'library', () => S.library(kit, 5)],
		[3.52, 'bakery', () => S.bakery(kit)],
		[4.36, 'art-studio', () => S.studio(kit, 30)],
		[5.1, 'repair-cafe', () => S.repair(kit)],
		[5.93, 'coworking', () => S.cowork(kit, 2)]
	];
}

test('every workshop Thing is in the way where its builder says, and its middle is the one the library brings it to', async () => {
	const THREE = await import('three');
	const { WALK, MIDDLE, villageAsset } = await import('./things.js');
	const { DOME_ROOMS } = await import('$lib/models/domerooms.js');
	for (const [, id, build] of await builtWorkshops()) {
		const ref = villageAsset(KEYS[id] ?? id);
		expect(pinnedAs(ref)).toBe(`things/${id}@1`);
		const s = build();
		expect(WALK[ref].length).toBe(s.colliders.length);
		WALK[ref].forEach((p, i) => ['x', 'z', 'r'].forEach((k) => expect(p[k]).toBeCloseTo(s.colliders[i][k], 9)));
		// the library's own set (domerooms.js `centred`): its builder's ground moved off by the middle
		const inner = DOME_ROOMS.find((d) => d.id === id).make().children[0];
		expect(inner.position.x).toBeCloseTo(-MIDDLE[ref].x, 6);
		expect(inner.position.z).toBeCloseTo(-MIDDLE[ref].z, 6);
		// and the set the dome built at its own seed has the same middle
		s.group.updateMatrixWorld(true);
		const c = new THREE.Box3().setFromObject(s.group).getCenter(new THREE.Vector3());
		expect(c.x).toBeCloseTo(MIDDLE[ref].x, 6);
		expect(c.z).toBeCloseTo(MIDDLE[ref].z, 6);
	}
});

test('a copy of each workshop covers what the master dome built there, and is in the way as it was', async () => {
	const THREE = await import('three');
	const { workshopsOf, placeOf, collidersAt } = await import('./things.js');
	const { DOME_ROOMS } = await import('$lib/models/domerooms.js');
	const rr = 61.985;
	const ours = workshopsOf(rr), theirs = await builtWorkshops();
	expect(ours.length).toBe(theirs.length);
	const boxOf = (o) => (o.updateMatrixWorld(true), new THREE.Box3().setFromObject(o));
	ours.forEach((t, i) => {
		const [a, id, build] = theirs[i];
		expect(pinnedAs(t.ref)).toBe(`things/${id}@1`);
		expect(t.turn).toBe(a);
		// the dome's: its set put on the ring (spaces.ts `place`)
		const s = build();
		s.group.position.set(Math.sin(a) * rr, 0, Math.cos(a) * rr);
		s.group.rotation.y = a;
		// ours: the library's Thing where its copy stands
		const thing = DOME_ROOMS.find((d) => d.id === id).make();
		const at = placeOf(t);
		thing.position.set(at.x, at.y, at.z);
		thing.rotation.y = at.turn;
		const A = boxOf(s.group), B = boxOf(thing);
		for (const k of ['x', 'y', 'z']) {
			expect(B.min[k]).toBeCloseTo(A.min[k], 5);
			expect(B.max[k]).toBeCloseTo(A.max[k], 5);
		}
		const c = Math.cos(a), sn = Math.sin(a);
		const was = s.colliders.map((p) => ({ x: Math.sin(a) * rr + p.x * c + p.z * sn, z: Math.cos(a) * rr - p.x * sn + p.z * c, r: p.r }));
		collidersAt(t.ref, t.x, t.z, t.turn).forEach((p, j) => ['x', 'z', 'r'].forEach((k) => expect(p[k]).toBeCloseTo(was[j][k], 9)));
	});
});
