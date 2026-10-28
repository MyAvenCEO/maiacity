/*
 * THE JACKFRUIT (Artocarpus heterophyllus), v3 — a seedling jackfruit grown as one grows: a single straight trunk that
 * keeps its leader to the top (monopodial), setting its limbs in a spiral as it passes, the lowest the longest, so the
 * young tree is a cone that fills out into a dense dome; the lowest limbs die off in the shade and fall, leaving a clear
 * trunk of about two metres — where the fruit will come.
 *
 * Its bark grey-brown, rough and a little scaly, its trunk flaring at the foot; its twigs green-brown, ringed every few
 * centimetres by the scars of the stipules that wrapped its buds. Its leaves leathery, glossy dark green above and paler
 * beneath, elliptic to obovate, 10–20 cm on a short stalk, crowded spirally toward the shoot tips at the crown's edge,
 * the new flush pale; a seedling's first leaves often two- or three-lobed (hetero-phyllus: two kinds of leaf).
 *
 * It flowers and fruits on the old wood (cauliflory): short, stout, leafy footstalks break straight out of the trunk
 * and the thick limbs, each with a club-shaped green male head or an oblong female one, a fleshy ring at its foot;
 * smaller male heads also among the leaves. The male heads shed their pollen and blacken; the female heads swell over
 * months into the largest fruit any tree bears, 30–55 cm and tens of kilograms, oblong to round, often lopsided and
 * lumpy, covered in blunt hexagonal knobs — dozens of them, singly and in clusters of two to four, all up the trunk
 * into the crown and along the big limbs. Each hangs straight down on its thick short stalk, leaning against the bark
 * it grew from — not held out on a stalk. Green, then yellowing as it ripens, its knobs flattening and browning at their tips.
 *
 * Every limb, footstalk and fruit draws its chance by its place in the tree, and the tree is designed whole and shown
 * as far as it has grown (`Y` years), so a tree tabbed through its stages grows. ./orchard.v1.js and ./orchard.js grow
 * its v1 and v2 (./trees.js `JACKFRUIT`).
 */
import * as THREE from 'three';
import { Bag, Space, about, aim, bead, between, chance, clamp, lerp, root, sheet, span, tube, v3 } from './grow.js';
import { sprout } from './sprout.js';

const UP = v3(0, 1, 0);

/** the tree's age in years at g (its stages: the seed … day 45, 365, 1300, 2200 … 2380) */
const YEARS = /** @type {[number, number][]} */ ([
	[1.2, 0],
	[2, 0.12],
	[3, 1],
	[4, 3.6],
	[5, 6.0],
	[6, 6.05],
	[7, 6.25],
	[8, 6.4],
	[9, 6.45]
]);
/** the leader's height through the years: about a metre a year, slowing once it bears */
const LEADER = /** @type {[number, number][]} */ ([
	[0, 0],
	[0.12, 0.18],
	[1, 1.15],
	[2, 2.45],
	[3, 3.6],
	[4, 4.75],
	[5, 5.85],
	[6, 6.8],
	[6.5, 7.2]
]);
/** the clear trunk: limbs set below it die off in the shade and fall, a couple of years after the crown closes over them */
const CLEAR = 2.0;

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

/** @typedef {() => number} Chance */
/**
 * @typedef {{ s: number, out: THREE.Vector3, key: (string | number)[], female: boolean, keep: number, len: number }} Site
 *   a footstalk `s` metres along its trunk or limb, breaking out of the bark along `out`; a female head (and the
 *   fruit it keeps, 0 … 2) or a male one
 * @typedef {{
 *   key: (string | number)[], order: number, at: number, dirs: THREE.Vector3[], step: number, full: number, born: number,
 *   rate: number, dies: number, kids: Branch[], sites: Site[], male: boolean
 * }} Branch one branch as it will be when grown: `at` how far along its parent it starts, `dirs` the way each of its
 *   steps goes, its full length, the year it breaks, how fast it grows (m a year) and the year it dies off
 */

/** the whole tree as it will grow, from its seed — designed once a seed */
const TREES = new Map();

/** @param {string} seed @returns {Branch} */
function design(seed) {
	const cached = TREES.get(seed);
	if (cached) return cached;
	const pr = chance(seed, 'jack-tree');
	const vigour = about(pr, 1, 0.06);
	// the dome it fills when grown, from the clear trunk to a little over the leader's top, a little lopsided
	const env = { c: v3(about(pr, 0, 0.2), 4.5 * vigour, about(pr, 0, 0.2)), rx: 3.35 * vigour * about(pr, 1, 0.06), rz: 3.35 * vigour * about(pr, 1, 0.06), up: 3.0 * vigour, down: 2.75 * vigour };
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
	/** a branch's way, step by step: rising at first, then bowing out under its leaves, wandering a little @param {Chance} r */
	const way = (r, /** @type {THREE.Vector3} */ d0, /** @type {number} */ n, /** @type {number} */ up, /** @type {number} */ droop, /** @type {number} */ wander) => {
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
	const leave = (/** @type {THREE.Vector3} */ d, /** @type {number} */ tilt, /** @type {number} */ turn) => {
		const side = new THREE.Vector3().crossVectors(d, Math.abs(d.y) > 0.95 ? v3(1, 0, 0) : UP).normalize().applyAxisAngle(d, turn);
		return d.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(side, Math.sin(tilt)).normalize();
	};

	const tr = chance(seed, 'jack-trunk');
	const top = LEADER[LEADER.length - 1][1] * vigour;
	/** @type {Branch} */
	const trunk = { key: ['trunk'], order: 0, at: 0, dirs: [], step: top / 24, full: top, born: 0, rate: 1, dies: Infinity, kids: [], sites: [], male: false };
	trunk.dirs = way(tr, v3(about(tr, 0, 0.02), 1, about(tr, 0, 0.02)), 24, 0.01, 0, 0.025);
	const madeAt = (/** @type {Branch} */ b, /** @type {number} */ s) => (b.order === 0 ? leaderAt(s / vigour) : b.born + s / b.rate);
	const starts = new Map([[trunk, v3(0, 0, 0)]]);
	const point = (/** @type {Branch} */ b, /** @type {number} */ s) => {
		const p = /** @type {THREE.Vector3} */ (starts.get(b)).clone();
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
	const branch = (/** @type {Branch} */ parent, /** @type {(string | number)[]} */ key, /** @type {number} */ s, /** @type {THREE.Vector3} */ d, /** @type {number} */ order, /** @type {number} */ full, /** @type {number} */ born) => {
		const r = chance(seed, 'jack-branch', ...key);
		const n = order === 1 ? 10 : order === 2 ? 6 : 3;
		const shape = order === 1 ? [0.05, 0.12, 0.07] : order === 2 ? [0.02, 0.14, 0.14] : [0.05, 0.08, 0.2];
		/** @type {Branch} */
		const b = { key, order, at: s, dirs: way(r, d, n, shape[0], shape[1], shape[2]), step: full / n, full, born, rate: order === 1 ? 1.3 : order === 2 ? 0.8 : 0.6, dies: Infinity, kids: [], sites: [], male: false };
		parent.kids.push(b);
		starts.set(b, point(parent, s));
		return b;
	};

	// the limbs, one by one up the leader in a spiral, near-level low down, more upright higher up
	let s = 0.55 + tr() * 0.15;
	let turn = tr() * Math.PI * 2;
	let k = 0;
	while (s < top - 0.45) {
		turn += 2.4 + about(tr, 0, 0.25);
		const h = s / top;
		const d = leave(dirAt(trunk, s), lerp(1.2, 0.9, h) * about(tr, 1, 0.08), turn);
		const p = point(trunk, s);
		const full = clamp(edge(p, d) * about(tr, 0.9, 0.06), 0.5, 3.6);
		const b = branch(trunk, ['limb', k], s, d, 1, full, madeAt(trunk, s) + 0.1);
		// below the clear trunk, shaded out once the crown closes over it
		if (s < CLEAR) b.dies = madeAt(trunk, s) + 3.6 + tr() * 0.8;
		s += 0.22 * about(tr, 1, 0.3);
		k++;
	}
	// laterals along the limbs, nearly level, and short leafy shoots along those, filling the dome's surface
	/** @param {Branch} b */
	const furnish = (b) => {
		const r = chance(seed, 'jack-laterals', ...b.key);
		const kidOrder = b.order + 1;
		const spacing = kidOrder === 2 ? 0.2 : 0.11;
		let s = kidOrder === 2 ? Math.max(0.3, b.full * 0.25) : 0.1;
		let k = 0;
		let phyl = r() * Math.PI * 2;
		while (s < b.full - 0.08) {
			phyl += 2.4 + about(r, 0, 0.4);
			const d0 = leave(dirAt(b, s), between(r, 0.8, 1.15), phyl);
			d0.y = kidOrder === 2 ? d0.y * 0.5 : d0.y * 0.6 + 0.18;
			d0.normalize();
			const p = point(b, s);
			// those turned in toward the middle are shaded out
			const out = v3(p.x - env.c.x, 0, p.z - env.c.z).normalize();
			const inward = d0.x * out.x + d0.z * out.z < -0.3;
			if (!(inward && r() < 0.65)) {
				const room = edge(p, d0) * between(r, kidOrder === 2 ? 0.55 : 0.4, kidOrder === 2 ? 0.9 : 0.75) * (inward ? 0.5 : 1);
				const full = clamp(room, kidOrder === 2 ? 0.25 : 0.1, kidOrder === 2 ? 1.5 : 0.42);
				const kid = branch(b, [...b.key, k], s, d0, kidOrder, full, madeAt(b, s) + 0.3 + r() * 0.3);
				kid.dies = b.dies;
				// a few shoots carry a male head among their leaves
				kid.male = kidOrder === 3 && r() < 0.3;
				if (kidOrder === 2) furnish(kid);
			}
			k++;
			s += spacing * about(r, 1, 0.25);
		}
		// and short leafy shoots straight off the outer part of the limbs themselves
		if (b.order === 1) {
			let s2 = b.full * 0.45 + r() * 0.1;
			let j = 0;
			while (s2 < b.full - 0.1) {
				phyl += 2.4 + about(r, 0, 0.4);
				const d0 = leave(dirAt(b, s2), between(r, 0.7, 1.1), phyl);
				d0.y = d0.y * 0.6 + 0.2;
				d0.normalize();
				const kid = branch(b, [...b.key, 'shoot', j], s2, d0, 3, clamp(edge(point(b, s2), d0) * 0.6, 0.1, 0.38), madeAt(b, s2) + 0.3 + r() * 0.3);
				kid.dies = b.dies;
				kid.male = r() < 0.2;
				j++;
				s2 += 0.14 * about(r, 1, 0.3);
			}
		}
	};
	for (const b of [...trunk.kids]) furnish(b);

	// the footstalks of the old wood: all up the trunk from knee height into the crown, and all along the big limbs
	// out to where they thin — the fruit hangs in clusters from the wood throughout the tree, not only low down
	const fr = chance(seed, 'jack-sites');
	const high = top * 0.72;
	const sites = Math.round((high - 0.4) * 6);
	for (let i = 0; i < sites; i++) {
		const a = fr() * Math.PI * 2;
		trunk.sites.push(site(fr, lerp(0.4, high, (i + fr()) / sites), v3(Math.cos(a), 0, Math.sin(a)), ['trunk', i]));
	}
	for (const b of trunk.kids) {
		if (b.dies < 99 || b.full < 0.9) continue;
		const lr = chance(seed, 'jack-limb-sites', ...b.key);
		const n = Math.floor(b.full * 1.7 + lr());
		for (let i = 0; i < n; i++) {
			const at = lerp(0.12, 0.75, (i + lr()) / n) * b.full;
			// out of its underside or its flanks, where the fruit can hang
			const d = dirAt(b, at);
			const side = new THREE.Vector3().crossVectors(d, UP).normalize().applyAxisAngle(d, between(lr, -1.2, 1.2) + Math.PI / 2);
			if (side.y > 0.1) side.y = -side.y;
			b.sites.push(site(lr, at, side.normalize(), [...b.key, 'site', i]));
		}
	}
	if (TREES.size > 24) TREES.delete(TREES.keys().next().value);
	TREES.set(seed, trunk);
	return trunk;
}

/** a footstalk: male or female, and how many fruit a female head keeps @param {Chance} r */
function site(r, /** @type {number} */ s, /** @type {THREE.Vector3} */ out, /** @type {(string | number)[]} */ key) {
	const female = r() < 0.68;
	const k = r();
	// a cushion keeps one fruit, or a cluster of two to four
	return { s, out, key, female, keep: female ? (k < 0.14 ? 0 : k < 0.5 ? 1 : k < 0.76 ? 2 : k < 0.92 ? 3 : 4) : 0, len: between(r, 0.035, 0.07) };
}

/** a leaf: a short stout stalk, then a blade broadest a little beyond its middle (obovate), with a short blunt tip */
const LEAF = (/** @type {number} */ u) => (u < 0.12 ? 0.06 : Math.max(0.06, Math.pow(Math.sin(Math.PI * Math.pow((u - 0.12) / 0.88, 0.85)), 0.7)));
/** a seedling's lobed leaf: two side lobes at its middle, a long middle lobe beyond them */
const LOBED = (/** @type {number} */ u) => {
	if (u < 0.12) return 0.06;
	const t = (u - 0.12) / 0.88;
	const lobe = Math.pow(Math.max(0, Math.sin(Math.PI * clamp(t / 0.62))), 0.7);
	const middle = 0.42 * Math.pow(Math.max(0, Math.sin(Math.PI * clamp((t - 0.3) / 0.7))), 0.6);
	return Math.max(0.06, t < 0.62 ? Math.max(lobe, middle) : middle);
};
/** the colours, made once */
const C = {
	dark: new THREE.Color('#173a16'), mid: new THREE.Color('#1f4a1b'), light: new THREE.Color('#2c5a24'),
	under: new THREE.Color('#6f8c5c'), young: new THREE.Color('#9dbb52'), rib: new THREE.Color('#b9c48a'),
	barkOld: new THREE.Color('#6d6255'), barkYoung: new THREE.Color('#6b6e44'), scar: new THREE.Color('#a59a7c'),
	plate: new THREE.Color('#5b5045'), lichen: new THREE.Color('#9a9888'), flake: new THREE.Color('#8b8070'), crack: new THREE.Color('#362e27'),
	footstalk: new THREE.Color('#6a6a42'), stalk: new THREE.Color('#5e6a34'), ring: new THREE.Color('#7e8a46'),
	green: new THREE.Color('#5a8a2c'), greenTip: new THREE.Color('#3b6220'), ripe: new THREE.Color('#bcb244'), ripeTip: new THREE.Color('#7c7a2c'),
	male: new THREE.Color('#5f7d34'), pollen: new THREE.Color('#c9c060'), spent: new THREE.Color('#2b2a20'),
	c: new THREE.Color()
};

/**
 * The jackfruit tree, v3.
 * @param {number} g @param {string} seed
 */
export function jackfruit(g, seed) {
	const bag = new Bag();
	const space = bag.space;
	const depth = 0.03;
	const at = v3(0, -depth, 0);
	const Y = linear(g, YEARS);

	// the seed, three centimetres long, pale brown: its root down, its shoot up, its seed leaves kept in the seed below
	const s = sprout(bag, {
		seed,
		at,
		size: v3(0.016, 0.009, 0.01),
		coat: '#c9a678',
		coatShade: '#8a6a44',
		stem: linear(g, [[0, 0], [0.3, depth * 0.1 + 0.001], [1, depth + 0.03], [2, depth + 0.07], [9, depth + 0.07]]),
		hook: linear(g, [[0, 1], [1, 1], [1.6, 0]]),
		radius: 0.0018 + 0.004 * span(g, 1, 3),
		stemColor: '#7a7a42',
		leaf: { length: 0.001, width: 0.0005, shape: () => 1, color: '#7a8a4a', vein: '#7a8a4a' },
		open: 0,
		shed: span(g, 3.5, 4.5),
		wither: 1,
		keepCoat: true
	});

	// the roots: a taproot going deep, and roots spreading wide near the surface
	root(bag, { seed, key: ['tap'], from: at.clone(), dir: v3(0.02, -1, 0.01), length: 2, grown: linear(g, [[0, 0], [0.3, 0.004], [1, 0.03], [2, 0.07], [3, 0.2], [4, 0.45], [5, 0.75], [6, 0.9], [8, 1]]), radius: 0.002 + 0.07 * span(g, 2, 8), down: 0.03, wander: 0.1, laterals: 10, lateral: 0.3, depth: 2, age: span(g, 1.5, 6), young: '#f3e6cc', old: '#6e5032' });
	for (let i = 0; i < 18; i++) {
		const rr = chance(seed, 'feeder', i);
		const born = 2.6 + i * (4 / 18);
		const bear = i * 2.39996 + rr() * 0.4;
		root(bag, { seed, key: ['feeder', i], from: at.clone().add(v3(0, -0.04 - rr() * 0.12, 0)), dir: v3(Math.cos(bear), -0.15, Math.sin(bear)), length: between(rr, 0.6, 1) * 2.8, grown: (g - born) / 2.8, radius: 0.003 + 0.028 * span(g, 3, 8), down: 0.01, wander: 0.14, laterals: 5, lateral: 0.25, depth: 2, age: (g - born - 0.6) / 2.5, young: '#efdcb8', old: '#6e5032' });
	}
	if (Y <= 0) return bag.build();

	const tree = design(seed);
	const base = s.top.clone();
	// the season: a flush of pale new leaves as it flowers; the fruit sets, swells and yellows
	const flushing = span(g, 4.4, 4.9) * (1 - span(g, 5.4, 6.4));
	const set = span(g, 5.15, 7.4);
	const ripe = span(g, 7.4, 8.95);

	/** @type {{ pts: THREE.Vector3[], from: number, zone: number, key: (string | number)[], made: (u: number) => number, young: boolean }[]} */
	const leafy = [];
	/** @type {{ at: THREE.Vector3, out: THREE.Vector3, along: THREE.Vector3, site: Site, wood: number, limb: boolean }[]} */
	const footstalks = [];
	/** @type {{ at: THREE.Vector3, dir: THREE.Vector3, key: (string | number)[] }[]} */
	const males = [];

	/** a branch as far as it has grown, and everything off it @param {Branch} b @param {THREE.Vector3} from */
	const draw = (b, from) => {
		const length = b.order === 0 ? linear(Y, LEADER) * (b.full / LEADER[LEADER.length - 1][1]) : b.full * clamp(((Y - b.born) * b.rate) / b.full);
		if (length < 0.004) return;
		const age = Y - b.born;
		if (Y > b.dies) {
			// fallen: a healed knob where it was
			if (b.order === 1) bag.add('body', bead(from.clone().addScaledVector(b.dirs[0], 0.01), v3(0.022, 0.022, 0.022), C.plate, 3));
			return;
		}
		const R =
			b.order === 0
				? 0.005 + 0.13 * Math.pow(clamp(Y / 6.4), 1.3)
				: b.order === 1
					? 0.004 + 0.05 * Math.sqrt(length / 3) * clamp(age / 4.5)
					: b.order === 2 ? 0.0035 + 0.014 * Math.sqrt(length / 1.3) * clamp(age / 3) : 0.0035 + 0.0025 * clamp(length / 0.3);
		const pts = [from.clone()];
		let left = length;
		for (let i = 0; i < b.dirs.length && left > 1e-5; i++) {
			const t = Math.min(left, b.step);
			pts.push(pts[i].clone().addScaledVector(b.dirs[i], t));
			left -= t;
		}
		const L = length;
		const made = (/** @type {number} */ u) => (b.order === 0 ? leaderAt((u * L) / (b.full / LEADER[LEADER.length - 1][1])) : b.born + (u * L) / b.rate);
		const taper = b.order === 0 ? 0.7 : 0.62;
		// rough scaly bark on the old wood
		const scales = (/** @type {number} */ u, /** @type {number} */ v) => Math.sin(v * Math.PI * 2 * 9 + Math.sin(u * L * 7) * 2.4) * Math.sin(u * L * 19 + v * Math.PI * 2 * 4);
		const paint = (/** @type {number} */ u, /** @type {number} */ v) => {
			const wood = Y - made(u);
			const c = C.c.lerpColors(C.barkYoung, C.barkOld, clamp((wood - 0.5) / 1.5));
			// the stipules' ring scars on the young twigs, every few centimetres
			if (wood < 1.5 && (u * L * 30) % 1 < 0.12) c.lerp(C.scar, 0.55 * (1 - wood / 1.5));
			if (b.order <= 1 && wood > 2) {
				const sc = scales(u, v);
				const old = clamp((wood - 2) / 2.5) * (b.order === 0 ? 1 : 0.55);
				c.lerp(sc > 0.45 ? C.flake : sc < -0.5 ? C.crack : C.plate, old * (sc > 0.45 || sc < -0.5 ? 0.85 : 0.4));
				// pale grey patches of lichen on the old bark
				const patch = Math.sin(u * L * 3.1 + v * Math.PI * 2 * 3) * Math.sin(v * Math.PI * 2 * 2 + u * L * 1.7);
				if (patch > 0.55) c.lerp(C.lichen, old * 0.45);
			}
			return c.clone();
		};
		const radius = (/** @type {number} */ u, /** @type {number} */ v) => {
			let r = Math.max(0.0025, R * (1 - taper * u));
			if (b.order === 0) {
				// the foot flares into low root ridges
				const foot = Math.pow(1 - Math.min(1, (u * L) / 0.6), 2.5);
				r *= 1 + foot * (0.35 + 0.18 * Math.cos(v * Math.PI * 2 * 5));
				if (Y > 2.5) r *= 1 + 0.03 * clamp((Y - 2.5) / 2) * scales(u, v);
			}
			return r;
		};
		const sides = b.order === 0 ? 30 : b.order === 1 ? 8 : b.order === 2 ? 5 : 4;
		bag.add('body', tube(b.order === 0 ? fine(pts) : pts, radius, paint, sides));
		if (b.order <= 1) for (let i = 0; i + 1 < pts.length; i++) space.rods.push({ a: pts[i].clone(), b: pts[i + 1].clone(), r: Math.max(0.003, R * (1 - taper * ((i + 0.5) / (pts.length - 1)))) });
		const where = (/** @type {number} */ s) => {
			const f = Math.min(pts.length - 1.0001, s / b.step), k = Math.floor(f);
			return { p: pts[k].clone().lerp(pts[k + 1], f - k), d: pts[k + 1].clone().sub(pts[k]).normalize(), r: radius(s / Math.max(1e-6, L), 0) };
		};
		// its leaves: crowded toward the tips of the shoots at the crown's edge; on a young tree, along all its young wood
		const zone = b.order === 0 ? 0.9 : b.order === 1 ? 0.6 : b.order === 2 ? 0.55 : 0.5;
		leafy.push({ pts, from: 0.03, zone: L - zone, key: b.key, made: (s) => made(s / L), young: Y < 1.6 });
		for (const kid of b.kids) {
			if (kid.at > length) continue;
			const w = where(kid.at);
			draw(kid, w.p.clone().addScaledVector(kid.dirs[0], w.r * 0.6));
		}
		for (const st of b.sites) {
			if (st.s > length - 0.2) continue;
			const w = where(st.s);
			footstalks.push({ at: w.p.clone().addScaledVector(st.out, w.r * 0.92), out: st.out, along: w.d, site: st, wood: Y - made(st.s / L), limb: b.order === 1 });
		}
		if (b.male && b.order === 3 && L > 0.08) {
			const w = where(L * 0.55);
			males.push({ at: w.p, dir: w.d, key: b.key });
		}
	};
	draw(tree, base);

	// the flowering: from the footstalks on the trunk and the limbs, and the male heads among the leaves
	const blooming = g > 4.55;
	// the room the grown fruit take, and the wood they hang by
	const crowd = new Space();
	crowd.rods = space.rods;
	for (const f of footstalks) {
		if (!blooming || f.wood < 1.2) continue;
		const st = f.site;
		const r = chance(seed, 'jack-flower', ...st.key);
		const grownStalk = clamp((g - 4.55) / 0.3);
		// a short, stout, knobbly shoot straight out of the bark, a little down, with a leaf or two
		const tip = f.at.clone().addScaledVector(f.out, st.len * grownStalk).add(v3(0, -st.len * 0.25 * grownStalk, 0));
		bag.add('body', tube([f.at.clone().addScaledVector(f.out, -0.01), tip], (u) => 0.011 * (1 - 0.3 * u) + 0.002 * Math.max(0, Math.sin(u * 11)), () => C.footstalk, 5));
		if (g < 7) for (let k = 0; k < 2; k++) {
			const a = (k ? 1 : -1) * between(r, 0.7, 1.3);
			const out = f.out.clone().applyAxisAngle(UP, a).setY(between(r, -0.1, 0.35)).normalize();
			bag.add('sheet', sheet({ length: 0.09 * grownStalk * (1 - span(g, 6.3, 7)), width: 0.04 * grownStalk, shape: LEAF, lift: (u, v) => 0.05 * v * v - 0.08 * u * u, paint: leafPaint(r, 0), along: 4, across: 1 }), aim(tip, out, (r() - 0.5) * 0.8));
		}
		if (!st.female) {
			// a club-shaped male head, dark green, yellow with pollen, then black and gone
			const fall = span(g, 5.6, 6.1);
			if (fall >= 1) continue;
			const size = lerp(0.4, 1, clamp((g - 4.55) / 0.4)) * about(r, 1, 0.15);
			const d = f.out.clone().add(v3(0, -0.9, 0)).normalize();
			const colour = g < 5.05 ? C.male : g < 5.45 ? C.pollen : C.spent;
			bag.add('body', tube([tip, tip.clone().addScaledVector(d, 0.025)], () => 0.004, () => C.stalk, 4));
			bag.add('body', bead(tip.clone().addScaledVector(d, 0.025 + 0.03 * size), v3(0.013, 0.034, 0.013).multiplyScalar(size * (1 - 0.4 * fall)), colour, 6, new THREE.Quaternion().setFromUnitVectors(UP, d)));
			continue;
		}
		// the female head, and the fruit it becomes: those it does not keep blacken and drop
		const n = Math.max(1, st.keep);
		for (let k = 0; k < n; k++) {
			const kept = k < st.keep;
			const drop = kept ? 0 : span(g, 5.4, 6.2);
			if (drop >= 1) continue;
			const kr = chance(seed, 'jack-fruit', ...st.key, k);
			// a cluster's fruit smaller than a lone one, and every one its own shape: long and barrel-shaped, or short and round
			const size = about(kr, 1, 0.14) * (n > 2 ? 0.82 : n > 1 ? 0.9 : 1);
			const stout = between(kr, 0.95, 1.45);
			const grow = kept ? set : 0;
			const Lf = lerp(0.1, (0.46 * size) / Math.sqrt(stout), grow) * lerp(0.6, 1, clamp((g - 4.55) / 0.4));
			const Wf = lerp(0.026, 0.12 * size * Math.sqrt(stout), grow) * lerp(0.6, 1, clamp((g - 4.55) / 0.4));
			// the fruit of one cushion fanned round it, some hanging lower than the others
			const flat = f.out.clone().setY(0);
			if (flat.lengthSq() < 0.01) flat.copy(f.along).setY(0);
			if (flat.lengthSq() < 1e-6) flat.set(1, 0, 0);
			const out = flat.normalize().applyAxisAngle(UP, (k - (n - 1) / 2) * 0.75 + about(kr, 0, 0.2));
			const lower = k % 2 ? 0.35 : 0;
			// it hangs straight down from its short thick stalk, its top end against the footstalk, its side against
			// the bark, leaning a little out — not held off the wood
			const lean = f.limb ? 0.12 : 0.3 + kr() * 0.12;
			const shape = (/** @type {THREE.Vector3} */ a, /** @type {THREE.Vector3} */ d, L = Lf, W = Wf) => [0.18, 0.4, 0.62, 0.84].map((t) => ({ c: a.clone().addScaledVector(d, L * t), r: W * PROFILE(t) * 0.86 }));
			// where it hangs is chosen by the room the grown fruit will need, so it hangs in the same place at every stage
			const fullL = kept ? (0.46 * size) / Math.sqrt(stout) : Lf, fullW = kept ? 0.12 * size * Math.sqrt(stout) : Wf;
			// of a few hangs — leaning more or less, turned a little round the wood — the one that touches least; never held
			// out sideways
			/** @type {{ balls: { c: THREE.Vector3, r: number }[], cost: number, data: { at: THREE.Vector3, dir: THREE.Vector3 } }[]} */
			const options = [];
			for (const [more, turn, cost, drop] of [[0, 0, 0, lower], [0.15, 0, 0.004, lower], [0, 0.4, 0.006, lower], [0, -0.4, 0.006, lower], [0, 0, 0.008, lower + 0.4], [0.3, 0.35, 0.01, lower], [0.3, -0.35, 0.01, lower], [0, 0.8, 0.014, lower + 0.3], [0, -0.8, 0.014, lower + 0.3], [0.45, 0, 0.016, lower + 0.6], [0, 1.3, 0.02, lower], [0, -1.3, 0.02, lower]]) {
				const o = out.clone().applyAxisAngle(UP, turn);
				const dir = v3(0, -1, 0).addScaledVector(o, lean + more * 0.5).normalize();
				// some hang lower, on a longer stalk
				const at = tip.clone().addScaledVector(o, Wf * (0.3 + more)).add(v3(0, -0.012 - Wf * 0.15 - drop * Lf * 0.3, 0));
				const full = tip.clone().addScaledVector(o, fullW * (0.3 + more)).add(v3(0, -0.012 - fullW * 0.15 - drop * fullL * 0.3, 0));
				options.push({ balls: shape(full, dir, fullL, fullW), cost, data: { at, dir } });
			}
			// a fruit with no room to grow is one the tree would have dropped
			if (kept && Math.min(...options.map((o) => crowd.overlap(o.balls))) > fullW * 0.45) continue;
			const place = crowd.best(options);
			const stalkR = 0.005 + 0.012 * grow;
			bag.fruit([...st.key, k], tip, place.dir);
			bag.add('body', tube([tip.clone().addScaledVector(f.out, -0.01), tip, place.at.clone().add(v3(0, 0.004, 0))], (u) => stalkR * (1 - 0.15 * u), () => C.stalk, 6));
			// the fleshy ring at its foot
			bag.add('body', bead(place.at, v3(Wf * 0.32, Wf * 0.12, Wf * 0.32), C.ring, 5, new THREE.Quaternion().setFromUnitVectors(UP, place.dir.clone().negate())));
			jack(bag, { at: place.at, dir: place.dir, L: Lf, W: Wf, ripe: kept ? ripe * between(kr, 0.8, 1) : 0, dark: drop, r: kr, set: grow });
			bag.fruitDone();
		}
	}
	// male heads among the leaves of the young shoots
	for (const m of males) {
		if (g < 4.55 || g > 6.1) continue;
		const r = chance(seed, 'jack-male', ...m.key);
		const side = new THREE.Vector3().crossVectors(m.dir, UP).normalize();
		const d = side.add(v3(0, -0.6, 0)).normalize();
		const size = lerp(0.4, 0.8, clamp((g - 4.55) / 0.4)) * about(r, 1, 0.15);
		const colour = g < 5.05 ? C.male : g < 5.45 ? C.pollen : C.spent;
		const end = m.at.clone().addScaledVector(d, 0.03);
		bag.add('body', tube([m.at, end], () => 0.0025, () => C.stalk, 3));
		bag.add('body', bead(end.clone().addScaledVector(d, 0.025 * size), v3(0.01, 0.028, 0.01).multiplyScalar(size), colour, 5, new THREE.Quaternion().setFromUnitVectors(UP, d)));
	}

	// the leaves, one by one in a spiral, lying out flat to the light
	const ageSize = lerp(0.55, 1, clamp(Y / 2.2));
	for (const sh of leafy) {
		const lr = chance(seed, 'jack-leaves', ...sh.key);
		const lengths = [0];
		for (let i = 1; i < sh.pts.length; i++) lengths.push(lengths[i - 1] + sh.pts[i].distanceTo(sh.pts[i - 1]));
		const total = lengths[lengths.length - 1];
		let s = sh.from;
		let i = 0;
		let phyl = lr() * Math.PI * 2;
		while (s < total - 0.004) {
			while (i + 2 < sh.pts.length && lengths[i + 1] < s) i++;
			const a = sh.pts[i], b = sh.pts[i + 1];
			const p = a.clone().lerp(b, clamp((s - lengths[i]) / Math.max(1e-6, lengths[i + 1] - lengths[i])));
			const d = b.clone().sub(a).normalize();
			phyl += 2.4;
			const side = new THREE.Vector3().crossVectors(d, Math.abs(d.y) > 0.95 ? v3(1, 0, 0) : UP).normalize().applyAxisAngle(d, phyl);
			const toTip = (total - s) / 0.1;
			const made = sh.made(s);
			// the leaves live about two years: on the young wood, and crowded at the tips
			if (s < sh.zone && Y - made > 2) {
				s += 0.03;
				continue;
			}
			// the newest leaves at the tip: small, held up, pale
			const young = clamp(1 - (Y - made) / 0.35) * 0.6 + flushing * clamp(1 - toTip) * 0.8;
			const size = ageSize * lerp(0.45, 1, clamp(toTip)) * between(lr, 0.78, 1.18);
			const out = side.clone().addScaledVector(d, 0.55).setY(0);
			if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
			out.normalize();
			const lift = lerp(0.7, between(lr, -0.35, 0.15), clamp(toTip));
			const dir = out.multiplyScalar(Math.cos(lift)).add(v3(0, Math.sin(lift), 0));
			const lobed = sh.young && made < 0.8 && lr() < 0.5;
			const len = 0.16 * size;
			bag.add('sheet', sheet({ length: len, width: len * (lobed ? 0.62 : 0.4), shape: lobed ? LOBED : LEAF, lift: (u, v) => 0.05 * v * v - 0.07 * u * u, paint: leafPaint(lr, young), along: lobed ? 8 : 5, across: 1 }), aim(p.clone().addScaledVector(dir, 0.004), dir, (lr() - 0.5) * 0.5));
			s += (sh.young ? 0.04 : 0.021) * about(lr, 1, 0.25);
		}
	}
	return bag.build();
}

/** the trunk's path in more points, so its flare and its bark read */
function fine(/** @type {THREE.Vector3[]} */ pts) {
	const out = [pts[0]];
	for (let i = 1; i < pts.length; i++) {
		const n = i === 1 ? 12 : 6;
		for (let k = 1; k <= n; k++) out.push(pts[i - 1].clone().lerp(pts[i], k / n));
	}
	return out;
}

/** a leaf's colours: glossy dark green, a few turned to show their paler undersides, the young flush pale @param {Chance} r */
function leafPaint(r, /** @type {number} */ young) {
	const tone = r();
	const under = r() < 0.08;
	const ground = under ? C.under.clone() : tone < 0.5 ? new THREE.Color().lerpColors(C.dark, C.mid, tone / 0.5) : new THREE.Color().lerpColors(C.mid, C.light, (tone - 0.5) / 0.5);
	const c = ground.lerp(C.young, clamp(young));
	const rib = c.clone().lerp(C.rib, 0.3);
	return (/** @type {number} */ u, /** @type {number} */ v) => (u < 0.12 || Math.abs(v) < 0.1 ? rib : c);
}

/** the fruit's outline along its axis, stalk end to the far end: barrel-shaped, a little broader below */
const PROFILE = (/** @type {number} */ u) => Math.pow(Math.max(0, Math.sin(Math.PI * clamp(u))), 0.48) * (0.84 + 0.2 * u);

/**
 * A jackfruit hanging from `at` along `dir`: oblong, a little lopsided and bent, covered in blunt hexagonal knobs,
 * green, yellowing as it ripens, the knobs flattening and their tips browning; `dark` 0 … 1 a female head withering.
 * @param {Bag} bag
 * @param {{ at: THREE.Vector3, dir: THREE.Vector3, L: number, W: number, ripe: number, dark: number, r: Chance, set: number }} o
 */
function jack(bag, o) {
	const r = o.r;
	const turn = r() * Math.PI * 2;
	const m = new THREE.Matrix4().compose(o.at, new THREE.Quaternion().setFromUnitVectors(v3(0, -1, 0), o.dir.clone().normalize()).multiply(new THREE.Quaternion().setFromAxisAngle(UP, turn)), v3(1, 1, 1));
	// the knobs: as many round it and along it as a grown fruit has (they grow with it), on a staggered grid
	const N = 22 + Math.floor(r() * 5), M = 17 + Math.floor(r() * 4);
	const sides = N * 2, rings = M * 2;
	const bend = about(r, 0, 0.07), lop = between(r, 0.04, 0.14), lopAt = r() * Math.PI * 2, waist = r() * 0.1, lump = between(r, 0.03, 0.11), lumpAt = r() * Math.PI * 2;
	const axis = [];
	for (let k = 0; k <= rings; k++) {
		const u = k / rings;
		axis.push(v3(bend * Math.sin(Math.PI * u) * o.L, -0.002 - u * o.L, 0));
	}
	/** how far up a knob this place is: 1 at its point, 0 between knobs */
	const knob = (/** @type {number} */ u, /** @type {number} */ v) => {
		const y = u * M, row = Math.floor(y);
		const x = v * N + (row % 2 ? 0.5 : 0);
		const dx = (x % 1) - 0.5, dy = (y % 1) - 0.5;
		return clamp(1 - Math.sqrt(dx * dx + dy * dy) * 2.1);
	};
	const height = lerp(0.1, 0.05, o.ripe) * o.W * lerp(0.5, 1, o.set);
	const radius = (/** @type {number} */ u, /** @type {number} */ v) => {
		// lopsided, waisted, and swollen in lumps where its flowers set unevenly
		const side = 1 + lop * Math.cos(v * Math.PI * 2 - lopAt) * Math.sin(Math.PI * u) - waist * Math.sin(Math.PI * u * 2) * 0.5 + lump * Math.sin(v * Math.PI * 2 * 2 + lumpAt) * Math.sin(Math.PI * u * 3 + lumpAt) * Math.sin(Math.PI * u);
		const base = o.W * PROFILE(u) * side;
		return base + (u > 0.03 && u < 0.98 ? knob(u, v) * height : 0);
	};
	const paint = (/** @type {number} */ u, /** @type {number} */ v) => {
		const kb = knob(u, v);
		const ripe = clamp(o.ripe * (1.1 - 0.25 * Math.cos(v * Math.PI * 2 - lopAt)));
		const ground = C.c.lerpColors(C.green, C.ripe, ripe);
		const tip = new THREE.Color().lerpColors(C.greenTip, C.ripeTip, ripe);
		const c = ground.lerp(tip, kb > 0.75 ? 0.6 : kb < 0.15 ? 0.25 : 0);
		if (o.dark > 0) c.lerp(C.spent, o.dark);
		return c.clone();
	};
	const geo = tube(axis, radius, paint, sides);
	// its knobs shaded as knobs, not as a smooth skin
	geo.computeVertexNormals();
	bag.add('body', geo, m);
}
