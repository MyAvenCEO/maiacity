// THE WORLDS A SHOT CAN BE IN — every sandbox the film camera can shoot, and where its film page is.
//
// A shot names its world (`spec.world.sandbox`) and, where a sandbox has more than one place, which (`world.area`;
// its first is the default). Each world's film page, `/games/<sandbox>/?film&area=<area>`, mounts that world alone
// under the film's clocks and hands it to the film camera (src/lib/sandbox-kit/film.js): the studio's world viewer,
// the Mac app's plate renderer and the shoot CLI all open a shot's world from here.
// Plain JavaScript, shared by the browser, the API and the scripts.

/**
 * @typedef {{ label: string, areas: string[] | null, domes?: number, sets?: string[] }} World
 *   areas: the places a shot can be in (the first is the default), or null for a sandbox that is one place;
 *   domes: how many domes a shot can name (world.dome); sets: the sets a shot can build into it (world.props)
 */

/** @type {Record<string, World>} */
export const WORLDS = {
	// the hex island of the city-builder, seen from above; always the same island
	'sandbox-1': { label: 'Sandbox 1 · the island', areas: ['island'] },
	// the planet of cities, and a city's island (world.seed is the island's seed); the procedural world alone, without
	// the live settlements, so a shot renders the same every time
	'sandbox-2': { label: 'Sandbox 2 · the planet', areas: ['planet', 'island'] },
	// one dome's whole inside, walked at eye height, with its forest round it
	'sandbox-3': { label: 'Sandbox 3 · inside a dome', areas: ['home', 'tent', 'glamp', 'large', 'master', 'factory'] },
	// a whole dome cell: thirteen domes, their insides built as the camera comes
	'sandbox-4': { label: 'Sandbox 4 · a dome cell', areas: null, domes: 13, sets: ['tired-land'] },
	// a real room, measured from photos: a 14 m² bedroom — the bed, two wine-crate towers, two chairs, the window, the
	// door, a bulb (src/lib/worlds/room.ts; Day 02)
	room: { label: 'The room · fourteen square metres', areas: null, sets: ['stand-in sitting', 'stand-in fallen', 'stand-in window'] },
	// the tired land on its own: the fields, the highway, the trucks (src/lib/worlds/tired-land.ts; the same set as
	// Sandbox 4's `tired-land`)
	'tired-land': { label: 'The tired land · fields, a highway, trucks', areas: null }
};

/** Where a shot is when it names no world: the film camera's first world. */
export const DEFAULT_SANDBOX = 'sandbox-4';

/**
 * The film page of a shot's world, from the site's root (prefix the base path).
 * @param {{ sandbox?: string, area?: string }} world
 */
export function filmPath(world) {
	const sandbox = world.sandbox ?? DEFAULT_SANDBOX;
	const area = world.area ?? WORLDS[sandbox]?.areas?.[0];
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
	if (!m || !u.searchParams.has('film') || !WORLDS[m[1]]) return null;
	const area = u.searchParams.get('area') ?? WORLDS[m[1]].areas?.[0];
	return { sandbox: m[1], ...(area ? { area } : {}) };
}
