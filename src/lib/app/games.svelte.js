// @ts-nocheck — plain JS, kept loose on purpose
// Which games are published, as the Maia City COOP vault says (game/games.js): read once a tab from avenDB's public
// feed, which lists a game's entry while the vault gives everyone a Public share on its `game:<id>` tag. Until the
// feed answers, or while it names no game at all (a vault without its Games area yet), each game keeps what places.ts
// says (`release`). Publishing and withdrawing are the vault's own: whoever's device acts for Maia City shares the tag
// with everyone, or revokes that share.
import { GAMES, gameTag, loadPublished } from '../../../game/games.js';
import { EVERYONE, seeded } from '$lib/avendb/vaults.js';
import { session } from '$lib/avendb/session.svelte.js';

export const games = $state({ /** @type {Set<string> | null} */ ids: null, error: '' });

let loading = null;
/** Read the feed (once a tab; `again` reads it anew, as after publishing). */
export function loadGames(again = false) {
	if (loading && !again) return loading;
	loading = loadPublished().then((got) => {
		if (got?.error) games.error = got.error;
		else (games.ids = got), (games.error = '');
	});
	return loading;
}

/** Whether game `id` is published: the feed's word, else the repo's (`fallback`). */
export const isPublished = (id, fallback) => (games.ids && id ? games.ids.has(id) : fallback);

/** The Maia City COOP vault, where this device acts for it (the seed's founder's devices), else null. */
export function cityOf(world) {
	return world ? (seeded(world)[3]?.[0] ?? null) : null;
}

/** The Public share that publishes game `id` in vault `city`, if the device sees one. */
export const shareOf = (world, city, id) =>
	world?.shares.find((c) => c.over === city && c.who === EVERYONE && c.slice?.where?.tag === gameTag(id)) ?? null;

/** Publish game `id` (or withdraw it, `on` false), acting as Maia City; the feed is read again after. */
export async function publish(id, on) {
	const world = session.world;
	const city = cityOf(world);
	if (!city) return false;
	const had = shareOf(world, city.id, id);
	const done = on
		? had ?? (await session.run(`Publishing ${labelOf(id)}`, { op: 'share', over: city.id, who: EVERYONE, level: 'Public', what: { tag: gameTag(id) }, as: city.id }))
		: !had || (await session.run(`Withdrawing ${labelOf(id)}`, { op: 'revoke', share: had.id, as: city.id }));
	if (!done) return false;
	// the device knows at once; the server's feed, a moment later
	if (games.ids) games.ids = new Set([...games.ids, id].filter((x) => on || x !== id));
	setTimeout(() => loadGames(true), 6000);
	return true;
}

const labelOf = (id) => GAMES.find((g) => g.id === id)?.label ?? id;
