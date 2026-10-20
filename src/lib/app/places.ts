// The places of the signed-in app (/app/): what the dashboard shows as tiles and the nav pill links to. Every game,
// sandbox, world, game asset and admin's tool opens by a cap group of the Maia City COOP vault the person holds in
// avenDB (Samuel 2026-10-19: "purely behind avenDB native caps", no draft stage, no Postgres role): the sandboxes, the
// worlds and the game assets to every Traveler, as every invited human is, MaiaCity V1 to every Citizen, the admins'
// own pages to every Admin, all of it to whoever acts for Maia City ($lib/app/access.svelte.js); anyone else who has
// a link to one is told what opens it.
import { base } from '$app/paths';
import type { Founder } from '$lib/auth/client';
import { FIRST, latestOf, versionsOf, type Change, type Version } from '$lib/app/versions.js';
import { holdsGroup } from '$lib/app/access.svelte.js';
import { ADMIN, CITIZEN, TRAVELER } from '$lib/avendb/capgroups.js';
import { gameOfRoute } from '../../../game/games.js';

export type Place = {
	href: string; label: string; icon: IconName; cap?: string; note?: string; /** a picture, by hash */ cover?: string
	/** the cap group of the Maia City vault that opens it ($lib/avendb/capgroups.js): Admin for the admins' own tools */
	needs?: string
	/** a world's or sandbox's versions and history ($lib/app/versions.js), the latest its own; and what it is anchored to */
	versions?: Version<string>[]; version?: number; anchors?: string
	/** a game's id in the Maia City COOP vault (game/games.js), from its address */
	game?: string
};
export type IconName = 'back' | 'home' | 'play' | 'board' | 'calendar' | 'media' | 'studio' | 'journal' | 'spark' | 'user' | 'key' | 'ledger' | 'coops' | 'proposals' | 'leaf' | 'database' | 'universe' | 'gear' | 'chat';

// a founder's own apps: their money and the COOPs, read from MaiaCity V1's one game, the proposals of every game
// (AIPs), which live only here, never on a game's own screens (Samuel 2026-10-17), the chat, and the Universe.
// Every sandbox draws the same ones.
export const APPS: Place[] = [
	{ href: `${base}/app/ledger/`, label: 'Ledger', icon: 'ledger', note: 'Your HEARTS and MINDs, every rent and pay day, every transaction' },
	{ href: `${base}/app/coops/`, label: 'Coops', icon: 'coops', note: 'The three COOPs: treasuries, holders, assets, rents' },
	// chat rooms on avenDB: notes to self, DMs, groups and a coop's channels, every signed-in person's
	{ href: `${base}/app/chat/`, label: 'Chat', icon: 'chat', note: 'Notes to self, direct messages, groups and channels, end to end encrypted' },
	{ href: `${base}/app/aips/`, label: 'Proposals', icon: 'proposals', note: 'Every game’s proposals: ideas, proposed, applied or rejected' },
	// the Universe stream, on the public site (the navbar's Universe tab): the journal and Inspire me are its channels
	{ href: `${base}/universe/`, label: 'Universe', icon: 'universe', note: 'What happens in maiaCITY, as it happens' }
];

/** the worlds' and sandboxes' older versions, by address, each with what it was */
const HISTORY: Record<string, (Change & { build?: string })[]> = {
	[`${base}/app/games/sandbox-5/`]: [FIRST, { v: 2, date: '2026-10-06', note: 'Replanted the cacao, jackfruit, durian and soursop at their v2' }, { v: 3, date: '2026-10-06', note: 'Replanted the apple trees at v2' }, { v: 4, date: '2026-10-06', note: 'Mini fields of oats, lentils, chickpeas, edamame and hemp, and bamboo groves' }, { v: 5, date: '2026-10-06', note: 'The chicken coops, rabbit hutches and playgrounds as mini domes (their v2), eggs in the nests' }, { v: 6, date: '2026-10-06', note: 'Paths routed round the coops and squares: in from every dome to the master’s nearest door' }, { v: 7, date: '2026-10-06', note: 'Ant roads you can see: bare trodden earth from every hill, crowded with ants going out and coming home' }, { v: 8, date: '2026-10-06', note: 'The goats, sheep and rabbits graze at their v2: the neck reaching forward and down to the grass' }, { v: 9, date: '2026-10-06', note: 'The geese graze at their v2, their necks reaching to the grass; every animal eases between its moves along the shortest turn; geese graze longer between walks' }],
	[`${base}/app/games/sandbox-4/`]: [FIRST, { v: 2, date: '2026-10-06', note: 'Paths routed round the coops and squares: in from every dome to the master’s nearest door' }, { v: 3, date: '2026-10-06', note: 'Ant roads you can see: bare trodden earth from every hill, crowded with ants going out and coming home' }, { v: 4, date: '2026-10-06', note: 'The goats, sheep and rabbits graze at their v2: the neck reaching forward and down to the grass' }, { v: 5, date: '2026-10-06', note: 'The geese graze at their v2, their necks reaching to the grass; every animal eases between its moves along the shortest turn; geese graze longer between walks' }]
};
/** a list of worlds with their versions, each opened by every Traveler */
const withVersions = (list: Place[]): Place[] =>
	list.map((p) => {
		const versions = versionsOf(p.href, HISTORY[p.href]);
		return { ...p, versions, version: latestOf(versions), needs: TRAVELER, ...gameOf(p) };
	});
/** a game's id, from its address */
const gameOf = (p: Place) => {
	const id = gameOfRoute(p.href.slice(base.length));
	return id ? { game: id } : {};
};

export const PLAY: Place[] = withVersions([
	{ href: `${base}/app/games/sandbox-1/`, label: 'Sandbox 1', icon: 'play', note: 'A hex island to settle', cover: '6a08f524a54384aa2c902b0e19f3d01b0264f1c218f62a7c47c2950ed0a0b620.jpg' },
	{ href: `${base}/app/games/sandbox-2/`, label: 'Sandbox 2', icon: 'play', note: 'The planet and its first cities', cover: '88528c9521de8682f676c3e2539c3a19ffd2a4731a2343410761025e27fde55e.jpg' },
	{ href: `${base}/app/games/sandbox-4/`, label: 'Sandbox 3', icon: 'play', note: 'A whole dome cell', cover: '1427db9edf3652e5354bb645e1c8155930dd53bf7cb17e39a4019efe33c6c2d6.jpg' },
	{ href: `${base}/app/games/sandbox-5/`, label: 'Sandbox 4', icon: 'play', note: 'The dome cell, its food forest grown from our plants', cover: '5ddd7dc657e28a84e7ef48b8064dafe5698791950dea387e7059b1c41e5d2fc1.jpg', anchors: 'the Plants, each at the version its forest was planted with' },
	{ href: `${base}/app/games/sandbox-6/`, label: 'Sandbox 5', icon: 'play', note: 'A valley of settlers: production chains, an open market, abundance for all', cover: 'a36f799daadadb75a3d845776dc8ee9730f8fd92fb1458edff5d9819c155a7c8.jpg' },
	{ href: `${base}/app/games/sandbox-7/`, label: 'Sandbox 6', icon: 'play', note: 'One village at its real size: six living hexes of terraced Dome40 and Dome80 homes and Dome120s round the Tower180 hex, in tonnes, euros and hectares', cover: '46e52e9e393b192c0a6db481e95fbf623e8d12d2753a3e1d15d1663292d2c716.jpg' }
]);

// the 3D worlds made from real places, to walk and to film, opened from avenDB's Worlds (Maia City's `game` entries)
export const WORLDS: Place[] = withVersions([
	{ href: `${base}/app/worlds/tired-land/`, label: 'The tired land', icon: 'play', note: 'Day 19 · fields of one crop, a highway, trucks' }
]);

// MaiaCity itself, as games of its own, apart from the sandboxes: two players, HEARTS, COOPs and their MINDs
export const CITY: Place[] = ([
	{ href: `${base}/app/maiacity-v1/`, label: 'MaiaCity V1', icon: 'coops', note: 'Two players, three COOPs, one hex, one tent, one Balancer pool', cover: `${base}/maiacity-v1/cover.jpg` }
] as Place[]).map((p) => ({ ...p, needs: CITIZEN, ...gameOf(p) }));


/** every game, on the dashboard's Game Worlds: MaiaCity V1 first, then the sandboxes */
export const GAME_WORLDS: Place[] = [...CITY, ...PLAY];

export const holds = (founder: Founder | null, p: Place) => !p.cap || !!founder?.caps?.includes(p.cap);

/** An admin: holds Maia City's Admin cap group, or acts for Maia City. */
export const isAdmin = () => holdsGroup(ADMIN);

/** Whether the person opens a place: by the cap group of Maia City it needs, if any. */
export const opens = (p: Place) => !p.needs || holdsGroup(p.needs);

/** The game, world, game asset or admin's page a path is in, if any: closed to whoever doesn't hold what opens it. */
export const gameAt = (path: string) =>
	[...CITY, ...PLAY, ...WORLDS].find((p) => path.startsWith(p.href)) ?? PAGES.find((p) => path.startsWith(p.href));
/** the Worlds grid and the game assets' own pages (the Buildings, the Factories, the Biomes): every Traveler's; the
 *  Skills, the Postgres window and avenDB's own page: the admins'. The studio keeps its own gate: it works on the
 *  media vault through the API, which decides who may (`media:admin`). The Postgres window's rows open by the same
 *  Admin group, as avenDB's server tells the API of the pass the page's device signs (api/src/standing.ts) */
const PAGES: Place[] = [
	{ href: `${base}/app/worlds/`, label: 'Worlds', icon: 'play', needs: TRAVELER },
	{ href: `${base}/app/factories/`, label: 'Factories', icon: 'gear', needs: TRAVELER },
	{ href: `${base}/app/buildings/`, label: 'Buildings', icon: 'home', needs: TRAVELER },
	{ href: `${base}/app/biomes/`, label: 'Biomes', icon: 'leaf', needs: TRAVELER },
	{ href: `${base}/app/skills/`, label: 'Skills', icon: 'journal', needs: ADMIN },
	{ href: `${base}/app/postgres/`, label: 'Postgres', icon: 'database', needs: ADMIN },
	{ href: `${base}/app/avendb/`, label: 'avenDB', icon: 'database', needs: ADMIN }
];
