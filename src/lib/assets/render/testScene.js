// @ts-nocheck — plain JS
/*
 * THE RENDERER'S TEST SCENE — a thousand of our assets of every group in one place, the gate of phase 4 of the asset
 * pipeline (/mnt/project-files/asset-audit/e2e-plan.md): a square of 240 m, a village's green in the middle with its
 * tables, seats, tents and stalls, a yard of machines to the east, a pasture of animals and people to the south, an
 * orchard round them with its shrubs and the plants under them, and a ring of tall nut trees outside. Laid out from one
 * seed, so it is the same every time, and walked by the lab (/app/assets/render/) from the same three places.
 */

/** a seeded stream of numbers between 0 and 1 (mulberry32) */
export function seeded(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** what it holds, by where it stands: each kind a ref, how many of it, and how far apart (m) if more than its part's */
export const KINDS = {
	// the ring outside: the tall nut trees and the alder
	canopy: [
		['plants/walnut?stage=9', 12],
		['plants/chestnut?stage=9', 12],
		['plants/linden?stage=9', 10],
		['plants/alder?stage=9', 10],
		['plants/pecan?stage=7', 8],
		['plants/korean-pine?stage=9', 8]
	],
	// the orchard
	trees: [
		['plants/apple@2?stage=9', 30],
		['plants/apple@2?stage=4', 15],
		['plants/pear?stage=9', 18],
		['plants/plum?stage=7', 18],
		['plants/cherry?stage=9', 18],
		['plants/quince?stage=9', 15],
		['plants/hazel?stage=9', 18],
		['plants/serviceberry?stage=7', 18]
	],
	shrubs: [
		['plants/redcurrant?stage=9', 22],
		['plants/blackcurrant?stage=9', 22],
		['plants/raspberry?stage=9', 22],
		['plants/blueberry?stage=9', 22],
		['plants/elder?stage=7', 20],
		['plants/rose?stage=9', 20],
		['plants/gooseberry?stage=9', 22]
	],
	cover: [
		['plants/rhubarb?stage=9', 30],
		['plants/comfrey?stage=9', 30],
		['plants/kale?stage=7', 28],
		['plants/chard?stage=7', 28],
		['plants/strawberry?stage=9', 30],
		['plants/lavender?stage=9', 28],
		['plants/pumpkin?stage=9', 26]
	],
	// the green
	things: [
		['things/sofa', 16, 2.5],
		['things/bistro-set', 14],
		['things/bar-stool-round', 56],
		['things/backpack', 16],
		['things/long-table', 6, 5],
		['things/parasol', 10, 3],
		['things/loading-ramp', 18],
		['things/tent-bag', 12],
		['things/potted-rosemary', 36],
		['things/potted-lavender', 12],
		['things/plant-stake', 6],
		['things/paper-lantern-big', 12],
		['things/dug-earth', 6],
		['things/kiosk', 3, 6],
		['things/bread-oven', 2, 4],
		['things/fire-place', 6, 3],
		['things/bell-tent', 4, 7],
		['things/dome-tent', 6, 4],
		['things/chicken-coop', 3, 4],
		['things/rabbit-hutch', 3, 3],
		['things/solar-panel', 12, 3],
		['things/water-bottle', 1]
	],
	// the yard
	machines: [
		['machines/excavator:excavator-small', 6],
		['machines/forklift:forklift-pallet', 8],
		['machines/lifetrac', 6],
		['machines/van', 6],
		['machines/pickup', 8],
		['machines/pickup:pickup-cube', 2],
		['machines/powercube', 8],
		['machines/electrocube', 6],
		['machines/batterycube', 6],
		['machines/pod:pod-people', 4]
	],
	// the pasture
	actors: [
		['actors/chicken:chicken-red', 18],
		['actors/chicken:chicken-leghorn', 14],
		['actors/chicken:chicken-rooster', 6],
		['actors/goat:goat-saanen', 12],
		['actors/goat:goat-boer', 10],
		['actors/sheep:sheep-whiteface', 16],
		['actors/sheep:sheep-black', 8],
		['actors/rabbit:rabbit-wild', 12],
		['actors/goose:goose-embden', 10],
		['actors/stand-in', 14]
	]
};

/** where each part of the scene may stand (inside its box), and how far apart its things stand at least (m) */
const AREAS = {
	canopy: { box: [-118, 118, -118, 118], inside: (x, z) => Math.hypot(x, z) > 85 && !(x > 32 && Math.abs(z) < 40), apart: 9 },
	trees: { box: [-84, 84, -84, 84], inside: (x, z) => orchard(x, z), apart: 6 },
	shrubs: { box: [-118, 118, -118, 118], inside: (x, z) => orchard(x, z) || Math.hypot(x, z) > 85, apart: 2.4 },
	cover: { box: [-84, 84, -84, 84], inside: (x, z) => orchard(x, z), apart: 1.6 },
	things: { box: [-30, 30, -30, 30], inside: (x, z) => Math.hypot(x, z) < 30, apart: 1.6 },
	machines: { box: [34, 94, -38, 38], inside: () => true, apart: 7 },
	actors: { box: [-28, 28, 34, 74], inside: () => true, apart: 1.6 }
};
const orchard = (x, z) => {
	const r = Math.hypot(x, z);
	return r > 32 && r < 84 && !(x > 32 && Math.abs(z) < 40) && !(z > 32 && z < 76 && Math.abs(x) < 30);
};

/**
 * The thousand copies: each its ref, where it stands, its turn and its scale.
 * @param {number} [seed]
 * @returns {{ ref: string, x: number, z: number, turn: number, scale: number, part: string }[]}
 */
export function testScene(seed = 4) {
	const r = seeded(seed);
	const out = [];
	/** every copy placed so far, filed by 4 m cells, for the distance to keep */
	const cells = new Map();
	const cellOf = (x, z) => `${Math.floor(x / 4)},${Math.floor(z / 4)}`;
	const free = (x, z, apart) => {
		const span = Math.ceil(apart / 4);
		const cx = Math.floor(x / 4), cz = Math.floor(z / 4);
		for (let i = -span; i <= span; i++)
			for (let j = -span; j <= span; j++)
				for (const p of cells.get(`${cx + i},${cz + j}`) ?? []) if (Math.hypot(p.x - x, p.z - z) < Math.max(apart, p.apart)) return false;
		return true;
	};
	for (const [part, list] of Object.entries(KINDS)) {
		const area = AREAS[part];
		for (const [ref, n, own] of list)
			for (let k = 0; k < n; k++) {
				for (let tries = 0; tries < 3000; tries++) {
					const [x0, x1, z0, z1] = area.box;
					const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0);
					// a crowded part takes its things a little closer the longer it looks for room
					const apart = (own ?? area.apart) * 0.8 ** Math.floor(tries / 500);
					if (!area.inside(x, z) || !free(x, z, apart)) continue;
					const p = { ref, x, z, turn: r() * Math.PI * 2, scale: part === 'things' || part === 'machines' ? 1 : 0.85 + r() * 0.3, part, apart };
					out.push(p);
					const key = cellOf(x, z);
					if (!cells.has(key)) cells.set(key, []);
					cells.get(key).push(p);
					break;
				}
			}
	}
	return out.map(({ apart, ...p }) => p);
}

/**
 * The three places the scene is measured from, as Sandbox 4's forest is (scratchpad/p4/sandbox4.mjs): where the
 * walker starts, the same place turned a quarter round, and twenty metres on into the orchard. x, z, yaw, pitch.
 */
export const SPOTS = [
	{ name: 'start', x: 0, z: 40, yaw: 0, pitch: 0.08 },
	{ name: 'turned', x: 0, z: 40, yaw: Math.PI / 2, pitch: 0.08 },
	{ name: 'walked', x: -20, z: 40, yaw: Math.PI / 2, pitch: 0.08 }
];
