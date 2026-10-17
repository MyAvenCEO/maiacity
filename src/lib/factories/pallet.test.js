// @ts-nocheck — plain JS
// The Factories' Euro pallet is the Things' own, built in the asset box: the kit names it by a ref the Things list, and
// stacks product on it at the height the machines' pallet stands (the kit no longer builds it, so ./pallet.js keeps the
// number).
// Run: bun test src/lib/factories/pallet.test.js
import { expect, test } from 'bun:test';
import { PALLET, PALLET_H } from './pallet.js';
import { PH } from '$lib/actors/pallet.js';

// outside a page: textures draw on a stand-in canvas, and a module's runes are plain values
const noop = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) };
globalThis.$state ??= (x) => x;
const { MODELS } = await import('$lib/models');

test('the kit stacks on the pallet at its height', () => {
	expect(PALLET_H).toBe(PH);
});

test('the kit’s pallet is a version the Things list', () => {
	const [, id, v] = /^things\/([\w-]+)@(\d+)$/.exec(PALLET);
	const model = MODELS.find((m) => m.id === id);
	expect(model?.versions.map((x) => x.v)).toContain(Number(v));
});
