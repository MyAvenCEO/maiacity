/*
 * FLORA — a world's forest of our own plants ($lib/plants), as many thousands of them as a dome cell holds, drawn by the
 * universal renderer ($lib/assets/render, through ./drawn.js `createFlora`): every kind of plant (a plant at its
 * version, stage and seed: an apple tree in flower, a ripe pumpkin) built in the asset box,
 * `plants/<id>@<v>?stage=<s>&seed=<seed>`, at the two details Sandbox 4 has always drawn its plants at (0.25 near you,
 * 0.1 further off: `DETAILS`, ./sandbox5.js `TIERS`), and further still as a picture of itself; every plant of a kind one
 * more copy of it, all of them drawn in a handful of draw calls. Nothing of a plant runs here: what the box made is
 * data, checked, and the renderer draws it.
 *
 * What the world decides, here: where every plant stands; how far off each reach of plants is drawn at all (a tree
 * always, a shrub to the middle distance, the small plants only near you), the ones within it put down as copies as the
 * eye walks; and where each kind changes its detail. The renderer draws a kind by how big it looks; Sandbox 4 has always
 * changed a plant's detail at its own distances for each reach (`VILLAGE`, and nearer under the glass, `INSIDE`), so
 * each kind is told the sizes it looks at there (`Flora.tune`) and changes where it always did. What the renderer
 * decides: the level each copy is drawn at, frame by frame, the coarser fading in under the finer, and that nothing
 * behind the eye is drawn.
 *
 * A forest is a list of plants put somewhere (`add`); `grown` waits for their kinds (each its coarsest shape first) and
 * puts the trees down; `update` keeps the small plants round the eye; the renderer's own update (`Flora.update`, the
 * world's, before every frame) draws them. Its plants are measured off their builds (how tall, how far they reach, how
 * thick at the foot: for the walker, the birds and the picked plant's ring) and found by a ray (`pick`) against their
 * own shapes.
 *
 * Nothing here loads the renderer: a dome's inside (./interior.ts) is handed the flora it plants in by whoever builds it.
 */
import * as THREE from 'three';
import { MAIA_CITY } from '../../../../game/code/sources/anchor.js';
import { NotInVault, pinRef } from '../../assets/sources/avendb.js';
import { TIERS } from './sandbox5.js';

/** @typedef {import('./sandbox5.js').Kind} Kind */
/**
 * @typedef {'tree' | 'shrub' | 'cover'} Reach how far off a plant is still drawn: a tree always (far off as its picture),
 *   a shrub to the middle distance, the cover (herbs, vegetables, the ground layer) only near you
 */
/** @typedef {Record<Reach, [number, number]>} Reaches for each reach: to how far (m) it is drawn finely, and coarsely */
/**
 * @typedef {{ height: number, reach: number, foot: number, leaf: [number, number, number] }} Shape a kind's measure, off
 *   its build: how tall it stands, how far it reaches out over the ground, how thick it is at its foot (its trunk or its
 *   clump), and the colour of its leaves
 */
/**
 * @typedef {{
 *   reach: Reaches,
 *   use: (ref: string, shadows?: boolean, picture?: boolean) => any,
 *   take: (k: any, at: { x: number, y: number, z: number, turn: number, scale: number }) => any,
 *   give: (c: any) => void,
 *   tune: (k: any, r: Reach) => void,
 *   assets: { stats: () => { tris: number } }
 * }} FloraDrawn the renderer a forest's plants are drawn by (./drawn.js `createFlora`), at its distances
 */

/** the details a plant is built at for a world: as Sandbox 4 has always grown its near and its far plants */
export const DETAILS = [TIERS.near.level, TIERS.mid.level];
/** the village's own distances (Sandbox 4's flora: its trees fine to 16 m, coarse to 40 m, a picture beyond) */
export const VILLAGE = /** @type {Reaches} */ ({ tree: [16, 40], shrub: [10, 26], cover: [6, 13] });
/** under a dome's glass, nearer and so finer */
export const INSIDE = /** @type {Reaches} */ ({ tree: [28, 75], shrub: [16, 40], cover: [9, 22] });

/** A plant's key, for a forest to know it by. @param {Kind} k */
export const keyOf = (k) => `${k.id}@${k.v}:${k.stage}:${k.seed}`;
/**
 * A kind as the asset it is built from and its values: by its pin alone, the plant's entry in the Maia City vault and
 * the heads of its version (Samuel 2026-10-20, 2026-10-22: no old ref stands behind it). Throws NotInVault for a kind
 * the garden pins no version of. @param {Kind} k
 */
export const refOf = (k) => {
	if (!k.pin) throw new NotInVault(`the garden pins no version of ${k.id} (configs/sandbox-4/garden)`);
	return pinRef({ vault: MAIA_CITY, ...k.pin }, `stage=${k.stage}&seed=${encodeURIComponent(k.seed)}`);
};

/** the side of a cell of the ground the small plants are filed in, metres */
const CELL = 8;
/** a cell's key @param {number} ix @param {number} iz */
const cellKey = (ix, iz) => (ix + 4096) * 8192 + (iz + 4096);

/**
 * A kind's measure, off the shape it was built at: everything over the soil (what is under it no one walking a forest
 * sees), its wood (the body, drawn on one side) at its foot, its leaves and petals (drawn on both).
 * @param {any} level the renderer's level (its drawings, each at its places) @returns {Shape}
 */
function measure(level) {
	let height = 0, reach = 0, foot = 0, leaves = 0;
	const leaf = [0, 0, 0];
	const v = new THREE.Vector3(), m = new THREE.Matrix4();
	for (const d of level.draws) {
		const sheet = d.material.side === THREE.DoubleSide, body = !sheet && !d.material.isMeshPhysicalMaterial;
		const P = d.geometry.attributes.position, C = d.geometry.attributes.color;
		for (let k = 0; k < d.n; k++) {
			m.fromArray(d.locals, k * 16);
			for (let i = 0; i < P.count; i++) {
				v.fromBufferAttribute(P, i).applyMatrix4(m);
				if (v.y > height) height = v.y;
				const h = Math.hypot(v.x, v.z);
				if (v.y > 0 && h > reach) reach = h;
				if (body && v.y > 0.05 && v.y < 0.5 && h < 0.8 && h > foot) foot = h;
				if (sheet && C) {
					leaf[0] += C.getX(i);
					leaf[1] += C.getY(i);
					leaf[2] += C.getZ(i);
					leaves++;
				}
			}
		}
	}
	const n = Math.max(1, leaves);
	return { height, reach, foot: foot || reach * 0.4, leaf: leaves ? [leaf[0] / n, leaf[1] / n, leaf[2] / n] : [0.3, 0.45, 0.2] };
}

/**
 * @typedef {{
 *   kind: Kind, reach: Reach, n: number, add: number[], k?: any, shape?: Shape,
 *   x?: Float32Array, y?: Float32Array, z?: Float32Array, turn?: Float32Array, scale?: Float32Array,
 *   copies?: (any | null)[], cells?: Map<number, number[]>, placed?: number[]
 * }} Stand all the plants of one kind in a forest: where each stands, its turn and its size; the copy drawing each one
 *   (none while it is left out); the small ones filed by their cell of the ground
 */

/**
 * A forest: plants put down in it, drawn as you see them. Its plants stand in its own ground, which lies at `origin` in
 * the world the renderer draws (a dome's inside, in its own ground, stands off the village's middle); `hidden`, none of
 * them drawn until it is shown (a dome's inside, until it joins the world).
 * @param {{ flora: FloraDrawn, origin?: [number, number, number], hidden?: boolean }} o
 */
export function createForest(o) {
	const { flora } = o;
	const [ox, oy, oz] = o.origin ?? [0, 0, 0];
	/** @type {Map<string, Stand>} */
	const stands = new Map();
	/** the circles of ground whose plants are not drawn (a dome whose own full forest is shown there) */
	/** @type {{ x: number, z: number, r: number }[]} */
	let masked = [];
	let hidden = !!o.hidden, dirty = true, gone = false;
	const last = { x: Infinity, z: Infinity };
	const at = { x: 0, y: 0, z: 0, turn: 0, scale: 1 };

	/**
	 * A plant put down at x, z (on the ground at y), turned by `turn`, at `scale` of its kind's size.
	 * @param {Kind} kind @param {Reach} reach @param {number} x @param {number} y @param {number} z @param {number} turn @param {number} scale
	 */
	function add(kind, reach, x, y, z, turn, scale) {
		const key = keyOf(kind);
		let st = stands.get(key);
		if (!st) stands.set(key, (st = { kind, reach, n: 0, add: [] }));
		st.add.push(x, y, z, turn, scale);
		st.n++;
		dirty = true;
	}

	/** the kinds this forest has */
	const kinds = () => [...stands.values()].map((st) => st.kind);

	const isMasked = (/** @type {number} */ x, /** @type {number} */ z) => masked.some((m) => (x - m.x) ** 2 + (z - m.z) ** 2 < m.r * m.r);
	/** plant i of a stand where the world draws it @param {Stand} st @param {number} i */
	const where = (st, i) => {
		at.x = /** @type {Float32Array} */ (st.x)[i] + ox;
		at.y = /** @type {Float32Array} */ (st.y)[i] + oy;
		at.z = /** @type {Float32Array} */ (st.z)[i] + oz;
		at.turn = /** @type {Float32Array} */ (st.turn)[i];
		at.scale = /** @type {Float32Array} */ (st.scale)[i];
		return at;
	};
	/** plant i drawn, or not @param {Stand} st @param {number} i @param {boolean} on */
	const draw = (st, i, on) => {
		const copies = /** @type {(any | null)[]} */ (st.copies);
		if (on && !copies[i]) copies[i] = flora.take(st.k, where(st, i));
		else if (!on && copies[i]) {
			flora.give(copies[i]);
			copies[i] = null;
		}
	};

	/**
	 * Builds every kind of the forest (in the asset box, its coarsest shape first, side by side) and puts its trees down;
	 * `onKind` hears each kind as it is ready.
	 * @param {(done: number, of: number) => void} [onKind]
	 */
	async function grown(onKind) {
		const list = [...stands.values()];
		let done = 0;
		await Promise.all(
			list.map(async (st) => {
				let k = null;
				try {
					// a tree casts its shadow at every level and far off as its picture; the small plants cast none, and are
					// left out before they would ever be a picture
					const tree = st.reach === 'tree';
					k = flora.use(refOf(st.kind), tree, tree);
					await k.ready;
				} catch (err) {
					k = { error: String(/** @type {Error} */ (err)?.message ?? err) };
				}
				if (gone) return;
				if (k.error) {
					// a kind that will not build (a plant or a version the library has not got) leaves its places empty
					console.warn(`flora: ${keyOf(st.kind)} did not grow: ${k.error}`);
					onKind?.(++done, list.length);
					return;
				}
				st.k = k;
				st.shape = measure(k.levels[k.base].level);
				flora.tune(k, st.reach);
				// where each stands, packed; and the small ones filed by their cell of the ground
				const n = st.n, a = st.add;
				st.x = new Float32Array(n);
				st.y = new Float32Array(n);
				st.z = new Float32Array(n);
				st.turn = new Float32Array(n);
				st.scale = new Float32Array(n);
				st.copies = new Array(n).fill(null);
				if (st.reach !== 'tree') {
					st.cells = new Map();
					st.placed = [];
				}
				for (let i = 0; i < n; i++) {
					st.x[i] = a[i * 5];
					st.y[i] = a[i * 5 + 1];
					st.z[i] = a[i * 5 + 2];
					st.turn[i] = a[i * 5 + 3];
					st.scale[i] = a[i * 5 + 4];
					if (st.cells) {
						const key = cellKey(Math.floor(st.x[i] / CELL), Math.floor(st.z[i] / CELL));
						let cell = st.cells.get(key);
						if (!cell) st.cells.set(key, (cell = []));
						cell.push(i);
					}
				}
				st.add = [];
				// every tree stands from the start, however far off (as its picture); the rest come as the eye nears them
				if (!st.cells && !hidden) for (let i = 0; i < n; i++) if (!isMasked(st.x[i], st.z[i])) draw(st, i, true);
				onKind?.(++done, list.length);
			})
		);
		dirty = true;
	}

	/** the plants of a stand within `far` of x, z, by their cells @param {Stand} st @param {number} x @param {number} z @param {number} far @param {(i: number) => void} each */
	const within = (st, x, z, far, each) => {
		const cells = /** @type {Map<number, number[]>} */ (st.cells);
		const span = Math.ceil(far / CELL), cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
		for (let i = -span; i <= span; i++) for (let j = -span; j <= span; j++) for (const k of cells.get(cellKey(cx + i, cz + j)) ?? []) each(k);
	};

	/** marks: which plants of a small stand stand within reach now */
	let mark = new Uint32Array(0), epoch = 0;
	/**
	 * Puts down the small plants within their reach of the eye at x, z (in the forest's own ground), and takes away the
	 * ones that fell out of it. Cheap when nothing has changed: chosen again only once the eye has moved a little.
	 * @param {number} x @param {number} z
	 */
	function update(x, z) {
		if (hidden || gone || (!dirty && Math.hypot(x - last.x, z - last.z) < 2)) return;
		dirty = false;
		last.x = x;
		last.z = z;
		for (const st of stands.values()) {
			if (!st.cells || !st.k) continue;
			const far = flora.reach[st.reach][1];
			const X = /** @type {Float32Array} */ (st.x), Z = /** @type {Float32Array} */ (st.z), placed = /** @type {number[]} */ (st.placed);
			if (mark.length < st.n) mark = new Uint32Array(Math.max(st.n, mark.length * 2));
			const now = ++epoch;
			within(st, x, z, far, (i) => {
				if (Math.hypot(X[i] - x, Z[i] - z) >= far || isMasked(X[i], Z[i])) return;
				mark[i] = now;
				if (!(/** @type {any[]} */ (st.copies)[i])) {
					draw(st, i, true);
					placed.push(i);
				}
			});
			let w = 0;
			for (const i of placed) {
				if (mark[i] === now) placed[w++] = i;
				else draw(st, i, false);
			}
			placed.length = w;
		}
	}

	/**
	 * Leaves out every plant standing in these circles of ground (in the forest's own), until the next mask: the trees
	 * at once, the small plants when they are next chosen.
	 * @param {{ x: number, z: number, r: number }[]} list
	 */
	function mask(list) {
		masked = list.slice();
		if (!hidden)
			for (const st of stands.values()) {
				if (st.cells || !st.k) continue;
				const X = /** @type {Float32Array} */ (st.x), Z = /** @type {Float32Array} */ (st.z);
				for (let i = 0; i < st.n; i++) draw(st, i, !isMasked(X[i], Z[i]));
			}
		dirty = true;
	}

	/** every copy taken away (a dome's inside while it is not shown), or put back @param {boolean} on */
	function show(on) {
		if (hidden === !on || gone) return;
		hidden = !on;
		for (const st of stands.values()) {
			if (!st.k) continue;
			if (st.cells) {
				if (!on) {
					for (const i of /** @type {number[]} */ (st.placed)) draw(st, i, false);
					/** @type {number[]} */ (st.placed).length = 0;
				}
				continue;
			}
			const X = /** @type {Float32Array} */ (st.x), Z = /** @type {Float32Array} */ (st.z);
			for (let i = 0; i < st.n; i++) draw(st, i, on && !isMasked(X[i], Z[i]));
		}
		dirty = true;
	}

	/** how many triangles the plants' renderer draws now, for a check on its weight; and how many plants it has */
	const weight = () => flora.assets.stats().tris;
	const plants = () => [...stands.values()].reduce((a, st) => a + st.n, 0);

	/** a mesh to cast rays at one plant's own shape, moved to wherever it stands */
	const probe = new THREE.Mesh();
	const caster = new THREE.Raycaster();
	const M = new THREE.Matrix4(), L = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
	/**
	 * The plant a ray from o along d (in the forest's own ground) meets first, within `far` metres: found by its leaves,
	 * its wood and its fruit, as drawn near you. The plants the ray passes close to (each taken as an upright cylinder as
	 * tall as it is and as wide as it reaches) are tried, nearest first, against their own shapes. Null when it meets none.
	 * @param {THREE.Vector3} o @param {THREE.Vector3} d @param {number} [far]
	 * @returns {{ kind: Kind, x: number, y: number, z: number, height: number, reach: number, t: number } | null}
	 */
	function pick(o, d, far = 45) {
		/** @type {{ st: Stand, i: number, t: number }[]} */
		const near = [];
		const dd = d.x * d.x + d.z * d.z;
		for (const st of stands.values()) {
			if (!st.k || !st.shape) continue;
			const X = /** @type {Float32Array} */ (st.x), Y = /** @type {Float32Array} */ (st.y), Z = /** @type {Float32Array} */ (st.z), S = /** @type {Float32Array} */ (st.scale);
			const shape = st.shape;
			const test = (/** @type {number} */ i) => {
				const cx = X[i] - o.x, cz = Z[i] - o.z;
				if (cx * cx + cz * cz > far * far) return;
				const k = S[i];
				const w = Math.max(0.3, shape.reach * k + 0.2), h = Math.max(0.2, shape.height * k);
				// the stretch of the ray inside the plant's cylinder, if any: where it enters (or 0, from inside)
				let t0 = 0, t1 = far;
				if (dd > 1e-9) {
					const b = -(cx * d.x + cz * d.z), c = cx * cx + cz * cz - w * w;
					const disc = b * b - dd * c;
					if (disc < 0) return;
					t0 = Math.max(0, (-b - Math.sqrt(disc)) / dd);
					t1 = (-b + Math.sqrt(disc)) / dd;
					if (t1 < 0) return;
				} else if (cx * cx + cz * cz > w * w) return;
				const ya = o.y + d.y * t0, yb = o.y + d.y * t1;
				if (Math.max(ya, yb) < Y[i] - 0.1 || Math.min(ya, yb) > Y[i] + h + 0.1) return;
				near.push({ st, i, t: t0 });
			};
			if (st.cells) within(st, o.x, o.z, far, test);
			else for (let i = 0; i < st.n; i++) test(i);
		}
		near.sort((a, b) => a.t - b.t);
		caster.set(o, d.clone().normalize());
		caster.far = far;
		/** @type {{ kind: Kind, x: number, y: number, z: number, height: number, reach: number, t: number } | null} */
		let best = null;
		for (const { st, i, t } of near.slice(0, 40)) {
			// nothing nearer than the one already found can come after it
			if (best && t > best.t) break;
			const k = st.k, X = /** @type {Float32Array} */ (st.x), Y = /** @type {Float32Array} */ (st.y), Z = /** @type {Float32Array} */ (st.z);
			const sc = /** @type {Float32Array} */ (st.scale)[i];
			// its finest shape here, as it is drawn near you
			const level = (k.levels[0].state === 'ready' ? k.levels[0] : k.levels[k.base]).level;
			M.compose(_p.set(X[i], Y[i], Z[i]), _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, /** @type {Float32Array} */ (st.turn)[i]), _s.setScalar(sc));
			for (const dr of level.draws) {
				probe.geometry = dr.geometry;
				probe.material = dr.material;
				for (let j = 0; j < dr.n; j++) {
					probe.matrixWorld.multiplyMatrices(M, L.fromArray(dr.locals, j * 16));
					const hit = caster.intersectObject(probe, false)[0];
					if (hit && (!best || hit.distance < best.t)) {
						const shape = /** @type {Shape} */ (st.shape);
						best = { kind: st.kind, x: X[i], y: Y[i], z: Z[i], height: shape.height * sc, reach: shape.reach * sc, t: hit.distance };
					}
				}
			}
		}
		return best;
	}

	/** The kind's measure, once it is built (how far a plant of it reaches, how thick its foot). @param {Kind} kind */
	const shape = (kind) => stands.get(keyOf(kind))?.shape;

	/** every copy handed back to the renderer's keeping (the renderer is the world's: a village's, shared by its domes) */
	function dispose() {
		gone = true;
		for (const st of stands.values()) for (const c of st.copies ?? []) if (c) flora.give(c);
		stands.clear();
	}

	return { add, kinds, grown, update, weight, plants, shape, pick, mask, show, dispose };
}

/** @typedef {ReturnType<typeof createForest>} Forest */
