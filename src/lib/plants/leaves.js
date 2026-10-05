/*
 * LEAVES — a compound leaf: a stalk running on into a rachis, leaflets in pairs along it and one at its end, sometimes
 * small ones in between (a tomato's). The raspberry's five or three toothed leaflets, the tomato's ragged lobed ones.
 * Young, the leaflets are folded along their midribs and the leaf stands up; grown, it spreads and droops; old, it
 * yellows and hangs.
 */
import * as THREE from 'three';
import { aim, chance, clamp, lerp, mix, sheet, tube, v3 } from './grow.js';

/**
 * @typedef {{ length: number, width: number, shape: (u: number) => number, colour: string, young: string, vein: string, old?: string }} Leaflet
 */

/**
 * @param {import('./grow.js').Bag} bag
 * @param {{
 *   seed: string, key: (string | number)[], at: THREE.Vector3, out: THREE.Vector3, lift: number, length: number,
 *   pairs: number, leaflet: Leaflet, grown: number, old?: number, between?: boolean, stalk: string, radius: number,
 *   terminal?: number
 * }} o — `out` the way it reaches (level), `lift` how far up from level it starts (radians), `length` the stalk and
 *   rachis together, `terminal` the end leaflet's size against the pairs', `between` small leaflets between the pairs
 */
export function pinnate(bag, o) {
	const r = chance(o.seed, 'pinnate', ...o.key);
	const g = clamp(o.grown);
	const old = clamp(o.old ?? 0);
	const len = o.length * lerp(0.25, 1, g);
	const out = o.out.clone().setY(0).normalize();
	// up while young, then out and bowing down under its leaflets (further when old)
	const lift = lerp(1.2, o.lift, g) - old * 0.6;
	let d = out.clone().multiplyScalar(Math.cos(lift)).add(v3(0, Math.sin(lift), 0)).normalize();
	let p = o.at.clone();
	/** @type {THREE.Vector3[]} */
	const pts = [];
	const droop = 0.05 + r() * 0.05 + old * 0.12;
	for (let k = 0; k <= 12; k++) {
		pts.push(p.clone());
		d = d.clone().addScaledVector(v3(0, -1, 0), droop * (k / 12)).normalize();
		p = p.clone().addScaledVector(d, len / 12);
	}
	bag.add('body', tube(pts, (u) => o.radius * (1 - 0.6 * u), () => mix(o.stalk, '#c2a94a', old), 4));
	/** the rachis at u: its point and direction */
	const along = (/** @type {number} */ u) => {
		const f = u * 12, k = Math.min(11, Math.floor(f));
		return { p: pts[k].clone().lerp(pts[k + 1], f - k), d: pts[k + 1].clone().sub(pts[k]).normalize() };
	};
	const fold = (1 - g) * 0.9 + 0.05 + old * 0.2;
	const leaf = o.leaflet;
	const paint = (/** @type {number} */ u, /** @type {number} */ v) => {
		const vein = Math.abs(v) < 0.09 ? 0.45 : 0;
		const green = mix(mix(leaf.colour, leaf.young, 1 - clamp(g * 1.3)), leaf.vein, vein);
		return old ? green.lerp(mix(leaf.old ?? '#d2bf4a', '#a8823a', u), clamp(old * 1.3)) : green;
	};
	/** one leaflet at u along the rachis, to one side (−1, 1) or straight on (0) */
	const leaflet = (/** @type {number} */ u, /** @type {number} */ side, /** @type {number} */ size) => {
		const { p: at, d: t } = along(u);
		let dir;
		if (side === 0) dir = t.clone();
		else {
			const across = new THREE.Vector3().crossVectors(t, v3(0, 1, 0));
			if (across.lengthSq() < 1e-6) across.set(1, 0, 0);
			across.normalize().multiplyScalar(side);
			dir = across.multiplyScalar(0.85).addScaledVector(t, 0.5).add(v3(0, -0.12 - old * 0.3, 0)).normalize();
		}
		const l = leaf.length * size * lerp(0.3, 1, g);
		const blade = sheet({
			length: l,
			width: l * (leaf.width / leaf.length),
			shape: leaf.shape,
			lift: (uu, v) => fold * Math.abs(v) * 0.3 - (0.08 + old * 0.2) * uu * uu,
			paint,
			along: 36,
			across: 6
		});
		bag.add('sheet', blade, aim(at, dir, (r() - 0.5) * 0.3));
	};
	for (let k = 0; k < o.pairs; k++) {
		const u = lerp(0.42, 0.9, o.pairs === 1 ? 0.5 : k / (o.pairs - 1));
		const size = lerp(0.75, 0.95, k / Math.max(1, o.pairs - 1)) * (0.9 + r() * 0.2);
		leaflet(u, -1, size);
		leaflet(u + (r() - 0.5) * 0.03, 1, size * (0.9 + r() * 0.2));
		if (o.between && k < o.pairs - 1) {
			const ub = u + 0.48 / Math.max(1, o.pairs - 1) / 2;
			leaflet(ub, -1, 0.3);
			leaflet(ub, 1, 0.28);
		}
	}
	leaflet(1, 0, o.terminal ?? 1.1);
}
