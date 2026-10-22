// @ts-nocheck — plain JS, kept loose on purpose
/**
 * THE GAMES AREA of the Maia City COOP vault (A2 of /mnt/project-files/game-caps/plan.md; Samuel 2026-10-17: every
 * game lives in the COOP, public means watch and read only). Each game is one entry there, of type `game`, tagged
 * `game` and `game:<id>`, and everything else of it (its code, its configs, its AIPs) carries the same `game:<id>` tag.
 * Who plays it is no flag of the game's: the vault's cap groups say it (Samuel 2026-10-19: no draft stage), every
 * sandbox open to every Traveler, MaiaCity V1 to every Citizen (src/lib/avendb/capgroups.js,
 * src/lib/app/access.svelte.js). A Public share on a game's tag (the seed gives V1 one) lets everyone, signed out
 * too, watch it and read its proposals. Nothing here writes: the page's seed writes the entries
 * (src/lib/avendb/seed.js).
 *
 * A game's id is the one its code already carries (code/ `for`): its name's number, which its address carries too
 * since the addresses moved to match the names (2026-10-22), so Sandbox 6 is `sandbox-6` at /app/games/sandbox-6/.
 */

/** every game, by its id: its name, where it is played (under the site's base) and what it is; the real places to walk
 *  and film are worlds of the vault the same way (Samuel 2026-10-19: worlds purely from avenDB, its Worlds page) */
export const GAMES = [
	{ id: 'sandbox-1', label: 'Sandbox 1', route: '/app/games/sandbox-1/', note: 'A hex island to settle' },
	{ id: 'sandbox-2', label: 'Sandbox 2', route: '/app/games/sandbox-2/', note: 'The planet and its first cities' },
	{ id: 'sandbox-3', label: 'Sandbox 3', route: '/app/games/sandbox-3/', note: 'A whole dome cell' },
	{ id: 'sandbox-4', label: 'Sandbox 4', route: '/app/games/sandbox-4/', note: 'The dome cell, its food forest grown from our plants' },
	{ id: 'sandbox-5', label: 'Sandbox 5', route: '/app/games/sandbox-5/', note: 'A valley of settlers: production chains, an open market, abundance for all' },
	{ id: 'sandbox-6', label: 'Sandbox 6', route: '/app/games/sandbox-6/', note: 'One village at its real size round the Tower180 hex' },
	{ id: 'maiacity-v1', label: 'MaiaCity V1', route: '/app/maiacity-v1/', note: 'Two players, three COOPs, one hex, one tent, one Balancer pool' },
	{ id: 'tired-land', label: 'The tired land', route: '/app/worlds/tired-land/', note: 'Day 19: fields of one crop, a highway, trucks' }
];

/** the game played at `route` (without the base), if any */
export const gameOfRoute = (route) => GAMES.find((g) => route === g.route)?.id ?? null;

/** the tag every entry of game `id` carries, and that its Public share names */
export const gameTag = (id) => `game:${id}`;

/** the tag every game's own entry carries */
export const GAME = 'game';
