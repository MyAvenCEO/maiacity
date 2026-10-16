// @ts-nocheck — plain JS, runs inside the box
/*
 * AN ASSET'S CONTROLS AS DATA — what a builder leaves on its object to move it after it is built (a tent's pitch, a
 * pickup's doors, a machine's explode and build) is a function, and no function leaves the box (./serialize.js). So
 * the box plays each one here, from 0 to 1, and writes down where every part it moves stands at each step: its place,
 * turn and size, whether it shows, its blend shapes' weights, its instances. The page plays the control back from
 * those numbers alone (../controls.js), on its own page and in the renderer, as the builder's function would have
 * moved it. A function of one number is all any of our controls is, so nothing is lost but the shortcuts.
 *
 * The controls it knows, by the function on the object's userData (engine 3, the first that bakes them):
 *   setPitch → pitch, setBuild → build, explode → explode, setOpen → open, setTailgate → tailgate,
 *   setDoor(name, k) with `doors` → door.<name> for each, fire.setLit(on) → lit (a choice: off or on).
 * Each is sampled at SAMPLES even steps from 0 to 1, with the object as built put back between controls and after the
 * last; `rest` is the value it was built at (the sample that matches it best). A control that changes the object's
 * tree (adds or takes away a part) cannot be played back from numbers: it is left out, and the object built again.
 */

/** steps a control is sampled at, from 0 to 1: enough to follow a part's turn or flight (our builds ease over a third or more of it) */
export const SAMPLES = 33;
/** the longest the box spends sampling one asset's controls (ms): the rest are left out */
const TIME = 4000;
/** the most numbers one control's tracks may hold */
const MOST = 4_000_000;
const EPS = 1e-5;

/** the controls an object offers: each an id, the function that sets it (0 … 1), how many samples, whether a choice */
function offered(u) {
	const out = [];
	const fn = (f) => (typeof f === 'function' ? f : null);
	const one = (id, set, samples = SAMPLES, choice = false) => set && out.push({ id, set, samples, choice });
	one('pitch', fn(u.setPitch));
	one('build', fn(u.setBuild));
	one('explode', fn(u.explode));
	one('open', fn(u.setOpen));
	one('tailgate', fn(u.setTailgate));
	if (fn(u.setDoor) && u.doors && typeof u.doors === 'object')
		for (const name of Object.keys(u.doors).slice(0, 16)) if (/^[a-zA-Z0-9]{1,24}$/.test(name)) one(`door.${name}`, (k) => u.setDoor(name, k));
	if (u.fire && typeof u.fire === 'object' && fn(u.fire.setLit)) one('lit', (k) => u.fire.setLit(k >= 0.5), 2, true);
	return out;
}

/** every node of the tree, in the order it is walked (each before its children): how a control names a part */
const walk = (root) => {
	const list = [];
	root.traverse((o) => list.push(o));
	return list;
};

/** a node's own place, turn and size, as it stands now (written into `out` at `at`) */
function trsOf(o, out, at) {
	if (!o.matrixAutoUpdate) {
		o.matrix.decompose(o.position, o.quaternion, o.scale);
	}
	const { position: p, quaternion: q, scale: s } = o;
	out[at] = p.x;
	out[at + 1] = p.y;
	out[at + 2] = p.z;
	out[at + 3] = q.x;
	out[at + 4] = q.y;
	out[at + 5] = q.z;
	out[at + 6] = q.w;
	out[at + 7] = s.x;
	out[at + 8] = s.y;
	out[at + 9] = s.z;
}

/** the same place, turn and size: a turn and its negative are one turn */
function sameTrs(a, ai, b, bi) {
	for (const k of [0, 1, 2, 7, 8, 9]) if (Math.abs(a[ai + k] - b[bi + k]) > EPS) return false;
	const dot = a[ai + 3] * b[bi + 3] + a[ai + 4] * b[bi + 4] + a[ai + 5] * b[bi + 5] + a[ai + 6] * b[bi + 6];
	return Math.abs(dot) > 1 - EPS;
}

const same = (a, b) => {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > EPS) return false;
	return true;
};

/** the whole object as it stands: every node's place, whether it shows, its blend shapes, its instances */
function snapshot(nodes) {
	const trs = new Float32Array(nodes.length * 10);
	const visible = new Uint8Array(nodes.length);
	const morph = new Map(), instances = new Map();
	nodes.forEach((o, i) => {
		trsOf(o, trs, i * 10);
		visible[i] = o.visible ? 1 : 0;
		if (o.morphTargetInfluences?.length) morph.set(i, Float32Array.from(o.morphTargetInfluences));
		if (o.isInstancedMesh) instances.set(i, Float32Array.from(o.instanceMatrix.array.subarray(0, o.count * 16)));
	});
	return { trs, visible, morph, instances };
}

/** the object put back as it stood */
function restore(nodes, s) {
	nodes.forEach((o, i) => {
		const t = s.trs, a = i * 10;
		o.position.set(t[a], t[a + 1], t[a + 2]);
		o.quaternion.set(t[a + 3], t[a + 4], t[a + 5], t[a + 6]);
		o.scale.set(t[a + 7], t[a + 8], t[a + 9]);
		if (!o.matrixAutoUpdate) o.matrix.compose(o.position, o.quaternion, o.scale);
		o.visible = s.visible[i] === 1;
		const w = s.morph.get(i);
		if (w) o.morphTargetInfluences.splice(0, w.length, ...w);
		const m = s.instances.get(i);
		if (m) {
			o.instanceMatrix.array.set(m);
			o.instanceMatrix.needsUpdate = true;
		}
	});
}

/** the tree is still the one it was: the same nodes, each under the same parent */
const intact = (root, nodes) => {
	const now = walk(root);
	return now.length === nodes.length && now.every((o, i) => o === nodes[i]);
};

/**
 * Plays an object's controls and writes them down.
 * @param {import('three').Object3D} root an object as its builder made it
 * @returns {{ controls: object[], intact: boolean }} its controls as data, and whether the object is still the one
 *   that was built (false: a control changed its tree; build it again before it leaves)
 */
export function bake(root) {
	const list = offered(root.userData ?? {});
	if (!list.length) return { controls: [], intact: true };
	const nodes = walk(root);
	const rest = snapshot(nodes);
	const t0 = performance.now();
	const controls = [];
	const cur = new Float32Array(10);
	for (const c of list) {
		if (performance.now() - t0 > TIME) break;
		const S = c.samples;
		/** the nodes it moves, by their place in the walk: each its tracks, the samples before it moved filled from rest */
		const moved = new Map();
		const track = (i) => {
			let t = moved.get(i);
			if (!t) {
				t = { trs: new Float32Array(S * 10), visible: new Uint8Array(S), morph: null, instances: null };
				for (let s = 0; s < S; s++) {
					t.trs.set(rest.trs.subarray(i * 10, i * 10 + 10), s * 10);
					t.visible[s] = rest.visible[i];
				}
				moved.set(i, t);
			}
			return t;
		};
		let ok = true;
		/** how far each sample stands from the object as built: the nearest is its rest */
		const off = new Float64Array(S);
		try {
			for (let s = 0; s < S; s++) {
				c.set(s / (S - 1));
				if (nodes.length !== walk(root).length) throw new Error('its tree changed');
				nodes.forEach((o, i) => {
					trsOf(o, cur, 0);
					const vis = o.visible ? 1 : 0;
					const moves = !sameTrs(cur, 0, rest.trs, i * 10) || vis !== rest.visible[i];
					const w = o.morphTargetInfluences?.length ? o.morphTargetInfluences : null;
					const m = o.isInstancedMesh ? o.instanceMatrix.array.subarray(0, o.count * 16) : null;
					// as many blend shapes and instances as it was built with, or it is another thing now
					if ((w?.length ?? 0) !== (rest.morph.get(i)?.length ?? 0) || (m?.length ?? 0) !== (rest.instances.get(i)?.length ?? 0)) throw new Error('its parts changed');
					const bends = w && !same(w, rest.morph.get(i));
					const spreads = m && !same(m, rest.instances.get(i));
					if (moves || bends || spreads || moved.has(i)) {
						const t = track(i);
						t.trs.set(cur, s * 10);
						t.visible[s] = vis;
						if (moves) off[s] += 1;
						if (w && (bends || t.morph)) {
							const r = rest.morph.get(i);
							if (!t.morph) {
								t.morph = new Float32Array(S * r.length);
								for (let k = 0; k < S; k++) t.morph.set(r, k * r.length);
							}
							t.morph.set(w, s * r.length);
							if (bends) off[s] += 1;
						}
						if (m && (spreads || t.instances)) {
							if (!t.instances) {
								const r = rest.instances.get(i);
								t.instances = new Float32Array(S * r.length);
								for (let k = 0; k < S; k++) t.instances.set(r, k * r.length);
							}
							t.instances.set(m, s * (t.instances.length / S));
							if (spreads) off[s] += 1;
						}
					}
				});
			}
		} catch {
			ok = false;
		}
		if (!intact(root, nodes)) return { controls, intact: false };
		restore(nodes, rest);
		if (!ok || !moved.size) continue;
		const order = [...moved.keys()].sort((a, b) => a - b);
		const m = order.length;
		const numbers = order.reduce((a, i) => a + S * 11 + (moved.get(i).morph?.length ?? 0) + (moved.get(i).instances?.length ?? 0), 0);
		if (numbers > MOST) continue;
		const out = { id: c.id, from: 0, to: 1, rest: 0, samples: S, nodes: Uint32Array.from(order), trs: new Float32Array(S * m * 10), visible: new Uint8Array(S * m), morph: [], instances: [] };
		if (c.choice) out.choice = true;
		order.forEach((i, j) => {
			const t = moved.get(i);
			for (let s = 0; s < S; s++) {
				out.trs.set(t.trs.subarray(s * 10, s * 10 + 10), (s * m + j) * 10);
				out.visible[s * m + j] = t.visible[s];
			}
			if (t.morph) out.morph.push({ node: i, weights: t.morph });
			if (t.instances) out.instances.push({ node: i, count: t.instances.length / S / 16, matrices: t.instances });
		});
		// its rest: the sample nearest the object as built; of several as near, an end (a build is whole before its last
		// step, a door shut at 0)
		const least = Math.min(...off);
		const ties = [...off.keys()].filter((s) => off[s] === least);
		const best = ties.includes(S - 1) ? S - 1 : ties[0];
		out.rest = best / (S - 1);
		controls.push(out);
	}
	restore(nodes, rest);
	root.updateMatrixWorld(true);
	return { controls, intact: true };
}
