// The places of the signed-in app (/app/): what the dashboard shows as tiles and the nav pill links to. A place
// with a capability is only for whoever holds it (the admin's tools). A game has a release: "published" is open to
// every founder; a "draft" only to the admins (marked Draft), and anyone else who has its link is told it is not
// released yet. Flip it here to publish or withdraw a sandbox.
import { base } from '$app/paths';
import type { Founder } from '$lib/auth/client';
import { FIRST, latestOf, versionsOf, type Change, type Version } from '$lib/app/versions.js';

export type Release = 'draft' | 'published';
export type Place = {
	href: string; label: string; icon: IconName; cap?: string; note?: string; /** a picture, by hash */ cover?: string; release?: Release
	/** a world's or sandbox's versions and history ($lib/app/versions.js), the latest its own; and what it is anchored to */
	versions?: Version<string>[]; version?: number; anchors?: string
};
export type IconName = 'back' | 'home' | 'play' | 'board' | 'calendar' | 'media' | 'studio' | 'journal' | 'spark' | 'user' | 'key' | 'ledger' | 'coops' | 'leaf' | 'database';

// a founder's own apps: their money, and the communities — cities and settlements, founded, joined and backed here,
// with no map. Every sandbox draws the same ones.
export const APPS: Place[] = [
	{ href: `${base}/app/ledger/`, label: 'Ledger', icon: 'ledger', note: 'Your hearts, what you hold, what happened' },
	{ href: `${base}/app/coops/`, label: 'Coops', icon: 'coops', note: 'Found, join and back cities and settlements' }
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
		return { ...p, versions, version: latestOf(versions) };
	});

export const PLAY: Place[] = withVersions([
	{ href: `${base}/app/games/sandbox-1/`, label: 'Sandbox 1', icon: 'play', release: 'draft', note: 'A hex island to settle', cover: '6a08f524a54384aa2c902b0e19f3d01b0264f1c218f62a7c47c2950ed0a0b620.jpg' },
	{ href: `${base}/app/games/sandbox-2/`, label: 'Sandbox 2', icon: 'play', release: 'draft', note: 'The planet and its first cities', cover: '88528c9521de8682f676c3e2539c3a19ffd2a4731a2343410761025e27fde55e.jpg' },
	{ href: `${base}/app/games/sandbox-4/`, label: 'Sandbox 3', icon: 'play', release: 'draft', note: 'A whole dome cell', cover: '1427db9edf3652e5354bb645e1c8155930dd53bf7cb17e39a4019efe33c6c2d6.jpg' },
	{ href: `${base}/app/games/sandbox-5/`, label: 'Sandbox 4', icon: 'play', release: 'draft', note: 'The dome cell, its food forest grown from our plants', cover: '5ddd7dc657e28a84e7ef48b8064dafe5698791950dea387e7059b1c41e5d2fc1.jpg', anchors: 'the Plants, each at the version its forest was planted with' },
	{ href: `${base}/app/games/sandbox-6/`, label: 'Sandbox 5', icon: 'play', release: 'draft', note: 'A valley of settlers: production chains, an open market, abundance for all', cover: 'a36f799daadadb75a3d845776dc8ee9730f8fd92fb1458edff5d9819c155a7c8.jpg' },
	{ href: `${base}/app/games/sandbox-7/`, label: 'Sandbox 6', icon: 'play', release: 'draft', note: 'One village at its real size: six living hexes of terraced Dome40 and Dome80 homes and Dome120s round the Tower180 hex, in tonnes, euros and hectares' }
]);

// the 3D worlds made from real places, to walk and to film (an admin's: drafts, opened from the Worlds tile)
export const WORLDS: Place[] = withVersions([
	{ href: `${base}/app/worlds/room/`, label: 'Apartment of Samuel', icon: 'play', release: 'draft', note: 'Day 02 · his room, the hallway, the kitchen, the bathroom' },
	{ href: `${base}/app/worlds/tired-land/`, label: 'The tired land', icon: 'play', release: 'draft', note: 'Day 19 · fields of one crop, a highway, trucks' },
	{ href: `${base}/app/worlds/isar/`, label: 'The Isar', icon: 'play', release: 'draft', note: 'Munich · from the Wittelsbacherbrücke south to the railway bridge' },
	{ href: `${base}/app/worlds/backyard/`, label: 'The backyard', icon: 'play', release: 'draft', note: 'Munich · the courtyard, the pergola terrace, the garden corner' }
]);

export const READ: Place[] = [
	{ href: `${base}/blog/`, label: 'Journal', icon: 'journal', note: 'Day by day' },
	{ href: `${base}/blog/inspire-me/`, label: 'Inspire me', icon: 'spark', note: 'Ideas we learn from' }
];

export const ADMIN: Place[] = [
	{ href: `${base}/app/stories/`, label: 'Stories', icon: 'board', cap: 'content:admin', note: 'Every story, idea to published, and when it goes out' },
	{ href: `${base}/app/studio/`, label: 'Studio', icon: 'studio', cap: 'media:admin', note: 'Films and sound' },
	{ href: `${base}/app/worlds/`, label: 'Worlds', icon: 'play', cap: 'media:admin', note: 'Real places as 3D worlds, to walk and film' },
	{ href: `${base}/app/models/`, label: 'Assets', icon: 'media', cap: 'media:admin', note: 'The things the worlds are built from' },
	{ href: `${base}/app/buildings/`, label: 'Buildings', icon: 'home', cap: 'media:admin', note: 'The tents, the domes and the containers, to walk inside' },
	{ href: `${base}/app/actors/`, label: 'Actors', icon: 'user', cap: 'media:admin', note: 'The stand-in and the animals, rigged to move' },
	{ href: `${base}/app/plants/`, label: 'Plants', icon: 'leaf', cap: 'media:admin', note: 'Grown from code, seed to fruit, roots and all' },
	{ href: `${base}/app/biomes/`, label: 'Biomes', icon: 'leaf', cap: 'media:admin', note: 'The floors the worlds stand on, in layers that mix' },
	{ href: `${base}/app/skills/`, label: 'Skills', icon: 'journal', cap: 'media:admin', note: "The film crew's skills, as a wiki" },
	{ href: `${base}/app/avendb/`, label: 'avenDB', icon: 'database', cap: 'media:admin', note: 'The user-owned database: every device in one page' },
	{ href: `${base}/app/device/`, label: 'Terminal', icon: 'key', cap: 'media:admin', note: 'Sign a terminal in' }
];

export const holds = (founder: Founder | null, p: Place) => !p.cap || !!founder?.caps?.includes(p.cap);

/** An admin: holds any of the admin's capabilities. */
export const isAdmin = (founder: Founder | null) => !!founder?.caps?.some((c) => c.endsWith(':admin'));

/** Whether this founder may open a place: a draft only an admin. */
export const released = (founder: Founder | null, p: Place) => p.release !== 'draft' || isAdmin(founder);

/** The game (or world) a path is in, if any: a draft one is closed to whoever is no admin. */
export const gameAt = (path: string) =>
	[...PLAY, ...WORLDS].find((p) => path.startsWith(p.href)) ??
	(path.startsWith(`${base}/app/worlds/`) ? WORLDS_TILE : path.startsWith(`${base}/app/models/`) ? MODELS_TILE : path.startsWith(`${base}/app/buildings/`) ? BUILDINGS_TILE : path.startsWith(`${base}/app/actors/`) ? ACTORS_TILE : path.startsWith(`${base}/app/plants/`) ? PLANTS_TILE : path.startsWith(`${base}/app/biomes/`) ? BIOMES_TILE : path.startsWith(`${base}/app/skills/`) ? SKILLS_TILE : path.startsWith(`${base}/app/avendb/`) ? AVENDB_TILE : undefined);
/** the Worlds grid, the Assets, the Buildings, the Actors, the Plants, the Skills and avenDB: only an admin's */
const WORLDS_TILE: Place = { href: `${base}/app/worlds/`, label: 'Worlds', icon: 'play', release: 'draft' };
const MODELS_TILE: Place = { href: `${base}/app/models/`, label: 'Assets', icon: 'media', release: 'draft' };
const BUILDINGS_TILE: Place = { href: `${base}/app/buildings/`, label: 'Buildings', icon: 'home', release: 'draft' };
const ACTORS_TILE: Place = { href: `${base}/app/actors/`, label: 'Actors', icon: 'user', release: 'draft' };
const PLANTS_TILE: Place = { href: `${base}/app/plants/`, label: 'Plants', icon: 'leaf', release: 'draft' };
const BIOMES_TILE: Place = { href: `${base}/app/biomes/`, label: 'Biomes', icon: 'leaf', release: 'draft' };
const SKILLS_TILE: Place = { href: `${base}/app/skills/`, label: 'Skills', icon: 'journal', release: 'draft' };
const AVENDB_TILE: Place = { href: `${base}/app/avendb/`, label: 'avenDB', icon: 'database', release: 'draft' };

/** Where a path is, in words: the top bar's title. */
export function placeOf(path: string): string {
	const rel = path.slice(base.length).replace(/\/+$/, '/');
	if (rel === '/app/') return 'Dashboard';
	if (rel.startsWith('/app/games/')) return PLAY.find((p) => path.startsWith(p.href))?.label ?? 'Games';
	if (rel.startsWith('/app/worlds/')) return WORLDS.find((p) => path.startsWith(p.href))?.label ?? 'Worlds';
	if (rel.startsWith('/app/models/')) return 'Assets';
	if (rel.startsWith('/app/buildings/')) return 'Buildings';
	if (rel.startsWith('/app/actors/')) return 'Actors';
	if (rel.startsWith('/app/plants/')) return 'Plants';
	if (rel.startsWith('/app/biomes/')) return 'Biomes';
	if (rel.startsWith('/app/skills/')) return 'Skills';
	if (rel.startsWith('/app/avendb/')) return 'avenDB';
	const app = APPS.find((p) => path.startsWith(p.href));
	if (app) return app.label;
	return ADMIN.find((p) => path.startsWith(p.href))?.label ?? '';
}
