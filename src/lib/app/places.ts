// The places of the signed-in app (/app/): what the dashboard shows as tiles and the nav pill links to. A place
// with a capability is only for whoever holds it (the admin's tools). A game (`game`, its id in the Maia City COOP
// vault's Games area, game/games.js) is published while that vault gives everyone a Public share on its tag: then it
// is open to every founder; else it is a draft, only the admins' (marked Draft), and anyone else who has its link is
// told it is not released yet. Its owner publishes or withdraws it on the Sandboxes list ($lib/app/games.svelte.js);
// `release` is what the repo said, kept until the vault's feed answers.
import { base } from '$app/paths';
import type { Founder } from '$lib/auth/client';
import { FIRST, latestOf, versionsOf, type Change, type Version } from '$lib/app/versions.js';
import { isPublished } from '$lib/app/games.svelte.js';
import { gameOfRoute } from '../../../game/games.js';

export type Release = 'draft' | 'published';
export type Place = {
	href: string; label: string; icon: IconName; cap?: string; note?: string; /** a picture, by hash */ cover?: string; release?: Release
	/** a world's or sandbox's versions and history ($lib/app/versions.js), the latest its own; and what it is anchored to */
	versions?: Version<string>[]; version?: number; anchors?: string
	/** a game's id in the Maia City COOP vault (game/games.js), from its address */
	game?: string
};
export type IconName = 'back' | 'home' | 'play' | 'board' | 'calendar' | 'media' | 'studio' | 'journal' | 'spark' | 'user' | 'key' | 'ledger' | 'coops' | 'proposals' | 'leaf' | 'database' | 'universe' | 'gear';

// a founder's own apps: their money and the COOPs, read from MaiaCity V1's one game, the proposals of every game
// (AIPs), which live only here, never on a game's own screens (Samuel 2026-10-17), and the Universe.
// Every sandbox draws the same ones.
export const APPS: Place[] = [
	{ href: `${base}/app/ledger/`, label: 'Ledger', icon: 'ledger', note: 'Your HEARTS and MINDs, every rent and pay day, every transaction' },
	{ href: `${base}/app/coops/`, label: 'Coops', icon: 'coops', note: 'The three COOPs: treasuries, holders, assets, rents' },
	{ href: `${base}/app/aips/`, label: 'Proposals', icon: 'proposals', note: 'Every game’s proposals: ideas, proposed, applied or rejected' },
	// the Universe stream, on the public site (the navbar's Universe tab): the journal and Inspire me are its channels
	{ href: `${base}/universe/`, label: 'Universe', icon: 'universe', note: 'What happens in maiaCITY, as it happens' }
];

/** the worlds' and sandboxes' older versions, by address, each with what it was */
const HISTORY: Record<string, (Change & { build?: string })[]> = {
	[`${base}/app/games/sandbox-5/`]: [FIRST, { v: 2, date: '2026-10-06', note: 'Replanted the cacao, jackfruit, durian and soursop at their v2' }, { v: 3, date: '2026-10-06', note: 'Replanted the apple trees at v2' }, { v: 4, date: '2026-10-06', note: 'Mini fields of oats, lentils, chickpeas, edamame and hemp, and bamboo groves' }, { v: 5, date: '2026-10-06', note: 'The chicken coops, rabbit hutches and playgrounds as mini domes (their v2), eggs in the nests' }, { v: 6, date: '2026-10-06', note: 'Paths routed round the coops and squares: in from every dome to the master’s nearest door' }, { v: 7, date: '2026-10-06', note: 'Ant roads you can see: bare trodden earth from every hill, crowded with ants going out and coming home' }, { v: 8, date: '2026-10-06', note: 'The goats, sheep and rabbits graze at their v2: the neck reaching forward and down to the grass' }, { v: 9, date: '2026-10-06', note: 'The geese graze at their v2, their necks reaching to the grass; every animal eases between its moves along the shortest turn; geese graze longer between walks' }],
	[`${base}/app/games/sandbox-4/`]: [FIRST, { v: 2, date: '2026-10-06', note: 'Paths routed round the coops and squares: in from every dome to the master’s nearest door' }, { v: 3, date: '2026-10-06', note: 'Ant roads you can see: bare trodden earth from every hill, crowded with ants going out and coming home' }, { v: 4, date: '2026-10-06', note: 'The goats, sheep and rabbits graze at their v2: the neck reaching forward and down to the grass' }, { v: 5, date: '2026-10-06', note: 'The geese graze at their v2, their necks reaching to the grass; every animal eases between its moves along the shortest turn; geese graze longer between walks' }]
};
/** a list of worlds with their versions */
const withVersions = (list: Place[]): Place[] =>
	list.map((p) => {
		const versions = versionsOf(p.href, HISTORY[p.href]);
		return { ...p, versions, version: latestOf(versions), ...gameOf(p) };
	});
/** a game's id, from its address */
const gameOf = (p: Place) => {
	const id = gameOfRoute(p.href.slice(base.length));
	return id ? { game: id } : {};
};

export const PLAY: Place[] = withVersions([
	{ href: `${base}/app/games/sandbox-1/`, label: 'Sandbox 1', icon: 'play', release: 'draft', note: 'A hex island to settle', cover: '6a08f524a54384aa2c902b0e19f3d01b0264f1c218f62a7c47c2950ed0a0b620.jpg' },
	{ href: `${base}/app/games/sandbox-2/`, label: 'Sandbox 2', icon: 'play', release: 'draft', note: 'The planet and its first cities', cover: '88528c9521de8682f676c3e2539c3a19ffd2a4731a2343410761025e27fde55e.jpg' },
	{ href: `${base}/app/games/sandbox-4/`, label: 'Sandbox 3', icon: 'play', release: 'draft', note: 'A whole dome cell', cover: '1427db9edf3652e5354bb645e1c8155930dd53bf7cb17e39a4019efe33c6c2d6.jpg' },
	{ href: `${base}/app/games/sandbox-5/`, label: 'Sandbox 4', icon: 'play', release: 'draft', note: 'The dome cell, its food forest grown from our plants', cover: '5ddd7dc657e28a84e7ef48b8064dafe5698791950dea387e7059b1c41e5d2fc1.jpg', anchors: 'the Plants, each at the version its forest was planted with' },
	{ href: `${base}/app/games/sandbox-6/`, label: 'Sandbox 5', icon: 'play', release: 'draft', note: 'A valley of settlers: production chains, an open market, abundance for all', cover: 'a36f799daadadb75a3d845776dc8ee9730f8fd92fb1458edff5d9819c155a7c8.jpg' },
	{ href: `${base}/app/games/sandbox-7/`, label: 'Sandbox 6', icon: 'play', release: 'draft', note: 'One village at its real size: six living hexes of terraced Dome40 and Dome80 homes and Dome120s round the Tower180 hex, in tonnes, euros and hectares', cover: '46e52e9e393b192c0a6db481e95fbf623e8d12d2753a3e1d15d1663292d2c716.jpg' }
]);

// the 3D worlds made from real places, to walk and to film (an admin's: drafts, opened from the Worlds tile)
export const WORLDS: Place[] = withVersions([
	{ href: `${base}/app/worlds/tired-land/`, label: 'The tired land', icon: 'play', release: 'draft', note: 'Day 19 · fields of one crop, a highway, trucks' }
]);

// MaiaCity itself, as games of its own, apart from the sandboxes: two players, HEARTS, COOPs and their MINDs
export const CITY: Place[] = ([
	{ href: `${base}/app/maiacity-v1/`, label: 'MaiaCity V1', icon: 'coops', note: 'Two players, three COOPs, one hex, one tent, one Balancer pool', cover: `${base}/maiacity-v1/cover.jpg` }
] as Place[]).map((p) => ({ ...p, ...gameOf(p) }));


/** the game's building blocks, one group on the dashboard (Game Assets, /app/assets/), listed with a picture each, in
 *  the asset producer's order (.claude/skills/asset-producer): the factories (whole production lines, live), the
 *  machines, the actors (people and animals), the worlds, the buildings, the things, the biomes and the plants, then
 *  the engine's two labs under them all (the asset box, the renderer). The things are the still models (src/lib/models; the address kept from when they were the Models) */
export const GAME_ASSETS: Place[] = [
	{ href: `${base}/app/factories/`, label: 'Factories', icon: 'gear', cap: 'media:admin', note: 'Whole production lines, run live by simulation: the BatteryPack line', cover: `${base}/app/covers/factories.jpg` },
	{ href: `${base}/app/machines/`, label: 'Machines', icon: 'gear', cap: 'media:admin', note: 'Diggers, the pod, the LifeTrac, the cubes: every part its own', cover: `${base}/app/covers/machines.jpg` },
	{ href: `${base}/app/actors/`, label: 'Actors', icon: 'user', cap: 'media:admin', note: 'People and animals, rigged to move', cover: `${base}/app/covers/actors.jpg` },
	{ href: `${base}/app/worlds/`, label: 'Worlds', icon: 'play', cap: 'media:admin', note: 'Real places as 3D worlds, to walk and film', cover: `${base}/app/covers/worlds.jpg` },
	{ href: `${base}/app/buildings/`, label: 'Buildings', icon: 'home', cap: 'media:admin', note: 'The tents, the domes and the containers, to walk inside', cover: `${base}/app/covers/buildings.jpg` },
	{ href: `${base}/app/models/`, label: 'Things', icon: 'media', cap: 'media:admin', note: 'The still things the worlds are built from', cover: `${base}/app/covers/models.jpg` },
	{ href: `${base}/app/biomes/`, label: 'Biomes', icon: 'leaf', cap: 'media:admin', note: 'The floors the worlds stand on, in layers that mix', cover: `${base}/app/covers/biomes.jpg` },
	{ href: `${base}/app/plants/`, label: 'Plants', icon: 'leaf', cap: 'media:admin', note: 'Grown from code, seed to fruit, roots and all', cover: `${base}/app/covers/plants.jpg` },
	{ href: `${base}/app/assets/box/`, label: 'Asset box', icon: 'gear', cap: 'media:admin', note: 'The engine\'s safety lab: our assets built where an untrusted one would run', cover: `${base}/app/covers/box.jpg` },
	{ href: `${base}/app/assets/render/`, label: 'Renderer lab', icon: 'gear', cap: 'media:admin', note: 'A thousand assets from the box, drawn by one renderer at the detail each needs', cover: `${base}/app/covers/render.jpg` }
];

/** the game's building blocks as one list (Game Assets, /app/assets/), an admin's tile among the dashboard's apps */
export type Group = Place & { items: Place[] };
export const ASSETS_GROUP: Group = { href: `${base}/app/assets/`, label: 'Game Assets', icon: 'media', cap: 'media:admin', note: 'Factories, machines, actors, worlds, buildings, things, biomes and plants', items: GAME_ASSETS };

/** every game, on the dashboard's Game Worlds: MaiaCity V1 first, then the sandboxes, each published as the Maia City
 *  COOP vault says ($lib/app/games.svelte.js) */
export const GAME_WORLDS: Place[] = [...CITY, ...PLAY];

/** the group a place sits in, if any (a game asset's, Game Assets): its way back goes there */
export const groupOf = (path: string) => (ASSETS_GROUP.items.some((p) => path.startsWith(p.href)) ? ASSETS_GROUP : undefined);

export const holds = (founder: Founder | null, p: Place) => !p.cap || !!founder?.caps?.includes(p.cap);

/** An admin: holds any of the admin's capabilities. */
export const isAdmin = (founder: Founder | null) => !!founder?.caps?.some((c) => c.endsWith(':admin'));

/** Whether a place is published: a game as the Maia City COOP vault says, else as the repo says. */
export const published = (p: Place) => isPublished(p.game, p.release !== 'draft');

/** Whether this founder may open a place: a draft only an admin. */
export const released = (founder: Founder | null, p: Place) => published(p) || isAdmin(founder);

/** The game (or world) a path is in, if any: a draft one is closed to whoever is no admin. */
export const gameAt = (path: string) =>
	[...PLAY, ...WORLDS].find((p) => path.startsWith(p.href)) ??
	(path.startsWith(`${base}/app/worlds/`) ? WORLDS_TILE : path.startsWith(`${base}/app/models/`) ? MODELS_TILE : path.startsWith(`${base}/app/buildings/`) ? BUILDINGS_TILE : path.startsWith(`${base}/app/actors/`) ? ACTORS_TILE : path.startsWith(`${base}/app/factories/`) ? FACTORIES_TILE : path.startsWith(`${base}/app/machines/`) ? MACHINES_TILE : path.startsWith(`${base}/app/plants/`) ? PLANTS_TILE : path.startsWith(`${base}/app/biomes/`) ? BIOMES_TILE : path.startsWith(`${base}/app/skills/`) ? SKILLS_TILE : path.startsWith(`${base}/app/avendb/`) ? AVENDB_TILE : path.startsWith(`${base}/app/genui/`) ? GENUI_TILE : undefined);
/** the Worlds grid, the Things, the Buildings, the Actors, the Factories, the Machines, the Plants, the Skills and avenDB: only an admin's */
const WORLDS_TILE: Place = { href: `${base}/app/worlds/`, label: 'Worlds', icon: 'play', release: 'draft' };
const FACTORIES_TILE: Place = { href: `${base}/app/factories/`, label: 'Factories', icon: 'gear', release: 'draft' };
const MODELS_TILE: Place = { href: `${base}/app/models/`, label: 'Things', icon: 'media', release: 'draft' };
const BUILDINGS_TILE: Place = { href: `${base}/app/buildings/`, label: 'Buildings', icon: 'home', release: 'draft' };
const ACTORS_TILE: Place = { href: `${base}/app/actors/`, label: 'Actors', icon: 'user', release: 'draft' };
const MACHINES_TILE: Place = { href: `${base}/app/machines/`, label: 'Machines', icon: 'gear', release: 'draft' };
const PLANTS_TILE: Place = { href: `${base}/app/plants/`, label: 'Plants', icon: 'leaf', release: 'draft' };
const BIOMES_TILE: Place = { href: `${base}/app/biomes/`, label: 'Biomes', icon: 'leaf', release: 'draft' };
const SKILLS_TILE: Place = { href: `${base}/app/skills/`, label: 'Skills', icon: 'journal', release: 'draft' };
const AVENDB_TILE: Place = { href: `${base}/app/avendb/`, label: 'avenDB', icon: 'database', release: 'draft' };
const GENUI_TILE: Place = { href: `${base}/app/genui/`, label: 'Generated UI', icon: 'spark', release: 'draft' };
