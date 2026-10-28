/*
 * BLOOM — a flower of the rose family and its kin: petals round a centre, sepals behind them, a ring of stamens. The
 * strawberry's white flower, the raspberry's small white one with its sepals bent back, the tomato's yellow star.
 * Built facing up (+Y), then turned to face where it looks; it opens, and then (falling) its petals drop.
 */
import * as THREE from 'three';
import { bead, lerp, mix, sheet, v3 } from './grow.js';

/**
 * @typedef {{
 *   petals: number, length: number, width: number, colour: string, heart: string, shape?: (u: number) => number,
 *   sepals?: number, sepal?: number, sepalColour?: string, sepalBack?: number, stamens?: number, stamenColour?: string,
 *   cone?: boolean, flat?: number
 * }} Kind — `sepalBack` how far the sepals bend back (radians), `cone` a tomato's cone of anthers in place of a
 *   cushion, `flat` how far the open petals lie back (0 level, more for a reflexed star)
 */

/**
 * @param {import('./grow.js').Bag} bag
 * @param {Kind} kind
 * @param {THREE.Vector3} at @param {THREE.Vector3} facing @param {number} size
 * @param {number} open 0 … 1 the bud opening @param {number} fall 0 … 1 the petals dropping
 */
export function bloom(bag, kind, at, facing, size, open, fall) {
	const m = new THREE.Matrix4().compose(at, new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), facing.clone().normalize()), v3(size, size, size));
	const turn = (/** @type {number} */ a, /** @type {number} */ up) => new THREE.Matrix4().makeRotationY(-a).multiply(new THREE.Matrix4().makeRotationZ(up));
	const sepals = kind.sepals ?? 10;
	for (let k = 0; k < sepals; k++) {
		const sepal = sheet({
			length: (kind.sepal ?? 0.008) * (sepals > 6 && k % 2 ? 0.75 : 1),
			width: (kind.sepal ?? 0.008) * 0.22,
			shape: (u) => Math.sin(Math.PI * Math.pow(u, 0.6)) * (1 - u * 0.6),
			lift: (u) => -0.15 * u,
			paint: () => kind.sepalColour ?? '#5f8f34',
			along: 6,
			across: 2
		});
		bag.add('sheet', sepal, m.clone().multiply(turn((k / sepals) * Math.PI * 2 + 0.3, -(kind.sepalBack ?? 0.25) * lerp(0.3, 1, open))));
	}
	if (fall < 1) {
		const shape = kind.shape ?? ((/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.62)), 0.55));
		for (let k = 0; k < kind.petals; k++) {
			const petal = sheet({
				length: kind.length * lerp(0.4, 1, open),
				width: kind.width * lerp(0.4, 1, open),
				shape,
				lift: (u, v) => 0.12 * u * u + 0.04 * v * v,
				paint: (u) => mix(kind.colour, '#fffdf6', kind.colour.startsWith('#f') ? u * 0.4 : 0),
				along: 10,
				across: 6
			});
			// opening from upright to flat (or bent back), then drooping back and away as it falls
			const up = lerp(1.25, 0.12 - (kind.flat ?? 0), open) - fall * 0.9;
			bag.add('sheet', petal, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.0006, 0)).multiply(turn((k / kind.petals) * Math.PI * 2, up)).multiply(new THREE.Matrix4().makeScale(1 - fall * 0.6, 1, 1 - fall * 0.6)));
		}
	}
	if (kind.cone) {
		// the tomato's anthers, fused into a yellow cone round the style
		bag.add('body', bead(v3(0, 0.003, 0).applyMatrix4(m), v3(0.0018, 0.0042, 0.0018).multiplyScalar(size), fall > 0.5 ? '#a99a3a' : kind.heart, 6));
		return;
	}
	bag.add('body', bead(v3(0, 0.0012, 0).applyMatrix4(m), v3(0.0034, 0.0022, 0.0034).multiplyScalar(size), fall > 0.5 ? '#bfc35a' : kind.heart, 8));
	const stamens = kind.stamens ?? 20;
	for (let k = 0; k < stamens; k++) {
		const a = (k / stamens) * Math.PI * 2;
		bag.add('body', bead(v3(Math.cos(a) * 0.0042, 0.0018, Math.sin(a) * 0.0042).applyMatrix4(m), v3(0.0006, 0.0006, 0.0006).multiplyScalar(size), fall > 0.5 ? '#9c7a3a' : (kind.stamenColour ?? '#e9b52a'), 2));
	}
}
