// @ts-nocheck — plain JS
// Phase 2 of the asset pipeline: a recipe declares its parameters, a ref names them, and every build of an asset has
// one name and one cache key (./params.js, ./refs.js, ./cache.js).
// Run: bun test src/lib/assets/params.test.js
import { expect, test } from 'bun:test';

// outside a page: textures draw on a stand-in canvas, and a module's runes are plain values
const noop = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) };
globalThis.$state ??= (x) => x;
const { objectAt, parseRef, refOf } = await import('./index.js');
const { valuesOf } = await import('./params.js');
const { fingerprint, keyOf } = await import('./cache.js');
const { trianglesOf } = await import('./card.js');
const { PLANTS } = await import('$lib/plants');

const ENGINE = 'ab'.repeat(32);

test('a ref names its parameters after a question mark, sorted when written', () => {
	expect(parseRef('plants/apple@2?stage=9&seed=maia')).toEqual({ group: 'plants', id: 'apple', v: 2, variant: undefined, params: { stage: '9', seed: 'maia' } });
	expect(parseRef('machines/powercube@1:powercube-electric').params).toBeUndefined();
	expect(refOf('plants', 'apple', 2, undefined, { stage: 9, seed: 'maia' })).toBe('plants/apple@2?seed=maia&stage=9');
	expect(refOf('plants', 'apple', 2, undefined, { seed: 'a b&c' })).toBe('plants/apple@2?seed=a+b%26c');
	expect(parseRef(refOf('plants', 'apple', 2, undefined, { seed: 'a b&c' })).params).toEqual({ seed: 'a b&c' });
	expect(() => parseRef('plants/apple?stage=1&stage=2')).toThrow();
	expect(() => parseRef('plants/apple?__proto__=1')).toThrow();
});

test('every plant declares its stage and its seed, in the order it grows by', () => {
	expect(PLANTS.length).toBeGreaterThan(50);
	for (const p of PLANTS) {
		expect(p.params.map((x) => x.id)).toEqual(['stage', 'seed']);
		expect(p.params[0]).toMatchObject({ type: 'number', min: 0, max: p.stages.length - 1, value: p.stages.length - 1 });
		expect(p.params[0].names).toEqual(p.stages.map((s) => s.name));
	}
});

test('what a ref says is checked against what the recipe declares', () => {
	const { params } = PLANTS.find((x) => x.id === 'apple');
	expect(valuesOf(params)).toEqual({ stage: 9, seed: 'maia' });
	expect(valuesOf(params, { stage: '4.5' })).toEqual({ stage: 4.5, seed: 'maia' });
	expect(valuesOf(params, {}, [3, 'isar'])).toEqual({ stage: 3, seed: 'isar' });
	for (const given of [{ stage: '12' }, { stage: '-1' }, { stage: 'x' }, { stage: '' }, { stage: 'Infinity' }, { colour: 'red' }, { seed: 'x'.repeat(41) }]) expect(() => valuesOf(params, given)).toThrow();
	expect(() => valuesOf(params, {}, [1, 'a', 'b'])).toThrow();
});

test('a ref with parameters builds what the same arguments build, and an asset that takes none refuses them', async () => {
	const named = await objectAt('plants/apple?seed=isar&stage=6');
	const passed = await objectAt('plants/apple', 6, 'isar');
	expect(trianglesOf(named)).toBe(trianglesOf(passed));
	expect(named.userData.ref).toBe('plants/apple@2?seed=isar&stage=6');
	expect(passed.userData.ref).toBe('plants/apple@2?seed=isar&stage=6');
	// the latest, at its own values, unless asked
	expect((await objectAt('plants/apple')).userData.ref).toBe('plants/apple@2?seed=maia&stage=9');
	await expect(objectAt('plants/apple?stage=99')).rejects.toThrow();
	await expect(objectAt('things/bell-tent?size=2')).rejects.toThrow();
	expect((await objectAt('things/bell-tent')).userData.ref).toBe('things/bell-tent@1');
}, 60000);

test('one build, one cache key: the same values in any order, another value or engine another key', () => {
	const k = keyOf('plants/apple?seed=maia&stage=9', { engine: ENGINE });
	expect(k).toMatch(/^[0-9a-f]{64}$/);
	expect(keyOf('plants/apple?stage=9&seed=maia', { engine: ENGINE })).toBe(k);
	expect(keyOf('plants/apple?seed=isar&stage=9', { engine: ENGINE })).not.toBe(k);
	expect(keyOf('plants/apple@2?seed=maia&stage=9', { engine: ENGINE })).not.toBe(k);
	expect(keyOf('plants/apple?seed=maia&stage=9', { engine: 'cd'.repeat(32) })).not.toBe(k);
	expect(keyOf('plants/apple?seed=maia&stage=9', { engine: ENGINE, recipe: 'ef'.repeat(32) })).not.toBe(k);
	expect(() => keyOf('plants/apple', { engine: 'nope' })).toThrow();
});

test('a fingerprint tells data apart by every byte and every field', () => {
	const a = { format: 0, geometries: [{ attributes: { position: { array: new Float32Array([0, 1, 2]), itemSize: 3 } } }] };
	const b = structuredClone(a);
	expect(fingerprint(a)).toBe(fingerprint(b));
	b.geometries[0].attributes.position.array[2] = 2.0000002;
	expect(fingerprint(a)).not.toBe(fingerprint(b));
	expect(fingerprint({ x: 1, y: 2 })).toBe(fingerprint({ y: 2, x: 1 }));
	expect(fingerprint({ a: new Uint8Array([1]) })).not.toBe(fingerprint({ a: new Int8Array([1]) }));
});
