/*
 * The cap groups of the Maia City COOP vault (Samuel 2026-10-19: access to the sandboxes, the worlds, the game assets
 * and the games "purely behind avenDB native caps", "Not depending on PG"; "Always go for the full lean! Way"). A cap
 * group is an entry of its vault, `{name, caps, includes}`, each cap one op over one slice, and every right to it is a
 * share that names the group: a new version of the group reaches every share naming it at once, and revoking a share
 * ends that one alone (avendb/spec/AvenDB/Gate.lean, avendb/docs/ARCHITECTURE.md §8). An invite is such a share to a
 * one-time key, which the newcomer's vault claims at sign-up with no owner signing ($lib/app/entry.js).
 *
 *   Traveler   every invited human: Sandbox 4 demo only. Public assets and Universe posts remain public;
 *              the person owns their own profile independently of this group
 *   Citizen    a Traveler who plays MaiaCity V1 too (to become the paid one later), and reads all of V1, its proposals
 *              among it; V1's moves still run on maiaCITY's API, so no write of them is a cap yet. Nobody is invited
 *              a citizen (Samuel 2026-10-19): travelers become citizens by other means, later
 *   Admin      a Citizen who reads all of Maia City and opens the admins' own pages (avenDB's own page, the
 *              vault apps on the dashboard, signing a terminal in; Samuel 2026-10-19: no Postgres role decides it), and
 *              may found coops and avens through avenDB's server (avendb's `gate::ADMIN`). Maia City's own owners always
 *              may all of it; anyone else holds it by a share of it
 *
 *   Agent      what the coop's aven, avenMAIA, holds, so every agent session of it (Samuel 2026-10-21: the Suggester's and
 *              the AIP author's shares as one group): reads all of Maia City, drafts new entries and writes on proposals,
 *              starts and merges them, and adds and sets its AIPs, so an agent opens and promotes them as their author;
 *              a human of Maia City accepts each. No seed defines it: an owner gives it in the Vaults app (`agentOps`)
 *
 * The repo seed defines the first three groups once, on the first device of Maia City's owner (./seed.js runs in
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

/** The group the coop's aven holds, so its agents. */
export const AGENT = 'Agent';

/** MaiaCity V1's tag in the Maia City vault, which every entry of it carries (game/games.js `gameTag`). */
const V1 = 'game:maiacity-v1';
export const TRAVELER_GAME = 'sandbox-4';
const GAME_READS = [{ op: 'read', where: { type: ['game', 'recipe', 'view', 'logic', 'config'] } }];

/**
 * Traveler grants the demo's game tag only. Public recipes and posts are read through
 * their existing public shares, not a blanket recipe grant. Citizen retains all game code.
 * @type {{ name: string, caps: { op: string, where?: object }[], includes: string[] }[]}
 */
export const CAP_GROUPS = [
	{ name: TRAVELER, caps: [{ op: 'read', where: { tag: `game:${TRAVELER_GAME}` } }], includes: [] },
	{ name: CITIZEN, caps: [...GAME_READS, { op: 'read', where: { tag: V1 } }, { op: 'read', where: { tag: 'game:maiacity-v2' } }], includes: [TRAVELER] },
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

/**
 * Who holds which of vault `city`'s cap groups, and the invites open, as a device's world shows the shares in force over
 * it (`shares`, its world's `shares`) and the vault's groups (`groups`, the `cap_groups` op's rows): by each vault, the
 * shares to it that name a group, each `{share, group, name}`; and each invite no vault claimed yet, a share that names a
 * group to a key that is no vault's (`isVault` tells a vault's id from an invite key's, which a world writes alike). What
 * the Vaults app (./Vaults.svelte) shows and changes.
 * @param {import('./vaults.js').CapView[]} shares @param {string} city @param {CapGroup[]} groups
 * @param {(id: string) => boolean} isVault
 * @returns {{ held: Map<string, { share: string, group: string, name: string }[]>,
 *   invites: { share: string, group: string, name: string, issuer: string | null }[] }}
 */
export function groupHolders(shares, city, groups, isVault) {
	const names = new Map(groups.map((g) => [g.entry, g.name]));
	const held = new Map();
	const invites = [];
	for (const c of shares) {
		if (c.over !== city || !c.capGroup || c.who === EVERYONE) continue;
		const one = { share: c.id, group: c.capGroup, name: names.get(c.capGroup) ?? '' };
		if (isVault(c.who)) held.set(c.who, [...(held.get(c.who) ?? []), one]);
		else invites.push({ ...one, issuer: c.issuer });
	}
	return { held, invites };
}

/**
 * The ops that make human vault `vault` a `to` of vault `city`, Traveler or Citizen (Samuel 2026-10-20: an admin moves
 * travelers to citizens and back), as `city` itself: a share of group `to` first, so they never stand with neither,
 * then the revocation of each share of the other of the two that they hold (`held`, as `groupHolders` lists them); none
 * where they hold `to` alone already. An Admin share stays as it is: the app changes no admin's roles.
 * @param {string} city @param {string} vault @param {'Traveler' | 'Citizen'} to @param {CapGroup[]} groups
 * @param {{ share: string, name: string }[]} held
 */
export function moveOps(city, vault, to, groups, held) {
	const group = groups.find((g) => g.name === to);
	if (!group) throw new Error(`Maia City has no ${to} group yet.`);
	const other = to === TRAVELER ? CITIZEN : TRAVELER;
	const drop = held.filter((h) => h.name === other).map((h) => ({ op: 'revoke', share: h.share, as: city }));
	const has = held.some((h) => h.name === to);
	if (has && !drop.length) return [];
	return [...(has ? [] : [{ op: 'share_group', over: city, group: group.entry, who: { vault }, as: city }]), ...drop];
}

/** What the Agent group gives (avendb/crates/avendb/tests/cap_groups.rs proves it), its AIPs its entries of type `aip`. */
export const AGENT_GROUP = {
	name: AGENT,
	caps: [
		{ op: 'read' },
		{ op: 'create', on: 'proposals' },
		{ op: 'set', path: [], on: 'proposals' },
		{ op: 'propose' },
		{ op: 'merge', on: 'proposals' },
		{ op: 'create', where: { type: ['aip'] } },
		{ op: 'set', path: [], where: { type: ['aip'] } }
	],
	includes: []
};

/** The shares the Agent group stands in for: a Suggester's, and an AIP author's (./vaults.js `AIP_AUTHOR`). */
const OLD_AGENT = (/** @type {import('./vaults.js').CapView} */ c) =>
	!c.capGroup && (c.group === 'Suggester' || c.slice?.name === 'AIP author');

/**
 * The ops, run one after another as vault `city` itself, that give aven `aven` Maia City's Agent group in place of the
 * shares it stands in for: the group defined first where `city` holds none yet (`groups`, the `cap_groups` op's rows),
 * then a share of it to the aven where it holds none, then the revocation of each Suggester's and AIP author's share
 * over `city` to the aven (`shares`, its world's), so it never stands with neither. None where it is done.
 * @param {string} city @param {string} aven @param {CapGroup[]} groups @param {import('./vaults.js').CapView[]} shares
 */
export function agentOps(city, aven, groups, shares) {
	const group = groups.find((g) => g.name === AGENT)?.entry;
	const mine = shares.filter((c) => c.over === city && c.who === aven);
	const define = group ? [] : [{ op: 'define_group', vault: city, group: AGENT_GROUP }];
	const has = !!group && mine.some((c) => c.capGroup === group);
	const give = has ? [] : [{ op: 'share_group', over: city, group: group ?? '$0', who: { vault: aven }, as: city }];
	const drop = mine.filter(OLD_AGENT).map((c) => ({ op: 'revoke', share: c.id, as: city }));
	return [...define, ...give, ...drop];
}

/** Whether aven `aven` holds Maia City's Agent group, as `shares` show it. @param {string} city @param {string} aven
 *  @param {CapGroup[]} groups @param {import('./vaults.js').CapView[]} shares */
export const holdsAgent = (city, aven, groups, shares) => {
	const group = groups.find((g) => g.name === AGENT)?.entry;
	return !!group && shares.some((c) => c.over === city && c.who === aven && c.capGroup === group);
};

/** Migrate only the known original grants, preserving custom owner policies. Citizen first keeps existing access.
 * Public shares and the person's own vault are independent of these Maia City grants.
 * @param {CapGroup[]} have
 */
export function travelerDemoOps(have) {
 const traveler = have.find(g => g.name === TRAVELER);
 const citizen = have.find(g => g.name === CITIZEN);
 if (!traveler || JSON.stringify(traveler.caps) !== JSON.stringify(GAME_READS) || traveler.includes.length) return [];
 const ops = [];
 if (citizen) {
  const caps = [...citizen.caps];
  for (const cap of CAP_GROUPS[1].caps) if (!caps.some(c => JSON.stringify(c) === JSON.stringify(cap))) caps.push(cap);
  ops.push({ op: 'redefine_group', entry: citizen.entry, group: { name: citizen.name, caps, includes: citizen.includes } });
 }
 ops.push({ op: 'redefine_group', entry: traveler.entry, group: { name: TRAVELER, caps: CAP_GROUPS[0].caps, includes: [] } });
 return ops;
}
