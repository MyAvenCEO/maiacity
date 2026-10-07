/*
 * THE BIOMES — the floor a world stands on, as recipes: which surfaces the ground is made of and how much of each
 * (./surfaces.js: leaf litter, humus, needles, moss, the living mat, bare soil), and what grows and lies on it, kind by
 * kind (./cover.js), each kind in colonies of its own size — wood anemones and woodruff carpet whole patches several
 * metres across, ferns stand in groups, deadwood and stones lie here and there — and on the surface it belongs on
 * (moss on the litter's edges, clover in the green). Any two biomes mix (`mix`): a forest edge is half the beech
 * wood and half the meadow; a world can run one into the other over a few metres.
 *
 * Why it looks so: a temperate forest floor is litter over humus over soil (the L, F and H horizons) — under a closed
 * canopy mostly whole fallen leaves, dark humus where they are thin; mosses on what rises out of it (stones, roots,
 * deadwood); the herb layer growing in clonal colonies rather than sprinkled evenly (a carpet of anemones, a stand of
 * ramsons); grasses, sedges and flowers only where light reaches the floor. A forest garden keeps its soil covered on
 * purpose: a living mulch of clover and wild strawberries between the plants, leaf litter under the trees.
 *
 * The Biomes explorer (/app/biomes/) shows each on a patch of ground, every layer to show or hide, and mixed with
 * another; Sandbox 5's floor is the food forest's (src/lib/sandbox-2/interior/village.ts), and under the glass of its
 * domes the warm food forest's (interior.ts).
 */
import { COVER } from './cover.js';
import { SURFACES, surfacesAt } from './surfaces.js';
import { fbm2 } from './noise.js';
import { versioned } from '../app/versions.js';

export { COVER } from './cover.js';
export { SURFACE, SURFACES, groundMaterial, surfacesAt } from './surfaces.js';

/** @typedef {import('./cover.js').Cover} Cover */
/** @typedef {import('./surfaces.js').Surface} Surface */
/**
 * @typedef {object} Colony one kind of cover in a biome
 * @property {Cover} kind
 * @property {number} share how often it is met where its colonies are, against the others
 * @property {number} colony how big its colonies are across (m)
 * @property {number} spread how much of the ground its colonies take (0…1)
 * @property {Surface} [on] the surface it grows on (it is met there, and seldom elsewhere)
 * @property {number} [fill] how full its colonies are (0…1, 0.85 if not said)
 */
/**
 * @typedef {object} Recipe a biome
 * @property {string} id
 * @property {string} label
 * @property {string} note
 * @property {string} from where it is used
 * @property {Partial<Record<Surface, number>>} surface how much of the floor each surface takes
 * @property {number} density how many plants (or things) of its cover stand on a square metre inside their colonies
 * @property {Colony[]} cover
 */

/** @type {Recipe[]} */
const LIST = [
	{
		id: 'food-forest',
		label: 'Food forest floor',
		note: 'A forest garden’s floor, its soil covered on purpose: a living mulch of clover, wild strawberries and grasses in the light between the plants, leaf litter and moss under the trees, ferns and wood anemones in the shade, a fallen branch now and then.',
		from: 'Sandbox 4',
		surface: { green: 5, litter: 3, humus: 1, moss: 1 },
		density: 7,
		cover: [
			{ kind: 'grass', share: 6, colony: 5, spread: 0.7, on: 'green' },
			{ kind: 'tallgrass', share: 2, colony: 4, spread: 0.35, on: 'green', fill: 0.4 },
			{ kind: 'clover', share: 3, colony: 3, spread: 0.35, on: 'green' },
			{ kind: 'strawberry', share: 3, colony: 3, spread: 0.35, on: 'green' },
			{ kind: 'daisy', share: 2, colony: 2.5, spread: 0.25, on: 'green' },
			{ kind: 'buttercup', share: 2, colony: 3, spread: 0.25, on: 'green' },
			{ kind: 'cranesbill', share: 1, colony: 3, spread: 0.2, on: 'green' },
			{ kind: 'forgetmenot', share: 1, colony: 2, spread: 0.2 },
			{ kind: 'litter', share: 5, colony: 6, spread: 0.6, on: 'litter', fill: 0.12 },
			{ kind: 'moss', share: 3, colony: 3, spread: 0.4, on: 'moss', fill: 0.165 },
			{ kind: 'anemone', share: 3, colony: 3.5, spread: 0.25, on: 'litter' },
			{ kind: 'fern', share: 2, colony: 5, spread: 0.3, on: 'humus', fill: 0.08 },
			{ kind: 'mushrooms', share: 0.4, colony: 6, spread: 0.2, on: 'humus', fill: 0.006 },
			{ kind: 'deadwood', share: 0.4, colony: 8, spread: 0.3, on: 'litter', fill: 0.0018 },
			{ kind: 'stones', share: 0.3, colony: 8, spread: 0.2, fill: 0.004 }
		]
	},
	{
		id: 'warm-food-forest',
		label: 'Food forest under glass',
		note: 'The warm forest garden inside a dome: moist, shaded, never bare — big fallen leaves of banana, mango and fig over dark humus, moss where it stays damp, ferns in the shade of the palms, a living mat of clover, wild strawberries and soft grass where the light comes through the glass.',
		from: 'Sandbox 4, inside the domes',
		surface: { green: 4, litter: 3, humus: 2, moss: 1.5 },
		density: 7,
		cover: [
			{ kind: 'grass', share: 4, colony: 4, spread: 0.55, on: 'green' },
			{ kind: 'clover', share: 3, colony: 3, spread: 0.35, on: 'green' },
			{ kind: 'strawberry', share: 4, colony: 3, spread: 0.4, on: 'green' },
			{ kind: 'woodsorrel', share: 3, colony: 3, spread: 0.3, on: 'humus' },
			{ kind: 'fern', share: 4, colony: 4, spread: 0.4, on: 'humus', fill: 0.12 },
			{ kind: 'moss', share: 3, colony: 3, spread: 0.45, on: 'moss', fill: 0.18 },
			{ kind: 'litter', share: 5, colony: 5, spread: 0.6, on: 'litter', fill: 0.12 },
			{ kind: 'forgetmenot', share: 1, colony: 2, spread: 0.2 },
			{ kind: 'mushrooms', share: 0.6, colony: 5, spread: 0.25, on: 'humus', fill: 0.008 },
			{ kind: 'stones', share: 0.3, colony: 8, spread: 0.2, fill: 0.004 }
		]
	},
	{
		id: 'beech-forest',
		label: 'Beech forest',
		note: 'Under closed beech: deep brown leaf litter over dark humus, little grass; the herbs in carpets — wood anemone, woodruff, wood sorrel, ramsons where it is damp — ferns in groups, moss on deadwood and stones, mushrooms after rain.',
		from: 'The forests round the cell',
		surface: { litter: 7, humus: 2, moss: 1 },
		density: 6,
		cover: [
			{ kind: 'litter', share: 6, colony: 8, spread: 0.75, on: 'litter', fill: 0.12 },
			{ kind: 'anemone', share: 5, colony: 4, spread: 0.3 },
			{ kind: 'woodruff', share: 5, colony: 4, spread: 0.3 },
			{ kind: 'woodsorrel', share: 4, colony: 3, spread: 0.3 },
			{ kind: 'ramsons', share: 6, colony: 6, spread: 0.18, on: 'humus' },
			{ kind: 'fern', share: 3, colony: 6, spread: 0.3, fill: 0.08 },
			{ kind: 'sedge', share: 1.5, colony: 5, spread: 0.25, fill: 0.15 },
			{ kind: 'moss', share: 3, colony: 3, spread: 0.35, on: 'moss', fill: 0.165 },
			{ kind: 'deadwood', share: 1, colony: 9, spread: 0.35, fill: 0.0018 },
			{ kind: 'stones', share: 0.6, colony: 9, spread: 0.25, fill: 0.004 },
			{ kind: 'mushrooms', share: 0.8, colony: 7, spread: 0.25, on: 'humus', fill: 0.006 }
		]
	},
	{
		id: 'spruce-forest',
		label: 'Spruce forest',
		note: 'Under spruce: a floor of needles, thick moss carpets over it, blueberry in the gaps, ferns, fallen twigs and branches, stones mossed over, mushrooms.',
		from: 'The forests round the cell',
		surface: { needles: 6, moss: 4, humus: 1 },
		density: 6,
		cover: [
			{ kind: 'moss', share: 7, colony: 5, spread: 0.6, on: 'moss', fill: 0.193 },
			{ kind: 'blueberry', share: 5, colony: 5, spread: 0.4 },
			{ kind: 'fern', share: 2, colony: 6, spread: 0.3, fill: 0.08 },
			{ kind: 'woodsorrel', share: 2, colony: 3, spread: 0.25, on: 'moss' },
			{ kind: 'deadwood', share: 1.2, colony: 8, spread: 0.4, on: 'needles', fill: 0.0018 },
			{ kind: 'stones', share: 1, colony: 8, spread: 0.3, fill: 0.004 },
			{ kind: 'mushrooms', share: 1, colony: 6, spread: 0.3, fill: 0.006 }
		]
	},
	{
		id: 'meadow',
		label: 'Meadow',
		note: 'Open and sunny: grasses tall and short, buttercups, daisies, red clover and cranesbill in drifts, now and then a patch of bare soil.',
		from: 'The open ground round the forests',
		surface: { green: 9, soil: 0.6, moss: 0.4 },
		density: 10,
		cover: [
			{ kind: 'grass', share: 8, colony: 6, spread: 0.8 },
			{ kind: 'tallgrass', share: 6, colony: 5, spread: 0.6 },
			{ kind: 'buttercup', share: 3, colony: 4, spread: 0.35 },
			{ kind: 'daisy', share: 3, colony: 3, spread: 0.3 },
			{ kind: 'clover', share: 3, colony: 3, spread: 0.35 },
			{ kind: 'cranesbill', share: 2, colony: 4, spread: 0.3 },
			{ kind: 'forgetmenot', share: 0.6, colony: 2, spread: 0.15 }
		]
	},
	{
		id: 'clover-lawn',
		label: 'Clover lawn',
		note: 'A living mulch walked on: white and red clover, wild strawberries spreading by their runners, short grass, a daisy here and there.',
		from: 'Paths’ edges and the squares',
		surface: { green: 10, soil: 0.3 },
		density: 9,
		cover: [
			{ kind: 'clover', share: 6, colony: 3, spread: 0.6 },
			{ kind: 'strawberry', share: 4, colony: 3, spread: 0.45 },
			{ kind: 'grass', share: 4, colony: 4, spread: 0.6 },
			{ kind: 'daisy', share: 2, colony: 2.5, spread: 0.3 }
		]
	}
];

/** the biomes, each with its version and history ($lib/app/versions.js) */
export const BIOMES = versioned(LIST, 'cover', {});

/**
 * Two biomes run together, `t` of the way from a to b: their surfaces and their cover weighed so, their density between.
 * @param {Recipe} a @param {Recipe} b @param {number} t
 * @returns {Recipe}
 */
export function mix(a, b, t) {
	if (t <= 0) return a;
	if (t >= 1) return b;
	const sa = SURFACES.reduce((n, s) => n + (a.surface[s] ?? 0), 0) || 1, sb = SURFACES.reduce((n, s) => n + (b.surface[s] ?? 0), 0) || 1;
	/** @type {Partial<Record<Surface, number>>} */
	const surface = {};
	for (const s of SURFACES) surface[s] = ((a.surface[s] ?? 0) / sa) * (1 - t) + ((b.surface[s] ?? 0) / sb) * t;
	const ca = a.cover.reduce((n, c) => n + c.share, 0) || 1, cb = b.cover.reduce((n, c) => n + c.share, 0) || 1;
	return {
		id: `${a.id}+${b.id}`,
		label: `${a.label} · ${b.label}`,
		note: '',
		from: '',
		surface,
		density: a.density * (1 - t) + b.density * t,
		cover: [...a.cover.map((c) => ({ ...c, share: (c.share / ca) * (1 - t) })), ...b.cover.map((c) => ({ ...c, share: (c.share / cb) * t }))]
	};
}

/**
 * Which kind of a biome's cover stands at x, z (its index in `recipe.cover`), or −1 for none. Each kind grows in its
 * colonies (its own noise, at its colony's size, over the threshold its spread sets) on the surface it belongs on;
 * inside a colony its plants stand close (as many as the biome's density says a square metre holds), outside it none —
 * so a wood anemone carpets its patch and leaves the next bare. Where colonies overlap, the kinds share the ground by
 * their shares. `hidden`, the kinds to leave out (the explorer's toggles).
 * @param {Recipe} recipe @param {() => number} r @param {number} x @param {number} z @param {Set<number>} [hidden]
 */
export function coverAt(recipe, r, x, z, hidden) {
	const here = surfacesAt(recipe.surface, x, z);
	let empty = 1, total = 0;
	const w = recipe.cover.map((c, i) => {
		if (hidden?.has(i)) return 0;
		const f = fbm2(x / c.colony + i * 9.7 + 3.1, z / c.colony - i * 5.3);
		const cut = 0.5 + (0.5 - c.spread) * 0.55;
		const inColony = Math.min(1, Math.max(0, (f - cut) / 0.04 + 0.5));
		const ground = c.on ? Math.min(1, here[c.on] * 2.2 + 0.05) : 1;
		const m = inColony * ground, fill = c.fill ?? 0.85;
		empty *= 1 - fill * m;
		// where colonies overlap they share the ground by how much of each would stand there
		const v = c.share * fill * m;
		total += v;
		return v;
	});
	if (total <= 0 || r() < empty) return -1;
	let t = r() * total;
	for (let i = 0; i < w.length; i++) if ((t -= /** @type {number} */ (w[i])) < 0) return i;
	return w.length - 1;
}

/** Every kind of a biome's cover, built once (in its order). @param {Recipe} recipe */
export const coverOf = (recipe) => recipe.cover.map((c, i) => COVER[c.kind].build(7100 + i * 13 + c.kind.length * 31));
