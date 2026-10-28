/*
 * The models' shared parts: materials made once and shared by every copy, and the shapes every model is built from —
 * a box (`part`), a box with soft edges (`soft`), a round bar from one point to another (`bar`).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const shared = <T>(make: () => T) => {
	let v: T | undefined;
	return () => (v ??= make());
};
export const std = (color: string, roughness = 0.8, more: THREE.MeshStandardMaterialParameters = {}) => shared(() => new THREE.MeshStandardMaterial({ color, roughness, ...more }));
/** cloth: soft, a sheen at grazing angles as woven fabric has */
export const cloth = (color: string, sheen = '#ffffff') => shared(() => new THREE.MeshPhysicalMaterial({ color, roughness: 0.92, sheen: 1, sheenRoughness: 0.75, sheenColor: new THREE.Color(sheen) }));

/** A part: a box at its place, casting shadows (and catching them, unless `catches` is false). */
export function part(g: THREE.Group, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, catches = true) {
	const p = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
	p.position.set(x, y, z);
	p.castShadow = true;
	p.receiveShadow = catches;
	g.add(p);
	return p;
}
/** A soft part: a box with rounded edges (a mattress, a pillow, a seat). */
export function soft(g: THREE.Group, w: number, h: number, d: number, radius: number, m: THREE.Material, x: number, y: number, z: number) {
	const p = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, Math.min(radius, w / 2, h / 2, d / 2)), m);
	p.position.set(x, y, z);
	p.castShadow = p.receiveShadow = true;
	g.add(p);
	return p;
}
/** A round bar from a to b (a leg, a tube, a spindle). */
export function bar(g: THREE.Group, a: THREE.Vector3, b: THREE.Vector3, r0: number, m: THREE.Material, r1 = r0) {
	const len = a.distanceTo(b);
	const p = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 12), m);
	p.position.copy(a).add(b).multiplyScalar(0.5);
	p.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
	p.castShadow = true;
	g.add(p);
	return p;
}
export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
