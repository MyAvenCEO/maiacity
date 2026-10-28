/*
 * WALD · LOW TREES — the second layer of a temperate forest garden and its biggest shrubs: the small trees that stand
 * under the walnuts and the chestnuts, and the bushes at their feet as tall as they are. The quince and the medlar,
 * two old crooked fruit trees of the rose family, a big single flower at the tip of each short new shoot and one
 * fruit from it; the serviceberry, many-stemmed, its racemes of white stars at the shoot tips turning to hanging
 * clusters of berries; the cornelian cherry, flowering yellow on its bare twigs in late winter and hanging glossy red
 * cherries along them in late summer; the elder, a big arching shrub of feathered leaves with flat cream umbels that
 * turn over into heavy dark umbels of berries on red stalks; the sea buckthorn, thorny and silver, its orange berries
 * packed along last year's twigs, its roots fixing nitrogen in little coral-like nodules; and the pawpaw, a small
 * pyramid of great drooping leaves, its maroon bells on last year's wood and its fruit in clusters of two or three.
 *
 * Each is one description (`Grove`) grown the same way: its seed and how it comes up, its roots, its crown (in
 * flushes, ./crown.js, or with a leader for the pawpaw), its leaves (alternate or opposite, simple or pinnate, along
 * the outer shoots, gone in the winter it flowers in when it flowers bare), and where it flowers — at the tips of the
 * newest shoots, along last year's twigs, or (the sea buckthorn) all along them — each flowering site drawn by the
 * plant's own hand, then its fruit. The crown is finished the spring it flowers, so the flowers sit at the ends of
 * the outermost shoots, where they really are; the fruit and berries keep clear of the wood and of each other, and
 * the leaves turn away from them.
 */
import * as THREE from 'three';
import { Bag, DETAIL, about, aim, bead, between, chance, clamp, fan, lerp, mix, root, sheet, span, table, tube, v3 } from './grow.js';
import { sprout } from './sprout.js';
import { bloom } from './bloom.js';
import { flushCrown, leaderCrown } from './crown.js';

const stages = (/** @type {[string, number, string][]} */ rows) => rows.map(([name, day, note]) => ({ name, day, note }));
/** a colour by its hex, made once (a tube or sheet painted one colour asks for it at every vertex) */
const COLOURS = /** @type {Map<string, THREE.Color>} */ (new Map());
const col = (/** @type {string} */ hex) => COLOURS.get(hex) ?? /** @type {THREE.Color} */ (COLOURS.set(hex, new THREE.Color(hex)).get(hex));
const UP = v3(0, 1, 0);
const DOWN = v3(0, -1, 0);

/* ------------------------------------------------------------------------------------------------ the description */

/**
 * @typedef {{
 *   bag: Bag, seed: string, key: (string | number)[], at: THREE.Vector3, dir: THREE.Vector3, g: number, phase: number,
 *   grid: Grid, vigour: number, shoot: import('./crown.js').Shoot
 * }} Site — one flowering site as its plant draws it: where it is on the bark and which way it faces, `phase` how far
 *   past its opening (below 0 a bud; flowers to about 0.55, then the fruit), `grid` what the fruit and berries must
 *   keep clear of (the thick wood, and every fruit and berry so far), and the leaves after them
 */

/**
 * @typedef {{
 *   length: number, width: number, shape: (u: number) => number, colour: string, dark: string, young: string,
 *   opposite?: boolean, pinnate?: { pairs: [number, number], length: number, width: number },
 *   spacing: number, droop: number, from: number, start?: number, tuft?: number, max?: number,
 *   on?: [number, number][], along?: number, across?: number, curl?: number
 * }} Leaf — `spacing` a node every so many leaf lengths along a shoot, `from` the first generation of shoot that
 *   keeps leaves (the outer ones), `start` how far along a fruit-packed shoot they begin, `tuft` leaves crowded at a shoot's tip,
 *   `on` how far in leaf through the stages (0 bare, for a tree that flowers before its leaves), `pinnate` leaflets
 *   in pairs along a rachis `length` long, `curl` how far the blade folds up along its midrib
 */

/**
 * @typedef {{
 *   seed: { size: THREE.Vector3, coat: string, shade: string, depth: number }, hypogeal: boolean,
 *   cotyledon?: { length: number, width: number, colour: string },
 *   roots: { tap: number, spread: number, count: number, radius: number, nodules?: boolean },
 *   flush?: import('./crown.js').Flush, leader?: import('./crown.js').Leader,
 *   leaf: Leaf,
 *   bloom: { sites: 'tips' | 'twigs' | 'wood', opens: number, chance: number, gen: number, pairs?: boolean },
 *   thorns?: number,
 *   site: (s: Site) => void
 * }} Grove — a low tree or a big shrub, described: its flowering sites at the tips of the outermost shoots (`tips`,
 *   `chance` of them), along last year's twigs (`twigs`, `chance` a metre, in opposite `pairs` or one by one), or
 *   whole shoots handed to `site` (`wood`), from shoots of generation `gen` on
 */

/**
 * What the plant has put where — its thick wood as chains of balls, its fruit and berries as balls — in cells, so a
 * fruit can look for a place to hang and a leaf ask whether it would run into one cheaply (a berry bush has thousands;
 * ./grow.js's Space asks every ball every time).
 */
class Grid {
	constructor(cell = 0.2) {
		this.cell = cell;
		/** @type {Grid | null} the thick wood, kept apart: a fruit keeps clear of it, a leaf grows out of it */
		this.wood = null;
		/** @type {Map<number, { c: THREE.Vector3, r: number }[]>} */
		this.cells = new Map();
	}
	/** @param {number} x @param {number} y @param {number} z */
	key(x, y, z) {
		return ((x + 400) * 1000 + (y + 400)) * 1000 + (z + 400);
	}
	/** @param {THREE.Vector3} c @param {number} r */
	add(c, r) {
		const s = this.cell;
		const k = this.key(Math.floor(c.x / s), Math.floor(c.y / s), Math.floor(c.z / s));
		let list = this.cells.get(k);
		if (!list) this.cells.set(k, (list = []));
		list.push({ c: c.clone(), r });
	}
	/** how deep a ball at c of radius r would sink into what is here (0 when it touches nothing) @param {THREE.Vector3} c @param {number} r */
	depth(c, r) {
		const s = this.cell;
		const x = Math.floor(c.x / s), y = Math.floor(c.y / s), z = Math.floor(c.z / s);
		let worst = 0;
		for (let i = -1; i <= 1; i++)
			for (let j = -1; j <= 1; j++)
				for (let k = -1; k <= 1; k++) {
					const list = this.cells.get(this.key(x + i, y + j, z + k));
					if (list) for (const b of list) worst = Math.max(worst, r + b.r - c.distanceTo(b.c));
				}
		return worst;
	}
	/** a rod along a path, as a chain of balls @param {THREE.Vector3[]} pts @param {number} r */
	rod(pts, r) {
		for (let i = 0; i + 1 < pts.length; i++) {
			const n = Math.max(1, Math.ceil(pts[i].distanceTo(pts[i + 1]) / r));
			for (let k = 0; k < n; k++) this.add(pts[i].clone().lerp(pts[i + 1], k / n), r);
		}
	}
	/**
	 * Where a fruit hangs, as Space.settle has it: from `at`, along a direction near `dir`, its stalk perhaps a little
	 * longer, so that its balls (`shape(at, dir)`) touch nothing, or as little as can be. Its balls are added.
	 * @param {THREE.Vector3} at @param {THREE.Vector3} dir
	 * @param {(at: THREE.Vector3, dir: THREE.Vector3) => { c: THREE.Vector3, r: number }[]} shape @param {number} reach
	 */
	settle(at, dir, shape, reach) {
		const d0 = dir.clone().normalize();
		let best = { at: at.clone(), dir: d0, cost: Infinity };
		const side = new THREE.Vector3();
		for (const ext of [0, 0.5, 1]) {
			for (const swing of [0, 0.45, 0.9, 1.4, 2]) {
				for (let k = 0; k < (swing ? 8 : 1); k++) {
					const a = (k / 8) * Math.PI * 2;
					side.set(Math.cos(a), 0, Math.sin(a));
					const d = d0.clone().addScaledVector(side, swing).normalize();
					if (d.y > 0.35) continue;
					const p = at.clone().addScaledVector(d, ext * reach);
					let cost = swing * 0.004 + ext * 0.003;
					for (const b of shape(p, d)) cost += (this.depth(b.c, b.r) + (this.wood?.depth(b.c, b.r) ?? 0)) * 10 + Math.max(0, b.r - b.c.y) * 10;
					if (cost < best.cost) best = { at: p, dir: d, cost };
				}
				if (best.cost < 0.004 * (swing + 0.5)) break;
			}
			if (best.cost < 0.01) break;
		}
		for (const b of shape(best.at, best.dir)) this.add(b.c, b.r);
		return best;
	}
}

/** a place along a path, u 0 … 1 */
function along(/** @type {THREE.Vector3[]} */ pts, /** @type {number} */ u) {
	const f = clamp(u) * (pts.length - 1), k = Math.min(pts.length - 2, Math.floor(f));
	return { at: pts[k].clone().lerp(pts[k + 1], f - k), dir: pts[k + 1].clone().sub(pts[k]).normalize() };
}

/** a direction square to `dir`, turned round it by `turn` */
function across(/** @type {THREE.Vector3} */ dir, /** @type {number} */ turn) {
	const side = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) > 0.95 ? v3(1, 0, 0) : UP).normalize();
	return side.applyAxisAngle(dir, turn);
}

/**
 * @param {Grove} spec
 * @returns {(g: number, seed: string) => THREE.Group}
 */
function grove(spec) {
	return (g, seed) => {
		const bag = new Bag();
		const grid = new Grid();
		const vigour = about(chance(seed, 'plant'), 1, 0.08);
		const at = v3(0, -spec.seed.depth, 0);

		// the seed, and how it comes up
		const s = sprout(bag, {
			seed,
			at,
			size: spec.seed.size,
			coat: spec.seed.coat,
			coatShade: spec.seed.shade,
			stem: table(g, [[0, 0], [0.3, spec.seed.depth * 0.1 + 0.001], [1, spec.seed.depth + 0.03], [2, spec.seed.depth + 0.07], [9, spec.seed.depth + 0.07]]),
			hook: table(g, [[0, 1], [1, 1], [1.6, 0]]),
			radius: 0.0018 + 0.004 * span(g, 1, 3),
			stemColor: '#7a7a42',
			leaf: spec.cotyledon ? { length: spec.cotyledon.length, width: spec.cotyledon.width, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.7), color: spec.cotyledon.colour, vein: '#a6c47e' } : { length: 0.001, width: 0.0005, shape: () => 1, color: '#7a8a4a', vein: '#7a8a4a' },
			open: spec.hypogeal ? 0 : span(g, 1.1, 2),
			shed: spec.hypogeal ? span(g, 3.5, 4.5) : span(g, 1, 1.6),
			wither: spec.hypogeal ? 1 : span(g, 3, 3.8),
			keepCoat: spec.hypogeal
		});

		// the roots: a taproot, and roots spreading wide near the surface (with their nodules, on a nitrogen fixer)
		const R = spec.roots;
		root(bag, { seed, key: ['tap'], from: at.clone(), dir: v3(0.02, -1, 0.01), length: R.tap, grown: table(g, [[0, 0], [0.3, 0.004], [1, 0.03], [2, 0.07], [3, 0.2], [4, 0.45], [5, 0.75], [6, 0.9], [8, 1]]), radius: 0.002 + R.radius * span(g, 2, 8), down: 0.03, wander: 0.1, laterals: 8, lateral: 0.3, depth: 2, age: span(g, 1.5, 6), young: '#f3e6cc', old: '#6e5032' });
		for (let i = 0; i < R.count; i++) {
			const rr = chance(seed, 'feeder', i);
			const born = 2.6 + i * (4 / R.count);
			const bear = i * 2.39996 + rr() * 0.4;
			const from = at.clone().add(v3(0, -0.04 - rr() * 0.12, 0));
			const dir = v3(Math.cos(bear), -0.15, Math.sin(bear));
			const grown = (g - born) / 2.8;
			root(bag, { seed, key: ['feeder', i], from, dir, length: between(rr, 0.6, 1) * R.spread * vigour, grown, radius: 0.003 + R.radius * 0.4 * span(g, 3, 8), down: 0.01, wander: 0.14, laterals: 4, lateral: 0.25, depth: 2, age: (g - born - 0.6) / 2.5, young: '#efdcb8', old: '#6e5032' });
			if (R.nodules && DETAIL.roots && grown > 0.15) {
				// Frankia's nodules: little clusters of short swollen lobes, coral-like, orange-brown, near the root's start
				const n = 3 + Math.floor(rr() * 3);
				const p = from.clone().addScaledVector(dir.clone().normalize(), 0.03 + rr() * 0.03);
				for (let k = 0; k < n; k++) {
					const d = v3(rr() - 0.5, rr() - 0.7, rr() - 0.5).normalize();
					bag.add('body', bead(p.clone().addScaledVector(d, 0.006), v3(0.003, 0.006, 0.003).multiplyScalar(clamp(grown * 2)), '#c08a4a', 3, new THREE.Quaternion().setFromUnitVectors(UP, d)));
				}
			}
		}

		// the crown
		const shoots = spec.flush ? flushCrown(bag, { seed, g, from: s.top.clone(), spec: spec.flush }) : spec.leader ? leaderCrown(bag, { seed, g, from: s.top.clone(), spec: spec.leader }) : [];
		const gens = spec.flush ? spec.flush.gens : 2;

		// what is where, so the fruit hang clear of the wood
		grid.wood = new Grid();
		for (const sh of shoots) if (sh.gen <= 2 && sh.radius > 0.01) grid.wood.rod(sh.pts, sh.radius + 0.01);

		// thorns: short spines out of the side of the outer shoots, the shoot's own tip a thorn too
		if (spec.thorns) {
			for (const sh of shoots) {
				if (sh.gen < gens - 1 || sh.length < 0.05) continue;
				const tr = chance(seed, 'thorns', ...sh.key);
				const n = Math.floor(sh.length * spec.thorns);
				for (let k = 0; k < n; k++) {
					const p = along(sh.pts, between(tr, 0.15, 0.9));
					const d = across(p.dir, tr() * Math.PI * 2).addScaledVector(p.dir, 0.8).normalize();
					const len = between(tr, 0.012, 0.025) * clamp((g - sh.born) / 0.8);
					bag.add('body', tube([p.at, p.at.clone().addScaledVector(d, len)], (u) => 0.0016 * (1 - u), () => col('#6a5a4a'), 3));
				}
			}
		}

		// the flowering sites (and which shoots bear, for the leaves to keep to their newer ends)
		const B = spec.bloom;
		/** @type {Set<import('./crown.js').Shoot>} */
		const bearing = new Set();
		for (const sh of shoots) {
			if (sh.gen < B.gen) continue;
			const sr = chance(seed, 'site', ...sh.key);
			const opens = B.opens + sr() * 0.2;
			const phase = g - opens;
			if (phase < -0.4) continue;
			/** @param {THREE.Vector3} p @param {THREE.Vector3} d @param {(string | number)[]} key */
			const draw = (p, d, key) => spec.site({ bag, seed, key, at: p, dir: d, g, phase, grid, vigour, shoot: sh });
			// grown before it flowers (a leader's limbs and side shoots, all of them old wood by then)
			const old = !!spec.leader || sh.born < opens - 0.15;
			if (B.sites === 'tips') {
				if (sh.end && old && sr() < B.chance) {
					bearing.add(sh);
					draw(sh.tip.clone(), sh.dir.clone(), sh.key);
				}
			} else if (B.sites === 'wood') {
				if (old && sr() < B.chance) {
					bearing.add(sh);
					draw(sh.tip.clone(), sh.dir.clone(), sh.key);
				}
			} else if (old) {
				// along last year's twigs (on a leader's limbs, their outer half): one, or a pair, to a node
				const from = spec.leader && sh.gen === 1 ? 0.5 : 0.2;
				const n = Math.floor(sh.length * (1 - from) * B.chance + sr());
				for (let k = 0; k < n; k++) {
					const p = along(sh.pts, from + (1 - from) * ((k + 0.3 + sr() * 0.4) / n) * 0.95);
					const turn = sr() * Math.PI * 2;
					for (let m = 0; m < (B.pairs ? 2 : 1); m++) {
						const side = across(p.dir, turn + m * Math.PI);
						if (!B.pairs && side.y > 0.3) side.y *= -1;
						draw(p.at.clone().addScaledVector(side, sh.radius * 0.9), side.addScaledVector(p.dir, 0.5).normalize(), [...sh.key, k, m]);
					}
				}
			}
		}

		// the leaves
		for (const sh of shoots) foliage(bag, spec, seed, g, sh, grid, bearing.has(sh));
		return bag.build();
	};
}

/**
 * The leaves of a shoot: at nodes along its outer part, one to a node in a spiral or two opposite (each pair square to
 * the last), a tuft at its tip; each turned on its stalk away from any fruit it would run into.
 * @param {Bag} bag @param {Grove} spec @param {string} seed @param {number} g @param {import('./crown.js').Shoot} sh
 * @param {Grid} grid @param {boolean} bears whether it flowers and fruits at its tip, or along its old wood (its leaves
 *   then only beyond it)
 */
function foliage(bag, spec, seed, g, sh, grid, bears) {
	const L = spec.leaf;
	const leader = !!spec.leader;
	// the outer shoots keep their leaves; any shoot still in its first year has them too (a young tree is leafy throughout)
	const leafy = leader || sh.end || sh.gen >= L.from || g - sh.born < 1.1;
	if (!leafy) return;
	const on = L.on ? table(g, L.on) : 1;
	if (on < 0.04) return;
	const lr = chance(seed, 'leaves', ...sh.key);
	const age = clamp((g - sh.born) / 0.8);
	const youth = Math.max(1 - age, 1 - on);
	const shade = mix(L.colour, L.dark, lr());
	const colour = mix(shade, L.young, youth);
	const vein = colour.clone().lerp(new THREE.Color('#e0e4b0'), 0.3);
	const paint = (/** @type {number} */ u, /** @type {number} */ v) => (Math.abs(v) < 0.1 ? vein : colour);
	const grownBy = lerp(0.35, 1, age) * lerp(0.5, 1, clamp(g - 2)) * lerp(0.3, 1, on);
	/** one leaf (or compound leaf) at p, reaching out along `out` @param {THREE.Vector3} p @param {THREE.Vector3} out */
	const leaf = (p, out) => {
		const len = (L.pinnate ? L.pinnate.length : L.length) * between(lr, 0.78, 1.08) * grownBy * vigourOf(lr);
		const wid = (L.pinnate ? L.pinnate.width / L.pinnate.length : L.width / L.length) * len;
		const hang = lerp(0.9, -L.droop, Math.min(age, on)) + about(lr, 0, 0.3);
		/** its direction, turned `turn` round the vertical */
		const aimed = (/** @type {number} */ turn) => {
			const level = out.clone().setY(0);
			if (level.lengthSq() < 1e-6) level.set(1, 0, 0);
			level.normalize().applyAxisAngle(UP, turn);
			return level.multiplyScalar(Math.cos(hang)).add(v3(0, Math.sin(hang), 0)).normalize();
		};
		let dir = aimed(0);
		// away from the fruit: the first turn that touches nothing, or no leaf at all
		let ok = false;
		for (const turn of [0, 0.7, -0.7, 1.4, -1.4, 2.2, -2.2]) {
			const d = aimed(turn);
			const hit = grid.depth(p.clone().addScaledVector(d, len * 0.5), wid * 0.5) + grid.depth(p.clone().addScaledVector(d, len * 0.92), wid * 0.35);
			if (hit < wid * 0.1) {
				dir = d;
				ok = true;
				break;
			}
		}
		if (!ok) return;
		const base = p.clone().addScaledVector(dir, 0.006);
		if (L.pinnate) return pinnateLeaf(bag, L, lr, base, dir, len, paint, Math.min(age, on));
		bag.add(
			'sheet',
			sheet({ length: len, width: wid, shape: L.shape, lift: (u, v) => (L.curl ?? 0.06) * v * v - 0.07 * u * u, paint, along: L.along ?? 5, across: L.across ?? 2 }),
			aim(base, dir, (lr() - 0.5) * 0.6)
		);
	};
	// on a leader's limbs, their outer half; on the leader itself, its top metre or so
	const start = leader && sh.gen === 1 ? 0.45 : leader && sh.gen === 0 ? (g < 3.6 ? 0.1 : 1 - Math.min(0.35, 1.2 / Math.max(0.1, sh.length))) : bears ? (L.start ?? 0.12) : 0.12;
	const step = (L.pinnate ? L.pinnate.length : L.length) * L.spacing;
	const n = Math.min(L.max ?? 18, Math.max(1, Math.floor((sh.length * (1 - start)) / step)));
	for (let k = 0; k < n; k++) {
		const { at, dir } = along(sh.pts, start + ((1 - start) * (k + 0.5)) / n);
		if (L.opposite) {
			const turn = (k % 2) * (Math.PI / 2) + about(lr, 0, 0.15);
			for (const m of [0, Math.PI]) leaf(at, across(dir, turn + m).addScaledVector(dir, 0.45));
		} else leaf(at, across(dir, k * 2.39996 + about(lr, 0, 0.3)).addScaledVector(dir, 0.45));
	}
	// the tuft at the tip: the newest leaves, reaching on with the shoot (not where a flower or a fruit is)
	if (sh.end && L.tuft && !bears) {
		for (let k = 0; k < L.tuft; k++) leaf(sh.tip, across(sh.dir, k * 2.39996 + lr()).multiplyScalar(0.6).addScaledVector(sh.dir, 1));
	}
}

/** a leaf's own size, give or take */
const vigourOf = (/** @type {() => number} */ r) => about(r, 1, 0.06);

/**
 * A compound leaf: a rachis, leaflets in pairs along it, one at its end (the elder's five or seven).
 * @param {Bag} bag @param {Leaf} L @param {() => number} r @param {THREE.Vector3} at @param {THREE.Vector3} dir
 * @param {number} len @param {(u: number, v: number) => THREE.Color} paint @param {number} grown
 */
function pinnateLeaf(bag, L, r, at, dir, len, paint, grown) {
	const P = /** @type {NonNullable<Leaf['pinnate']>} */ (L.pinnate);
	const scale = len / P.length;
	const end = at.clone().addScaledVector(dir, len).add(v3(0, -len * 0.12, 0));
	bag.add('body', tube([at, end], (u) => 0.0022 * (1 - 0.6 * u), () => col('#5a7a34'), 3));
	const pairs = P.pairs[0] + Math.floor(r() * (P.pairs[1] - P.pairs[0] + 1));
	const fold = lerp(0.35, 0.06, grown);
	const blade = (/** @type {THREE.Vector3} */ p, /** @type {THREE.Vector3} */ d, /** @type {number} */ s) =>
		bag.add('sheet', sheet({ length: L.length * s * scale, width: L.width * s * scale, shape: L.shape, lift: (u, v) => fold * v * v - 0.06 * u * u, paint, along: L.along ?? 4, across: L.across ?? 2 }), aim(p, d, (r() - 0.5) * 0.4));
	const rachis = end.clone().sub(at).normalize();
	for (let k = 0; k < pairs; k++) {
		const u = lerp(0.3, 0.82, pairs === 1 ? 0.5 : k / (pairs - 1));
		const p = at.clone().lerp(end, u);
		for (const side of [-1, 1]) {
			const d = across(rachis, side > 0 ? Math.PI / 2 : -Math.PI / 2);
			if (d.y > 0.5) d.y = 0.2;
			blade(p, d.normalize().multiplyScalar(0.9).addScaledVector(rachis, 0.55).add(v3(0, -0.1, 0)).normalize(), lerp(0.85, 1, u));
		}
	}
	blade(end, rachis.clone().add(v3(0, -0.15, 0)).normalize(), 1.05);
}

/* ------------------------------------------------------------------------------------------------ helpers for the sites */

/**
 * A fruit swept along its axis from `at` down `dir`: `shape(u, v)` its radius (0 … 1) along and round it, `bend` how
 * far its axis bows to one side (a pawpaw's kidney).
 * @param {Bag} bag
 * @param {{ at: THREE.Vector3, dir: THREE.Vector3, L: number, W: number, shape: (u: number, v: number) => number,
 *   paint: (u: number, v: number) => THREE.Color, sides: number, rings: number, gloss: boolean, turn: number, bend?: number }} o
 */
function fruitBody(bag, o) {
	const m = new THREE.Matrix4().compose(o.at, new THREE.Quaternion().setFromUnitVectors(DOWN, o.dir.clone().normalize()).multiply(new THREE.Quaternion().setFromAxisAngle(UP, o.turn)), v3(1, 1, 1));
	const axis = [];
	for (let k = 0; k <= o.rings; k++) {
		const u = k / o.rings;
		axis.push(v3((o.bend ?? 0) * o.L * Math.sin(Math.PI * u), -0.001 - u * o.L, 0));
	}
	bag.add(o.gloss ? 'gloss' : 'body', tube(axis, (u, v) => o.W * o.shape(u, v), o.paint, o.sides), m);
	return m;
}

/**
 * A big fruit hanging from a site: a place found for it clear of the wood and the other fruit (`grid`), its stalk,
 * and its body. Hands back its matrix, its length and girth, for anything more on it (an eye, a calyx). It starts
 * the fruit's mark (`Bag.fruit`): the caller ends it (`fruitDone`) once it has drawn the rest of it.
 * @param {Site} s @param {number} k
 * @param {{ L: number, W: number, stalk: number, shape: (u: number, v: number) => number, paint: (u: number, v: number) => THREE.Color,
 *   gloss: boolean, set: number, sides?: number, rings?: number, bend?: number, out?: number, stalkColour?: string }} F
 */
function hangFruit(s, k, F) {
	const kr = chance(s.seed, 'fruit', ...s.key, k);
	const size = s.vigour * about(kr, 1, 0.1);
	const L = F.L * size * lerp(0.15, 1, F.set);
	const W = F.W * size * lerp(0.15, 1, F.set);
	const swing = v3(Math.cos(k * 2.4 + kr() * 3), 0, Math.sin(k * 2.4 + kr() * 3));
	const start = s.at.clone().addScaledVector(s.dir, F.stalk * 0.3);
	const hangFrom = start.clone().addScaledVector(swing, F.stalk * (F.out ?? 0.25)).add(v3(0, -F.stalk * lerp(0.3, 0.8, F.set), 0));
	const place = s.grid.settle(hangFrom, DOWN.clone().addScaledVector(swing, 0.15), (a, d) => [0.3, 0.72].map((t) => ({ c: a.clone().addScaledVector(d, L * t), r: W * 0.95 })), F.stalk * 0.5 + W);
	s.bag.fruit([...s.key, k], s.at, place.dir);
	s.bag.add('body', tube([s.at, start, place.at], (u) => (0.0015 + 0.0035 * F.set * (F.W / 0.03)) * (1 - 0.4 * u), () => col(F.stalkColour ?? '#6f6a3a'), 4));
	const m = fruitBody(s.bag, { at: place.at, dir: place.dir, L, W, shape: F.shape, paint: F.paint, sides: F.sides ?? 12, rings: F.rings ?? 10, gloss: F.gloss, turn: kr() * Math.PI * 2, bend: F.bend });
	return { m, L, W };
}

/**
 * A berry at `c`, if there is room for it there (none of the plant's fruit or berries in the way): its skin, and the
 * dark remains of its flower at its foot.
 * @param {Site} s @param {THREE.Vector3} c @param {number} r @param {THREE.Color} colour @param {THREE.Vector3} down where its flower end faces
 * @param {{ crown?: string, long?: number, gloss?: boolean, detail?: number }} [o]
 */
function berry(s, c, r, colour, down, o = {}) {
	if (s.grid.depth(c, r) > r * 0.2) return false;
	s.grid.add(c, r);
	const turn = new THREE.Quaternion().setFromUnitVectors(UP, down.clone().negate());
	s.bag.add(o.gloss === false ? 'body' : 'gloss', bead(c, v3(r, r * (o.long ?? 1), r), colour, o.detail ?? 3, turn));
	if (o.crown) s.bag.add('body', bead(c.clone().addScaledVector(down, r * (o.long ?? 1) * 0.92), v3(r * 0.35, r * 0.18, r * 0.35), o.crown, 2, turn));
	return true;
}

/**
 * A small cheap flower for the many-flowered ones (a raceme's, an umbel's): `petals` strap-like or round petals in a
 * star and a dot of stamens. Opens, then its petals fall.
 * @param {Bag} b @param {THREE.Vector3} at @param {THREE.Vector3} facing
 * @param {{ petals: number, length: number, width: number, colour: string, heart: string, shape?: (u: number) => number, cup?: number }} k
 * @param {number} open @param {number} fall
 */
function star(b, at, facing, k, open, fall) {
	const f = facing.clone().normalize();
	if (fall >= 1) return;
	const shape = k.shape ?? ((/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 0.6));
	for (let i = 0; i < k.petals; i++) {
		const side = across(f, (i / k.petals) * Math.PI * 2);
		// from upright round the heart to spread (cupped by `cup`), then dropping away
		const tilt = lerp(0.15, 1 - (k.cup ?? 0.15), open) + fall * 0.6;
		const d = f.clone().multiplyScalar(Math.cos(tilt * Math.PI * 0.5)).addScaledVector(side, Math.sin(tilt * Math.PI * 0.5)).normalize();
		b.add('sheet', sheet({ length: k.length * lerp(0.45, 1, open) * (1 - fall * 0.4), width: k.width * lerp(0.45, 1, open), shape, paint: () => col(k.colour), along: 3, across: 1 }), aim(at, d, 0));
	}
	b.add('body', bead(at.clone().addScaledVector(f, k.length * 0.08), v3(k.length * 0.2, k.length * 0.12, k.length * 0.2), k.heart, 2));
}

/** a colour from green through `turning` to `ripe`, as t goes 0 … 1 */
const ripening = (/** @type {string} */ green, /** @type {string} */ turning, /** @type {string} */ ripe, /** @type {number} */ t) => (t < 0.5 ? mix(green, turning, t * 2) : mix(turning, ripe, (t - 0.5) * 2));

/** how far a site's fruit has set and ripened, from its phase: set from 0.55, colouring from `from` over `over` */
const fruiting = (/** @type {number} */ phase, from = 2.6, over = 1.2, setFor = 1.6) => ({ set: span(phase, 0.55, 0.55 + setFor), ripe: span(phase, from, from + over) });

/** leaf shapes: ovate; oblong-lanceolate; elliptic and pointed; obovate (widest beyond the middle); linear */
const ovate = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.72)), 0.62) * (u < 0.04 ? u / 0.04 : 1);
const oblong = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.85)), 0.45) * (u > 0.88 ? 1 - (u - 0.88) * 3 : 1);
const pointed = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.6) * (u > 0.85 ? 1 - (u - 0.85) * 2.8 : 1);
const obovate = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 1.45)), 0.6) * (u < 0.05 ? u / 0.05 : 1);
const linear = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * u), 0.35);
const toothed = (/** @type {number} */ u) => pointed(u) * (1 + (u > 0.1 && u < 0.92 ? ((u * 18) % 1) * 0.07 : 0));

/** a crown in flushes, finished by the spring it flowers: a few of its numbers changed */
const crown = (/** @type {Partial<import('./crown.js').Flush>} */ o) => ({
	trunk: 0.8, trunkBorn: 1.3, trunkFlush: 1.1, scaffolds: /** @type {[number, number]} */ ([3, 4]), scaffoldAngle: 0.8,
	gens: 6, flush: 0.2, rest: 0.13, shoot: (/** @type {number} */ gen) => [0, 1.1, 0.8, 0.6, 0.45, 0.35, 0.28][gen] ?? 0.28,
	whorl: /** @type {[number, number]} */ ([2, 3]), spread: 0.6, up: 0.035, droop: 0.06, wander: 0.12, radius: 0.12, taper: 0.6, thicken: 4,
	bark: /** @type {[string, string]} */ (['#7d6a4c', '#5a4a3e']),
	...o
});

/* ------------------------------------------------------------------------------------------------ quince */

export const QUINCE_STAGES = stages([
	['Pip', 0, 'A brown quince pip, its coat turning to slime when wet, chilled through the winter, a centimetre down.'],
	['Germination', 25, 'The radicle goes down; the hook comes up and lifts its seed leaves.'],
	['Seedling', 45, 'Two oval seed leaves, then round true leaves, woolly underneath.'],
	['Sapling', 1100, 'A twiggy young tree, its shoots felted grey, already leaning its own way.'],
	['Young tree', 1460, 'A small crooked tree of four metres, low-branched, its round felted leaves dense.'],
	['Blossom', 1830, 'Late in the spring, one big pale-pink flower at the tip of each short new shoot, among the leaves.'],
	['Fruit set', 1845, 'The petals fall; a woolly green fruit swells under the five leafy sepals.'],
	['Green quinces', 1920, 'Big hard grey-green fruit, still in their grey felt, weighing the shoots down.'],
	['Colouring', 1980, 'The felt rubs off; they turn lemon-yellow, and the tree smells of them.'],
	['Ripe', 2000, 'Big golden quinces, lumpy, pear- or apple-shaped: rock hard, for jelly, paste and the cellar.']
]);

/** a quince: pear- or apple-shaped by the tree, lumpy at the shoulders, a dimple of dried sepals at its end */
const quinceShape = (/** @type {boolean} */ pearish) => (/** @type {number} */ u, /** @type {number} */ v) => {
	const body = Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(0.985, u))), 0.42);
	const neck = pearish ? 0.48 + 0.52 * Math.pow(clamp(u * 1.35), 1.3) : 0.78 + 0.22 * clamp(u * 1.6);
	return body * neck * (1 + 0.05 * Math.cos(v * Math.PI * 10) * Math.sin(Math.PI * u) + 0.03 * Math.cos(v * Math.PI * 2 * 3 + u * 4));
};

const quince = grove({
	seed: { size: v3(0.008, 0.0035, 0.0045), coat: '#6a4428', shade: '#3e2614', depth: 0.01 },
	hypogeal: false,
	cotyledon: { length: 0.014, width: 0.008, colour: '#6aa046' },
	// low-branched and crooked: a short trunk, wandering limbs spreading wide, twiggy
	flush: crown({ trunk: 0.7, scaffolds: [3, 5], scaffoldAngle: 0.7, gens: 6, whorl: [2, 3], spread: 0.6, up: 0.06, droop: 0.04, wander: 0.2, radius: 0.12, taper: 0.62, shoot: (gen) => [0, 1.0, 0.75, 0.55, 0.42, 0.32, 0.25][gen] ?? 0.25, bark: ['#8a7a68', '#5a4c40'] }),
	roots: { tap: 1.0, spread: 1.8, count: 10, radius: 0.035 },
	leaf: { length: 0.085, width: 0.06, shape: ovate, colour: '#5a7a44', dark: '#4a6a3a', young: '#a8b890', spacing: 0.32, droop: 0.35, from: 4, tuft: 3, curl: 0.1 },
	bloom: { sites: 'tips', opens: 4.6, chance: 0.38, gen: 5 },
	site: (s) => {
		const up = s.dir.clone().lerp(UP, 0.65).normalize();
		if (s.phase < 0.55) {
			if (s.phase < 0) return void s.bag.add('body', bead(s.at.clone().addScaledVector(up, 0.008), v3(0.006, 0.009, 0.006), mix('#c8d0a0', '#f0b8c0', s.phase + 0.4), 4));
			bloom(s.bag, { petals: 5, length: 0.017, width: 0.016, colour: '#f6d4da', heart: '#e8d06a', sepals: 5, sepal: 0.009, sepalColour: '#6a8a44', stamens: 20, stamenColour: '#e8c040' }, s.at.clone().addScaledVector(up, 0.012), up, 1.75, clamp(s.phase / 0.2), span(s.phase, 0.35, 0.55));
			return;
		}
		const { set, ripe } = fruiting(s.phase, 2.5, 1.3, 1.8);
		const pearish = chance(s.seed, 'form')() < 0.5;
		const felt = (1 - ripe) * 0.4;
		const ground = ripening('#98a868', '#c8c050', '#e8c42e', ripe);
		const r = hangFruit(s, 0, {
			L: 0.105, W: 0.045, stalk: 0.014, set, gloss: false, out: 0.6,
			shape: quinceShape(pearish),
			paint: (u, v) => ground.clone().lerp(new THREE.Color('#d8d8c4'), felt * (0.6 + 0.4 * Math.abs(Math.sin(v * 31 + u * 17)))).lerp(new THREE.Color('#a8781e'), ripe * 0.12 * Math.max(0, Math.cos(v * Math.PI * 2)))
		});
		// the dried sepals at its end
		s.bag.add('body', bead(v3(0, -r.L * 0.985, 0), v3(r.W * 0.22, r.W * 0.1, r.W * 0.22), ripe > 0.5 ? '#5a4024' : '#6a7a3a', 3), r.m);
		s.bag.fruitDone();
	}
});

/* ------------------------------------------------------------------------------------------------ medlar */

export const MEDLAR_STAGES = stages([
	['Stone', 0, 'One of the five hard stones of a medlar, chilled through two winters, two centimetres down: slow and fickle — most are grafted.'],
	['Germination', 60, 'In its second spring the stone splits; the root goes down, the seed leaves come up.'],
	['Seedling', 90, 'Two oval seed leaves, then long narrow downy leaves.'],
	['Sapling', 1100, 'A slender young tree, its shoots downy, a few thorns on a wild one.'],
	['Young tree', 1500, 'A small tree as wide as it is high, its branches crooked and spreading level.'],
	['Blossom', 1880, 'In late spring, one big white flower at the tip of each short leafy shoot, its long sepals between the petals.'],
	['Fruit set', 1895, 'The petals fall; the sepals stay, round a green fruit already open at its end.'],
	['Green medlars', 1960, 'Round green-brown fruit, flattened, each with its open eye and five long sepals.'],
	['Russeting', 2040, 'They turn russet brown, rough and hard.'],
	['Ripe', 2060, 'Brown russet medlars picked hard after the first frost; laid down, they blet soft and brown, like apple sauce.']
]);

/** a medlar: round, flattened, then its open eye — a rim flaring round a hollow where the sepals stand */
const medlarShape = (/** @type {number} */ u, /** @type {number} */ v) => {
	if (u < 0.76) return Math.pow(Math.max(0, Math.sin(Math.PI * (0.06 + (u / 0.76) * 0.84))), 0.5);
	const t = (u - 0.76) / 0.24;
	return t < 0.5 ? 0.56 + 0.3 * Math.sin(t * Math.PI) : 0.86 - (t - 0.5) * 1.1;
};

const medlar = grove({
	seed: { size: v3(0.007, 0.004, 0.005), coat: '#a8865a', shade: '#7a5a3a', depth: 0.02 },
	hypogeal: false,
	cotyledon: { length: 0.014, width: 0.007, colour: '#6aa046' },
	// a short crooked trunk, limbs spreading near level, the crown wide and low
	flush: crown({ trunk: 0.8, scaffolds: [3, 5], scaffoldAngle: 0.85, gens: 6, whorl: [2, 3], spread: 0.62, up: 0.045, droop: 0.045, wander: 0.18, radius: 0.12, taper: 0.62, shoot: (gen) => [0, 1.05, 0.8, 0.6, 0.44, 0.33, 0.26][gen] ?? 0.26, bark: ['#8a7058', '#5e4a3a'] }),
	roots: { tap: 1.0, spread: 1.9, count: 10, radius: 0.035 },
	leaf: { length: 0.12, width: 0.035, shape: oblong, colour: '#4a6a32', dark: '#3e5e2c', young: '#9ab468', spacing: 0.24, droop: 0.4, from: 4, tuft: 4, curl: 0.08 },
	bloom: { sites: 'tips', opens: 4.6, chance: 0.4, gen: 5 },
	site: (s) => {
		const up = s.dir.clone().lerp(UP, 0.65).normalize();
		const sepals = (/** @type {THREE.Matrix4} */ m, /** @type {number} */ L, /** @type {number} */ W, /** @type {number} */ grown, /** @type {string} */ colour) => {
			// five long narrow sepals from the eye's rim, curving out
			const c = mix(colour, '#4a3420', 0.3);
			for (let k = 0; k < 5; k++) {
				const a = (k / 5) * Math.PI * 2;
				const out = v3(Math.cos(a), 0, Math.sin(a));
				const d = out.clone().multiplyScalar(0.8).add(v3(0, -0.6, 0)).normalize();
				s.bag.add('sheet', sheet({ length: 0.016 * grown, width: 0.0035 * grown, shape: (u) => Math.sin(Math.PI * Math.pow(u, 0.5)) * (1 - 0.7 * u), lift: (u) => 0.25 * u * u, paint: () => c, along: 4, across: 1 }), m.clone().multiply(aim(v3(0, -L * 0.88, 0).addScaledVector(out, W * 0.7), d, 0)));
			}
		};
		if (s.phase < 0.55) {
			if (s.phase < 0) return void s.bag.add('body', bead(s.at.clone().addScaledVector(up, 0.008), v3(0.006, 0.01, 0.006), '#e8ecd8', 4));
			bloom(s.bag, { petals: 5, length: 0.016, width: 0.014, colour: '#fbfaf2', heart: '#d8c878', sepals: 5, sepal: 0.018, sepalColour: '#6a8a3a', sepalBack: 0.05, stamens: 30, stamenColour: '#9a2a2a' }, s.at.clone().addScaledVector(up, 0.012), up, 1.6, clamp(s.phase / 0.2), span(s.phase, 0.35, 0.55));
			return;
		}
		const { set, ripe } = fruiting(s.phase, 2.4, 1.3, 1.8);
		const ground = ripening('#7a9048', '#8a7a44', '#7a5030', ripe);
		const r = hangFruit(s, 0, {
			L: 0.036, W: 0.027, stalk: 0.012, set, gloss: false, out: 0.5,
			shape: medlarShape,
			// russet, rough, speckled; the eye darker
			paint: (u, v) => ground.clone().lerp(new THREE.Color('#a88a5a'), Math.pow(Math.abs(Math.sin(u * 47 + v * 61)), 18) * 0.5).lerp(new THREE.Color('#3a2a1a'), u > 0.9 ? 0.5 : 0)
		});
		sepals(r.m, r.L, r.W, lerp(0.6, 1, set), ripe > 0.5 ? '#5a4024' : '#5a7a34');
		s.bag.fruitDone();
	}
});

/* ------------------------------------------------------------------------------------------------ serviceberry */

export const SERVICEBERRY_STAGES = stages([
	['Seed', 0, 'A tiny brown seed from a berry, chilled through the winter, barely covered.'],
	['Germination', 30, 'A root goes down, a tiny hook comes up.'],
	['Seedling', 50, 'Two round seed leaves, then small oval toothed leaves, bronze as they unfold.'],
	['Young bush', 1100, 'Thin stems from the base, grey and smooth, the tallest above your head.'],
	['Young tree', 1460, 'A small tree of many grey stems, four metres high, its crown light and airy.'],
	['Blossom', 1680, 'Early in the spring, as the bronze leaves unfold: clouds of white stars in loose racemes at every shoot tip.'],
	['Fruit set', 1695, 'The petals fall; little green berries along the racemes, each crowned by its sepals.'],
	['Green berries', 1720, 'Clusters of green berries hanging, swelling, the leaves green now.'],
	['Colouring', 1745, 'In June they turn red, then berry by berry purple.'],
	['Ripe', 1760, 'Hanging clusters of red and purple-black berries, sweet, tasting of almond: the blackbirds know. In autumn the leaves turn orange and red.']
]);

const serviceberry = grove({
	seed: { size: v3(0.004, 0.002, 0.0025), coat: '#5a3a24', shade: '#3a2414', depth: 0.006 },
	hypogeal: false,
	cotyledon: { length: 0.008, width: 0.005, colour: '#6aa046' },
	// many stems from the base, steep, arching a little at the top
	flush: crown({ trunk: 0.08, trunkFlush: 0.9, scaffolds: [5, 7], scaffoldAngle: 0.32, gens: 6, whorl: [2, 3], spread: 0.55, up: 0.04, droop: 0.05, wander: 0.12, radius: 0.07, taper: 0.66, shoot: (gen) => [0, 1.5, 0.95, 0.65, 0.45, 0.32, 0.24][gen] ?? 0.24, bark: ['#8a8680', '#5e5a56'] }),
	roots: { tap: 0.8, spread: 1.5, count: 10, radius: 0.025 },
	leaf: { length: 0.07, width: 0.045, shape: toothed, colour: '#4a7234', dark: '#3a6230', young: '#9a5a3e', spacing: 0.6, droop: 0.35, from: 5, tuft: 3, on: [[4.3, 1], [4.55, 0.35], [5.4, 1]] },
	bloom: { sites: 'tips', opens: 4.6, chance: 0.45, gen: 5 },
	site: (s) => {
		const out = s.dir.clone().setY(0);
		if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
		out.normalize();
		const fr = chance(s.seed, 'raceme', ...s.key);
		const n = 6 + Math.floor(fr() * 5);
		const { set, ripe } = fruiting(s.phase, 2.6, 1.2, 1.4);
		// the raceme: up and out while it flowers, hanging under its berries
		const tilt = span(s.phase, 0.4, 1.6);
		const axisDir = out.clone().multiplyScalar(0.7).add(v3(0, lerp(0.75, -0.9, tilt), 0)).normalize();
		const len = 0.055 * lerp(0.5, 1, clamp((s.phase + 0.4) / 0.5));
		const tip = s.at.clone().addScaledVector(axisDir, len);
		// once set, the whole raceme is picked as one
		const bearing = s.phase >= 0.55;
		if (bearing) s.bag.fruit(s.key, s.at, axisDir);
		s.bag.add('body', tube([s.at, s.at.clone().lerp(tip, 0.5).add(v3(0, 0.004 * (1 - tilt), 0)), tip], (u) => 0.0012 * (1 - 0.5 * u), () => col(ripe > 0.3 ? '#8a3a3a' : '#6a7a3a'), 3));
		for (let k = 0; k < n; k++) {
			const u = 0.2 + (0.8 * k) / (n - 1);
			const p = s.at.clone().lerp(tip, u);
			const side = across(axisDir, k * 2.39996 + fr());
			const pd = side.clone().add(v3(0, s.phase < 0.55 ? 0.6 : -0.8, 0)).normalize();
			const pl = (0.012 + 0.012 * (1 - u)) * lerp(0.6, 1, clamp(s.phase + 0.4));
			const end = p.clone().addScaledVector(pd, pl);
			s.bag.add('body', tube([p, end], () => 0.0006, () => col(ripe > 0.4 ? '#8a3a3a' : '#7a8a3a'), 3));
			if (s.phase < 0.55) {
				// a white star of five long narrow petals
				if (s.phase < 0) s.bag.add('body', bead(end, v3(0.0025, 0.004, 0.0025), '#f0eee0', 2));
				else star(s.bag, end, pd.clone().lerp(UP, 0.3), { petals: 5, length: 0.015, width: 0.0032, colour: '#fcfcf6', heart: '#e0d890', shape: (uu) => Math.pow(Math.sin(Math.PI * Math.pow(uu, 0.6)), 0.5) }, clamp(s.phase / 0.2), span(s.phase, 0.35, 0.55));
				continue;
			}
			if (fr() > 0.75) continue;
			// the berries at the raceme's base ripen first: a cluster red and purple-black at once
			const t = clamp(ripe * 1.3 - u * 0.45 - fr() * 0.15);
			const c = t < 0.45 ? mix('#8aa04a', '#c83038', t / 0.45) : mix('#c83038', '#3a1834', (t - 0.45) / 0.55);
			const r = (0.0018 + 0.0037 * set) * s.vigour * about(fr, 1, 0.08);
			berry(s, end.clone().add(v3(0, -r, 0)), r, c.lerp(new THREE.Color('#7a6a8a'), t * 0.15), DOWN, { crown: '#3a2a2a' });
		}
		if (bearing) s.bag.fruitDone();
	}
});

/* ------------------------------------------------------------------------------------------------ cornelian cherry */

export const CORNEL_STAGES = stages([
	['Stone', 0, 'An oblong ribbed stone from a cornel cherry, two centimetres down: it lies two winters before it wakes.'],
	['Germination', 540, 'In its second spring the root goes down and the seed leaves come up.'],
	['Seedling', 570, 'Two oval seed leaves, then true leaves in opposite pairs, their veins curving to the tip.'],
	['Sapling', 1500, 'A slow, upright little tree, its twigs in pairs.'],
	['Young tree', 2200, 'A dense small tree of five metres, branching in pairs, leafy to the ground.'],
	['Blossom', 2600, 'In February, on the bare twigs: tiny yellow flowers in little umbels at every pair of buds, the whole tree a yellow haze.'],
	['Fruit set', 2650, 'The opposite oval leaves unfold after the flowers; a few small green fruit hold in each umbel.'],
	['Green fruit', 2720, 'Hard green oval fruit hanging in ones and twos all along the twigs.'],
	['Colouring', 2780, 'Through yellow and scarlet in August.'],
	['Ripe', 2800, 'Glossy oval cherries, dark red, sour until they fall: Kornelkirschen for jam, syrup and the schnapps.']
]);

const cornel = grove({
	seed: { size: v3(0.012, 0.005, 0.005), coat: '#c8b48a', shade: '#9a8460', depth: 0.02 },
	hypogeal: false,
	cotyledon: { length: 0.018, width: 0.009, colour: '#6aa046' },
	// dense, twiggy, its branching in pairs: limbs steep, then many short twigs
	flush: crown({ trunk: 0.55, scaffolds: [4, 5], scaffoldAngle: 0.5, gens: 6, whorl: [2, 3], spread: 0.6, up: 0.07, droop: 0.035, wander: 0.12, radius: 0.1, taper: 0.62, shoot: (gen) => [0, 1.2, 0.85, 0.6, 0.44, 0.32, 0.24][gen] ?? 0.24, bark: ['#8a6a50', '#5a4636'] }),
	roots: { tap: 1.0, spread: 1.6, count: 10, radius: 0.03 },
	leaf: { length: 0.075, width: 0.038, shape: pointed, colour: '#3e6a2e', dark: '#34602a', young: '#8ab45a', opposite: true, spacing: 0.6, droop: 0.3, from: 4, tuft: 2, curl: 0.12, on: [[4.25, 1], [4.55, 0], [5.3, 0], [6.1, 1]] },
	bloom: { sites: 'twigs', opens: 4.6, chance: 4, gen: 4, pairs: true },
	site: (s) => {
		const fr = chance(s.seed, 'umbel', ...s.key);
		const up = s.dir.clone().lerp(UP, 0.5).normalize();
		if (s.phase < 0.55) {
			// a little umbel: four yellow-brown bracts round twenty tiny four-petalled yellow flowers on stalks
			const open = clamp((s.phase + 0.4) / 0.5), fall = span(s.phase, 0.35, 0.55);
			for (let k = 0; k < 4; k++) s.bag.add('sheet', sheet({ length: 0.005, width: 0.003, shape: (u) => Math.sin(Math.PI * u), paint: () => col('#a89048'), along: 2, across: 1 }), aim(s.at, across(up, (k * Math.PI) / 2).multiplyScalar(lerp(0.2, 0.8, open)).addScaledVector(up, 1).normalize(), 0));
			const n = 10;
			for (let k = 0; k < n; k++) {
				const d = up.clone().addScaledVector(across(up, k * 2.39996), lerp(0.2, 0.9, open) * Math.sqrt((k + 0.5) / n)).normalize();
				const end = s.at.clone().addScaledVector(d, 0.01 * lerp(0.4, 1, open));
				s.bag.add('body', tube([s.at, end], () => 0.0004, () => col('#8a8a3a'), 3));
				s.bag.add('body', bead(end, v3(0.003, 0.0022, 0.003).multiplyScalar(lerp(0.6, 1, open) * (1 - fall * 0.6)), fall > 0.5 ? '#9a9a4a' : mix('#c8b438', '#f0d020', open), 2));
			}
			return;
		}
		// most umbels keep none; some one, a few two
		const x = fr();
		const keep = s.shoot.gen < 5 || x < 0.6 ? 0 : x < 0.9 ? 1 : 2;
		const { set, ripe } = fruiting(s.phase, 2.5, 1.3, 1.6);
		const c = ripe < 0.35 ? mix('#86a048', '#d8c050', ripe / 0.35) : ripe < 0.65 ? mix('#d8c050', '#d8261e', (ripe - 0.35) / 0.3) : mix('#d8261e', '#a8101c', (ripe - 0.65) / 0.35);
		for (let k = 0; k < keep; k++) {
			const r = hangFruit(s, k, { L: 0.021, W: 0.0075, stalk: 0.016, set, gloss: true, sides: 8, rings: 7, out: 0.4, shape: (u) => Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.5), paint: () => c });
			s.bag.add('body', bead(v3(0, -r.L, 0), v3(r.W * 0.25, r.W * 0.12, r.W * 0.25), '#3a2a1a', 2), r.m);
			s.bag.fruitDone();
		}
	}
});

/* ------------------------------------------------------------------------------------------------ elder */

export const ELDER_STAGES = stages([
	['Seed', 0, 'A tiny wrinkled seed from an elderberry, left by a blackbird, barely covered.'],
	['Germination', 30, 'A root goes down; two small seed leaves come up.'],
	['Seedling', 50, 'Its first true leaves in opposite pairs, already feathered into leaflets.'],
	['Young bush', 365, 'Fast: soft green stems a metre and more in a year, their pith white.'],
	['Bush', 1100, 'A big shrub of many stems, corky grey, arching out under feathered leaves, five metres high.'],
	['Flowering', 1250, 'In June, flat cream umbels a hand across at the tips of the new shoots, smelling of muscat: picked for elderflower.'],
	['Fruit set', 1265, 'The tiny petals fall; the umbels fill with green beads and begin to bow.'],
	['Green berries', 1300, 'The umbels heavy with hard green berries, turning over on their stalks.'],
	['Colouring', 1330, 'The stalks redden, the berries go red-purple, then black.'],
	['Ripe', 1350, 'Heavy drooping umbels of glossy black berries on red stalks: cooked, never raw, for juice, syrup and jam.']
]);

const elder = grove({
	seed: { size: v3(0.003, 0.0016, 0.0016), coat: '#8a6a40', shade: '#5a4020', depth: 0.005 },
	hypogeal: false,
	cotyledon: { length: 0.008, width: 0.004, colour: '#6aa046' },
	// many stems from the base, arching out and bowing under their leaves and fruit
	flush: crown({ trunk: 0.06, trunkFlush: 0.9, scaffolds: [5, 7], scaffoldAngle: 0.38, gens: 5, whorl: [2, 3], spread: 0.6, up: 0.04, droop: 0.1, wander: 0.12, radius: 0.08, taper: 0.64, rest: 0.15, flush: 0.22, shoot: (gen) => [0, 2.0, 1.05, 0.7, 0.48, 0.36][gen] ?? 0.36, bark: ['#9a9282', '#6a6458'] }),
	roots: { tap: 0.7, spread: 1.6, count: 5, radius: 0.03 },
	leaf: { length: 0.095, width: 0.038, shape: toothed, colour: '#3e6a2c', dark: '#335c26', young: '#86b052', opposite: true, pinnate: { pairs: [2, 3], length: 0.27, width: 0.11 }, spacing: 0.7, droop: 0.25, from: 4, tuft: 2, along: 3, across: 1 },
	bloom: { sites: 'tips', opens: 4.6, chance: 0.45, gen: 4 },
	site: (s) => {
		const fr = chance(s.seed, 'umbel', ...s.key);
		const { set, ripe } = fruiting(s.phase, 2.5, 1.3, 1.4);
		// the umbel faces up while it flowers, then turns over under its berries
		const out = s.dir.clone().setY(0);
		if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
		out.normalize();
		const turnOver = span(s.phase, 0.6, 2.2);
		const axis = UP.clone().multiplyScalar(Math.cos(turnOver * 2.4)).addScaledVector(out, Math.sin(turnOver * 2.4) + 0.15).normalize();
		const stalkEnd = s.at.clone().addScaledVector(s.dir.clone().lerp(UP, 0.7).normalize(), 0.07).addScaledVector(axis, 0.05);
		const stalk = ripe > 0.3 ? mix('#6a8a3a', '#9a1e3a', (ripe - 0.3) / 0.4) : new THREE.Color('#6a8a3a');
		// once set, the whole umbel is picked as one, hanging from its stalk's foot
		const bearing = s.phase >= 0.55;
		if (bearing) s.bag.fruit(s.key, s.at, stalkEnd.clone().addScaledVector(axis, 0.025).sub(s.at));
		s.bag.add('body', tube([s.at, stalkEnd], () => 0.002, () => stalk, 4));
		const Rd = 0.075 * lerp(0.6, 1, clamp((s.phase + 0.4) / 0.6)) * (1 + 0.15 * set) * about(fr, 1, 0.1);
		const H = 0.05 * (1 + 0.3 * set);
		const q = new THREE.Quaternion().setFromUnitVectors(UP, axis);
		const local = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => v3(x, y, z).applyQuaternion(q).add(stalkEnd);
		// five rays to five nodes, each node fanning into the pedicels of its share of the flowers
		const nodes = [];
		for (let k = 0; k < 5; k++) {
			const a = (k / 5) * Math.PI * 2 + fr();
			nodes.push({ a, p: local(Math.cos(a) * Rd * 0.42, H * 0.45, Math.sin(a) * Rd * 0.42) });
			s.bag.add('body', tube([stalkEnd, nodes[k].p], () => 0.0011, () => stalk, 3));
		}
		// in flower, the umbel reads as one cream plate: hundreds of tiny flowers, a few dozen of them drawn, over a
		// shallow dome of cream just under them
		if (s.phase < 0.55 && s.phase > -0.2) {
			const fall = span(s.phase, 0.35, 0.55);
			const plate = fan({ size: Rd, from: -Math.PI, to: Math.PI, edge: () => 0.92 * (1 - fall * 0.5), lift: (r) => (H * (1 - 0.35 * r * r) - 0.003) / Rd, paint: () => col(s.phase < 0 ? '#d8dcb0' : '#ece4c0'), rings: 2, rays: 12 });
			s.bag.add('body', plate, new THREE.Matrix4().compose(stalkEnd, q, v3(1, 1, 1)));
		}
		// sixty-odd flowers; every other one keeps its berry
		const n = 64;
		for (let k = 0; k < n; k++) {
			const rho = Rd * Math.sqrt((k + 0.5) / n);
			const a = k * 2.39996;
			const y = H * (1 - 0.35 * Math.pow(rho / Rd, 2));
			const p = local(Math.cos(a) * rho, y, Math.sin(a) * rho);
			let near = nodes[0];
			for (const nd of nodes) if (Math.abs(Math.atan2(Math.sin(nd.a - a), Math.cos(nd.a - a))) < Math.abs(Math.atan2(Math.sin(near.a - a), Math.cos(near.a - a)))) near = nd;
			if (s.phase < 0.55 || k % 2 === 0) s.bag.add('body', tube([rho < Rd * 0.2 ? stalkEnd : near.p, p], () => 0.0005, () => stalk, 3));
			if (s.phase < 0.55) {
				// a tiny cream star, five petals
				const open = clamp((s.phase + 0.2) / 0.25), fall = span(s.phase, 0.35, 0.55);
				if (fall < 1) s.bag.add('body', bead(p.clone().addScaledVector(axis, 0.001), v3(0.0042, 0.0014, 0.0042).multiplyScalar(lerp(0.55, 1, open) * (1 - fall * 0.5)), open < 0.5 ? '#e0e0b8' : '#f6f0d6', 2, q));
				continue;
			}
			if (k % 2 || fr() > 0.85) continue;
			const t = clamp(ripe * 1.2 - fr() * 0.2);
			const c = t < 0.4 ? mix('#7a9a42', '#8a3a4a', t / 0.4) : mix('#8a3a4a', '#1c1222', (t - 0.4) / 0.6);
			const r = (0.0012 + 0.0026 * set) * s.vigour;
			berry(s, p.clone().addScaledVector(axis, r * 0.9), r, c, axis.clone(), { detail: 2 });
		}
		if (bearing) s.bag.fruitDone();
	}
});

/* ------------------------------------------------------------------------------------------------ sea buckthorn */

export const SEA_BUCKTHORN_STAGES = stages([
	['Seed', 0, 'A small glossy brown seed from an orange berry, a centimetre down in sandy soil.'],
	['Germination', 20, 'A root goes down, two narrow seed leaves come up; soon Frankia, a soil bacterium, finds the roots.'],
	['Seedling', 45, 'Narrow silvery leaves; little orange-brown nodules swelling on the roots, fixing nitrogen from the air.'],
	['Young bush', 730, 'Thorny stems, suckering, the leaves silver beneath.'],
	['Bush', 1100, 'A thorny silver shrub of three metres, many-stemmed, its twigs ending in thorns.'],
	['Flowering', 1250, 'In April, before the leaves: tiny greenish flowers crowded along last year’s twigs (on the female bush; the wind brings the pollen from a male).'],
	['Fruit set', 1270, 'The narrow silver leaves unfold; little green berries set, packed along the twigs.'],
	['Green berries', 1330, 'The twigs crammed with hard green berries.'],
	['Colouring', 1400, 'The berries turn yellow, then orange.'],
	['Ripe', 1430, 'Orange berries packed all along the twigs among the silver leaves: sour, oily, rich in vitamin C; the twigs are cut and frozen to shake them off.']
]);

const seaBuckthorn = grove({
	seed: { size: v3(0.004, 0.0022, 0.0022), coat: '#4a2a1a', shade: '#2a160c', depth: 0.008 },
	hypogeal: false,
	cotyledon: { length: 0.008, width: 0.003, colour: '#7a9a5a' },
	// many stems from the base and from suckers, upright then spreading, stiff and thorny
	flush: crown({ trunk: 0.06, trunkFlush: 0.9, scaffolds: [5, 7], scaffoldAngle: 0.4, gens: 5, whorl: [2, 3], spread: 0.6, up: 0.04, droop: 0.04, wander: 0.14, radius: 0.04, taper: 0.64, rest: 0.15, flush: 0.22, shoot: (gen) => [0, 1.3, 0.75, 0.5, 0.36, 0.28][gen] ?? 0.28, bark: ['#7a6a58', '#4a4038'] }),
	roots: { tap: 0.6, spread: 1.6, count: 8, radius: 0.025, nodules: true },
	leaf: { length: 0.07, width: 0.011, shape: linear, colour: '#9aa892', dark: '#86967e', young: '#c0cab0', spacing: 0.15, droop: 0.15, from: 3, start: 0.62, tuft: 6, max: 30, along: 3, across: 1, on: [[4.25, 1], [4.55, 0], [5.15, 0], [5.9, 1]] },
	thorns: 5,
	bloom: { sites: 'wood', opens: 4.6, chance: 0.6, gen: 4 },
	site: (s) => {
		// berries packed all along last year's wood, in a tight spiral, each just clear of the next
		const sh = s.shoot;
		const fr = chance(s.seed, 'packed', ...s.key);
		const { set, ripe } = fruiting(s.phase, 2.5, 1.3, 1.5);
		const r = (0.0012 + 0.0029 * set) * s.vigour;
		const step = 0.0068;
		const from = 0.12, to = 0.62;
		const n = Math.floor((sh.length * (to - from)) / step);
		const t0 = fr() * Math.PI * 2;
		for (let k = 0; k < n; k++) {
			const p = along(sh.pts, from + ((to - from) * k) / Math.max(1, n));
			const side = across(p.dir, t0 + k * 2.39996);
			if (s.phase < 0.55) {
				// the tiny flowers: little greenish-yellow knobs
				if (k % 2 === 0) s.bag.add('body', bead(p.at.clone().addScaledVector(side, sh.radius + 0.0015), v3(0.0018, 0.0018, 0.0018).multiplyScalar(clamp((s.phase + 0.4) / 0.4)), '#a8a85a', 2));
				continue;
			}
			if (fr() > 0.9) continue;
			const t = clamp(ripe * 1.2 - fr() * 0.2);
			const c = t < 0.5 ? mix('#8aa04a', '#e8c030', t * 2) : mix('#e8c030', '#e8741a', (t - 0.5) * 2);
			// each berry sits on the twig without a stalk: picked one by one
			s.bag.fruit([...s.key, k], p.at.clone().addScaledVector(side, sh.radius), side);
			berry(s, p.at.clone().addScaledVector(side, sh.radius + r * 1.05), r, c, side.clone().negate(), { long: 1.2, detail: 2 });
			s.bag.fruitDone();
		}
	}
});

/* ------------------------------------------------------------------------------------------------ pawpaw */

export const PAWPAW_STAGES = stages([
	['Seed', 0, 'A big flat brown seed from a pawpaw, never dried, chilled through the winter, two centimetres down.'],
	['Germination', 60, 'Slow: the root goes deep first; the seed leaves stay in the seed below the soil.'],
	['Seedling', 100, 'A shoot with its first long leaves, wanting shade its first years.'],
	['Sapling', 1100, 'A slender young tree, its leaves big and drooping, its limbs in tiers.'],
	['Young tree', 1800, 'A narrow pyramid four metres high, its great drooping leaves hanging in layers, tropical-looking.'],
	['Flowering', 2200, 'In spring, as the leaves unfold: nodding maroon bells, three-petalled twice, on last year’s bare wood, smelling faintly of yeast.'],
	['Fruit set', 2220, 'Several fruit from each flower: little green clusters, like tiny bananas.'],
	['Green fruit', 2300, 'Clusters of two to four green fruit, kidney-shaped, swelling under the leaves.'],
	['Colouring', 2360, 'The green pales toward yellow; the fruit softens.'],
	['Ripe', 2380, 'Soft yellow-green pawpaws freckled brown, smelling of mango and banana: custard inside, big brown seeds.']
]);

const pawpaw = grove({
	seed: { size: v3(0.022, 0.008, 0.013), coat: '#6a4424', shade: '#3e2410', depth: 0.02 },
	hypogeal: true,
	// a straight leader and tiers of limbs, the lowest the longest: a pyramid
	leader: {
		height: [[1.8, 0], [3, 0.6], [4, 2.6], [5, 3.9], [6, 4.5], [7, 4.8], [9, 5.1]], radius: 0.17, tiers: 36, clear: 0.7, spacing: 0.12, angle: 1.0,
		limb: (h) => 1.8 * (1 - h) + 0.35, rate: 1.4, crown: 4.6, sides: 0.55, side: 0.11, bark: ['#8a8070', '#5e564c'], droop: 0.14
	},
	roots: { tap: 1.3, spread: 1.8, count: 10, radius: 0.035 },
	leaf: { length: 0.26, width: 0.11, shape: obovate, colour: '#3e6a2c', dark: '#34602a', young: '#9ab86a', spacing: 0.24, droop: 0.85, from: 1, tuft: 3, max: 12, curl: 0.05, on: [[4.3, 1], [4.6, 0.15], [5.5, 1]] },
	bloom: { sites: 'twigs', opens: 4.6, chance: 2.4, gen: 1 },
	site: (s) => {
		const out = s.dir.clone().setY(0);
		if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
		out.normalize();
		if (s.phase < 0.55) {
			// a nodding bell on a short stalk: three broad outer petals flaring back, three small inner ones
			const open = clamp((s.phase + 0.4) / 0.6), fall = span(s.phase, 0.38, 0.55);
			const face = out.clone().multiplyScalar(0.4).add(v3(0, -1, 0)).normalize();
			const at = s.at.clone().addScaledVector(face, 0.012);
			s.bag.add('body', tube([s.at, at], () => 0.0012, () => col('#5a4a30'), 3));
			if (fall >= 1) return;
			const colour = mix('#6a7a3a', '#5a1424', open);
			for (let k = 0; k < 6; k++) {
				const inner = k >= 3;
				const side = across(face, (k / 3) * Math.PI * 2 + (inner ? Math.PI / 3 : 0));
				const flare = inner ? 0.25 : lerp(0.15, 0.75, open);
				const d = face.clone().multiplyScalar(Math.cos(flare)).addScaledVector(side, Math.sin(flare)).normalize();
				const len = (inner ? 0.012 : 0.022) * lerp(0.4, 1, open) * (1 - fall * 0.4);
				s.bag.add('sheet', sheet({ length: len, width: len * 0.7, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.75)), 0.6), lift: (u, v) => 0.12 * v * v - 0.15 * u * u, paint: (u) => colour.clone().lerp(new THREE.Color('#2a0a12'), u * 0.3), along: 4, across: 2 }), aim(at, d, 0));
			}
			return;
		}
		const fr = chance(s.seed, 'cluster', ...s.key);
		// few flowers set: most none, some one to four fruit from the one flower
		const x = fr();
		const keep = x < 0.78 ? 0 : x < 0.86 ? 1 : x < 0.95 ? 2 : 3 + Math.floor(fr() * 2);
		const { set, ripe } = fruiting(s.phase, 2.6, 1.2, 1.9);
		const ground = ripening('#5f8a34', '#8aa040', '#c0be5a', ripe);
		for (let k = 0; k < keep; k++) {
			hangFruit(s, k, {
				L: 0.1, W: 0.03, stalk: 0.025, set, gloss: false, out: 0.8, sides: 12, rings: 10, bend: 0.12,
				shape: (u) => Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.5) * (0.82 + 0.18 * u),
				paint: (u, v) => ground.clone().lerp(new THREE.Color('#6a4a2a'), ripe * 0.6 * Math.pow(Math.abs(Math.sin(u * 53 + v * 71)), 24))
			});
			s.bag.fruitDone();
		}
	}
});

/** @type {(import('./index.js').Plant & { layer: import('./index.js').Layer })[]} */
export const WALD = [
	{
		id: 'quince',
		label: 'Quince',
		latin: 'Cydonia oblonga · Quitte',
		note: 'A small crooked tree of round felted leaves; one big pale-pink flower at the tip of each short new shoot, then a big downy fruit, pear- or apple-shaped, ripening golden.',
		from: 'Tree · 5 years',
		stages: QUINCE_STAGES,
		grow: quince,
		layer: 'sub-canopy'
	},
	{
		id: 'medlar',
		label: 'Medlar',
		latin: 'Mespilus germanica · Mispel',
		note: 'A small spreading tree of long narrow leaves; big single white flowers at the shoot tips, then brown russet fruit, each with an open eye ringed by five long sepals.',
		from: 'Tree · 5 years',
		stages: MEDLAR_STAGES,
		grow: medlar,
		layer: 'sub-canopy'
	},
	{
		id: 'serviceberry',
		label: 'Serviceberry',
		latin: 'Amelanchier lamarckii · Felsenbirne',
		note: 'A small tree of many grey stems: clouds of white starry flowers in racemes as its bronze leaves unfold, then hanging clusters of berries, red, then purple-black.',
		from: 'Tree · 4 years',
		stages: SERVICEBERRY_STAGES,
		grow: serviceberry,
		layer: 'sub-canopy'
	},
	{
		id: 'cornel',
		label: 'Cornelian cherry',
		latin: 'Cornus mas · Kornelkirsche',
		note: 'A dense small tree of opposite oval leaves with curving veins; tiny yellow umbels all over its bare twigs in late winter, glossy oval red cherries hanging along them in late summer.',
		from: 'Tree · 7 years',
		stages: CORNEL_STAGES,
		grow: cornel,
		layer: 'sub-canopy'
	},
	{
		id: 'elder',
		label: 'Elder',
		latin: 'Sambucus nigra · Holunder',
		note: 'A big arching shrub of many stems and feathered leaves: flat cream umbels of elderflower at the shoot tips, turning over into heavy drooping umbels of black berries on red stalks.',
		from: 'Shrub · 3 years',
		stages: ELDER_STAGES,
		grow: elder,
		layer: 'shrub'
	},
	{
		id: 'sea-buckthorn',
		label: 'Sea buckthorn',
		latin: 'Hippophae rhamnoides · Sanddorn',
		note: 'A thorny silver shrub that fixes nitrogen in nodules on its roots; narrow silvery leaves, and orange berries packed all along last year’s twigs.',
		from: 'Shrub · 4 years',
		stages: SEA_BUCKTHORN_STAGES,
		grow: seaBuckthorn,
		layer: 'shrub'
	},
	{
		id: 'pawpaw',
		label: 'Pawpaw',
		latin: 'Asimina triloba · Indianerbanane',
		note: 'A small pyramidal tree of great drooping leaves; nodding maroon bells on last year’s wood, then clusters of green kidney-shaped fruit, custard inside.',
		from: 'Tree · 6 years',
		stages: PAWPAW_STAGES,
		grow: pawpaw,
		layer: 'sub-canopy'
	}
];
