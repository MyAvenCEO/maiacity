/*
 * TREE — a stem that branches: a leader up toward the light, side limbs off it at their places, limbs off those, each
 * drawn from its own chance so that a young tree is the first part of the old one. The eggplant's forked bush and the
 * mango's crown are made of it. Each limb as far as it has grown is handed back (`Limb`), for the plant to set its
 * leaves along it and its flowers and fruit at its tip.
 */
import * as THREE from 'three';
import { between, chance, clamp, mix, tube, v3 } from './grow.js';

/** @typedef {{ pts: THREE.Vector3[], tip: THREE.Vector3, dir: THREE.Vector3, order: number, key: (string | number)[], grown: number, end: boolean, length: number }} Limb */

/**
 * @param {import('./grow.js').Bag} bag
 * @param {{
 *   seed: string, key: (string | number)[], from: THREE.Vector3, dir: THREE.Vector3, length: number, grown: number,
 *   radius: number, up?: number, wander?: number, spread?: number, children?: number, shorten?: [number, number],
 *   depth?: number, order?: number, young: string, old: string, age?: number, out: Limb[], from0?: number, sides?: number
 * }} o — `up` how strongly it turns to the light, `spread` how far its limbs leave it (radians), `children` how many,
 *   `shorten` a limb's length against its parent's, `from0` how far along it the limbs start (0 … 1), `grown` how far
 *   it has grown: past 1 it is full length and the rest goes on into its limbs (a tree of three orders, about 3)
 */
export function limb(bag, o) {
	const r = chance(o.seed, 'limb', ...o.key);
	const grown = clamp(o.grown);
	if (grown <= 0.003) return;
	const order = o.order ?? 0, depth = o.depth ?? 3;
	const up = o.up ?? 0.08, wander = o.wander ?? 0.12;
	const steps = order ? 6 : 10;
	const step = o.length / steps;
	/** the whole path, drawn in full every time */
	const path = [o.from.clone()];
	const dir = o.dir.clone().normalize();
	for (let i = 0; i < steps; i++) {
		dir.y += up;
		dir.x += (r() * 2 - 1) * wander;
		dir.z += (r() * 2 - 1) * wander;
		dir.normalize();
		path.push(path[i].clone().addScaledVector(dir, step));
	}
	const reach = grown * steps;
	/** its growth beyond its own length, for its limbs */
	const reachAll = Math.max(0, o.grown) * steps;
	const whole = Math.floor(reach);
	const pts = path.slice(0, whole + 1);
	if (whole < steps) pts.push(path[whole].clone().lerp(path[whole + 1], reach - whole));
	if (pts.length < 2) return;
	// thickening as it lengthens, a trunk far more than a twig
	const r0 = o.radius * (0.1 + 0.9 * Math.pow(grown, 1.5));
	const age = clamp(o.age ?? 0);
	bag.add('body', tube(pts, (u) => r0 * (1 - 0.65 * u), (u) => mix(o.old, o.young, u * 1.4 - age + 0.4), o.sides ?? (order ? 5 : 8)));
	const tipDir = pts[pts.length - 1].clone().sub(pts[pts.length - 2]).normalize();
	let end = true;
	const n = order < depth ? (o.children ?? 3) : 0;
	const [s0, s1] = o.shorten ?? [0.5, 0.75];
	for (let i = 0; i < n; i++) {
		// the last one carries on from its tip; the others leave it on the way up
		const at = i === n - 1 ? 1 : between(r, o.from0 ?? 0.35, 0.92);
		const turn = r() * Math.PI * 2;
		const tilt = between(r, 0.6, 1) * (o.spread ?? 0.75) * (i === n - 1 ? 0.45 : 1);
		const short = between(r, s0, s1);
		const here = at * steps;
		if (here > reachAll - 0.4) continue;
		if (at === 1) end = false;
		const k = Math.min(steps - 1, Math.floor(here));
		const p = path[k].clone().lerp(path[k + 1], here - k);
		const along = path[k + 1].clone().sub(path[k]).normalize();
		const side = new THREE.Vector3().crossVectors(along, v3(0, 1, 0));
		if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
		side.normalize().applyAxisAngle(along, turn);
		const d = along.clone().applyAxisAngle(side, tilt);
		limb(bag, {
			...o,
			key: [...o.key, i],
			from: p,
			dir: d,
			length: o.length * short,
			grown: (reachAll - here) / (steps * 0.7),
			radius: o.radius * (at === 1 ? 0.75 : 0.6),
			order: order + 1,
			age: age * 0.7
		});
	}
	o.out.push({ pts, tip: pts[pts.length - 1].clone(), dir: tipDir, order, key: o.key, grown, end, length: o.length * grown });
}
