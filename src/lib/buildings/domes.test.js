// @ts-nocheck — plain JS
// The domes' names in ./domes.js, the light list avenDB's Assets names them by, are Sandbox 3's own.
// Run: bun test src/lib/buildings/domes.test.js
import { afterAll, expect, test } from 'bun:test';
import { DOMES_IN_ORDER } from './domes.js';

// outside a page: textures draw on a stand-in canvas, and a module's runes are plain values (given back after)
const had = { document: 'document' in globalThis, $state: '$state' in globalThis };
const noop = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) };
globalThis.$state ??= (x) => x;
afterAll(() => {
	for (const [k, was] of Object.entries(had)) if (!was) delete globalThis[k];
});

test('each dome of the light list is named as Sandbox 3 names it', async () => {
	const { DOMES } = await import('$lib/sandbox-2/interior/interior');
	expect(DOMES_IN_ORDER.map((d) => d.kind).sort()).toEqual(Object.keys(DOMES).sort());
	for (const d of DOMES_IN_ORDER) expect(d.label).toBe(DOMES[d.kind].label);
});
