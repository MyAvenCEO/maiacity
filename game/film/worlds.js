// THE WORLDS A SHOT CAN BE IN — every world the film camera can shoot, and where its film page is: the one registry
// of them (Samuel 2026-10-18: every world, sandbox, game and the studio's 3D view built from one pattern). The shot's
// validation (./shot.js), the studio's world picker (src/lib/studio/Inspector.svelte), its ShotSpec type
// (src/lib/studio/types.js reads `Sandbox` from here), the film pages (one page made for every world here,
// src/routes/games/[world=world], each world raised by its mount in mounts.js beside it) and the shoot scripts all
// read this list and nothing else.
//
// A shot names its world (`spec.world.sandbox`) and, where a sandbox has more than one place, which (`world.area`;
// its first is the default). Each world's film page, `/games/<sandbox>/?film&area=<area>`, mounts that world alone
// under the film's clocks and hands it to the film camera (src/lib/sandbox-kit/film.js): the studio's world viewer,
// the Mac app's plate renderer and the shoot CLI all open a shot's world from here.
// Plain JavaScript, shared by the browser, the API and the scripts.

import { PLACES } from '../places.js';

/** @typedef {import('../places.js').Sandbox} Sandbox */
/** @typedef {import('../places.js').World} World */
/** @typedef {import('../places.js').Part} Part */
/** @typedef {import('../places.js').Channel} Channel */
/** @type {Record<Sandbox, World>} */
export const WORLDS = /** @type {Record<Sandbox, World>} */ (Object.fromEntries(
	PLACES.filter((place) => place.film).sort((left, right) => (left.film?.order ?? 0) - (right.film?.order ?? 0)).map(({ route, film }) => {
		const { id, order, ...world } = /** @type {NonNullable<typeof film>} */ (film);
		return [id, { ...world, route }];
	})
));

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
