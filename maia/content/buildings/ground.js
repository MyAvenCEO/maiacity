/*
 * The round ground every building stands on in the Buildings viewer (/app/buildings/): a plain disc of light earth,
 * a grid of 1 m squares on it (every 10 m darker), and a rim — the same for a tent, a dome and a container, with
 * nothing else round them. Made as large as the building needs (`radius`, metres).
 */
import * as THREE from 'three';

/** the lines of a square grid of `step`, cut to a circle of radius `r` @param {number} r @param {number} step */
function lines(r, step) {
	/** @type {number[]} */
	const p = [];
	for (let a = -Math.floor(r / step) * step; a <= r; a += step) {
		const h = Math.sqrt(Math.max(0, r * r - a * a));
		if (h < 1e-3) continue;
		p.push(a, 0, -h, a, 0, h, -h, 0, a, h, 0, a);
	}
	return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
}

/** @param {number} radius @returns {THREE.Group} */
export function roundGround(radius) {
	const r = Math.max(2, radius);
	const g = new THREE.Group();
	g.name = 'round-ground';
	const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 128), new THREE.MeshStandardMaterial({ color: '#ddd6ca', roughness: 1 }));
	disc.rotation.x = -Math.PI / 2;
	disc.receiveShadow = true;
	g.add(disc);
	const fine = new THREE.LineSegments(lines(r, 1), new THREE.LineBasicMaterial({ color: '#c6beb1' }));
	const coarse = new THREE.LineSegments(lines(r, 10), new THREE.LineBasicMaterial({ color: '#a59e92' }));
	fine.position.y = 0.004;
	coarse.position.y = 0.006;
	g.add(fine, coarse);
	const rim = new THREE.Mesh(new THREE.RingGeometry(r - Math.min(0.25, r * 0.02), r, 128), new THREE.MeshBasicMaterial({ color: '#8f887c' }));
	rim.rotation.x = -Math.PI / 2;
	rim.position.y = 0.008;
	g.add(rim);
	g.userData.radius = r;
	return g;
}

/** how large the ground round a building of this footprint is: room to walk round it @param {number} reach half its widest span (m) */
export const groundRadius = (reach) => reach * 1.15 + 3;
