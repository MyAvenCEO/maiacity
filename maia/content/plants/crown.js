/*
 * CROWN — how a tree branches, two ways.
 *
 * In flushes (sympodial; the mango, the citrus, the apple): a shoot grows, rests, and the next flush breaks from the
 * ring of buds at its tip as two to four new shoots spread round it; its own tip goes no further. A short trunk, a
 * whorl of scaffold limbs at about 45°, then flush after flush, each shorter, bending out and down as they go, until the
 * crown is a dome as wide as it is tall, its leaves and flowers at the ends of the outermost shoots.
 *
 * With a leader (monopodial; the durian, the jackfruit): one trunk keeps growing straight up, setting near-level limbs
 * in tiers as it passes, the lowest the longest, so the young tree is a cone; the lowest limbs die off in the shade as
 * the crown rises, leaving a clear trunk. Each limb carries its own side shoots, level, in a fan.
 *
 * Every shoot draws its chance by its place in the tree, so a tree tabbed through its stages grows: the shoots of the
 * last stage are still there in the next, a flush further on.
 */
import * as THREE from 'three';
import { about, between, chance, clamp, mix, tube, v3 } from './grow.js';

/**
 * @typedef {{ pts: THREE.Vector3[], tip: THREE.Vector3, dir: THREE.Vector3, gen: number, key: (string | number)[],
 *   grown: number, end: boolean, radius: number, born: number, length: number }} Shoot — one shoot as far as it has
 *   grown; `end` while nothing has broken from its tip yet (where the leaves, the flowers and the fruit are)
 */

/**
 * @typedef {{
 *   trunk: number, trunkBorn: number, trunkFlush: number, scaffolds: [number, number], scaffoldAngle: number,
 *   gens: number, flush: number, rest: number, shoot: (gen: number) => number, whorl: [number, number], spread: number,
 *   up: number, droop: number, wander: number, radius: number, taper: number, thicken: number, bark: [string, string],
 *   stop?: (key: (string | number)[], gen: number, born: number) => boolean
 * }} Flush — `trunk` the clear trunk's length, its flush from `trunkBorn` over `trunkFlush`; then `scaffolds` limbs
 *   (at least, at most) at `scaffoldAngle` from it; then `gens` generations of flushes, each `flush` long with a `rest`
 *   between, of `shoot(gen)` metres, `whorl` new shoots each, leaving their parent at `spread`; a shoot that
 *   `stop`s flushes no further (it has become a flowering and fruiting tip)
 */

/**
 * A tree that grows in flushes. Its shoots are drawn into `bag` and handed back.
 * @param {import('./grow.js').Bag} bag
 * @param {{ seed: string, g: number, from: THREE.Vector3, spec: Flush }} o
 * @returns {Shoot[]}
 */
export function flushCrown(bag, o) {
	const { seed, g, spec } = o;
	/** @type {Shoot[]} */
	const out = [];
	/**
	 * @param {(string | number)[]} key @param {THREE.Vector3} from @param {THREE.Vector3} dir @param {number} gen @param {number} born
	 */
	const grow = (key, from, dir, gen, born) => {
		if (g <= born) return;
		const r = chance(seed, 'shoot', ...key);
		const length = (gen === 0 ? spec.trunk : spec.shoot(gen)) * about(r, 1, 0.18);
		const flush = gen === 0 ? spec.trunkFlush : spec.flush;
		const grown = clamp((g - born) / flush);
		const steps = gen === 0 ? 10 : 5;
		const path = [from.clone()];
		const d = dir.clone().normalize();
		for (let i = 0; i < steps; i++) {
			// toward the light, and (the further out, the more) bowed down by its own weight and its leaves
			d.y += spec.up - spec.droop * gen * (i / steps);
			d.x += (r() * 2 - 1) * spec.wander;
			d.z += (r() * 2 - 1) * spec.wander;
			d.normalize();
			path.push(path[i].clone().addScaledVector(d, length / steps));
		}
		const reach = grown * steps, whole = Math.floor(reach);
		const pts = path.slice(0, whole + 1);
		if (whole < steps) pts.push(path[whole].clone().lerp(path[whole + 1], reach - whole));
		if (pts.length < 2) return;
		// thicker the more tree it carries, and the older it is
		const age = g - born;
		const radius = spec.radius * Math.pow(spec.taper, gen) * (0.12 + 0.88 * clamp(age / spec.thicken));
		bag.add('body', tube(pts, (u) => radius * (1 - 0.35 * u), (u) => mix(spec.bark[1], spec.bark[0], clamp((u - 0.4) * 1.5 + (1 - clamp(age / 2)) * 0.8)), gen < 2 ? 9 : 5));
		const tip = pts[pts.length - 1];
		const tipDir = pts[pts.length - 1].clone().sub(pts[pts.length - 2]).normalize();
		let end = true;
		if (grown >= 1 && gen < spec.gens && !spec.stop?.(key, gen, born)) {
			const [a, b] = gen === 0 ? spec.scaffolds : spec.whorl;
			const n = a + Math.floor(r() * (b - a + 1));
			const turn0 = r() * Math.PI * 2;
			for (let i = 0; i < n; i++) {
				const bearing = turn0 + (i / n) * Math.PI * 2 + about(r, 0, 0.35);
				const tilt = (gen === 0 ? spec.scaffoldAngle : spec.spread) * about(r, 1, 0.2);
				const side = new THREE.Vector3().crossVectors(tipDir, v3(0, 1, 0));
				if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
				side.normalize().applyAxisAngle(tipDir, bearing);
				const cd = tipDir.clone().applyAxisAngle(side, tilt);
				const next = born + flush + spec.rest * about(r, 1, 0.25);
				if (g > next) end = false;
				grow([...key, i], tip, cd, gen + 1, next);
			}
		}
		out.push({ pts, tip: tip.clone(), dir: tipDir, gen, key, grown, end, radius, born, length: length * grown });
	};
	grow(['trunk'], o.from, v3(0, 1, 0), 0, spec.trunkBorn);
	return out;
}

/**
 * @typedef {{
 *   height: [number, number][], radius: number, tiers: number, clear: number, spacing: number, angle: number,
 *   limb: (h: number) => number, rate: number, crown: number, sides: number, side: number, bark: [string, string],
 *   droop: number
 * }} Leader — the trunk's height through the stages, how thick it grows, a limb every `spacing` metres from `clear`
 *   (`tiers` of them at most), at `angle` from upright, as long as `limb(h)` (h 0 … 1 up the tree) once grown, growing
 *   `rate` metres a stage; limbs further than `crown` below the top have died off; each limb with side shoots every
 *   `side` metres
 */

/**
 * A tree with a leader. Its trunk, limbs and side shoots are drawn into `bag` and handed back.
 * @param {import('./grow.js').Bag} bag
 * @param {{ seed: string, g: number, from: THREE.Vector3, spec: Leader }} o
 * @returns {Shoot[]}
 */
export function leaderCrown(bag, o) {
	const { seed, g, spec } = o;
	/** @type {Shoot[]} */
	const out = [];
	const r = chance(seed, 'leader');
	const H = tableAt(g, spec.height);
	if (H < 0.005) return out;
	const lean = v3(r() - 0.5, 0, r() - 0.5).multiplyScalar(0.06);
	const trunkAt = (/** @type {number} */ h) => o.from.clone().add(v3(lean.x * h * h, h, lean.z * h * h));
	const n = Math.max(2, Math.ceil(H / 0.1));
	const pts = [];
	for (let k = 0; k <= n; k++) pts.push(trunkAt((k / n) * H));
	const R = spec.radius * clamp(H / 8) + 0.004;
	bag.add('body', tube(pts, (u) => R * (1 - 0.7 * u) * (1 + 0.35 * Math.pow(1 - Math.min(1, (u * H) / 0.6), 3)), (u) => mix(spec.bark[1], spec.bark[0], clamp((u - 0.75) * 4)), 12));
	out.push({ pts, tip: pts[n].clone(), dir: v3(0, 1, 0), gen: 0, key: ['trunk'], grown: 1, end: true, radius: R, born: 0, length: H });
	for (let i = 0; i < spec.tiers; i++) {
		const lr = chance(seed, 'limb', i);
		const h = spec.clear * 0.3 + i * spec.spacing * about(lr, 1, 0.15);
		const bear = i * 2.39996 + about(lr, 0, 0.3);
		const ageLen = H - h;
		if (ageLen <= 0.05) break;
		// the lowest limbs have died off in the shade of the crown above
		if (h < H - spec.crown || h < spec.clear * clamp(H / 4)) {
			lr();
			continue;
		}
		const full = spec.limb(h / Math.max(1, H)) * about(lr, 1, 0.15);
		const len = Math.min(full, (ageLen / spec.rate) * full * 0.5 + 0.05);
		const out0 = v3(Math.cos(bear), 0, Math.sin(bear));
		const tilt = spec.angle * about(lr, 1, 0.08);
		let d = out0.clone().multiplyScalar(Math.sin(tilt)).add(v3(0, Math.cos(tilt), 0)).normalize();
		const lp = [trunkAt(h)];
		for (let k = 0; k < 8; k++) {
			d = d.clone().add(v3(0, -spec.droop * (k / 8), 0)).normalize();
			lp.push(lp[k].clone().addScaledVector(d, len / 8));
		}
		const lrad = R * 0.45 * clamp(len / 2 + 0.2);
		bag.add('body', tube(lp, (u) => lrad * (1 - 0.75 * u), () => spec.bark[1], 7));
		out.push({ pts: lp, tip: lp[8].clone(), dir: d.clone(), gen: 1, key: ['limb', i], grown: 1, end: true, radius: lrad, born: g - 2, length: len });
		// its side shoots, level, out to either side in a fan
		const count = Math.floor(len / spec.side);
		for (let k = 0; k < count; k++) {
			const u = (k + 0.7) / (count + 0.7);
			const f = u * 8, kk = Math.min(7, Math.floor(f));
			const p = lp[kk].clone().lerp(lp[kk + 1], f - kk);
			const along = lp[kk + 1].clone().sub(lp[kk]).normalize();
			const across = new THREE.Vector3().crossVectors(along, v3(0, 1, 0)).normalize().multiplyScalar(k % 2 ? 1 : -1);
			// level-ish, but some up and some down, so the limb's foliage is a deep layer and not a plate
			const sd = across.multiplyScalar(0.8).addScaledVector(along, 0.6).add(v3(0, between(lr, -0.35, 0.55), 0)).normalize();
			const slen = spec.sides * (1 - 0.6 * u) * between(lr, 0.7, 1.1) * clamp(len / 1.5 + 0.2);
			const sp = [p, p.clone().addScaledVector(sd, slen * 0.5), p.clone().addScaledVector(sd, slen).add(v3(0, -slen * 0.12, 0))];
			bag.add('body', tube(sp, (uu) => lrad * 0.3 * (1 - 0.6 * uu) + 0.002, () => spec.bark[0], 4));
			out.push({ pts: sp, tip: sp[2].clone(), dir: sd, gen: 2, key: ['side', i, k], grown: 1, end: true, radius: lrad * 0.3, born: g - 2 + clamp(1 - len / full) * 1.5, length: slen });
		}
	}
	return out;
}

/** a value through a table of [g, value] rows, straight between them */
function tableAt(/** @type {number} */ g, /** @type {[number, number][]} */ rows) {
	if (g <= rows[0][0]) return rows[0][1];
	for (let i = 1; i < rows.length; i++) if (g <= rows[i][0]) return rows[i - 1][1] + (rows[i][1] - rows[i - 1][1]) * ((g - rows[i - 1][0]) / (rows[i][0] - rows[i - 1][0]));
	return rows[rows.length - 1][1];
}
