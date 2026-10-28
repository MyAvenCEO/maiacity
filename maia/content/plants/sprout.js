/*
 * SPROUT — how a seed comes up, the same for every plant whose seed leaves rise into the light (epigeal): the radicle
 * breaks out and goes down first; then the hypocotyl, bent over in a hook so the soil does not tear the seed leaves,
 * pushes up through the surface; it straightens, lifts the seed leaves (the cotyledons) out of the seed coat, and they
 * open flat and green. Later, once the true leaves feed the plant, they yellow and fall.
 */
import * as THREE from 'three';
import { aim, bead, chance, clamp, lerp, mix, sheet, tube, v3 } from './grow.js';

/**
 * @param {import('./grow.js').Bag} bag
 * @param {{
 *   seed: string, at: THREE.Vector3, size: THREE.Vector3, coat: string, coatShade: string,
 *   stem: number, hook: number, radius: number, stemColor: string,
 *   leaf: { length: number, width: number, shape: (u: number) => number, color: string, vein: string },
 *   open: number, shed: number, wither: number, keepCoat?: boolean
 * }} o — `stem` the hypocotyl's length now, `hook` how bent over it is (1 a hook, 0 straight), `open` how far the seed
 *   leaves have spread, `shed` 0 … 1 the coat coming off, `wither` 0 … 1 the seed leaves gone
 * @returns {{ top: THREE.Vector3, dir: THREE.Vector3 }} the shoot's tip, and which way it points
 */
export function sprout(bag, o) {
	const r = chance(o.seed, 'sprout');
	// the hook bends across the viewer's first look (from the front right), so its arch is seen, not end-on
	const bearing = Math.atan2(-0.9, 1.25) + (r() * 2 - 1) * 0.4;
	// the hook bends over in one vertical plane, toward the bearing
	const across = v3(Math.cos(bearing), 0, Math.sin(bearing));
	const axis = new THREE.Vector3().crossVectors(across, v3(0, 1, 0)).normalize();
	const lean = (r() * 2 - 1) * 0.12;
	const steps = 14;
	/** @type {THREE.Vector3[]} */
	const path = [o.at.clone()];
	let dir = v3(0, 1, 0).addScaledVector(across, lean).normalize();
	const step = Math.max(1e-6, o.stem / steps);
	for (let i = 0; i < steps; i++) {
		const u = (i + 0.5) / steps;
		// the last third curls over as far as the hook is bent
		const bend = u > 0.62 ? (o.hook * Math.PI * 0.95) / (steps * 0.38) : 0;
		dir = dir.clone().applyAxisAngle(axis, -bend).normalize();
		path.push(path[i].clone().addScaledVector(dir, step));
	}
	const top = path[steps];
	const tip = path[steps].clone().sub(path[steps - 1]).normalize();
	if (o.stem > o.radius * 0.5) bag.add('body', tube(path, (u) => o.radius * (1 - 0.25 * u), (u) => mix('#e9e3c8', o.stemColor, 0.35 + u * 0.65), 6));

	// the seed coat: the seed itself before it opens, then a husk round the seed leaves until it is shed
	const coatAt = o.keepCoat ? o.at : top;
	if (o.shed < 1) {
		const s = o.size.clone().multiplyScalar(1 - 0.25 * o.shed);
		const turn = new THREE.Quaternion().setFromUnitVectors(v3(1, 0, 0), o.keepCoat || o.stem < o.radius ? across : tip);
		const lift = o.keepCoat ? v3(0, 0, 0) : tip.clone().multiplyScalar(o.size.x * 0.6);
		bag.add('body', bead(coatAt.clone().add(lift), s, mix(o.coat, o.coatShade, o.shed), 7, turn));
	}

	// the two seed leaves: folded together along the tip while in the coat, then opened out to each side
	if (o.wither < 1 && o.stem > o.radius) {
		const shrink = 1 - 0.45 * o.wither;
		const grown = lerp(0.35, 1, clamp(o.open * 1.3));
		for (const side of [-1, 1]) {
			const spread = lerp(0.08, 1.35 + (r() - 0.5) * 0.2, o.open) + o.wither * 0.35;
			const d = tip.clone().multiplyScalar(Math.cos(spread)).addScaledVector(across, side * Math.sin(spread)).normalize();
			const len = o.leaf.length * grown * shrink;
			const leaf = sheet({
				length: len,
				width: o.leaf.width * grown * shrink,
				shape: o.leaf.shape,
				lift: (u, v) => 0.06 * v * v - 0.05 * u * u * (1 + o.wither * 4),
				paint: (u, v) => mix(mix(o.leaf.color, o.leaf.vein, Math.abs(v) < 0.12 ? 0.6 : 0), '#d9c45a', o.wither * 1.2 - 0.1 + u * o.wither * 0.4),
				along: 10,
				across: 6
			});
			// the face toward the light once open; folded face to face before
			bag.add('sheet', leaf, aim(top, d, side * (1 - o.open) * 1.4));
		}
	}
	return { top, dir: tip };
}
