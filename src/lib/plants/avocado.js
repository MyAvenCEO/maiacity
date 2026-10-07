/*
 * THE AVOCADO (Persea americana 'Hass'), v2 — a seedling avocado grown as one grows. The big stone splits from its
 * base; a thick root goes down, and a shoot comes up while the seed leaves stay inside the stone (hypogeal). The shoot
 * runs up bare, its lowest leaves mere scales, and opens a tuft of big leaves at its top: the young tree is leggy, a
 * straight stem that grows in flushes, a cluster of leaves at the tip of each.
 *
 * From knee height up, the stem breaks into a few strong limbs that climb steeply and arch outwards, and these into
 * spreading laterals, the lowest of them sweeping down almost to the ground (the "skirt" growers leave on), so the
 * tree is a broad dense dome on a short trunk, about as wide as it is tall. Its young wood is green and smooth, the
 * old bark grey-brown, corky and furrowed lengthwise. The roots are shallow: a short taproot and many feeders
 * spreading out under the leaf litter.
 *
 * Its leaves, alternate in a spiral, crowd toward the tips of the shoots: elliptic to obovate with a pointed tip,
 * 12–25 cm on a 2–4 cm stalk, leathery, dark glossy green above and pale bluish green beneath, the midrib yellowish;
 * each new flush comes out limp, drooping and bronze-red and greens over weeks. A leaf lives two or three years.
 *
 * It flowers in late winter and spring at the ends of last year's shoots: a cluster of branched panicles round the
 * shoot's tip, hundreds of small yellow-green flowers each, and from the middle of the cluster the shoot grows on
 * (an indeterminate panicle) in a new bronze flush. Of the hundreds of flowers on a panicle one or two set at most;
 * the fruit then hangs under the new leaves on a long stalk that thickens toward it, swelling for ten to twelve
 * months: pear-shaped to egg-shaped, 8–10 cm, the stalk end narrowest, the skin thick, pebbly and dull dark green.
 * Hass keeps for months on the tree and ripens only once picked; left on into the next season, its sunny side colours
 * purple-black.
 *
 * Every limb, flush and fruit draws its chance by its place in the tree, and the tree is designed whole and shown as
 * far as it has grown (`Y` years), so a tree tabbed through its stages grows. ./orchard.js grows its v1
 * (./fruittrees.js `avocado`).
 */
import * as THREE from 'three';
import { Bag, Space, about, aim, bead, between, chance, clamp, lerp, root, sheet, smoothNormals, span, tube, v3 } from './grow.js';
import { sprout } from './sprout.js';

const UP = v3(0, 1, 0);

/** the tree's age in years at g (its stages: the stone … day 60, 365, 1500, 2200 … 2650) */
const YEARS = /** @type {[number, number][]} */ ([
	[1.2, 0],
	[2, 0.16],
	[3, 1],
	[4, 4.1],
	[5, 6.0],
	[6, 6.05],
	[7, 6.4],
	[8, 6.85],
	[9, 7.1]
]);
/** the stem's height through the years: a leggy first year, then slower as it spreads */
const LEADER = /** @type {[number, number][]} */ ([
	[0, 0],
	[0.16, 0.3],
	[1, 0.95],
	[2, 1.75],
	[3, 2.45],
	[4, 3.05],
	[5, 3.55],
	[6, 3.95],
	[7.2, 4.25]
]);

/** straight between the rows of a table */
function linear(/** @type {number} */ x, /** @type {[number, number][]} */ rows) {
	if (x <= rows[0][0]) return rows[0][1];
	for (let i = 1; i < rows.length; i++) if (x <= rows[i][0]) return rows[i - 1][1] + (rows[i][1] - rows[i - 1][1]) * ((x - rows[i - 1][0]) / (rows[i][0] - rows[i - 1][0]));
	return rows[rows.length - 1][1];
}
/** when (in years) the stem had reached the height h */
function leaderAt(/** @type {number} */ h) {
	for (let i = 1; i < LEADER.length; i++) if (h <= LEADER[i][1]) return LEADER[i - 1][0] + (LEADER[i][0] - LEADER[i - 1][0]) * ((h - LEADER[i - 1][1]) / (LEADER[i][1] - LEADER[i - 1][1]));
	return LEADER[LEADER.length - 1][0];
}

/** @typedef {() => number} Chance */
/**
 * @typedef {{ keep: number, key: (string | number)[] }} Panicle a flowering shoot tip: how many fruit it keeps, 0 … 2
 * @typedef {{
 *   key: (string | number)[], order: number, at: number, dirs: THREE.Vector3[], step: number, full: number, born: number,
 *   rate: number, kids: Branch[], panicle: Panicle | null
 * }} Branch one branch as it will be when grown: `at` how far along its parent it starts, `dirs` the way each of its
 *   steps goes, its full length, the year it breaks, how fast it grows (m a year); a shoot that flowers at its tip
 */

/** the year it first flowers, and its spring flush grows on out of the panicles */
const FLOWERS = 6.0;

/** the whole tree as it will grow, from its seed — designed once a seed */
const TREES = new Map();

/** @param {string} seed @returns {Branch} */
function design(seed) {
	const cached = TREES.get(seed);
	if (cached) return cached;
	const pr = chance(seed, 'avo-tree');
	const vigour = about(pr, 1, 0.07);
	// the dome it fills when grown: from near the ground (the skirt) to a little over the stem's top, a little lopsided
	const env = { c: v3(about(pr, 0, 0.2), 2.35 * vigour, about(pr, 0, 0.2)), rx: 2.45 * vigour * about(pr, 1, 0.07), rz: 2.45 * vigour * about(pr, 1, 0.07), up: 2.35 * vigour, down: 2.1 * vigour };
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
	/** a branch's way, step by step: rising at first, then arching out and over, wandering a little @param {Chance} r */
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

	const tr = chance(seed, 'avo-trunk');
	const top = LEADER[LEADER.length - 1][1] * vigour;
	/** @type {Branch} */
	const trunk = { key: ['trunk'], order: 0, at: 0, dirs: [], step: top / 24, full: top, born: 0, rate: 1, kids: [], panicle: null };
	trunk.dirs = way(tr, v3(about(tr, 0, 0.03), 1, about(tr, 0, 0.03)), 24, 0.01, 0, 0.035);
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
	/** a branch off `parent`; `shape` how it rises, arches over and wanders */
	const branch = (/** @type {Branch} */ parent, /** @type {(string | number)[]} */ key, /** @type {number} */ s, /** @type {THREE.Vector3} */ d, /** @type {number} */ order, /** @type {number} */ full, /** @type {number} */ born, /** @type {number[]} */ shape) => {
		const r = chance(seed, 'avo-branch', ...key);
		const n = order === 1 ? 12 : order === 2 ? 7 : 3;
		/** @type {Branch} */
		const b = { key, order, at: s, dirs: way(r, d, n, shape[0], shape[1], shape[2]), step: full / n, full, born, rate: order === 1 ? 0.95 : order === 2 ? 0.75 : order === 3 ? 0.55 : 0.6, kids: [], panicle: null };
		parent.kids.push(b);
		starts.set(b, point(parent, s));
		return b;
	};

	// the limbs: a few strong ones from knee height up, climbing steeply and arching out, then weaker ones up the stem
	let s = 0.5 + tr() * 0.2;
	let turn = tr() * Math.PI * 2;
	let k = 0;
	while (s < top - 0.4) {
		turn += 2.4 + about(tr, 0, 0.3);
		const h = s / top;
		const d = leave(dirAt(trunk, s), lerp(1.3, 0.5, Math.sqrt(h)) * about(tr, 1, 0.1), turn);
		const p = point(trunk, s);
		const full = clamp(edge(p, d) * about(tr, 0.95, 0.05) + (h < 0.4 ? 0.5 : 0), 0.5, 3.4);
		branch(trunk, ['limb', k], s, d, 1, full, madeAt(trunk, s) + 0.2, [0.03 * h, 0.14 + (1 - h) * 0.3, 0.07]);
		s += (h < 0.35 ? 0.2 : 0.33) * about(tr, 1, 0.3);
		k++;
	}
	// laterals along the limbs, spreading, the low ones sweeping down to the skirt; and short shoots along those
	/** @param {Branch} b */
	const furnish = (b) => {
		const r = chance(seed, 'avo-laterals', ...b.key);
		const kidOrder = b.order + 1;
		const spacing = kidOrder === 2 ? 0.2 : 0.11;
		let s = kidOrder === 2 ? Math.max(0.35, b.full * 0.22) : 0.08;
		let k = 0;
		let phyl = r() * Math.PI * 2;
		while (s < b.full - 0.08) {
			phyl += 2.4 + about(r, 0, 0.4);
			const d0 = leave(dirAt(b, s), between(r, 0.7, 1.1), phyl);
			d0.y = kidOrder === 2 ? d0.y * 0.4 : d0.y * 0.5 + 0.25;
			d0.normalize();
			const p = point(b, s);
			const out = v3(p.x - env.c.x, 0, p.z - env.c.z).normalize();
			const inward = d0.x * out.x + d0.z * out.z < -0.3;
			if (!(inward && r() < 0.7)) {
				const room = edge(p, d0) * between(r, kidOrder === 2 ? 0.55 : 0.4, kidOrder === 2 ? 0.95 : 0.8) * (inward ? 0.5 : 1);
				const full = clamp(room, kidOrder === 2 ? 0.25 : 0.1, kidOrder === 2 ? 1.6 : 0.45);
				// low down the laterals arch over under their leaves into the skirt
				const low = clamp(1 - p.y / 1.8);
				const shape = kidOrder === 2 ? [0.02, 0.16 + low * 0.45, 0.12] : [0.06, 0.1 + low * 0.2, 0.18];
				const kid = branch(b, [...b.key, k], s, d0, kidOrder, full, madeAt(b, s) + 0.3 + r() * 0.4, shape);
				if (kidOrder === 2) furnish(kid);
			}
			k++;
			s += spacing * about(r, 1, 0.25);
		}
		// and short leafy shoots straight off the outer half of the limbs themselves
		if (b.order === 1) {
			let s2 = b.full * 0.5 + r() * 0.1;
			let j = 0;
			while (s2 < b.full - 0.1) {
				phyl += 2.4 + about(r, 0, 0.4);
				const d0 = leave(dirAt(b, s2), between(r, 0.6, 1), phyl);
				d0.y = d0.y * 0.5 + 0.25;
				d0.normalize();
				branch(b, [...b.key, 'shoot', j], s2, d0, 3, clamp(edge(point(b, s2), d0) * 0.6, 0.1, 0.4), madeAt(b, s2) + 0.3 + r() * 0.3, [0.06, 0.1, 0.18]);
				j++;
				s2 += 0.15 * about(r, 1, 0.3);
			}
		}
	};
	for (const b of [...trunk.kids]) furnish(b);

	// the flowering: the tips of the shoots grown by the year before it flowers, out in the light of the crown's edge,
	// each a cluster of panicles round the tip, and the spring flush growing on out of their middle
	const tips = /** @type {Branch[]} */ ([]);
	const gather = (/** @type {Branch} */ b) => {
		if (b.order >= 2 && !b.kids.some((kid) => kid.at > b.full - 0.1)) tips.push(b);
		for (const kid of b.kids) gather(kid);
	};
	gather(trunk);
	for (const b of tips) {
		// it flowers at the tip it had grown to by the winter before, out where the light is; and grows on from there
		// only out of the panicles
		const reached = Math.min(b.full, (FLOWERS - 0.1 - b.born) * b.rate);
		if (reached < 0.08) continue;
		const p = point(b, reached);
		const o = v3((p.x - env.c.x) / env.rx, (p.y - env.c.y) / (p.y > env.c.y ? env.up : env.down), (p.z - env.c.z) / env.rz).length();
		if (o < 0.6) continue;
		const r = chance(seed, 'avo-panicle', ...b.key);
		if (r() > 0.8) continue;
		const k = r();
		// of hundreds of flowers, a panicle keeps one fruit now and then, rarely two — more in the sun on the outside
		const keep = k < 0.2 + 0.12 * clamp((o - 0.8) / 0.2) ? 1 : k < 0.27 + 0.12 * clamp((o - 0.8) / 0.2) ? 2 : 0;
		b.panicle = { keep, key: [...b.key, 'panicle'] };
		b.full = reached;
		b.kids = b.kids.filter((kid) => kid.at < reached - 0.02);
		// the flush: the shoot grows on out of the panicles, its new leaves bronze
		const d = dirAt(b, b.full).clone().setY(dirAt(b, b.full).y * 0.4 + 0.3).normalize();
		const flush = branch(b, [...b.key, 'flush'], b.full, d, 4, between(r, 0.12, 0.22), FLOWERS + 0.05, [0.05, 0.08, 0.12]);
		flush.rate = 0.5;
	}
	if (TREES.size > 24) TREES.delete(TREES.keys().next().value);
	TREES.set(seed, trunk);
	return trunk;
}

/** a leaf: a stalk of 2–4 cm, then an elliptic to obovate blade, broadest beyond its middle, drawn out to a point */
const LEAF = (/** @type {number} */ u) => {
	if (u < 0.13) return 0.05;
	const t = (u - 0.13) / 0.87;
	return Math.max(0.03, Math.pow(Math.sin(Math.PI * Math.pow(t, 0.92)), 0.72) * (1 - 0.3 * span(t, 0.72, 1)));
};
/** the colours, made once */
const C = {
	dark: new THREE.Color('#1c4419'), mid: new THREE.Color('#264f22'), light: new THREE.Color('#36612b'),
	under: new THREE.Color('#8ea486'), bronze: new THREE.Color('#8f4a2a'), flushGreen: new THREE.Color('#8fa24a'), rib: new THREE.Color('#cfc684'),
	scale: new THREE.Color('#7a7046'),
	barkYoung: new THREE.Color('#5f7c3a'), barkMid: new THREE.Color('#6f6f4e'), barkOld: new THREE.Color('#77695a'),
	ridge: new THREE.Color('#8e8270'), furrow: new THREE.Color('#3b322a'), lenticel: new THREE.Color('#a49a7c'),
	axis: new THREE.Color('#a3a650'), bud: new THREE.Color('#bdb860'), flower: new THREE.Color('#e3dc8e'), spent: new THREE.Color('#8a7a44'),
	stalk: new THREE.Color('#6c7a34'), button: new THREE.Color('#58662e'),
	fruitSet: new THREE.Color('#5f8c33'), fruitGreen: new THREE.Color('#33521f'), pebbleGreen: new THREE.Color('#4d6b2c'),
	fruitDark: new THREE.Color('#2b1b25'), pebbleDark: new THREE.Color('#3e2a34'),
	c: new THREE.Color()
};

/**
 * The avocado tree, v2.
 * @param {number} g @param {string} seed
 */
export function avocado(g, seed) {
	const bag = new Bag();
	const space = bag.space;
	const depth = 0.025;
	const at = v3(0, -depth, 0);
	const Y = linear(g, YEARS);

	// the stone, five to six centimetres, set broad end down with its tip at the surface: it splits from its base, a
	// thick root goes down, the shoot comes up between the halves, and the seed leaves (the stone) stay below
	const s = sprout(bag, {
		seed,
		at,
		size: v3(0.021, 0.027, 0.021),
		coat: '#9a6a44',
		coatShade: '#5e3c24',
		stem: linear(g, [[0, 0], [0.3, depth * 0.1 + 0.001], [1, depth + 0.03], [2, depth + 0.07], [9, depth + 0.07]]),
		hook: linear(g, [[0, 1], [1, 1], [1.6, 0]]),
		radius: 0.003 + 0.005 * span(g, 1, 3),
		stemColor: '#6e6a34',
		leaf: { length: 0.001, width: 0.0005, shape: () => 1, color: '#7a8a4a', vein: '#7a8a4a' },
		open: 0,
		shed: span(g, 3.5, 4.5),
		wither: 1,
		keepCoat: true
	});

	// the roots: a short taproot, and many feeder roots spreading wide and shallow under the litter
	root(bag, { seed, key: ['tap'], from: at.clone(), dir: v3(0.02, -1, 0.01), length: 1.1, grown: linear(g, [[0, 0], [0.3, 0.008], [1, 0.06], [2, 0.16], [3, 0.4], [4, 0.75], [5, 0.9], [8, 1]]), radius: 0.004 + 0.045 * span(g, 2, 8), down: 0.03, wander: 0.14, laterals: 8, lateral: 0.3, depth: 2, age: span(g, 1.5, 6), young: '#f0dcc0', old: '#6a4a30' });
	for (let i = 0; i < 22; i++) {
		const rr = chance(seed, 'avo-feeder', i);
		const born = 2.4 + i * (4 / 22);
		const bear = i * 2.39996 + rr() * 0.4;
		root(bag, { seed, key: ['feeder', i], from: at.clone().add(v3(0, -0.03 - rr() * 0.08, 0)), dir: v3(Math.cos(bear), -0.06, Math.sin(bear)), length: between(rr, 0.6, 1) * 2.6, grown: (g - born) / 2.6, radius: 0.003 + 0.02 * span(g, 3, 8), down: 0.006, wander: 0.16, laterals: 7, lateral: 0.22, depth: 2, age: (g - born - 0.6) / 2.5, young: '#ecd8b6', old: '#6a4a30' });
	}
	if (Y <= 0) return bag.build();

	const tree = design(seed);
	const base = s.top.clone();
	const bloom = span(g, 4.5, 4.75) * (1 - span(g, 5.25, 5.7));
	const set = span(g, 5.6, 8.0);
	const late = span(g, 8.2, 9);

	/** @type {{ pts: THREE.Vector3[], key: (string | number)[], made: (s: number) => number, order: number, seedling: boolean }[]} */
	const leafy = [];
	/** @type {{ at: THREE.Vector3, dir: THREE.Vector3, panicle: Panicle }[]} */
	const panicles = [];

	/** a branch as far as it has grown, and everything off it @param {Branch} b @param {THREE.Vector3} from */
	const draw = (b, from) => {
		const length = b.order === 0 ? linear(Y, LEADER) * (b.full / LEADER[LEADER.length - 1][1]) : b.full * clamp(((Y - b.born) * b.rate) / b.full);
		if (length < 0.004) return;
		const age = Y - b.born;
		const R =
			b.order === 0
				? 0.006 + 0.115 * Math.pow(clamp(Y / 7), 1.25)
				: b.order === 1
					? 0.004 + 0.055 * Math.sqrt(length / 3) * clamp(age / 4.5)
					: b.order === 2 ? 0.0035 + 0.015 * Math.sqrt(length / 1.4) * clamp(age / 3) : 0.003 + 0.0025 * clamp(length / 0.3);
		const pts = [from.clone()];
		let left = length;
		for (let i = 0; i < b.dirs.length && left > 1e-5; i++) {
			const t = Math.min(left, b.step);
			pts.push(pts[i].clone().addScaledVector(b.dirs[i], t));
			left -= t;
		}
		const L = length;
		const made = (/** @type {number} */ u) => (b.order === 0 ? leaderAt((u * L) / (b.full / LEADER[LEADER.length - 1][1])) : b.born + (u * L) / b.rate);
		const taper = b.order === 0 ? 0.72 : 0.62;
		// the old bark corky and furrowed lengthwise, its ridges paler
		const furrows = (/** @type {number} */ u, /** @type {number} */ v) => Math.sin(v * Math.PI * 2 * 8 + Math.sin(u * L * 2.3 + v * 9) * 1.3 + Math.sin(u * L * 9) * 0.25);
		const paint = (/** @type {number} */ u, /** @type {number} */ v) => {
			const wood = Y - made(u);
			// green and smooth on the young wood, greying as it corks over
			const c = wood < 1.5 ? C.c.lerpColors(C.barkYoung, C.barkMid, clamp(wood / 1.5)) : C.c.lerpColors(C.barkMid, C.barkOld, clamp((wood - 1.5) / 2));
			// pale lenticels on the young bark
			if (wood < 2.5 && Math.sin(u * L * 140 + v * 17) * Math.sin(v * Math.PI * 2 * 5 + u * L * 31) > 0.93) c.lerp(C.lenticel, 0.6);
			if (b.order <= 1 && wood > 2.5) {
				const old = clamp((wood - 2.5) / 2.5) * (b.order === 0 ? 1 : 0.6);
				const f = furrows(u, v);
				c.lerp(f < -0.55 ? C.furrow : f > 0.5 ? C.ridge : C.barkOld, old * (f < -0.55 ? 0.8 : 0.45));
			}
			return c.clone();
		};
		const radius = (/** @type {number} */ u, /** @type {number} */ v) => {
			let r = Math.max(0.0025, R * (1 - taper * u));
			if (b.order === 0) {
				// the foot flares a little into the shallow roots
				const foot = Math.pow(1 - Math.min(1, (u * L) / 0.4), 2.5);
				r *= 1 + foot * (0.25 + 0.12 * Math.cos(v * Math.PI * 2 * 4));
				if (Y > 3) r *= 1 + 0.025 * clamp((Y - 3) / 2) * furrows(u, v);
			}
			return r;
		};
		const sides = b.order === 0 ? 28 : b.order === 1 ? 8 : b.order === 2 ? 5 : 4;
		bag.add('body', tube(b.order === 0 ? fine(pts) : pts, radius, paint, sides));
		if (b.order <= 2) for (let i = 0; i + 1 < pts.length; i++) space.rods.push({ a: pts[i].clone(), b: pts[i + 1].clone(), r: Math.max(0.003, R * (1 - taper * ((i + 0.5) / (pts.length - 1)))) });
		const where = (/** @type {number} */ s) => {
			const f = Math.min(pts.length - 1.0001, s / b.step), k = Math.floor(f);
			return { p: pts[k].clone().lerp(pts[k + 1], f - k), d: pts[k + 1].clone().sub(pts[k]).normalize(), r: radius(s / Math.max(1e-6, L), 0) };
		};
		leafy.push({ pts, key: b.key, made: (s) => made(s / L), order: b.order, seedling: b.order === 0 && Y < 1.6 });
		for (const kid of b.kids) {
			if (kid.at > length + 1e-6) continue;
			const w = where(Math.min(kid.at, L));
			draw(kid, w.p.clone().addScaledVector(kid.dirs[0], kid.order === 4 ? 0 : w.r * 0.6));
		}
		if (b.panicle && L >= b.full - 1e-4) panicles.push({ at: pts[pts.length - 1].clone(), dir: pts[pts.length - 1].clone().sub(pts[pts.length - 2]).normalize(), panicle: b.panicle });
	};
	draw(tree, base);

	// the flowering, and the fruit it sets: hanging under the new flush on a long stalk, thickening toward the fruit
	const crowd = new Space();
	crowd.rods = space.rods;
	for (const pn of panicles) {
		const r = chance(seed, 'avo-flowers', ...pn.panicle.key);
		if (bloom > 0.01) {
			// a cluster of branched panicles round the tip, crowded with small yellow-green flowers, then shed
			const n = 4 + Math.floor(r() * 4);
			const open = clamp((g - 4.6) / 0.25);
			for (let k = 0; k < n; k++) {
				const a = (k / n) * Math.PI * 2 + r();
				const side = new THREE.Vector3().crossVectors(pn.dir, Math.abs(pn.dir.y) > 0.95 ? v3(1, 0, 0) : UP).normalize().applyAxisAngle(pn.dir, a);
				const d = pn.dir.clone().multiplyScalar(0.5).addScaledVector(side, 0.85).add(v3(0, 0.25, 0)).normalize();
				const len = between(r, 0.07, 0.13) * lerp(0.4, 1, clamp((g - 4.45) / 0.3)) * bloom;
				const end = pn.at.clone().addScaledVector(d, len).add(v3(0, -len * len * 2, 0));
				bag.add('body', tube([pn.at, pn.at.clone().lerp(end, 0.5).add(v3(0, len * 0.08, 0)), end], (u) => 0.0022 * (1 - 0.6 * u), () => C.axis, 3));
				for (let m = 0; m < 5; m++) {
					const u = 0.25 + m * 0.17;
					const p = pn.at.clone().lerp(end, u);
					const t = new THREE.Vector3().crossVectors(d, UP).normalize().applyAxisAngle(d, m * 2.4 + a);
					const twig = p.clone().addScaledVector(t, 0.018 * (1 - u * 0.5));
					bag.add('body', tube([p, twig], () => 0.0009, () => C.axis, 3));
					for (const q of [twig, p.clone().lerp(twig, 0.5)]) bag.add('body', bead(q, v3(0.0035, 0.0035, 0.0035).multiplyScalar(lerp(0.6, 1, open)), open > 0.4 ? C.flower : C.bud, 2));
				}
			}
		}
		// the fruit it keeps
		if (g < 5.55 || pn.panicle.keep === 0) continue;
		for (let k = 0; k < pn.panicle.keep; k++) {
			const kr = chance(seed, 'avo-fruit', ...pn.panicle.key, k);
			const size = about(kr, 1, 0.1) * (pn.panicle.keep > 1 ? 0.93 : 1);
			const grow = lerp(0.12, 1, set);
			// every one its own: rounder, or longer with a narrower neck
			const neck = between(kr, 0.62, 0.86);
			const stout = between(kr, 0.9, 1.12);
			const Lf = 0.095 * size * grow / Math.sqrt(stout), Wf = 0.034 * size * grow * Math.sqrt(stout);
			const fullL = 0.095 * size / Math.sqrt(stout), fullW = 0.034 * size * Math.sqrt(stout);
			// the stalk leaves the panicle's axis a few centimetres below the tip and hangs from it, longer as it grows heavy
			const stalk = between(kr, 0.04, 0.07);
			const flat = pn.dir.clone().setY(0);
			if (flat.lengthSq() < 1e-4) flat.set(1, 0, 0);
			flat.normalize().applyAxisAngle(UP, (k - (pn.panicle.keep - 1) / 2) * 1.4 + about(kr, 0, 0.5));
			const from = pn.at.clone().addScaledVector(pn.dir, -0.02);
			const shape = (/** @type {THREE.Vector3} */ a, /** @type {THREE.Vector3} */ d) => [0.35, 0.7].map((t) => ({ c: a.clone().addScaledVector(d, fullL * t), r: fullW * 0.95 }));
			/** @type {{ balls: { c: THREE.Vector3, r: number }[], cost: number, data: { at: THREE.Vector3, dir: THREE.Vector3, out: THREE.Vector3 } }[]} */
			const options = [];
			for (const [turn, lean, cost] of [[0, 0.15, 0], [0.6, 0.15, 0.004], [-0.6, 0.15, 0.004], [1.2, 0.2, 0.008], [-1.2, 0.2, 0.008], [0, 0.4, 0.01], [2, 0.2, 0.014], [-2, 0.2, 0.014], [Math.PI, 0.25, 0.02]]) {
				const out = flat.clone().applyAxisAngle(UP, turn);
				const end = from.clone().addScaledVector(out, stalk * 0.45).add(v3(0, -stalk * 0.85, 0));
				const dir = v3(0, -1, 0).addScaledVector(out, lean).normalize();
				options.push({ balls: shape(end, dir), cost, data: { at: end, dir, out } });
			}
			const place = crowd.best(options);
			const at = place.at.clone().add(v3(0, stalk * 0.85 * (1 - lerp(0.6, 1, set)), 0));
			bag.fruit([...pn.panicle.key, k], from, place.dir);
			// the stalk: out from the panicle's axis, then down, thickening toward the fruit into a knob (the button)
			const bow = from.clone().addScaledVector(place.out, stalk * 0.45);
			const curve = [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => from.clone().multiplyScalar((1 - t) * (1 - t)).addScaledVector(bow, 2 * t * (1 - t)).addScaledVector(at, t * t));
			bag.add('body', tube(curve, (u) => (0.0018 + 0.0035 * set) * (0.75 + 0.5 * u * u), () => C.stalk, 5));
			bag.add('body', bead(at, v3(1, 0.8, 1).multiplyScalar(0.003 + 0.0045 * set), C.button, 4));
			hass(bag, { at: at.clone().add(v3(0, -0.002, 0)), dir: place.dir, L: Lf, W: Wf, neck, set, late: late * between(kr, 0.5, 1), r: kr });
			bag.fruitDone();
		}
	}

	// the leaves, one by one in a spiral, crowded at the tips of the shoots; the new flush limp and bronze
	const ageSize = lerp(0.6, 1, clamp(Y / 2));
	for (const sh of leafy) {
		const lr = chance(seed, 'avo-leaves', ...sh.key);
		const lengths = [0];
		for (let i = 1; i < sh.pts.length; i++) lengths.push(lengths[i - 1] + sh.pts[i].distanceTo(sh.pts[i - 1]));
		const total = lengths[lengths.length - 1];
		let s = sh.order === 0 ? 0.03 : 0.02;
		let i = 0;
		let phyl = lr() * Math.PI * 2;
		while (s < total - 0.004) {
			while (i + 2 < sh.pts.length && lengths[i + 1] < s) i++;
			const a = sh.pts[i], b = sh.pts[i + 1];
			const p = a.clone().lerp(b, clamp((s - lengths[i]) / Math.max(1e-6, lengths[i + 1] - lengths[i])));
			const d = b.clone().sub(a).normalize();
			phyl += 2.4;
			const made = sh.made(s);
			const leafAge = Y - made;
			const toTip = (total - s) / 0.12;
			// on the seedling's stem the first leaves are mere scales; then each flush's leaves live two or three years
			if (sh.seedling && s < total * 0.55) {
				if (s > 0.02) bag.add('sheet', sheet({ length: 0.012, width: 0.004, shape: (u) => Math.sin(Math.PI * u), paint: () => C.scale, along: 2, across: 1 }), aim(p, d.clone().add(new THREE.Vector3().crossVectors(d, UP).normalize().applyAxisAngle(d, phyl).multiplyScalar(0.5)).normalize()));
				s += 0.035;
				continue;
			}
			// (a shoot's tip flushes again every year, so its last few leaves are always there)
			if (toTip > 2.5 && (leafAge > 2.4 + lr() * 0.5 || (sh.order <= 1 && Y > 2.5 && toTip > 6))) {
				s += 0.03;
				continue;
			}
			// the new flush: limp and drooping, bronze-red, greening over weeks
			const young = clamp(1 - leafAge / 0.3);
			const size = ageSize * lerp(0.5, 1, clamp(toTip * 1.2)) * between(lr, 0.75, 1.2) * lerp(1, 0.75, young * young);
			const side = new THREE.Vector3().crossVectors(d, Math.abs(d.y) > 0.95 ? v3(1, 0, 0) : UP).normalize().applyAxisAngle(d, phyl);
			const out = side.clone().addScaledVector(d, 0.5).setY(0);
			if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
			out.normalize();
			const lift = lerp(between(lr, -0.25, 0.25), -0.95, young) + (toTip < 1 ? 0.25 * (1 - toTip) : 0);
			const dir = out.multiplyScalar(Math.cos(lift)).add(v3(0, Math.sin(lift), 0));
			const len = 0.19 * size;
			bag.add('sheet', sheet({ length: len, width: len * between(lr, 0.3, 0.42), shape: LEAF, lift: (u, v) => 0.045 * Math.abs(v) - (0.06 + 0.1 * young) * u * u, paint: leafPaint(lr, young), along: 6, across: 2 }), aim(p.clone().addScaledVector(dir, 0.004), dir, (lr() - 0.5) * 0.6));
			s += (sh.seedling ? 0.025 : 0.024) * about(lr, 1, 0.25);
		}
	}
	return bag.build();
}

/** the stem's path in more points, so its flare and its bark read */
function fine(/** @type {THREE.Vector3[]} */ pts) {
	const out = [pts[0]];
	for (let i = 1; i < pts.length; i++) {
		const n = i === 1 ? 10 : 5;
		for (let k = 1; k <= n; k++) out.push(pts[i - 1].clone().lerp(pts[i], k / n));
	}
	return out;
}

/** a leaf's colours: glossy dark green, a few turned to show their pale bluish undersides, the young flush bronze @param {Chance} r */
function leafPaint(r, /** @type {number} */ young) {
	const tone = r();
	const under = r() < 0.12;
	const ground = under ? C.under.clone() : tone < 0.5 ? new THREE.Color().lerpColors(C.dark, C.mid, tone / 0.5) : new THREE.Color().lerpColors(C.mid, C.light, (tone - 0.5) / 0.5);
	// bronze-red as it unfolds, then a soft pale green, then dark
	const flush = young > 0.5 ? C.c.lerpColors(C.flushGreen, C.bronze, (young - 0.5) * 2) : C.c.copy(C.flushGreen);
	const c = ground.lerp(flush, clamp(young * 1.6));
	const rib = c.clone().lerp(C.rib, 0.4 * (1 - young));
	// the side veins, faint
	return (/** @type {number} */ u, /** @type {number} */ v) => (u < 0.13 || Math.abs(v) < 0.08 ? rib : Math.abs(((u * 9 - Math.abs(v) * 1.6) % 1)) < 0.08 ? c.clone().lerp(C.rib, 0.15) : c);
}

/**
 * A Hass avocado hanging from `at` along `dir`: pear- to egg-shaped, narrowest at the stalk, a little lopsided, its thick
 * skin pebbly; bright green when it sets, then a dull dark green, and late in the season its sunny side purple-black.
 * @param {Bag} bag
 * @param {{ at: THREE.Vector3, dir: THREE.Vector3, L: number, W: number, neck: number, set: number, late: number, r: Chance }} o
 */
function hass(bag, o) {
	const r = o.r;
	const turn = r() * Math.PI * 2;
	const m = new THREE.Matrix4().compose(o.at, new THREE.Quaternion().setFromUnitVectors(v3(0, -1, 0), o.dir.clone().normalize()).multiply(new THREE.Quaternion().setFromAxisAngle(UP, turn)), v3(1, 1, 1));
	const rings = 48, sides = 44;
	const bend = about(r, 0, 0.05), lop = between(r, 0.02, 0.07), lopAt = r() * Math.PI * 2, sun = r() * Math.PI * 2;
	const axis = [];
	for (let k = 0; k <= rings; k++) {
		const u = k / rings;
		axis.push(v3(bend * Math.sin(Math.PI * u) * o.L, -u * o.L, 0));
	}
	// the shoulder where the neck widens into the body: high on a round fruit, low on a long-necked one
	const shoulder = lerp(0.62, 0.42, (o.neck - 0.62) / 0.24);
	const profile = (/** @type {number} */ u) => Math.pow(Math.max(0, Math.sin(Math.PI * clamp(u))), u > 0.5 ? 0.38 : 0.5) * lerp(o.neck, 1, span(u, 0.05, shoulder));
	/** the pebbles of the skin: small rounded bumps on a staggered grid, each its own size, set a little off its place */
	const N = 26, M = 22, salt = Math.floor(r() * 1e6);
	const jitter = (/** @type {number} */ i, /** @type {number} */ j, /** @type {number} */ k) => {
		let h = Math.imul(salt ^ Math.imul(i + 7, 0x27d4eb2d) ^ Math.imul(j + 13, 0x165667b1) ^ Math.imul(k + 3, 0x9e3779b1), 0x85ebca6b);
		h ^= h >>> 13;
		h = Math.imul(h, 0xc2b2ae35);
		return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
	};
	const pebble = (/** @type {number} */ u, /** @type {number} */ v) => {
		const y = u * M, row = Math.floor(y);
		let best = 0;
		for (const dr of [-1, 0, 1]) {
			const rr = row + dr;
			const x = v * N + (rr % 2 ? 0.5 : 0);
			const col = Math.floor(x);
			for (const dc of [-1, 0, 1]) {
				const cc = (((col + dc) % N) + N) % N;
				const cx = col + dc + 0.5 + (jitter(rr, cc, 0) - 0.5) * 0.5, cy = rr + 0.5 + (jitter(rr, cc, 1) - 0.5) * 0.5;
				const big = 0.55 + 0.5 * jitter(rr, cc, 2);
				const d = Math.hypot(x - cx, y - cy) / big;
				best = Math.max(best, clamp(1 - d * 1.6));
			}
		}
		return Math.sqrt(best);
	};
	const height = 0.03 * o.W * lerp(0.25, 1, o.set);
	const radius = (/** @type {number} */ u, /** @type {number} */ v) => {
		const side = 1 + lop * Math.cos(v * Math.PI * 2 - lopAt) * Math.sin(Math.PI * u);
		return Math.max(0.0008, o.W * profile(u) * side + (u > 0.04 && u < 0.97 ? (pebble(u, v) - 0.4) * height * Math.min(1, profile(u) * 2) : 0));
	};
	const paint = (/** @type {number} */ u, /** @type {number} */ v) => {
		const pb = pebble(u, v);
		const sunny = clamp(o.late * (1.15 + 0.6 * Math.cos(v * Math.PI * 2 - sun)) - 0.15);
		const green = C.c.lerpColors(C.fruitSet, C.fruitGreen, span(o.set, 0.2, 0.8));
		const c = green.lerp(C.fruitDark, sunny);
		const tip = new THREE.Color().lerpColors(C.pebbleGreen, C.pebbleDark, sunny);
		return c.lerp(tip, pb * pb * 0.75).clone();
	};
	const geo = tube(axis, radius, paint, sides);
	// its pebbles shaded as pebbles
	smoothNormals(geo);
	bag.add('body', geo, m);
}
