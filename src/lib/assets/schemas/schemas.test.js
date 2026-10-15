// @ts-nocheck — plain JS
// Phase 1 of the asset pipeline: every asset's card fits its schema, and a card made to do harm is refused.
// Run: bun test src/lib/assets/schemas            (five sample assets and every hostile card)
//      ALL_ASSETS=1 bun test src/lib/assets/schemas   (the card of every asset, every version, every variant, each
//                                                      built at its own declared values)
import { expect, test } from 'bun:test';

// outside a page: textures draw on a stand-in canvas, and a module's runes are plain values
const noop = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) };
globalThis.$state ??= (x) => x;
const { assetAt, objectAt, GROUPS, refOf } = await import('../index.js');
const { OBJECT_GROUPS } = await import('../groups.js');
const { cardOf } = await import('../card.js');
const { checkCard, checkText, CARD, ASSET } = await import('./index.js');
const { hostileCards } = await import('./hostile.js');

const SAMPLES = ['plants/apple?seed=maia&stage=9', 'things/bell-tent', 'machines/powercube@3', 'machines/pickup@1:pickup-cube', 'actors/stand-in'];

const cardAt = async (ref) => cardOf(ref, await objectAt(ref), await assetAt(ref));

test('the five sample assets: their cards fit, with the values they were built with', async () => {
	for (const ref of SAMPLES) {
		const card = await cardAt(ref);
		const verdict = checkCard(card);
		expect(verdict.ok ? [] : verdict.errors).toEqual([]);
		// the same card read back from its text
		expect(checkCard(JSON.stringify(card)).ok).toBe(true);
	}
	const apple = await cardAt('plants/apple?seed=isar&stage=4');
	expect(apple.ref).toBe('plants/apple@2?seed=isar&stage=4');
	expect(apple.params.map((p) => p.id)).toEqual(['stage', 'seed']);
	expect((await cardAt('things/bell-tent')).params).toBeUndefined();
}, 120000);

test('a card made to do harm is refused', async () => {
	const good = await cardAt('machines/powercube@3');
	expect(checkCard(good).ok).toBe(true);
	const evil = hostileCards(good);
	for (const [what, card] of Object.entries(evil)) {
		const verdict = checkCard(card);
		if (verdict.ok) throw new Error(`accepted: ${what}`);
	}
	expect(Object.prototype.polluted).toBeUndefined();
}, 60000);

test('the schemas name every group the box builds, and avenDB’s entry schema every group there is', () => {
	expect(CARD.properties.group.enum.sort()).toEqual(Object.keys(OBJECT_GROUPS).sort());
	expect(ASSET.properties.group.enum.sort()).toEqual(Object.keys(GROUPS).sort());
	expect(checkText(CARD, JSON.stringify(CARD)).ok).toBe(false); // a schema is no card
});

test.skipIf(!process.env.ALL_ASSETS)('every asset, every version, every variant: its card fits', async () => {
	const failed = [];
	let n = 0;
	for (const group of Object.keys(OBJECT_GROUPS)) {
		for (const item of await OBJECT_GROUPS[group].list()) {
			for (const version of item.versions.filter((x) => x.kept)) {
				const variants = Array.isArray(version.build) ? version.build.map((x) => x.id) : [undefined];
				for (const variant of variants) {
					const ref = refOf(group, item.id, version.v, variant);
					try {
						const card = await cardAt(ref);
						const verdict = checkCard(card);
						if (!verdict.ok) failed.push(`${ref}: ${verdict.errors.slice(0, 3).join('; ')}`);
					} catch (err) {
						failed.push(`${ref}: did not build (${String(err?.message ?? err).slice(0, 80)})`);
					}
					n++;
				}
			}
		}
	}
	console.log(`${n} cards checked, ${failed.length} refused`);
	expect(failed).toEqual([]);
}, 1_800_000);
