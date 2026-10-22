// @ts-nocheck — plain JS, for the tests alone
/*
 * WHAT A WORLD'S PINS NAMED WHEN THEY WERE PINNED — for the tests that hold a world's measures (where a coop stands in
 * the way, where the stand-in's look goes) to its asset's builder in the repo, offline: each pin a world's assets config
 * keeps (code/configs/<game>/assets), its entry and heads, and the asset of the repo it named in Maia City then
 * (./pins.fixture.json, read off the vault's listing 2026-10-22). No page reads it: a page reads the pin, and the vault.
 */
import PINS from './pins.fixture.json';
import { configAt } from '../../../game/code/index.js';
import { WORLD_PIN } from './vault.js';

/** the asset of the repo a world's name for an asset (`pin:<game>/<key>`) named when it was pinned, `group/id@v[:variant]` @param {string} ref */
export function pinnedAs(ref) {
	const [, game, key] = WORLD_PIN.exec(String(ref)) ?? [];
	const pin = game ? configAt(`configs/${game}/assets`)[key] : undefined;
	return pin ? PINS[`${pin.entry}@${[...pin.at].sort().join(',')}`] : undefined;
}
