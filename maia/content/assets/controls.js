// @ts-nocheck — plain JS, trusted: runs in the page
/*
 * AN ASSET'S CONTROLS, PLAYED — a tent pitched, a pickup's doors opened, a machine drawn apart or built up, from the
 * numbers the box wrote down when it played its builder's own functions (./box/bake.js) and the page checked
 * (./box/rebuild.js `userData.controls`). Each control is a value from `from` to `to`; at any value its parts stand
 * where the box saw them, between the two samples nearest (their places and sizes blended, their turns turned the
 * short way), shown as at the nearer one. Its own page and the renderer (./render/index.js) play them alike.
 *
 * Several controls may move one part (a machine's explode and its build): the controls at rest are played first, in
 * their order, then the ones moved from it, so the last one moved has the last word.
 *
 * From engine 5 a control also carries the meshes it reshapes (their positions and normals at each sample), the looks
 * of the materials it changes and the lights it changes (./box/bake.js): played the same way, between the two samples
 * nearest. A copy of a build shares its meshes and materials with it (`clone`): `own` gives the copy its own of those
 * its controls change, so that one copy pitched does not pitch them all.
 */
import * as THREE from 'three';
import { LIGHT, MAT, putLight, putLook } from './box/bake.js';

/** what each control is called, by its id; a door by its name */
const LABELS = { pitch: 'Pitched', build: 'Built', explode: 'Drawn apart', open: 'Open', tailgate: 'Tailgate down', lit: 'Lit', wet: 'Wet' };
const DOORS = { driver: "driver's", passenger: "passenger's", rearL: 'rear left', rearR: 'rear right' };

/** a control's name for people @param {string} id */
export function labelOf(id) {
	if (LABELS[id]) return LABELS[id];
	const door = /^door\.(.+)$/.exec(id);
	if (door) return `${DOORS[door[1]] ?? door[1]} door open`.replace(/^./, (c) => c.toUpperCase());
	return id;
}

/** every node of a tree, each before its children: how a control names a part */
export const walk = (root) => {
	const list = [];
	root.traverse((o) => list.push(o));
	return list;
};

/**
 * The controls of an object as the page rebuilt it, or of a copy of that object (`clone`: the same tree, walked the
 * same), ready to play.
 * @param {THREE.Object3D} root
 * @param {object[]} [controls] its controls (`root.userData.controls`; a copy hands the original's)
 * @param {{ own?: boolean }} [o] `own`: a copy's meshes and materials its controls change made its own first
 */
export function poserOf(root, controls = root.userData.controls ?? [], { own = false } = {}) {
	const nodes = walk(root);
	const values = new Map(controls.map((c) => [c.id, c.rest]));
	const q = [0, 0, 0, 1];
	const look = new Float32Array(MAT), light = new Float32Array(LIGHT);
	const mine = new Set();
	for (const c of controls) {
		for (const x of c.shapes ?? []) {
			const o = nodes[x.node];
			if (!o?.geometry) continue;
			if (own && !mine.has(o.geometry)) {
				o.geometry = o.geometry.clone();
				mine.add(o.geometry);
			}
			// reshaped, it reaches past the ball that held it as built
			o.frustumCulled = false;
		}
		if (own)
			for (const x of c.looks ?? []) {
				const o = nodes[x.node];
				const list = Array.isArray(o?.material) ? o.material : o?.material ? [o.material] : [];
				const m = list[x.slot];
				if (!m || mine.has(m)) continue;
				// its own, drawn the same way (a renderer's material keeps the shader code it was given)
				const m2 = m.clone();
				if (Object.hasOwn(m, 'onBeforeCompile')) m2.onBeforeCompile = m.onBeforeCompile;
				if (Object.hasOwn(m, 'customProgramCacheKey')) m2.customProgramCacheKey = m.customProgramCacheKey;
				mine.add(m2);
				if (Array.isArray(o.material)) o.material[x.slot] = m2;
				else o.material = m2;
			}
	}
	/** numbers between two samples, `per` of them each, into `out` */
	const between = (out, A, s0, s1, per, t) => {
		const a = s0 * per, b = s1 * per;
		for (let i = 0; i < per; i++) out[i] = A[a + i] + (A[b + i] - A[a + i]) * t;
	};

	/** a control's parts where they stand at value `v` */
	function play(c, v) {
		const S = c.samples, m = c.nodes.length;
		const at = Math.min(S - 1, Math.max(0, ((v - c.from) / (c.to - c.from)) * (S - 1)));
		const s0 = Math.floor(at), s1 = Math.min(S - 1, s0 + 1), t = c.choice ? Math.round(at - s0) : at - s0;
		const near = t < 0.5 ? s0 : s1;
		const T = c.trs;
		for (let j = 0; j < m; j++) {
			const o = nodes[c.nodes[j]];
			if (!o) continue;
			const a = (s0 * m + j) * 10, b = (s1 * m + j) * 10;
			o.position.set(T[a] + (T[b] - T[a]) * t, T[a + 1] + (T[b + 1] - T[a + 1]) * t, T[a + 2] + (T[b + 2] - T[a + 2]) * t);
			THREE.Quaternion.slerpFlat(q, 0, T, a + 3, T, b + 3, t);
			o.quaternion.fromArray(q);
			o.scale.set(T[a + 7] + (T[b + 7] - T[a + 7]) * t, T[a + 8] + (T[b + 8] - T[a + 8]) * t, T[a + 9] + (T[b + 9] - T[a + 9]) * t);
			o.visible = c.visible[near * m + j] === 1;
			if (!o.matrixAutoUpdate) o.updateMatrix();
		}
		for (const x of c.morph) {
			const o = nodes[x.node], w = o?.morphTargetInfluences;
			if (!w) continue;
			const k = w.length;
			for (let i = 0; i < k; i++) w[i] = x.weights[s0 * k + i] + (x.weights[s1 * k + i] - x.weights[s0 * k + i]) * t;
		}
		for (const x of c.instances) {
			const o = nodes[x.node];
			if (!o?.isInstancedMesh) continue;
			const n = o.count * 16, A = o.instanceMatrix.array, M = x.matrices;
			for (let i = 0; i < n; i++) A[i] = M[s0 * n + i] + (M[s1 * n + i] - M[s0 * n + i]) * t;
			o.instanceMatrix.needsUpdate = true;
		}
		for (const x of c.shapes ?? []) {
			const g = nodes[x.node]?.geometry, p = g?.attributes.position;
			if (!p || x.position.length !== S * p.count * 3) continue;
			between(p.array, x.position, s0, s1, p.count * 3, t);
			p.needsUpdate = true;
			const n = g.attributes.normal;
			if (x.normal && n && x.normal.length === S * n.count * 3) {
				between(n.array, x.normal, s0, s1, n.count * 3, t);
				n.needsUpdate = true;
			}
			g.computeBoundingSphere();
		}
		for (const x of c.looks ?? []) {
			const o = nodes[x.node];
			const m = Array.isArray(o?.material) ? o.material[x.slot] : o?.material;
			if (!m) continue;
			between(look, x.values, s0, s1, MAT, t);
			putLook(m, look, 0);
		}
		for (const x of c.lights ?? []) {
			const o = nodes[x.node];
			if (!o?.isLight) continue;
			between(light, x.values, s0, s1, LIGHT, t);
			putLight(o, light, 0);
		}
	}

	/** a control's value kept, between its ends; whether it has that control */
	function put(id, v) {
		const c = controls.find((x) => x.id === id);
		if (!c || !Number.isFinite(Number(v))) return false;
		const lo = Math.min(c.from, c.to), hi = Math.max(c.from, c.to);
		values.set(id, Math.min(hi, Math.max(lo, Number(v))));
		return true;
	}

	/** every control played: those at rest first, then those moved, in their order */
	function apply() {
		for (const c of controls) if (values.get(c.id) === c.rest) play(c, c.rest);
		for (const c of controls) if (values.get(c.id) !== c.rest) play(c, values.get(c.id));
		root.updateMatrixWorld(true);
	}

	return {
		/** its controls: each its id, its name, its ends, its rest, whether it is a choice */
		list: controls.map((c) => ({ id: c.id, label: labelOf(c.id), from: c.from, to: c.to, rest: c.rest, choice: c.choice })),
		/** a control's value now */
		get: (id) => values.get(id),
		/** a control set to `v` (kept between its ends); its parts moved */
		set(id, v) {
			if (put(id, v)) apply();
		},
		/** several set at once, as `[id, value]` pairs or `{ id: value }`; the others left as they are, the parts moved once */
		setMany(given) {
			let any = false;
			for (const [id, v] of given instanceof Map ? given : Object.entries(given)) any = put(id, v) || any;
			if (any) apply();
		},
		/** every control back at its rest */
		reset() {
			for (const c of controls) values.set(c.id, c.rest);
			apply();
		},
		/** whether any control is away from its rest */
		get moved() {
			return controls.some((c) => values.get(c.id) !== c.rest);
		}
	};
}
