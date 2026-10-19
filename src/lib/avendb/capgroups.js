/*
 * The cap groups of the Maia City COOP vault (Samuel 2026-10-19: access to the sandboxes, the worlds, the game assets
 * and the games "purely behind avenDB native caps", "Not depending on PG"; "Always go for the full lean! Way"). A cap
 * group is an entry of its vault, `{name, caps, includes}`, each cap one op over one slice, and every right to it is a
 * share that names the group: a new version of the group reaches every share naming it at once, and revoking a share
 * ends that one alone (avendb/spec/AvenDB/Gate.lean, avendb/docs/ARCHITECTURE.md §8). An invite is such a share to a
 * one-time key, which the newcomer's vault claims at sign-up with no owner signing ($lib/app/entry.js).
 *
 *   Traveler   every invited human: reads the games, the asset recipes and the code the sandboxes and worlds run, so
 *              they open every sandbox, world and game asset, read only
 *   Citizen    a Traveler who plays MaiaCity V1 too (to become the paid one later), and reads all of V1, its proposals
 *              among it; V1's moves still run on maiaCITY's API, so no write of them is a cap yet. Nobody is invited
 *              a citizen (Samuel 2026-10-19): travelers become citizens by other means, later
 *   Admin      a Citizen who reads all of Maia City and opens the admins' own pages (the Skills, avenDB's own page, the
 *              vault apps on the dashboard, signing a terminal in; Samuel 2026-10-19: no Postgres role decides it), and
 *              may found coops and avens through avenDB's server (avendb's `gate::ADMIN`). Maia City's own owners always
 *              may all of it; anyone else holds it by a share of it
 *
 * The repo seed defines the three groups once, on the first device of Maia City's owner (./seed.js runs in
 * ./Account.svelte); the app reads which the person holds ($lib/app/access.svelte.js).
 */
import { EVERYONE } from './vaults.js';

/** The group every invited human holds. */
export const TRAVELER = 'Traveler';

/** The group that plays MaiaCity V1 too. */
export const CITIZEN = 'Citizen';

/** The admins' group: the admins' own pages, and founding coops and avens through avenDB's server, beside Maia City's own
 *  owners (avendb's `gate::ADMIN`, which names it exactly so). */
export const ADMIN = 'Admin';

/** MaiaCity V1's tag in the Maia City vault, which every entry of it carries (game/games.js `gameTag`). */
const V1 = 'game:maiacity-v1';

/**
 * Each group the seed defines, in order, a group it includes named by its name: a Traveler reads the games' entries
 * (`game`), the asset recipes (`recipe`), the views and logic modules (`view`, `logic`) and the games' settings (`config`),
 * which Maia City also shares with everyone for the server's feeds (./seed.js `CODE_TYPES`, `RECIPE_TYPES`,
 * `CONFIG_TYPES`); a Citizen reads all of V1 besides; an Admin all of Maia City.
 * @type {{ name: string, caps: { op: string, where?: object }[], includes: string[] }[]}
 */
export const CAP_GROUPS = [
	{ name: TRAVELER, caps: [{ op: 'read', where: { type: ['game', 'recipe', 'view', 'logic', 'config'] } }], includes: [] },
	{ name: CITIZEN, caps: [{ op: 'read', where: { tag: V1 } }], includes: [TRAVELER] },
	{ name: ADMIN, caps: [{ op: 'read' }], includes: [CITIZEN] }
];

/**
 * A cap group as the `cap_groups` op answers it: its entry, its name, its caps and the entries of the groups it includes.
 * @typedef {{ entry: string, name: string, caps: object[], includes: string[] }} CapGroup
 */

/**
 * The ops that define each group of `CAP_GROUPS` vault `vault` holds none of that name of yet, `have` its groups as
 * the `cap_groups` op answers them: run one after another, each `"$n"` in one the entry op n of them defined
 * (./ops.js `refs`), as a group it includes may be defined just before it. A group the vault holds stays as it is.
 * @param {CapGroup[]} have @param {string} vault
 */
export function capGroupOps(have, vault) {
	const at = new Map(have.map((g) => [g.name, g.entry]));
	/** @type {object[]} */
	const out = [];
	for (const g of CAP_GROUPS) {
		if (at.has(g.name)) continue;
		const includes = g.includes.map((n) => at.get(n)).filter((x) => !!x);
		out.push({ op: 'define_group', vault, group: { name: g.name, caps: g.caps, includes } });
		at.set(g.name, `$${out.length - 1}`);
	}
	return out;
}

/**
 * The names of vault `city`'s cap groups the person holds, as world `world` shows the shares over it and `groups` its
 * groups (the `cap_groups` op's rows): each share in force to their vault, or to everyone, that names a group, and every
 * group it includes, all the way down.
 * @param {import('./vaults.js').WorldView} world @param {string} city @param {CapGroup[]} groups
 * @returns {Set<string>}
 */
export function heldGroups(world, city, groups) {
	const byEntry = new Map(groups.map((g) => [g.entry, g]));
	const next = world.shares
		.filter((c) => c.over === city && (c.who === world.mine || c.who === EVERYONE) && !!c.capGroup)
		.map((c) => /** @type {string} */ (c.capGroup));
	const [seen, names] = [new Set(), new Set()];
	while (next.length) {
		const id = /** @type {string} */ (next.pop());
		const g = byEntry.get(id);
		if (seen.has(id) || !g) continue;
		seen.add(id);
		names.add(g.name);
		next.push(...g.includes);
	}
	return /** @type {Set<string>} */ (names);
}
