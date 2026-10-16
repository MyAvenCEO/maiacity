/*
 * THE LIBRARY'S THINGS IN THE VILLAGE — what Sandbox 3 and 4 put down round the master dome that is a Thing of the
 * library ($lib/models): the playgrounds between the domes, and in Sandbox 4 the coops and hutches round the squares,
 * mini domes. Each is built in the asset box from its recipe at the version the village has always stood
 * (`things/<id>@<v>`) and drawn by the renderer (./drawn.js) as a copy of it, at its finest shape, casting its
 * shadow as the village's baked ones did.
 *
 * A Thing is built as the library has it, so every copy of one is the same: the village no longer gives each its own
 * seed (a coop's eggs, a hutch's tunnel, a playground's stumps once differed a little from one to the next).
 *
 * What stands in the walker's way is the world's (`WALK`): each Thing's footprint as circles in its own ground, the
 * ones its builder hands back with it (./things.test.js holds them to it), put where the copy stands (`collidersAt`).
 */
import { coopsAround } from './spaces';

/** the Things the village puts down, at the version it stands */
export const THINGS = {
	/** the hens' mini dome (the chicken coop's v2), Sandbox 4's */
	hens: 'things/chicken-coop@2',
	/** the rabbits' mini dome (the rabbit hutch's v2), Sandbox 4's */
	rabbits: 'things/rabbit-hutch@2',
	/** the playground with a climbing dome of round logs (its v2), Sandbox 4's */
	playDome: 'things/playground@2',
	/** the wooden playground with its tower (its v1), Sandbox 3's */
	playground: 'things/playground@1'
};

/**
 * What of each Thing stands in the walker's way: circles in its own ground (x, z, r in metres), as its builder hands
 * them back (src/lib/models/minidomes.js, ./spaces.ts `playground`).
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

/**
 * Things put down by a renderer (./drawn.js), each a copy at its finest shape casting its shadow; and where each
 * stands in the walker's way.
 * @param {{ use: (ref: string, shadows?: boolean, picture?: boolean) => any, take: (k: any, at: { x: number, y: number, z: number, turn: number, scale: number }) => any }} drawn
 * @param {{ ref: string, x: number, z: number, turn: number }[]} list
 */
export function putThings(drawn, list) {
	const copies = list.map((t) => drawn.take(drawn.use(t.ref, true, false), { x: t.x, y: 0, z: t.z, turn: t.turn, scale: 1 }));
	return { copies, colliders: list.flatMap((t) => collidersAt(t.ref, t.x, t.z, t.turn)) };
}
