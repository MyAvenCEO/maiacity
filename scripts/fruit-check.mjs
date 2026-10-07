// Lists, for every plant (or those named), how many fruit it draws when grown ripe (Bag.fruit … fruitDone in
// src/lib/plants), and how big the first one is: `bun scripts/fruit-check.mjs [id …]`.
import * as THREE from 'three';
import { PLANTS } from '../src/lib/plants/index.js';
import { pickFruit } from '../src/lib/plants/grow.js';

const want = process.argv.slice(2);
for (const p of PLANTS) {
	if (want.length && !want.includes(p.id)) continue;
	const t = performance.now();
	const { fruits } = pickFruit(() => p.grow(p.stages.length - 1, 'maia'));
	const keys = new Set(fruits.map((f) => f.key));
	let size = '';
	if (fruits.length) {
		const b = new THREE.Box3();
		for (const part of fruits[0].parts) b.union(new THREE.Box3().setFromBufferAttribute(part.geometry.attributes.position));
		const s = b.getSize(new THREE.Vector3());
		size = `${(s.x * 100).toFixed(1)} × ${(s.y * 100).toFixed(1)} × ${(s.z * 100).toFixed(1)} cm`;
	}
	console.log(`${p.id.padEnd(22)} ${String(fruits.length).padStart(4)} fruit${keys.size !== fruits.length ? ` (${fruits.length - keys.size} keys repeated!)` : ''}  ${size}  ${Math.round(performance.now() - t)} ms`);
}
