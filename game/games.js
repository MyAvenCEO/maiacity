import { PLACES } from './places.js';
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
export const GAMES = PLACES.filter((place) => place.gameOrder !== undefined)
	.sort((left, right) => (left.gameOrder ?? 0) - (right.gameOrder ?? 0))
	.map(({ id, label, route, note }) => ({ id, label, route, note }));

/** the game played at `route` (without the base), if any @param {string} route */
export const gameOfRoute = (route) => GAMES.find((g) => route === g.route)?.id ?? null;

/** the tag every entry of game `id` carries, and that its Public share names @param {string} id */
export const gameTag = (id) => `game:${id}`;

/** the tag every game's own entry carries */
export const GAME = 'game';
