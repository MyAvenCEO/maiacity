/*
 * LEGACY — Sandbox 4's stand-in plants (./plants.ts) traded, in Sandbox 5, for the plants of our own library
 * ($lib/plants, drawn by ./flora.js) in the same places. Every stand-in says what it is (`userData.legacy`): a bed of a
 * crop becomes a row of that crop, a tuft of herbs a kitchen herb, a potted olive the library's olive in the same pot,
 * a vine along a balcony rail grapevines, a pergola's vines grapevines up its posts, a shrub or a fruit tree its kind.
 * The pots, the posts and the beds' soil stay; the stand-ins go.
 */
import * as THREE from 'three';

/** @typedef {import('./flora.js').Forest} Forest */
/** @typedef {import('./flora.grow.js').Kind} Kind */
/** @typedef {import('./flora.js').Reach} Reach */

/** the herbs a tuft of herbs becomes */
const HERBS = ['basil', 'parsley', 'chives', 'thyme', 'oregano', 'mint', 'coriander', 'lemon-balm'];
/** a crop of the stand-in beds, as the library has it; and how close it is sown (metres), in how many rows */
const CROPS = /** @type {Record<string, { id: string, gap: number, rows: number[], reach: Reach }>} */ ({
	lettuce: { id: 'lettuce', gap: 0.32, rows: [-0.3, 0, 0.3], reach: 'cover' },
	radish: { id: 'radish', gap: 0.16, rows: [-0.25, 0, 0.25], reach: 'cover' },
	kale: { id: 'kale', gap: 0.45, rows: [-0.22, 0.22], reach: 'cover' },
	chard: { id: 'chard', gap: 0.4, rows: [-0.22, 0.22], reach: 'cover' },
	strawberry: { id: 'strawberry', gap: 0.35, rows: [-0.22, 0.22], reach: 'cover' },
	herbs: { id: 'herbs', gap: 0.3, rows: [-0.25, 0.25], reach: 'cover' },
	pepper: { id: 'pepper', gap: 0.45, rows: [-0.2, 0.2], reach: 'cover' },
	aubergine: { id: 'eggplant', gap: 0.55, rows: [0], reach: 'shrub' },
	tomato: { id: 'tomato', gap: 0.6, rows: [0], reach: 'shrub' },
	cucumber: { id: 'cucumber', gap: 0.6, rows: [0], reach: 'shrub' },
	beans: { id: 'beans', gap: 0.5, rows: [0], reach: 'shrub' }
});

/**
 * Trades every stand-in plant under `root` for library plants put down in `forest`, in `space`'s ground (the scene the
 * forest is drawn in: the village's, or a dome's own). Under glass (`warm`) a shrub becomes coffee, outside a currant.
 * The library plants are all at their first version, the one Sandbox 5 was planted with.
 * @param {THREE.Object3D} root @param {THREE.Object3D} space @param {Forest} forest
 * @param {{ warm: boolean, seed: string, r: () => number }} o
 * @returns {number} how many stand-ins were traded
 */
export function swapLegacy(root, space, forest, { warm, seed, r }) {
	root.updateMatrixWorld(true);
	// the stand-ins' places in the space's own ground: the space's own place taken off when root stands in it
	let top = root;
	while (top.parent) top = top.parent;
	const off = top === space ? new THREE.Matrix4().copy(space.matrixWorld).invert() : new THREE.Matrix4();
	/** @type {THREE.Object3D[]} */
	const found = [];
	root.traverse((o) => {
		if (o.userData.legacy && !found.some((f) => isUnder(o, f))) found.push(o);
	});
	const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
	const at = new THREE.Vector3();
	/** @param {string} id @param {number[]} stages @param {Reach} reach @param {THREE.Vector3} w @param {number} scale */
	const add = (id, stages, reach, w, scale) => {
		const stage = stages[Math.min(stages.length - 1, Math.floor(r() * stages.length))];
		forest.add({ id, v: 1, stage, seed }, reach, w.x, w.y, w.z, r() * Math.PI * 2, scale * (0.9 + r() * 0.2));
	};
	for (const o of found) {
		const L = o.userData.legacy;
		m.multiplyMatrices(off, o.matrixWorld);
		m.decompose(p, q, s);
		/** a point in the stand-in's own frame, in the space's ground @param {number} x @param {number} y @param {number} z */
		const local = (x, y, z) => at.set(x, y, z).applyMatrix4(m);
		if ('crop' in L) {
			const c = CROPS[L.crop] ?? CROPS.herbs;
			for (let u = -L.len / 2 + c.gap / 2; u < L.len / 2; u += c.gap)
				for (const row of c.rows) add(c.id === 'herbs' ? HERBS[Math.floor(r() * HERBS.length)] : c.id, [7, 9], c.reach, local(u + (r() - 0.5) * 0.06, 0, row), 1);
			o.removeFromParent();
		} else if ('herb' in L) {
			add(HERBS[Math.floor(r() * HERBS.length)], [7, 9], 'cover', p, Math.min(1.4, (L.herb / 0.3) * 0.9));
			o.removeFromParent();
		} else if ('potted' in L) {
			const big = L.potted === 'olive' || L.potted === 'lemon';
			add(L.potted, big ? [4] : [9], 'shrub', local(0, L.ph, 0), big ? 0.55 * L.size : 0.8 * L.size);
			// the pot and its rim stay
			for (const child of o.children.slice(2)) child.removeFromParent();
		} else if ('vine' in L) {
			// grapevines along the rail, from the balcony's floor a rail's height below
			for (let u = -L.vine / 2 + 0.6; u < L.vine / 2; u += 1.3) add('grape', [7, 9], 'shrub', local(u, -1.05, 0), 0.8);
			o.removeFromParent();
		} else if ('pergola' in L) {
			const { w, d } = L.pergola;
			for (const sx of [-1, 1]) add('grape', [7, 9], 'shrub', local((sx * w) / 2, 0, d / 2), 1);
			o.removeFromParent();
		} else if ('plant' in L) {
			const k = L.plant;
			if (k === 'shrub') add(warm ? 'coffee' : 'blackcurrant', [7, 9], 'shrub', p, 0.9 * L.size);
			else if (k === 'berry') add(warm ? 'pepper' : 'redcurrant', [7, 9], 'shrub', p, L.size);
			else if (k === 'banana') add('banana', [5, 7, 9], 'tree', p, Math.min(1, 0.85 * L.size));
			else add(k === 'citrus' ? (r() < 0.5 ? 'lemon' : 'orange') : k, [7, 9], 'tree', p, Math.min(1.1, 0.9 * L.size));
			o.removeFromParent();
		}
	}
	return found.length;
}

/** whether o is f or under it @param {THREE.Object3D} o @param {THREE.Object3D} f */
function isUnder(o, f) {
	for (let x = /** @type {THREE.Object3D | null} */ (o); x; x = x.parent) if (x === f) return true;
	return false;
}
