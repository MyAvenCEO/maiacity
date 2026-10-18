// THE WORLDS A SHOT CAN BE IN — every world the film camera can shoot, and where its film page is: the one registry
// of them (Samuel 2026-10-18: every world, sandbox, game and the studio's 3D view built from one pattern). The shot's
// validation (./shot.js), the studio's world picker (src/lib/studio/Inspector.svelte), its ShotSpec type
// (src/lib/auth/client.ts reads `Sandbox` from here), the film pages (src/lib/film/FilmRoute.svelte) and the shoot
// scripts all read this list and nothing else.
//
// A shot names its world (`spec.world.sandbox`) and, where a sandbox has more than one place, which (`world.area`;
// its first is the default). Each world's film page, `/games/<sandbox>/?film&area=<area>`, mounts that world alone
// under the film's clocks and hands it to the film camera (src/lib/sandbox-kit/film.js): the studio's world viewer,
// the Mac app's plate renderer and the shoot CLI all open a shot's world from here.
// Plain JavaScript, shared by the browser, the API and the scripts.

/**
 * @typedef {'sandbox-1' | 'sandbox-2' | 'sandbox-3' | 'sandbox-4' | 'sandbox-5' | 'sandbox-6' | 'tired-land' | 'maiacity-v1'} Sandbox
 *   every world's id, as a shot names it (`world.sandbox`): the keys of WORLDS
 */
/**
 * @typedef {{ label: string, range: [number, number], unit?: string }} Channel
 *   one way a part of a world moves (a van along its road, a door open): what the studio calls it, the values it takes
 *   (a shot's are kept to them), and what they are in
 * @typedef {{ id: string, label: string, channels: Record<string, Channel> }} Part
 *   a moving part of a world a shot can move (`spec.parts`): a vehicle, an actor, a machine, a door, water. Left out
 *   of a shot, a part moves as the world moves it itself
 */
/**
 * @typedef {{ label: string, route: string, areas: string[] | null, areaNames?: Record<string, string>, domes?: number, sets?: string[], parts: Part[] }} World
 *   label: its name in the studio; route: the app's page of it, where its old address /games/<id>/ passes on to (from
 *   the site's root); areas: the places a shot can be in (the first is the default), or null for a world that is one
 *   place, and what each is called (areaNames); domes: how many domes a shot can name (world.dome); sets: the sets a
 *   shot can build into it (world.props); parts: its moving parts a shot can animate, each a lane of its own in the
 *   studio's 3D timeline (one per channel), beside the camera, the lens, the hour and the lights every world has
 */

/** @type {Record<Sandbox, World>} */
export const WORLDS = {
	// the hex island of the city-builder, seen from above; always the same island
	'sandbox-1': { label: 'Sandbox 1 · the island', route: '/app/games/sandbox-1/', areas: ['island'], parts: [] },
	// the planet itself, drawn from its map, so a shot renders the same every time
	'sandbox-2': { label: 'Sandbox 2 · the planet', route: '/app/games/sandbox-2/', areas: ['planet'], parts: [] },
	// one dome's whole inside, walked at eye height, with its forest round it
	'sandbox-3': { label: 'Sandbox 3 · inside a dome', route: '/app/buildings/', areas: ['home', 'tent', 'glamp', 'large', 'master', 'factory'], parts: [] },
	// a whole dome cell: thirteen domes, their insides built as the camera comes
	'sandbox-4': { label: 'Sandbox 4 · a dome cell', route: '/app/games/sandbox-4/', areas: null, domes: 13, sets: ['tired-land'], parts: [] },
	// the same dome cell, its food forest grown from our plants (src/lib/sandbox-2/interior/sandbox5.js)
	'sandbox-5': { label: 'Sandbox 5 · a dome cell grown from our plants', route: '/app/games/sandbox-5/', areas: null, domes: 13, sets: ['tired-land'], parts: [] },
	// a valley of settlers, played by its autoplayer from the same seed: roads, carriers, workshops
	// (src/lib/sandbox-6)
	'sandbox-6': { label: 'Sandbox 6 · a valley of settlers', route: '/app/games/sandbox-6/', areas: null, parts: [] },
	// the tired land on its own: the fields, the highway, the trucks (src/lib/worlds/tired-land.ts; the same set as
	// Sandbox 4's `tired-land`)
	'tired-land': { label: 'The tired land · fields, a highway, trucks', route: '/app/worlds/tired-land/', areas: null, parts: [] },
	// MaiaCity V1's world playing a seat's whole first-run intro on the world's clock (src/lib/maiacity-v1/film.js):
	// A the first player's, B the second's; a shot's world.clock is the second of that intro it starts at
	// its parts: the van down the highway to the bus stop, the Village COOP's pickup along the gravel track from the
	// gas station (0) by the shed to home (1), and the bell tent as far as it is pitched
	'maiacity-v1': {
		label: 'MaiaCity V1 · the intro',
		route: '/app/maiacity-v1/',
		areas: ['A', 'B'],
		areaNames: { A: 'Player 1', B: 'Player 2' },
		parts: [
			{ id: 'van', label: 'The van', channels: { along: { label: 'Along the highway', range: [0, 1], unit: '0 far out on the steppe · 1 at the bus stop' } } },
			{ id: 'pickup', label: 'The pickup', channels: { along: { label: 'Along the track', range: [0, 1], unit: '0 the gas station · 1 home' } } },
			{ id: 'tent', label: 'The bell tent', channels: { pitch: { label: 'Pitched', range: [0, 1], unit: '0 in its bag · 1 standing' } } }
		]
	}
};

/** A world's moving parts a shot can animate (none for a world not in the registry). @param {string} id @returns {Part[]} */
export const partsOf = (id) => (isWorld(id) ? WORLDS[id].parts : []);

/** Whether `id` names a world of the registry. @param {unknown} id @returns {id is Sandbox} */
export const isWorld = (id) => typeof id === 'string' && Object.hasOwn(WORLDS, id);

/** Where a shot is when it names no world: the film camera's first world. */
export const DEFAULT_SANDBOX = 'sandbox-4';

/**
 * The film page of a shot's world, from the site's root (prefix the base path).
 * @param {{ sandbox?: string, area?: string }} world
 */
export function filmPath(world) {
	const sandbox = world.sandbox ?? DEFAULT_SANDBOX;
	const area = world.area ?? (isWorld(sandbox) ? WORLDS[sandbox].areas?.[0] : undefined);
	return `/games/${sandbox}/?film${area ? `&area=${encodeURIComponent(area)}` : ''}`;
}

/**
 * Which world a film page is, from its address: what `filmPath` made.
 * @param {string} href
 * @returns {{ sandbox: string, area?: string } | null}
 */
export function worldOfPath(href) {
	const u = new URL(href, 'http://x');
	const m = /\/games\/([a-z0-9-]+)\/?$/.exec(u.pathname);
	if (!m || !u.searchParams.has('film') || !isWorld(m[1])) return null;
	const area = u.searchParams.get('area') ?? WORLDS[m[1]].areas?.[0];
	return { sandbox: m[1], ...(area ? { area } : {}) };
}
