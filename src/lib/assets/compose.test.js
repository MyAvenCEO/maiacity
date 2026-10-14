// @ts-nocheck — plain JS
// Everything composes ($lib/assets): an asset built by its ref, carried into another, and every part it brings
// naming where it came from; any other object carried whole, as one part.
// Run: bun test src/lib/assets/compose.test.js
import { expect, test } from 'bun:test';

// outside a page: textures draw on a stand-in canvas, and a module's runes are plain values
const noop = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) };
globalThis.$state ??= (x) => x;
const THREE = await import('three');
const { objectAt } = await import('./index.js');
const { assetKit } = await import('./parts.js');

const host = () => {
	const root = new THREE.Group();
	const kit = assetKit(root, { assemblies: [{ id: 'frame', label: 'Frame', note: '', out: [0, 0.5, 0] }] });
	kit.part(new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 1)), { id: 'deck', label: 'Deck', assembly: 'frame', what: 'what it stands on' });
	return { root, kit };
};

test('an asset built by its ref knows its ref', async () => {
	const cube = await objectAt('machines/powercube@3');
	expect(cube.userData.ref).toBe('machines/powercube@3');
	expect(cube.userData.asset.parts.length).toBeGreaterThan(40);
	await expect(objectAt('biomes/meadow@1')).rejects.toThrow('not built as one object');
});

test('a carried asset brings its parts, each naming the asset it came with', async () => {
	const cube = await objectAt('machines/powercube@3');
	const n = cube.userData.asset.parts.length;
	const { root, kit } = host();
	kit.carry(cube, { at: [0, 0.05, 0], prefix: 'cube-', explode: [0, 1, 0] });
	const asset = kit.seal();
	const came = asset.catalog.parts.filter((p) => p.id.startsWith('cube-'));
	expect(came.length).toBe(n);
	expect(came.every((p) => p.ref === 'machines/powercube@3')).toBe(true);
	expect(asset.catalog.parts.find((p) => p.id === 'deck')?.ref).toBeUndefined();
	expect(asset.lab).toBeUndefined();
	// its solver ticks with the host
	expect(() => asset.tick(0.02, { broken: false, time: 0, slow: 1, cut: 0, xray: 0 })).not.toThrow();
	expect(root.userData.parts['cube-deck']).toBeUndefined();
});

test('a host carried in turn keeps the refs its parts came with', async () => {
	const { root: inner, kit } = host();
	kit.carry(await objectAt('machines/powercube@3'), { prefix: 'cube-' });
	kit.seal();
	inner.name = 'trailer';
	const { kit: outer } = host();
	outer.carry(inner, { prefix: 'trailer-', ref: 'machines/trailer@1' });
	const parts = outer.seal().catalog.parts;
	expect(parts.find((p) => p.id === 'trailer-deck')?.ref).toBe('machines/trailer@1');
	expect(parts.filter((p) => p.id.startsWith('trailer-cube-')).every((p) => p.ref === 'machines/powercube@3')).toBe(true);
});

test('any other object is carried whole, as one part with its card', async () => {
	const crate = await objectAt('things/wine-crate');
	const { root, kit } = host();
	kit.carry(crate, { at: [0.5, 0.05, 0], prefix: 'crate-', card: { label: 'Wine crate', what: 'the load' } });
	const asset = kit.seal();
	const card = asset.catalog.parts.find((p) => p.id === 'crate');
	expect(card?.ref).toMatch(/^things\/wine-crate@\d+$/);
	expect(card?.label).toBe('Wine crate');
	expect(root.userData.parts.crate).toBe(crate);
	asset.explode(1);
	expect(crate.position.y).toBeGreaterThan(0.05);
});
