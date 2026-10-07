/*
 * THE EURO PALLET — EPAL, 1200 × 800 × 144 mm, as the machines carry it: five top boards, three cross boards under
 * them, nine blocks, three bottom boards; and on it, if it is loaded, cartons stacked to a height and wrapped in film.
 * Built where it is needed, into any actor's rig (the pod's hold, a forklift's forks), its length along x and its
 * 1200 mm side facing ±z, the side the forks go in: between the blocks, the two openings at x ±0.264, 22–100 mm up.
 */
import * as THREE from 'three';
import { block } from './excavator-rig.js';

/** @typedef {import('./rig').V3} V3 */
/** @typedef {(geo: THREE.BufferGeometry, color: string, bone: string, mat?: number) => void} Add */

/** a Euro pallet's length, width and height; the forks' openings: their middles across it (x), bottom and top */
export const PL = 1.2, PW = 0.8, PH = 0.144, FORK_X = 0.264, FORK_Y = [0.022, 0.1];
const WOOD = '#c9a878', WOOD2 = '#b8955f', CRATE = '#b98d55', CRATE2 = '#a87f4c', WRAP = '#dfe3e2';

/**
 * A Euro pallet standing at `at` (the middle of its underside), turned `yaw` about y from lying along x, on `bone`;
 * loaded with cartons to `stack` (m from the floor; 0: empty). The wrap is the actor's material 1 (its glass).
 * @param {Add} add @param {V3} at @param {number} yaw @param {string} bone @param {{ stack?: number }} [o]
 */
export function euroPallet(add, at, yaw, bone, { stack = 1.6 } = {}) {
	const place = new THREE.Matrix4().makeTranslation(...at).multiply(new THREE.Matrix4().makeRotationY(yaw));
	/** @type {Add} */
	const put = (geo, color, b, mat) => add(geo.applyMatrix4(place), color, b, mat);
	for (const [bz, w] of [[-0.3275, 0.145], [-0.16, 0.1], [0, 0.145], [0.16, 0.1], [0.3275, 0.145]]) put(block(PL, 0.022, w, [0, PH - 0.011, bz], 0.004), WOOD, bone);
	for (const bx of [-0.5275, 0, 0.5275]) {
		put(block(0.145, 0.022, PW, [bx, 0.111, 0], 0.004), WOOD2, bone);
		for (const bz of [-0.3275, 0, 0.3275]) put(block(0.145, 0.078, 0.145, [bx, 0.061, bz], 0.006), WOOD2, bone);
	}
	for (const bz of [-0.3275, 0, 0.3275]) put(block(PL, 0.022, 0.1, [0, 0.011, bz], 0.004), WOOD, bone);
	if (stack <= PH) return;
	const top = stack - PH;
	for (let k = 0; k < 3; k++) put(block(PL - 0.02, top / 3 - 0.01, PW - 0.02, [0, PH + (k + 0.5) * (top / 3), 0], 0.02), k % 2 ? CRATE : CRATE2, bone);
	put(block(PL + 0.004, top * 0.7, PW + 0.004, [0, PH + top * 0.5, 0], 0.02), WRAP, bone, 1);
}
