/*
 * THE LIBRARY'S THINGS IN THE VILLAGE — what Sandbox 3 and 4 put down that is a Thing of the library ($lib/models):
 * the playgrounds between the domes, in Sandbox 4 the coops and hutches round the squares, mini domes, and in every
 * master dome the workshops round its ground floor (the dome rooms', $lib/models/domerooms.js). Each is built in the
 * asset box from its recipe at the version the village's config pins (its avenDB entry, `THINGS`) and drawn by the
 * renderer (./drawn.js) as a copy of it, at its finest shape, casting its shadow as the village's baked ones did.
 *
 * A Thing is built as the library has it, so every copy of one is the same: the village no longer gives each its own
 * seed (a coop's eggs, a hutch's tunnel, a playground's stumps once differed a little from one to the next; the
 * second co-working space's laptops and the second art studio's paintings were their own).
 *
 * What stands in the walker's way is the world's (`WALK`): each Thing's footprint as circles in its builder's ground,
 * the ones its builder hands back with it (./things.test.js holds them to it), put where the copy stands
 * (`collidersAt`). A list of Things says where each one's builder's ground is put (x, z, turned by `turn`); a Thing the
 * library brings to its own middle stands that far off it (`MIDDLE`, `placeOf`).
 */
import { coopsAround } from './spaces';

/**
 * An asset of the village, by the key its config pins it under (code/configs/sandbox-4/assets: its avenDB entry and
 * the heads of its version, $lib/assets/vault.js `WORLD_PIN`), with the values it is built with.
 * @param {string} key @param {string} [query]
 */
export const villageAsset = (key, query = '') => `pin:sandbox-4/${key}${query ? `?${query}` : ''}`;

/** the Things the village puts down, each at the version its config pins */
export const THINGS = {
	/** the hens' mini dome (the chicken coop's v2), Sandbox 4's */
	hens: villageAsset('hens'),
	/** the rabbits' mini dome (the rabbit hutch's v2), Sandbox 4's */
	rabbits: villageAsset('rabbits'),
	/** the playground with a climbing dome of round logs (its v2), Sandbox 4's */
	playDome: villageAsset('play-dome'),
	/** the wooden playground with its tower (its v1), Sandbox 3's */
	playground: villageAsset('playground'),
	/** the master dome's workshops, each at its v1 */
	coworking: villageAsset('coworking'),
	woodshop: villageAsset('woodshop'),
	studio: villageAsset('studio'),
	pottery: villageAsset('pottery'),
	library: villageAsset('library'),
	bakery: villageAsset('bakery'),
	repair: villageAsset('repair')
};

/** the village's two forest floors: the food forest outside, the warm one under the glass */
export const FLOORS = { outside: villageAsset('food-forest'), warm: villageAsset('warm-food-forest') };

/**
 * A set the dome builds round its own place and the library brings to its middle, its foot on the ground
 * ($lib/models/domerooms.js `centred`): where that middle is in its builder's ground (x, z in metres).
 * @type {Record<string, { x: number, z: number }>}
 */
export const MIDDLE = {
	[THINGS.coworking]: { x: 0.23, z: 0.255 },
	[THINGS.woodshop]: { x: 0.425, z: 0.805 },
	[THINGS.studio]: { x: 0.295534, z: 0.2375 },
	[THINGS.pottery]: { x: 0.31, z: 0.9625 },
	[THINGS.library]: { x: 0.05, z: 0.45 },
	[THINGS.bakery]: { x: -0.6, z: -0.0375 },
	[THINGS.repair]: { x: 0, z: 1.1 }
};

/**
 * What of each Thing stands in the walker's way: circles in its builder's ground (x, z, r in metres), as its builder
 * hands them back (src/lib/models/minidomes.js, ./spaces.ts `playground` and the workshops).
 * @type {Record<string, { x: number, z: number, r: number }[]>}
 */
export const WALK = {
	[THINGS.hens]: [{ x: 0, z: 0.5, r: 2.8 }],
	[THINGS.rabbits]: [{ x: 0, z: 0.5, r: 2.6 }],
	[THINGS.playDome]: [
		{ x: -1.1, z: -0.7, r: 2.2 },
		{ x: 0.5, z: 2.3, r: 0.5 },
		{ x: 3.5, z: 2.3, r: 0.5 }
	],
	[THINGS.playground]: [
		{ x: -1.2, z: -0.8, r: 1.3 },
		{ x: 0.4, z: 2.2, r: 0.6 },
		{ x: 3.2, z: 2.2, r: 0.6 }
	],
	[THINGS.coworking]: [
		{ x: -1.6, z: -1.6, r: 1.1 },
		{ x: 0.4, z: -1.6, r: 1.1 },
		{ x: -1.6, z: 1.6, r: 1.1 },
		{ x: 0.4, z: 1.6, r: 1.1 },
		{ x: 4.3, z: 2.6, r: 1.3 },
		{ x: -5, z: 0, r: 0.6 }
	],
	[THINGS.woodshop]: [
		{ x: -3.2, z: -1.2, r: 1.2 },
		{ x: 0, z: -1.2, r: 1.2 },
		{ x: 3.2, z: -1.2, r: 1.2 },
		{ x: 5, z: 1, r: 0.8 },
		{ x: -1.5, z: 3.3, r: 0.5 },
		{ x: -4, z: 3.3, r: 0.5 },
		{ x: 1, z: 3.3, r: 0.5 },
		{ x: 0, z: 1.4, r: 1 }
	],
	[THINGS.studio]: [
		{ x: -4.5, z: 1.475, r: 0.5 },
		{ x: -2.7, z: 1.125, r: 0.5 },
		{ x: -0.9, z: 0.775, r: 0.5 },
		{ x: 0.9, z: 0.775, r: 0.5 },
		{ x: 2.7, z: 1.125, r: 0.5 },
		{ x: 4.5, z: 1.475, r: 0.5 },
		{ x: 0, z: -2.3, r: 1.5 },
		{ x: -5.4, z: -1.8, r: 0.6 }
	],
	[THINGS.pottery]: [
		{ x: -3.5, z: -0.8, r: 0.7 },
		{ x: -1.2, z: -0.8, r: 0.7 },
		{ x: 1.1, z: -0.8, r: 0.7 },
		{ x: 4.4, z: -0.6, r: 1.1 },
		{ x: -2.5, z: 3.2, r: 0.5 },
		{ x: 1.5, z: 3.2, r: 0.5 },
		{ x: -1.2, z: 1.3, r: 1.1 }
	],
	[THINGS.library]: [
		{ x: -4, z: 3.3, r: 1.2 },
		{ x: -1.3, z: 3.3, r: 1.2 },
		{ x: 1.4, z: 3.3, r: 1.2 },
		{ x: 4.1, z: 3.3, r: 1.2 },
		{ x: -1.8, z: -0.6, r: 1.1 },
		{ x: 1.8, z: -0.6, r: 1.1 },
		{ x: 0, z: 1.4, r: 1.1 }
	],
	[THINGS.bakery]: [
		{ x: -3.8, z: 2.2, r: 1.5 },
		{ x: -1.1, z: 0.6, r: 1 },
		{ x: 0.3, z: 0.6, r: 1 },
		{ x: 2.5, z: 0.6, r: 1 },
		{ x: 3.9, z: 0.6, r: 1 },
		{ x: -0.5, z: -2.4, r: 1.3 },
		{ x: 2.5, z: -2.4, r: 1.3 }
	],
	[THINGS.repair]: [
		{ x: -3, z: 2.8, r: 1 },
		{ x: 0, z: 2.8, r: 1 },
		{ x: 3, z: 2.8, r: 1 },
		{ x: -2.6, z: -0.4, r: 0.9 },
		{ x: 2.2, z: -0.6, r: 1.2 }
	]
};

/**
 * Where a Thing stands in the walker's way, put down at x, z turned by `turn` about the upright (as a group turned by
 * rotation.y).
 * @param {string} ref @param {number} x @param {number} z @param {number} turn
 */
export function collidersAt(ref, x, z, turn) {
	const c = Math.cos(turn), s = Math.sin(turn);
	return (WALK[ref] ?? []).map((p) => ({ x: x + p.x * c + p.z * s, z: z - p.x * s + p.z * c, r: p.r }));
}

/**
 * The coops round the squares as Sandbox 4 has them, mini domes: the hens' and the rabbits' in turn, every other one a
 * hutch (as ./spaces.ts `coops` lays them out), each facing out from the master dome.
 * @param {number} squareR @returns {{ ref: string, x: number, z: number, turn: number }[]}
 */
export const coopsOf = (squareR) => coopsAround(squareR).map(({ a, r }, i) => ({ ref: i % 2 === 1 ? THINGS.rabbits : THINGS.hens, x: Math.sin(a) * r, z: Math.cos(a) * r, turn: a }));

/** the master dome's workshops round its ground floor, between its doors, its stair, its kitchen and its aquaponics:
 *  each at its angle, as the dome has always laid them out */
const WORKSHOPS = /** @type {[number, keyof typeof THINGS][]} */ ([
	[0.36, 'coworking'],
	[1.2, 'woodshop'],
	[1.95, 'studio'],
	[2.55, 'pottery'],
	[2.92, 'library'],
	[3.52, 'bakery'],
	[4.36, 'studio'],
	[5.1, 'repair'],
	[5.93, 'coworking']
]);

/**
 * The master dome's workshops, `rr` from its middle, each facing out to the glass.
 * @param {number} rr @returns {{ ref: string, x: number, z: number, turn: number }[]}
 */
export const workshopsOf = (rr) => WORKSHOPS.map(([a, k]) => ({ ref: THINGS[k], x: Math.sin(a) * rr, z: Math.cos(a) * rr, turn: a }));

/**
 * Where a copy of a Thing stands for its builder's ground put at x, z turned by `turn`, in a ground standing at `at`.
 * @param {{ ref: string, x: number, z: number, turn: number }} t @param {number[]} [at]
 */
export function placeOf(t, at = [0, 0, 0]) {
	const m = MIDDLE[t.ref], c = Math.cos(t.turn), s = Math.sin(t.turn);
	const dx = m ? m.x * c + m.z * s : 0, dz = m ? -m.x * s + m.z * c : 0;
	return { x: at[0] + t.x + dx, y: at[1], z: at[2] + t.z + dz, turn: t.turn, scale: 1 };
}

/** @typedef {{ use: (ref: string, shadows?: boolean, picture?: boolean) => any, take: (k: any, at: { x: number, y: number, z: number, turn: number, scale: number }) => any, give: (c: any) => void }} Library */

/**
 * Things put down by a renderer (./drawn.js), each a copy at its finest shape casting its shadow; and where each
 * stands in the walker's way.
 * @param {Library} drawn @param {{ ref: string, x: number, z: number, turn: number }[]} list
 */
export function putThings(drawn, list) {
	const copies = list.map((t) => drawn.take(drawn.use(t.ref, true, false), placeOf(t)));
	return { copies, colliders: list.flatMap((t) => collidersAt(t.ref, t.x, t.z, t.turn)) };
}

/**
 * Things of a part of the world that comes and goes (a dome's inside, shown as you near it): their kinds asked for
 * at once, their copies put down while it is shown and handed back to the renderer when it is not, or let go of.
 * @param {Library} drawn @param {{ ref: string, x: number, z: number, turn: number }[]} list
 * @param {{ at?: number[], shown?: boolean }} [o] `at`: where the part's own ground stands in the renderer's;
 *   `shown`: put down now
 */
export function standThings(drawn, list, { at = [0, 0, 0], shown = true } = {}) {
	const kinds = list.map((t) => drawn.use(t.ref, true, false));
	/** @type {any[]} */
	let copies = [];
	/** @param {boolean} on */
	const show = (on) => {
		if (on && !copies.length) copies = list.map((t, i) => drawn.take(kinds[i], placeOf(t, at)));
		else if (!on) {
			for (const c of copies) drawn.give(c);
			copies = [];
		}
	};
	show(shown);
	return {
		/** where they stand in the walker's way, in the part's own ground */
		colliders: list.flatMap((t) => collidersAt(t.ref, t.x, t.z, t.turn)),
		show,
		/** every one of their kinds built (or failed) */
		ready: () => Promise.all(kinds.map((k) => k.ready)),
		dispose: () => show(false)
	};
}
