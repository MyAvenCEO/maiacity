/*
 * THE APPLE (Malus domestica), v2 — a half-standard apple tree from its pip, grown as an apple grows rather than in
 * flushes: a clear trunk of about one and a half metres, a central leader, three tiers of scaffold limbs, laterals
 * along them and short shoots along those, the whole filling out into a broad rounded crown. From the two-year-old wood
 * on, short knobbly spurs: each a rosette of leaves, and, from the wood's third year, a corymb of five or six flowers
 * (the king flower in the middle opening first, pink buds opening white flushed pink). Two to five apples of a cluster
 * hold through the June drop, swell, colour red over yellow-green on their sunny side, and their weight bows the
 * laterals down.
 *
 * Its leaves are oval with a pointed tip, 6–9 cm on a short stalk, alternate along the season's shoots, glossy, some
 * turned to show their paler felted undersides; its young bark smooth and grey-brown, the trunk's breaking into
 * scaly plates.
 *
 * Every branch, spur and fruit draws its chance by its place in the tree, and the tree is drawn whole and then shown as
 * far as it has grown (`grown` years), so a tree tabbed through its stages grows, it is not redrawn. ./orchard.v1.js
 * grows its v1 (./trees.js `APPLE_V1`).
 */
import * as THREE from 'three';
import { Bag, Space, about, aim, bead, between, chance, clamp, lerp, mix, root, sheet, span, tube, v3 } from './grow.js';
import { sprout } from './sprout.js';

const UP = v3(0, 1, 0);

/** the tree's age in years of growth at g (its stages: the pip … day 365, 1460, 2200 … 2320); the season's shoots
 * grow between the blossom and the green apples */
const YEARS = /** @type {[number, number][]} */ ([
	[1.6, 0],
	[2, 0.1],
	[3, 1],
	[4, 3.8],
	[5, 5.6],
	[6, 5.75],
	[7, 6.05],
	[8, 6.15],
	[9, 6.2]
]);
/** the year of the blossom: the spurs on wood old enough by then flower */
const BLOOM = linear(5, YEARS);
/** the trunk's (the leader's) length through the years */
const LEADER = /** @type {[number, number][]} */ ([
	[0, 0],
	[0.15, 0.1],
	[1, 0.8],
	[2, 1.85],
	[2.5, 2.25],
	[3, 3.0],
	[4, 3.45],
	[5, 3.95],
	[6, 4.4],
	[7, 4.65]
]);

/** straight between the rows of a table */
function linear(/** @type {number} */ x, /** @type {[number, number][]} */ rows) {
	if (x <= rows[0][0]) return rows[0][1];
	for (let i = 1; i < rows.length; i++) if (x <= rows[i][0]) return rows[i - 1][1] + (rows[i][1] - rows[i - 1][1]) * ((x - rows[i - 1][0]) / (rows[i][0] - rows[i - 1][0]));
	return rows[rows.length - 1][1];
}
/** when (in years) the leader had reached the height h */
function leaderAt(/** @type {number} */ h) {
	for (let i = 1; i < LEADER.length; i++) if (h <= LEADER[i][1]) return LEADER[i - 1][0] + (LEADER[i][0] - LEADER[i - 1][0]) * ((h - LEADER[i - 1][1]) / (LEADER[i][1] - LEADER[i - 1][1]));
	return LEADER[LEADER.length - 1][0];
}

/**
 * A space that finds what is near a place by a grid, not by looking at everything: a tree hung with hundreds of
 * apples asks it thousands of times.
 */
class GridSpace extends Space {
	constructor(cell = 0.12) {
		super();
		this.cell = cell;
		/** @type {Map<number, { c?: THREE.Vector3, a?: THREE.Vector3, b?: THREE.Vector3, r: number }[]>} */
		this.grid = new Map();
		/** how far round a place a question reaches at most (a fruit's radius, a leaf's) */
		this.reach = 0.045;
	}
	/** @param {number} x @param {number} y @param {number} z */
	key(x, y, z) {
		return ((Math.floor(x / this.cell) + 512) * 1024 + (Math.floor(y / this.cell) + 512)) * 1024 + (Math.floor(z / this.cell) + 512);
	}
	/** @param {{ c?: THREE.Vector3, a?: THREE.Vector3, b?: THREE.Vector3, r: number }} item @param {THREE.Vector3} lo @param {THREE.Vector3} hi */
	file(item, lo, hi) {
		const m = item.r + this.reach, s = this.cell;
		for (let x = Math.floor((lo.x - m) / s); x <= Math.floor((hi.x + m) / s); x++)
			for (let y = Math.floor((lo.y - m) / s); y <= Math.floor((hi.y + m) / s); y++)
				for (let z = Math.floor((lo.z - m) / s); z <= Math.floor((hi.z + m) / s); z++) {
					const k = ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
					let list = this.grid.get(k);
					if (!list) this.grid.set(k, (list = []));
					list.push(item);
				}
	}
	/** @param {THREE.Vector3} c @param {number} r */
	ball(c, r) {
		const item = { c: c.clone(), r };
		this.balls.push(/** @type {{ c: THREE.Vector3, r: number }} */ (item));
		this.file(item, c, c);
	}
	/** @param {THREE.Vector3[]} pts @param {number} r */
	rod(pts, r) {
		for (let i = 0; i + 1 < pts.length; i++) {
			const item = { a: pts[i].clone(), b: pts[i + 1].clone(), r };
			this.rods.push(/** @type {{ a: THREE.Vector3, b: THREE.Vector3, r: number }} */ (item));
			this.file(item, item.a.clone().min(item.b), item.a.clone().max(item.b));
		}
	}
	/** is there a fruit near p @param {THREE.Vector3} p */
	fruitNear(p) {
		return !!this.grid.get(this.key(p.x, p.y, p.z))?.some((it) => it.c);
	}
	/** @param {THREE.Vector3} c @param {number} r */
	depth(c, r) {
		const list = this.grid.get(this.key(c.x, c.y, c.z));
		if (!list) return 0;
		let worst = 0;
		for (const it of list) {
			if (it.c) worst = Math.max(worst, r + it.r - c.distanceTo(it.c));
			else {
				const a = /** @type {THREE.Vector3} */ (it.a), b = /** @type {THREE.Vector3} */ (it.b);
				const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
				const t = clamp(((c.x - a.x) * abx + (c.y - a.y) * aby + (c.z - a.z) * abz) / Math.max(1e-12, abx * abx + aby * aby + abz * abz));
				const dx = a.x + abx * t - c.x, dy = a.y + aby * t - c.y, dz = a.z + abz * t - c.z;
				worst = Math.max(worst, r + it.r - Math.sqrt(dx * dx + dy * dy + dz * dz));
			}
		}
		return Math.max(0, worst);
	}
}

/**
 * @typedef {{ s: number, dir: THREE.Vector3, len: number, born: number, flowers: number, keep: number, key: (string | number)[] }} Spur
 *   a spur `s` metres along its branch, born in the year `born`; it flowers (`flowers` in its cluster, 0 if not) and
 *   keeps `keep` apples
 * @typedef {{
 *   key: (string | number)[], order: number, at: number, dirs: THREE.Vector3[], step: number, full: number, born: number,
 *   rate: number, kids: Branch[], spurs: Spur[], base?: THREE.Vector3, load: number[]
 * }} Branch one branch as it will be when grown: `at` how far along its parent it starts, `dirs` the way each of its
 *   steps goes (before any fruit bows it), its full length, the year it breaks and how fast it grows (m a year);
 *   `load` the apples it carries beyond each step
 */

/** the whole tree as it will grow, from its seed — drawn once a seed */
const TREES = new Map();

/** @param {string} seed @returns {Branch} */
export function design(seed) {
	const cached = TREES.get(seed);
	if (cached) return cached;
	const pr = chance(seed, 'apple-tree');
	const vigour = about(pr, 1, 0.07);
	// the crown it fills: a dome over the clear trunk, a little lopsided
	const env = { c: v3(about(pr, 0, 0.15), 3.15 * vigour, about(pr, 0, 0.15)), rx: 3.0 * vigour * about(pr, 1, 0.06), rz: 3.0 * vigour * about(pr, 1, 0.06), up: 2.0 * vigour, down: 1.95 * vigour };
	/** how far from p along d to the crown's edge */
	const edge = (/** @type {THREE.Vector3} */ p, /** @type {THREE.Vector3} */ d) => {
		for (const ry of [env.up, env.down]) {
			const ox = (p.x - env.c.x) / env.rx, oy = (p.y - env.c.y) / ry, oz = (p.z - env.c.z) / env.rz;
			const dx = d.x / env.rx, dy = d.y / ry, dz = d.z / env.rz;
			const A = dx * dx + dy * dy + dz * dz, B = 2 * (ox * dx + oy * dy + oz * dz), C = ox * ox + oy * oy + oz * oz - 1;
			const disc = B * B - 4 * A * C;
			if (disc < 0) return 0.05;
			const t = (-B + Math.sqrt(disc)) / (2 * A);
			const y = p.y + d.y * t;
			if ((ry === env.up) === (y >= env.c.y)) return Math.max(0.05, t);
		}
		return 0.05;
	};
	/**
	 * a branch's way, step by step: toward the light at first, then (the further out, the more) bowing under its own
	 * weight, wandering a little
	 * @param {Chance} r @param {THREE.Vector3} d0 @param {number} n @param {number} up @param {number} droop @param {number} wander
	 */
	const way = (r, d0, n, up, droop, wander) => {
		const d = d0.clone().normalize();
		const dirs = [];
		for (let i = 0; i < n; i++) {
			d.y += up * (1 - i / n) - droop * (i / n);
			d.x += (r() * 2 - 1) * wander;
			d.z += (r() * 2 - 1) * wander;
			dirs.push(d.normalize().clone());
		}
		return dirs;
	};
	/** a point `s` metres along a branch from `from` (unbowed) */
	const point = (/** @type {THREE.Vector3} */ from, /** @type {Branch} */ b, /** @type {number} */ s) => {
		const p = from.clone();
		let left = s;
		for (const d of b.dirs) {
			const t = Math.min(left, b.step);
			p.addScaledVector(d, t);
			left -= t;
			if (left <= 0) break;
		}
		return p;
	};
	const dirAt = (/** @type {Branch} */ b, /** @type {number} */ s) => b.dirs[Math.min(b.dirs.length - 1, Math.floor(s / b.step))];
	/** when the wood s metres along a branch was made */
	const madeAt = (/** @type {Branch} */ b, /** @type {number} */ s) => (b.order === 0 ? leaderAt(s) : b.born + s / b.rate);
	/** a direction leaving `d` at `tilt`, turned `turn` round it */
	const leave = (/** @type {THREE.Vector3} */ d, /** @type {number} */ tilt, /** @type {number} */ turn) => {
		const side = new THREE.Vector3().crossVectors(d, Math.abs(d.y) > 0.95 ? v3(1, 0, 0) : UP).normalize().applyAxisAngle(d, turn);
		return d.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(side, Math.sin(tilt)).normalize();
	};

	/** @type {Branch} */
	const trunk = { key: ['trunk'], order: 0, at: 0, dirs: [], step: 0, full: LEADER[LEADER.length - 1][1], born: 0, rate: 1, kids: [], spurs: [], load: [] };
	const tr = chance(seed, 'apple-trunk');
	trunk.dirs = way(tr, v3(about(tr, 0, 0.03), 1, about(tr, 0, 0.03)), 16, 0.02, 0, 0.06);
	trunk.step = trunk.full / 16;
	const base = v3(0, -0.01, 0);

	/** a branch off `parent`, s metres along it, going d, as long as the crown leaves room for */
	const branch = (/** @type {Branch} */ parent, /** @type {(string | number)[]} */ key, /** @type {number} */ s, /** @type {THREE.Vector3} */ d, /** @type {number} */ order, /** @type {number} */ full, /** @type {number} */ born) => {
		const r = chance(seed, 'apple-branch', ...key);
		const n = order === 1 ? 10 : order === 2 ? 7 : order === 3 ? 4 : 3;
		const shape = order === 1 ? [0.03, 0.13, 0.08] : order === 2 ? [0.01, 0.16, 0.17] : order === 3 ? [0.03, 0.14, 0.2] : [0.08, 0.1, 0.22];
		/** @type {Branch} */
		const b = { key, order, at: s, dirs: way(r, d, n, shape[0], shape[1], shape[2]), step: full / n, full, born, rate: order === 1 ? 1.05 : order === 2 ? 0.75 : order === 3 ? 0.5 : 0.55, kids: [], spurs: [], load: [] };
		parent.kids.push(b);
		return b;
	};
	/** where each branch starts (unbowed), to measure the room it has */
	const starts = new Map();
	starts.set(trunk, base);

	// the scaffold limbs, in three tiers up the leader, spiralling round it
	const tiers = [
		{ n: 4 + Math.floor(tr() * 2), from: 1.42, to: 1.85, tilt: 1.0, longest: 3.4 },
		{ n: 2 + Math.floor(tr() * 2), from: 2.4, to: 2.95, tilt: 0.92, longest: 2.8 },
		{ n: 2, from: 3.35, to: 3.8, tilt: 0.78, longest: 1.8 }
	];
	let turn = tr() * Math.PI * 2;
	tiers.forEach((t, ti) => {
		for (let i = 0; i < t.n; i++) {
			const s = lerp(t.from, t.to, (i + tr() * 0.6) / t.n);
			turn += ti === 0 ? (Math.PI * 2) / t.n + about(tr, 0, 0.3) : 2.4 + about(tr, 0, 0.3);
			const d = leave(dirAt(trunk, s), t.tilt * about(tr, 1, 0.1), turn);
			const p = point(base, trunk, s);
			const full = clamp(edge(p, d) * about(tr, 0.92, 0.06), 0.6, t.longest);
			const b = branch(trunk, ['limb', ti, i], s, d, 1, full, madeAt(trunk, s) + 0.05);
			starts.set(b, p);
		}
	});
	// laterals along the scaffolds and the leader's top, and short shoots along the laterals
	/** @param {Branch} b */
	const furnish = (b) => {
		const from = starts.get(b);
		const r = chance(seed, 'apple-laterals', ...b.key);
		// the leader's top carries laterals as the limbs do
		const kidOrder = b.order === 0 ? 2 : b.order + 1;
		if (kidOrder <= 3) {
			const spacing = kidOrder === 2 ? 0.3 : 0.2;
			let s = b.order === 0 ? 3.3 : kidOrder === 2 ? 0.22 : 0.1;
			let k = 0;
			let phyl = r() * Math.PI * 2;
			while (s < b.full - (kidOrder === 2 ? 0.15 : 0.08)) {
				phyl += 2.4 + about(r, 0, 0.35);
				const d0 = leave(dirAt(b, s), between(r, 0.85, 1.2), phyl);
				// plagiotropic: the laterals lie out more level than they leave
				d0.y = d0.y * 0.45 + (kidOrder === 2 ? -0.02 : -0.04);
				d0.normalize();
				const p = point(from, b, s);
				// those turned in toward the middle are shaded out: short, or gone
				const out = v3(p.x - env.c.x, 0, p.z - env.c.z).normalize();
				const inward = d0.x * out.x + d0.z * out.z < -0.25;
				if (!(inward && r() < 0.6)) {
					const room = edge(p, d0) * between(r, kidOrder === 2 ? 0.6 : 0.4, kidOrder === 2 ? 0.95 : 0.8) * (inward ? 0.45 : 1);
					const full = clamp(room, kidOrder === 2 ? 0.25 : 0.1, kidOrder === 2 ? 1.6 : 0.55);
					const kid = branch(b, [...b.key, k], s, d0, kidOrder, full, madeAt(b, s) + 0.35 + r() * 0.3);
					starts.set(kid, p);
					furnish(kid);
				}
				k++;
				s += spacing * about(r, 1, 0.25);
			}
		}
		// the season's leafy shoots off the laterals and their shoots, filling the crown between them
		if (b.order === 2 || b.order === 3) {
			const tr4 = chance(seed, 'apple-twigs', ...b.key);
			let s = 0.12 + tr4() * 0.15;
			let k = 0;
			let phyl = tr4() * Math.PI * 2;
			while (s < b.full - 0.05) {
				phyl += 2.4 + about(tr4, 0, 0.5);
				const d = leave(dirAt(b, s), between(tr4, 0.6, 1.1), phyl);
				d.y = d.y * 0.7 + 0.25;
				d.normalize();
				const full = clamp(edge(point(from, b, s), d) * 0.7, 0.08, between(tr4, 0.14, 0.34));
				branch(b, [...b.key, 'twig', k], s, d, 4, full, madeAt(b, s) + 0.4 + tr4() * 0.4);
				k++;
				s += (b.order === 2 ? 0.36 : 0.3) * about(tr4, 1, 0.3);
			}
		}
		// spurs on the wood from its second year (not on the leader, nor the first half of a scaffold)
		if (b.order >= 1) {
			const sr = chance(seed, 'apple-spurs', ...b.key);
			let s = b.order === 1 ? b.full * 0.45 : 0.08;
			let k = 0;
			let phyl = sr() * Math.PI * 2;
			while (s < b.full - 0.06) {
				phyl += 2.4 + about(sr, 0, 0.4);
				const d = leave(dirAt(b, s), between(sr, 0.9, 1.4), phyl);
				// spurs stand up off the branch rather than hang under it
				d.y = d.y * 0.6 + 0.35;
				d.normalize();
				const made = madeAt(b, s);
				// a spur flowers from the wood's third year; the young tree's first blossom is sparse
				const flowers = sr() < (BLOOM - made >= 1.5 ? 0.85 : BLOOM - made >= 0.9 ? 0.55 : 0) ? 5 + (sr() < 0.5 ? 1 : 0) : 0;
				const k5 = sr();
				const keep = flowers && sr() < 0.55 ? (k5 < 0.3 ? 1 : k5 < 0.66 ? 2 : k5 < 0.88 ? 3 : k5 < 0.97 ? 4 : 5) : 0;
				b.spurs.push({ s, dir: d, len: between(sr, 0.015, 0.045), born: made + 0.45, flowers, keep, key: [...b.key, 'spur', k] });
				k++;
				s += (b.order === 1 ? 0.18 : 0.15) * about(sr, 1, 0.35);
			}
			// the shoots out at the crown's edge bear at their tips too (tip-bearing), where the fruit is seen
			if (b.order >= 2 && sr() < 0.6) {
				const made = madeAt(b, b.full);
				const flowers = BLOOM - made >= 0.6 ? 5 + (sr() < 0.5 ? 1 : 0) : 0;
				const k5 = sr();
				const keep = flowers && sr() < 0.7 ? (k5 < 0.3 ? 1 : k5 < 0.66 ? 2 : k5 < 0.88 ? 3 : 4) : 0;
				const d = dirAt(b, b.full).clone().setY(0.35).normalize();
				b.spurs.push({ s: b.full - 0.005, dir: d, len: 0.012, born: made + 0.3, flowers, keep, key: [...b.key, 'tip'] });
			}
		}
	};
	const limbs = [...trunk.kids];
	furnish(trunk);
	for (const b of limbs) furnish(b);
	if (TREES.size > 24) TREES.delete(TREES.keys().next().value);
	TREES.set(seed, trunk);
	return trunk;
}

/** @typedef {() => number} Chance */

/** an apple leaf: a short stalk, then an oval blade broadest below its middle, narrowing to a point */
const LEAF = (/** @type {number} */ u) => (u < 0.25 ? 0.07 : Math.max(0.07 * (1 - (u - 0.25) * 6), Math.pow(Math.sin(Math.PI * Math.pow((u - 0.25) / 0.75, 0.75)), 0.7)));
/** the apple's outline along its axis, stalk end to eye: flattened, broad in the shoulder */
const APPLE = (/** @type {number} */ u) => Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.42) * (1 - 0.13 * u);
/** a petal: rounded, broadest beyond its middle, on a short claw */
const PETAL = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 0.6);
/** the bark's colours: young shoots red-brown, older wood grey-brown, the trunk's plates, their flaking edges, the cracks */
const BARK = { young: new THREE.Color('#8a5a3e'), old: new THREE.Color('#7c7065'), flake: new THREE.Color('#998c7c'), crack: new THREE.Color('#3d332b'), plate: new THREE.Color('#5e5248'), c: new THREE.Color() };
const PETAL_C = { white: new THREE.Color('#fffdfb'), pink: new THREE.Color('#f0a2b9'), c: new THREE.Color() };

/**
 * The apple tree, v2.
 * @param {number} g @param {string} seed
 */
export function apple(g, seed) {
	const bag = new Bag();
	const space = new GridSpace();
	bag.space = space;
	const depth = 0.01;
	const at = v3(0, -depth, 0);
	const Y = linear(g, YEARS);

	// the pip, and how it comes up: its seed leaves lifted out of the soil
	sprout(bag, {
		seed,
		at,
		size: v3(0.004, 0.0022, 0.002),
		coat: '#5a3a22',
		coatShade: '#3a2414',
		stem: linear(g, [[0, 0], [0.3, depth * 0.1 + 0.001], [1, depth + 0.03], [2, depth + 0.07], [9, depth + 0.07]]),
		hook: linear(g, [[0, 1], [1, 1], [1.6, 0]]),
		radius: 0.0018 + 0.004 * span(g, 1, 3),
		stemColor: '#7a7a42',
		leaf: { length: 0.012, width: 0.0045, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.7), color: '#6aa046', vein: '#a6c47e' },
		open: span(g, 1.1, 2),
		shed: span(g, 1, 1.6),
		wither: span(g, 3, 3.8),
		keepCoat: false
	});

	// the roots: a taproot, and roots spreading wide near the surface
	root(bag, { seed, key: ['tap'], from: at.clone(), dir: v3(0.02, -1, 0.01), length: 1.2, grown: linear(g, [[0, 0], [0.3, 0.004], [1, 0.03], [2, 0.07], [3, 0.2], [4, 0.45], [5, 0.75], [6, 0.9], [8, 1]]), radius: 0.002 + 0.05 * span(g, 2, 8), down: 0.03, wander: 0.1, laterals: 10, lateral: 0.3, depth: 2, age: span(g, 1.5, 6), young: '#f3e6cc', old: '#6e5032' });
	for (let i = 0; i < 16; i++) {
		const rr = chance(seed, 'feeder', i);
		const born = 2.6 + i * 0.25;
		const bear = i * 2.39996 + rr() * 0.4;
		root(bag, { seed, key: ['feeder', i], from: at.clone().add(v3(0, -0.04 - rr() * 0.12, 0)), dir: v3(Math.cos(bear), -0.15, Math.sin(bear)), length: between(rr, 0.6, 1) * 2.4, grown: (g - born) / 2.8, radius: 0.003 + 0.02 * span(g, 3, 8), down: 0.01, wander: 0.14, laterals: 5, lateral: 0.25, depth: 2, age: (g - born - 0.6) / 2.5, young: '#efdcb8', old: '#6e5032' });
	}
	if (Y <= 0) return bag.build();

	const tree = design(seed);
	// the season: the leaves of the blossom are a young rosette, the shoots' leaves come after; the fruit sets,
	// swells and colours
	const leafSize = g < 4.5 ? 1 : g < 5 ? lerp(1, 0.5, (g - 4.5) / 0.5) : lerp(0.5, 1, span(g, 5, 6.4));
	const leafYoung = g < 4.5 ? 0 : g < 5 ? (g - 4.5) * 2 : 1 - span(g, 5, 6.6);
	const set = span(g, 5.5, 7.7);
	const ripe = span(g, 7.0, 8.7);
	const fruiting = g >= 5.5;
	const blooming = g >= 4.6 && g < 5.75;

	// the fruit each branch carries, and beyond each of its steps: its weight bows it down
	const weight = (/** @type {Branch} */ b) => {
		const n = b.dirs.length;
		b.load = new Array(n).fill(0);
		if (!fruiting) return 0;
		let total = 0;
		const add = (/** @type {number} */ s, /** @type {number} */ w) => {
			const k = Math.min(n - 1, Math.floor(s / b.step));
			for (let i = 0; i <= k; i++) b.load[i] += w;
			total += w;
		};
		for (const sp of b.spurs) if (sp.keep) add(sp.s, sp.keep * set * set);
		for (const kid of b.kids) add(kid.at, weight(kid));
		return total;
	};
	weight(tree);

	/** @type {{ at: THREE.Vector3, dir: THREE.Vector3, along: THREE.Vector3, spur: Spur, radius: number }[]} */
	const spurs = [];
	/** @type {{ pts: THREE.Vector3[], from: number, key: (string | number)[], twig: boolean }[]} */
	const leafy = [];

	/**
	 * a branch as far as it has grown, bowed by the fruit beyond each step, and everything off it
	 * @param {Branch} b @param {THREE.Vector3} from @param {THREE.Quaternion} turn how the branch it sits on has turned it
	 */
	const draw = (b, from, turn) => {
		const length = b.order === 0 ? linear(Y, LEADER) : b.full * clamp(((Y - b.born) * b.rate) / b.full);
		if (length < 0.004) return;
		const age = Y - b.born;
		// thick for the tree it carries and its years: the trunk the most
		const R =
			b.order === 0
				? 0.004 + 0.072 * Math.pow(clamp(Y / 6.2), 1.25)
				: b.order === 1
					? 0.005 + 0.03 * Math.sqrt(length / 3) * clamp(age / 4.5)
					: b.order === 2
						? 0.0035 + 0.012 * Math.sqrt(length / 1.3) * clamp(age / 3)
						: b.order === 3 ? 0.0028 + 0.0045 * clamp(length / 0.45) : 0.0022 + 0.001 * clamp(length / 0.3);
		const pts = [from.clone()];
		const qs = [turn.clone()];
		const q = turn.clone();
		let left = length;
		for (let i = 0; i < b.dirs.length && left > 1e-5; i++) {
			const d = b.dirs[i].clone().applyQuaternion(q);
			// the fruit beyond bows it: the more, the thinner the wood here
			const r = Math.max(0.003, R * (1 - 0.55 * (i / b.dirs.length)));
			const stiff = b.order === 0 ? 0 : b.order === 1 ? 0.35 : 0.9;
			const bow = Math.min(0.25, (0.003 * b.load[i] * b.step) / Math.pow(r / 0.01, 2.6)) * stiff;
			if (bow > 1e-5) {
				const axis = new THREE.Vector3().crossVectors(UP, d);
				if (axis.lengthSq() > 1e-6) {
					const bq = new THREE.Quaternion().setFromAxisAngle(axis.normalize(), bow);
					q.premultiply(bq);
					d.applyQuaternion(bq);
					// never past hanging straight down
					if (d.y < -0.85) d.y = -0.85;
					d.normalize();
				}
			}
			const t = Math.min(left, b.step);
			pts.push(pts[i].clone().addScaledVector(d, t));
			qs.push(q.clone());
			left -= t;
		}
		const L = length;
		// young wood smooth and red-brown, older grey-brown; the trunk's bark breaking into scaly plates
		const flare = b.order === 0 ? (/** @type {number} */ u) => 1 + 0.45 * Math.pow(1 - Math.min(1, (u * L) / 0.35), 3) : () => 1;
		const scales = (/** @type {number} */ u, /** @type {number} */ v) => Math.sin(v * Math.PI * 2 * 7 + Math.sin(u * L * 9) * 2.2) * Math.sin(u * L * 23 + v * 19);
		const madeAt = (/** @type {number} */ u) => (b.order === 0 ? leaderAt(u * L) : b.born + (u * L) / b.rate);
		const paint = (/** @type {number} */ u, /** @type {number} */ v) => {
			const woodAge = Y - madeAt(u);
			const c = BARK.c.lerpColors(BARK.young, BARK.old, clamp((woodAge - 0.6) / 1.8));
			if (b.order <= 1 && woodAge > 2.5) {
				const s = scales(u, v);
				c.lerp(s > 0.55 ? BARK.flake : s < -0.6 ? BARK.crack : BARK.plate, clamp((woodAge - 2.5) / 2) * (b.order === 0 ? 1 : 0.5));
			}
			return c;
		};
		const radius = (/** @type {number} */ u, /** @type {number} */ v) => {
			const r = Math.max(0.0022, R * (1 - (b.order === 0 ? 0.62 : 0.6) * u)) * flare(u);
			return b.order === 0 && Y > 3 ? r * (1 + 0.035 * clamp((Y - 3) / 2) * scales(u, v) * (u < 0.5 ? 1 : 0)) : r;
		};
		const sides = b.order === 0 ? 11 : b.order === 1 ? 7 : b.order === 2 ? 5 : b.order === 3 ? 4 : 3;
		bag.add('body', tube(pts, radius, paint, sides));
		if (b.order <= 2 && R > 0.006) space.rod(pts, R * 0.8 + 0.006);
		/** where s metres along it is, which way it goes there, and how it has turned there */
		const where = (/** @type {number} */ s) => {
			const f = Math.min(pts.length - 1.0001, s / b.step), k = Math.floor(f);
			return { p: pts[k].clone().lerp(pts[k + 1], f - k), d: pts[k + 1].clone().sub(pts[k]).normalize(), q: qs[k + 1], r: Math.max(0.0022, R * (1 - 0.6 * (s / Math.max(1e-6, L)))) };
		};
		// its leaves: along the season's growth at its tip (on a young tree, all its young wood)
		const grownBefore = b.order === 0 ? linear(Y - 1, LEADER) : b.full * clamp(((Y - 1 - b.born) * b.rate) / b.full);
		const season = clamp(length - grownBefore, Math.min(length, 0.14 + 0.08 * (b.key.length % 3) / 2), b.order === 0 ? 0.9 : 0.55);
		leafy.push({ pts, from: b.order === 4 ? 0.015 : length - season, key: b.key, twig: b.order === 4 });
		for (const kid of b.kids) {
			if (kid.at > length) continue;
			const w = where(kid.at);
			// out of the bark, not out of the core
			draw(kid, w.p.clone().addScaledVector(kid.dirs[0].clone().applyQuaternion(w.q), w.r * 0.5), w.q);
		}
		for (const sp of b.spurs) {
			if (sp.s > length || Y < sp.born) continue;
			const w = where(sp.s);
			const d = sp.dir.clone().applyQuaternion(w.q).normalize();
			const len = sp.len * clamp((Y - sp.born) / 1.5 + 0.3);
			const a = w.p.clone().addScaledVector(d, w.r * 0.6);
			const tip = a.clone().addScaledVector(d, len);
			// short and knobbly, ringed with the scars of years
			bag.add('body', tube([w.p.clone(), a, tip], (u) => 0.0032 * (1 - 0.3 * u) + 0.0012 * Math.max(0, Math.sin(u * 9)), () => '#6c5c4e', 3));
			spurs.push({ at: tip, dir: d, along: w.d, spur: sp, radius: w.r });
		}
	};
	draw(tree, v3(0, -0.01, 0), new THREE.Quaternion());

	// the blossom, and the fruit it sets
	for (const s of spurs) {
		if (!s.spur.flowers) continue;
		const fr = chance(seed, 'apple-cluster', ...s.spur.key);
		const opens = 4.7 + fr() * 0.15;
		const up = s.dir.clone().lerp(UP, 0.5).normalize();
		const n = s.spur.flowers;
		const sideOf = new THREE.Vector3().crossVectors(up, Math.abs(up.y) > 0.95 ? v3(1, 0, 0) : UP).normalize();
		/** where flower k sits and faces: the king in the middle, the others round it on longer stalks */
		const flowerAt = (/** @type {number} */ k) => {
			if (k === 0) return { d: up.clone(), len: 0.016 };
			const side = sideOf.clone().applyAxisAngle(up, (k / (n - 1)) * Math.PI * 2 + fr() * 0.4);
			return { d: up.clone().multiplyScalar(0.55).addScaledVector(side, 0.85).normalize(), len: 0.024 + fr() * 0.008 };
		};
		if (blooming) {
			for (let k = 0; k < n; k++) {
				const { d, len } = flowerAt(k);
				const end = s.at.clone().addScaledVector(d, len);
				const o = opens + (k ? 0.03 + k * 0.022 : 0);
				const open = clamp((g - o) / 0.12);
				const fall = span(g, o + 0.42, o + 0.62);
				const kept = k < s.spur.keep;
				if (fall >= 1 && (!kept || g > 5.55)) continue;
				bag.add('body', tube([s.at, end], () => 0.0009, () => '#7a8a3e', 3));
				const face = d.clone().lerp(UP, 0.15).normalize();
				if (open <= 0) {
					// the bud: deep pink, swelling
					const bud = 0.0042 + 0.0018 * clamp((g - (o - 0.3)) / 0.3);
					bag.add('body', bead(end.clone().addScaledVector(face, bud), v3(bud * 0.85, bud * 1.15, bud * 0.85), '#cf4f78', 3, new THREE.Quaternion().setFromUnitVectors(UP, face)));
					continue;
				}
				flower(bag, end, face, open, fall, 0.6 + fr() * 0.4, fr() * Math.PI);
				// after the petals the little fruit, the ones that will drop too
				if (fall > 0.3 && !kept) bag.add('body', bead(end.clone().addScaledVector(face, 0.003), v3(0.003, 0.004, 0.003), '#8aa64a', 2));
			}
		}
		if (!fruiting) continue;
		// the June drop: the ones it will not keep wither on their stalks and fall
		const drop = span(g, 5.6, 6.3);
		for (let k = s.spur.keep; k < n && drop < 1; k++) {
			const { d, len } = flowerAt(k);
			const end = s.at.clone().addScaledVector(d, len);
			const f = 0.004 * (1 - drop);
			if (f > 0.0008 && g > 5.75) bag.add('body', bead(end, v3(f, f * 1.2, f), mix('#8aa64a', '#b0a050', drop), 2));
		}
		for (let k = 0; k < s.spur.keep; k++) {
			const kr = chance(seed, 'apple-fruit', ...s.spur.key, k);
			const size = about(kr, 1, 0.1) * lerp(0.12, 1, set) * (k === 0 ? 1.04 : 1);
			const Lf = 0.066 * size, W = 0.04 * size;
			const { d } = flowerAt(k);
			// the stalk, 2–3 cm, lifting it out of the cluster, then the fruit hanging from it as it grows heavy
			const stalk = 0.022 + kr() * 0.01;
			const start = s.at.clone().addScaledVector(d, stalk * 0.45);
			const swing = d.clone().setY(0);
			if (swing.lengthSq() < 1e-6) swing.set(Math.cos(k * 2.4), 0, Math.sin(k * 2.4));
			swing.normalize();
			const hang = v3(0, -1, 0).lerp(d, clamp(0.85 - set * 1.4)).addScaledVector(swing, 0.35).normalize();
			const from = start.clone().addScaledVector(hang, stalk * 0.55);
			const place = space.settle(from, hang, (a, dd) => [0.32, 0.68].map((t) => ({ c: a.clone().addScaledVector(dd, Lf * t), r: W * 0.93 })), stalk * 0.9 + W * 0.6);
			bag.add('body', tube([s.at, start, place.at], (u) => 0.0011 + 0.0007 * set * (1 - 0.4 * u), () => '#6f6a3a', 3));
			// the sunny side: the outer and higher apples colour more
			const out = clamp(Math.hypot(place.at.x, place.at.z) / 2.2) * 0.5 + clamp((place.at.y - 1.4) / 3) * 0.5;
			appleFruit(bag, { at: place.at, dir: place.dir, L: Lf, W, ripe, sun: kr() * Math.PI * 2, blush: lerp(0.55, 1, out) * about(kr, 1, 0.12) });
		}
	}

	// the leaves: alternate along the season's shoots, and a rosette on every spur; turned clear of the fruit
	const leafPaint = (/** @type {Chance} */ r) => {
		const tone = r();
		const under = r() < 0.09;
		const ground = under ? mix('#8ea07c', '#a9b496', tone) : tone < 0.4 ? mix('#2c5524', '#3a6a2a', tone / 0.4) : mix('#3a6a2a', '#5a8a36', (tone - 0.4) / 0.6);
		const young = mix('#a2c45a', '#8ab44c', tone);
		const c = ground.lerp(young, leafYoung * 0.8);
		const rib = c.clone().lerp(new THREE.Color('#d6dca0'), 0.35);
		return (/** @type {number} */ u, /** @type {number} */ v) => (u < 0.25 || Math.abs(v) < 0.1 ? rib : c);
	};
	/** a leaf at p reaching out along `out` (level), raised by `lift` @param {Chance} r */
	const leaf = (/** @type {THREE.Vector3} */ p, /** @type {THREE.Vector3} */ out, /** @type {number} */ lift, /** @type {number} */ size, r) => {
		const len = 0.11 * size * between(r, 0.82, 1.12);
		let o = out.clone().setY(0);
		if (o.lengthSq() < 1e-6) o.set(1, 0, 0);
		o.normalize();
		if (fruiting && space.fruitNear(p)) o = space.steer(p, o, lift, len, 0.012);
		const dir = o.clone().multiplyScalar(Math.cos(lift)).add(v3(0, Math.sin(lift), 0));
		bag.add('sheet', sheet({ length: len, width: len * 0.25, shape: LEAF, lift: (u, v) => 0.07 * v * v - 0.07 * u * u, paint: leafPaint(r), along: 4, across: 2 }), aim(p, dir, (r() - 0.5) * 2.4));
	};
	const seedling = lerp(0.35, 1, clamp(Y));
	for (const sh of leafy) {
		const lr = chance(seed, 'apple-leaves', ...sh.key);
		const lengths = [0];
		for (let i = 1; i < sh.pts.length; i++) lengths.push(lengths[i - 1] + sh.pts[i].distanceTo(sh.pts[i - 1]));
		const total = lengths[lengths.length - 1];
		let s = Math.max(0.02, sh.from);
		let i = 0;
		let phyl = lr() * Math.PI * 2;
		while (s < total - 0.005) {
			while (i + 2 < sh.pts.length && lengths[i + 1] < s) i++;
			const a = sh.pts[i], b = sh.pts[i + 1];
			const p = a.clone().lerp(b, clamp((s - lengths[i]) / Math.max(1e-6, lengths[i + 1] - lengths[i])));
			const d = b.clone().sub(a).normalize();
			// alternate, two-fifths of a turn apart
			phyl += 2.51;
			const side = new THREE.Vector3().crossVectors(d, Math.abs(d.y) > 0.95 ? v3(1, 0, 0) : UP).normalize().applyAxisAngle(d, phyl);
			// the leaves nearest the tip still small and held up
			const toTip = (total - s) / 0.12;
			const size = leafSize * seedling * lerp(0.5, 1, clamp(toTip));
			leaf(p, side.clone().addScaledVector(d, 0.6), lerp(0.55, between(lr, -0.35, 0.25), clamp(toTip)), size, lr);
			s += (sh.twig ? 0.036 : 0.045) * about(lr, 1, 0.2);
		}
	}
	for (const s of spurs) {
		const lr = chance(seed, 'apple-rosette', ...s.spur.key);
		const n = 3 + Math.floor(lr() * 3);
		const side = new THREE.Vector3().crossVectors(s.dir, Math.abs(s.dir.y) > 0.95 ? v3(1, 0, 0) : UP).normalize();
		const age = clamp((Y - s.spur.born) / 0.6);
		for (let k = 0; k < n; k++) {
			const out = side.clone().applyAxisAngle(s.dir, (k / n) * Math.PI * 2 + lr() * 0.5).addScaledVector(s.dir, 0.4);
			leaf(s.at, out, between(lr, -0.45, 0.6), leafSize * 0.78 * lerp(0.4, 1, age), lr);
		}
	}

	// windfalls: a few ripe apples lying in the grass under the crown
	if (g > 8.4) {
		const wr = chance(seed, 'apple-windfalls');
		const n = Math.round(4 + wr() * 5) * clamp((g - 8.4) / 0.5);
		for (let k = 0; k < n; k++) {
			const a = wr() * Math.PI * 2, rr = between(wr, 0.6, 2.2);
			const W = 0.038 * about(wr, 1, 0.1);
			const p = v3(Math.cos(a) * rr, W * 0.92, Math.sin(a) * rr);
			appleFruit(bag, { at: p.clone().add(v3(0, W * 0.9, 0)), dir: v3(wr() - 0.5, -1, wr() - 0.5).normalize(), L: 0.066 * (W / 0.04), W, ripe: 1, sun: wr() * 6.28, blush: 0.8 });
		}
	}
	return bag.build();
}

/**
 * One apple blossom: five rounded petals, white flushed pink, opening from a cup to flat; a boss of yellow stamens.
 * @param {Bag} bag @param {THREE.Vector3} at @param {THREE.Vector3} facing @param {number} open @param {number} fall @param {number} pink @param {number} spin
 */
function flower(bag, at, facing, open, fall, pink, spin) {
	const m = new THREE.Matrix4().compose(at, new THREE.Quaternion().setFromUnitVectors(UP, facing.clone().normalize()), v3(1, 1, 1));
	if (fall < 1) {
		const petal = () =>
			sheet({
				length: 0.02 * lerp(0.5, 1, open),
				width: 0.0082 * lerp(0.5, 1, open),
				shape: PETAL,
				lift: (u, v) => 0.18 * u * u + 0.06 * v * v,
				// a fresh flower blushes pink at the edges, an older one is white
				paint: (u) => PETAL_C.c.lerpColors(PETAL_C.white, PETAL_C.pink, clamp(pink * (0.1 + u * u * 0.8) * (1.2 - open * 0.7))),
				along: 3,
				across: 1
			});
		for (let k = 0; k < 5; k++) {
			const up = lerp(1.2, 0.18, open) - fall * 0.9;
			const turn = new THREE.Matrix4().makeRotationY(-((k / 5) * Math.PI * 2 + spin)).multiply(new THREE.Matrix4().makeRotationZ(up));
			bag.add('sheet', petal(), m.clone().multiply(turn).multiply(new THREE.Matrix4().makeScale(1 - fall * 0.5, 1, 1 - fall * 0.5)));
		}
	}
	// the stamens, a yellow boss, browning once the petals go
	bag.add('body', bead(v3(0, 0.0016, 0).applyMatrix4(m), v3(0.0042, 0.0018, 0.0042), fall > 0.4 ? '#a89a4a' : '#e9cf55', 3));
}

/**
 * An apple hanging from `at` along `dir`: yellow-green ripening to yellow, flushed and streaked red on its sunny side,
 * its eye at the bottom.
 * @param {Bag} bag
 * @param {{ at: THREE.Vector3, dir: THREE.Vector3, L: number, W: number, ripe: number, sun: number, blush: number }} o
 */
function appleFruit(bag, o) {
	const m = new THREE.Matrix4().compose(o.at, new THREE.Quaternion().setFromUnitVectors(v3(0, -1, 0), o.dir.clone().normalize()).multiply(new THREE.Quaternion().setFromAxisAngle(UP, o.sun)), v3(1, 1, 1));
	const axis = [];
	const rings = 7;
	// the stalk sits in a hollow: the axis starts a little inside the shoulder
	for (let k = 0; k <= rings; k++) axis.push(v3(0, o.W * 0.12 - (k / rings) * o.L, 0));
	const green = new THREE.Color('#a3c450'), yellow = new THREE.Color('#dccf62');
	const red = new THREE.Color('#c0202c'), deep = new THREE.Color('#8a1424');
	const colour = (/** @type {number} */ u, /** @type {number} */ v) => {
		const ground = green.clone().lerp(yellow, clamp(o.ripe * 1.2));
		const sunny = 0.5 + 0.5 * Math.cos(v * Math.PI * 2);
		const streak = 0.78 + 0.22 * Math.abs(Math.sin(v * Math.PI * 26 + u * 3));
		const cover = clamp((o.ripe * 1.6 - 0.2) * o.blush * (0.85 + 0.5 * sunny) * streak * (1 - 0.25 * u * u));
		const c = ground.lerp(red, cover);
		return c.lerp(deep, clamp((cover - 0.8) * 1.5 * sunny * (1 - streak + 0.3)));
	};
	bag.add('gloss', tube(axis, (u) => o.W * APPLE(u), colour, 8), m);
	// the eye, the dried calyx at the bottom
	bag.add('body', bead(v3(0, o.W * 0.12 - o.L * 0.985, 0), v3(o.W * 0.16, o.W * 0.06, o.W * 0.16), '#4e3e26', 2), m);
}
