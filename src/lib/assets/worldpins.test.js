// @ts-nocheck — plain JS
// Every asset a sandbox or a world draws is named by its avenDB entry alone (Samuel 2026-10-22): the pin its game's
// assets config keeps (code/configs/<game>/assets), read by ../assets/vault.js `pinnedOf`, with no old ref behind it.
// Run: bun test src/lib/assets/worldpins.test.js
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { codeIn, configAt } from '../../../game/code/index.js';
import { MAIA_CITY } from '../../../game/code/sources/anchor.js';
import { NotInVault, WORLD_PIN, assetIn, parsePin, pinnedOf } from './vault.js';
import PINS from './pins.fixture.json';
import { pinnedAs } from './pins.fixture.js';

const ASSETS = codeIn('configs/').filter((e) => e.ref.endsWith('/assets'));

test('each game keeps its assets as pins: an entry and the heads of a version, nothing else', () => {
	expect(ASSETS.map((e) => e.ref).sort()).toEqual(['configs/factories/assets', 'configs/maiacity-v1/assets', 'configs/sandbox-4/assets', 'configs/tired-land/assets']);
	for (const e of ASSETS) {
		const pins = configAt(e.ref);
		for (const [key, pin] of Object.entries(pins)) {
			expect(key).toMatch(/^[a-z0-9][a-z0-9-]*$/);
			expect(Object.keys(pin).sort()).toEqual(['at', 'entry']);
			expect(parsePin(pin)).not.toBeNull();
			// and it named an asset of Maia City when it was pinned
			expect(PINS[`${pin.entry}@${[...pin.at].sort().join(',')}`]).toBeString();
		}
	}
});

test('a world’s name for an asset is the pin its config keeps, its values with it', () => {
	const pin = configAt('configs/sandbox-4/assets').hens;
	expect(pinnedOf('pin:sandbox-4/hens')).toBe(`vault:${MAIA_CITY}/${pin.entry}@${[...pin.at].sort().join(',')}`);
	expect(pinnedOf(assetIn('maiacity-v1', 'stake', { seed: 'pear', name: 'Ana Lu' }))).toMatch(/^vault:[0-9a-f]{64}\/[0-9a-f]{64}@[0-9a-f,]+\?name=Ana(%20|\+)Lu&seed=pear$/);
	// any other ref as it is
	expect(pinnedOf('plants/apple@2')).toBe('plants/apple@2');
	// a key the config doesn't pin names nothing, never an old ref
	expect(() => pinnedOf('pin:sandbox-4/no-such-thing')).toThrow(NotInVault);
	expect(() => pinnedOf('pin:no-game/hens')).toThrow(/keeps no assets config/);
});

test('every asset the sandboxes and worlds name is pinned', async () => {
	const { THINGS, FLOORS } = await import('$lib/sandbox-2/interior/things.js');
	const { CASTS, actorRef } = await import('$lib/sandbox-2/interior/animals');
	const { SONGBIRDS } = await import('$lib/sandbox-2/interior/birds.js');
	const V1 = await import('$lib/maiacity-v1/things.js');
	const { PLANT_IDS, plantOf, plantRef } = await import('$lib/maiacity-v1/plants.js');
	// the tired land's set imports the page's own modules: its truck read off its source
	const TRUCK = /export const TRUCK = '([^']+)'/.exec(readFileSync(new URL('../worlds/tiredLandSet.js', import.meta.url), 'utf8'))?.[1];
	const { PALLET } = await import('$lib/factories/pallet.js');
	const { PACK_REF } = await import('$lib/factories/batterypack-line.js');
	const refs = [
		...Object.values(THINGS),
		...Object.values(FLOORS),
		...CASTS.map(actorRef),
		...SONGBIRDS.map((k) => actorRef(`bird-${k}`)),
		...Object.values(V1.THINGS),
		V1.STAND_IN,
		// each plant at every version it has (`plantOf` gives its latest for one it hasn't)
		...new Set(PLANT_IDS.flatMap((id) => [1, 2, 3].map((v) => plantRef(plantOf(id, v), 9, 'seed')))),
		TRUCK,
		PALLET,
		PACK_REF
	];
	for (const ref of refs) {
		expect(ref).toMatch(WORLD_PIN);
		expect(() => pinnedOf(ref)).not.toThrow();
	}
	// at the versions they have always stood at
	expect(pinnedAs(THINGS.hens)).toBe('things/chicken-coop@2');
	expect(pinnedAs(FLOORS.outside)).toBe('biomes/food-forest@1');
	expect(pinnedAs(FLOORS.warm)).toBe('biomes/warm-food-forest@1');
	expect(pinnedAs(V1.STAND_IN)).toBe('actors/stand-in@11:stand-in');
	expect(pinnedAs(TRUCK)).toBe('machines/truck@1:truck');
	expect(pinnedAs(PACK_REF)).toBe('machines/batterypack@9:batterypack');
});
