// @ts-nocheck — plain JS, trusted: runs in the page
/*
 * AN ACTOR'S MOVES, PLAYED BACK — the clips of a rigged build as the box wrote them down (./box/clips.js), played in
 * the page by our own code, none of the asset's: for any rigged actor (an animal of a world, a person), any number of
 * copies, each at its own time and as it moves. A clip here is what it is in the actor's own code ($lib/actors/rig.ts
 * `Clip`): the pose at time t (seconds) and, for a gait, how the actor moves (how far it has come, how fast, how fast
 * it turns), the same pose for the same time and motion however often it is asked for, so a film's frame is always
 * the same frame. With `blend` (two poses, turned the short way from one to the other) and `poser` (a copy's bones
 * set to a pose), what a world's crowds need (./render/crowd.js).
 */
import * as THREE from 'three';

/** numbers a bone, as the box writes them: its turn about x, y and z, its size, its offset x, y and z */
const WIDTH = 7;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
/**
 * A table along one axis (time, or distance): its value for list entry q at x, its end running into its start and
 * on, each time round carried on by its drift. Row r of `rows` stacked tables.
 */
function along(A, m, r, q, x) {
	const { n, rate, length, table, drift } = A;
	const lap = Math.floor(x / length);
	const u = (x - lap * length) * rate;
	let i = Math.floor(u);
	if (i >= n) i = n - 1;
	if (i < 0) i = 0;
	const f = u - i, at = r * n * m;
	const v0 = table[at + i * m + q];
	const dr = drift ? drift[r * m + q] : 0;
	const v1 = i + 1 < n ? table[at + (i + 1) * m + q] : table[at + q] + dr;
	return v0 + (v1 - v0) * f + dr * lap;
}

/** one clip's tables, played: the pose at t (and motion m, for a gait) */
function clipOf(c, names) {
	const nb = names.length, nch = c.channels.length;
	const bones = new Map();
	const root = [];
	for (let j = 0; j < nch; j++) {
		const id = c.channels[j], b = Math.floor(id / WIDTH), k = id % WIDTH;
		if (b >= nb) {
			root.push([j, k]);
			continue;
		}
		if (!bones.has(b)) bones.set(b, { name: names[b], list: [], offsets: false });
		const e = bones.get(b);
		e.list.push([j, k]);
		if (k >= 4) e.offsets = true;
	}
	const used = [...bones.values()];
	const rows = c.base.length / nch;
	const rn = c.rch?.length ?? 0;
	const grid = c.turns ? [...c.turns, 0].sort((a, b) => a - b) : null;
	const v = new Float64Array(nch);
	/** rows r and r + 1 (w of the way to it) at t and distance d: the box writes down a pace between two wherever the
	 *  line between them strays from the clip (a leg reaching its full stretch), so a line between them is enough */
	const rowsAt = (r, w, t, d) => {
		const r1 = w > 0 ? r + 1 : r;
		for (let j = 0; j < nch; j++) v[j] = c.base[r * nch + j] + (c.base[r1 * nch + j] - c.base[r * nch + j]) * w;
		// a channel whose rows move out of step (a tail beating faster as it goes) takes the nearer, crossing quickly
		const ws = w <= 0.35 ? 0 : w >= 0.65 ? 1 : ((w - 0.35) / 0.3) ** 2 * (3 - 2 * ((w - 0.35) / 0.3));
		for (const T of c.t) {
			const m = T.list.length;
			for (let q = 0; q < m; q++) {
				const a = along(T, m, r, q, t), k = T.snap[q] ? ws : w;
				v[T.list[q]] += k > 0 ? a + (along(T, m, r1, q, t) - a) * k : a;
			}
		}
		const D = c.d;
		if (!D) return;
		const m = D.list.length;
		for (let q = 0; q < m; q++) {
			const x = d + D.k[q] * t, a = along(D, m, r, q, x);
			v[D.list[q]] += w > 0 ? a + (along(D, m, r1, q, x) - a) * w : a;
		}
	};
	return (t, m) => {
		t = Number.isFinite(t) ? t : 0;
		if (!c.gear) rowsAt(0, 0, t, 0);
		else {
			// as a gait shows on the spot when nothing moves it: at its own pace
			const mo = m ?? { dist: c.gear * t, speed: c.gear };
			const dist = Number.isFinite(mo.dist) ? mo.dist : 0;
			const p = clamp((Number.isFinite(mo.speed) ? mo.speed : 0) / c.gear, c.paces[0], c.paces[c.paces.length - 1]);
			let r = 0;
			while (r < c.paces.length - 2 && p > c.paces[r + 1]) r++;
			const w = rows > 1 ? clamp((p - c.paces[r]) / (c.paces[r + 1] - c.paces[r]), 0, 1) : 0;
			rowsAt(r, w, t, dist);
			// and what turning adds, between the rates of turn written down
			const turn = clamp(Number.isFinite(mo.turn) ? mo.turn : 0, grid[0], grid[grid.length - 1]);
			if (turn && rn) {
				let g = 0;
				while (g < grid.length - 2 && turn > grid[g + 1]) g++;
				const s = (turn - grid[g]) / (grid[g + 1] - grid[g]);
				const D = c.d, per = { n: D.n, rate: D.rate, length: D.length, table: c.turn, drift: null };
				for (const [gi, wgt] of [[g, 1 - s], [g + 1, s]]) {
					const tu = grid[gi];
					if (!tu || !wgt) continue;
					const j = c.turns.indexOf(tu);
					for (let q = 0; q < rn; q++) v[c.rch[q]] += wgt * along(per, rn, j, q, dist);
				}
			}
		}
		const pose = {};
		for (const e of used) {
			const out = e.offsets ? [0, 0, 0, 1, 0, 0, 0] : [0, 0, 0, 1];
			for (const [j, k] of e.list) out[k] = v[j];
			pose[e.name] = out;
		}
		if (root.length) {
			const out = [0, 0, 0];
			for (const [j, k] of root) out[k] = v[j];
			pose.root = out;
		}
		return pose;
	};
}

/**
 * The clips of a build (its view's `clips.motion`, ./box/rebuild.js), each played as a function of time and motion.
 * Its bones by name (`clips.bones`, root first).
 * @param {{ bones: number, clips: Record<string, any> } | undefined} motion
 * @param {string[]} names
 * @returns {Record<string, (t: number, m?: { dist: number, speed: number, turn?: number }) => Record<string, number[]>>}
 */
export function playerOf(motion, names) {
	const out = {};
	if (!motion?.clips || !Array.isArray(names)) return out;
	for (const [name, c] of Object.entries(motion.clips)) out[name] = clipOf(c, names);
	return out;
}

const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), eb = new THREE.Euler();
/**
 * Between two poses: the root's place, and each bone turned t of the way from a to b along the shortest arc, its size
 * and offset between (as $lib/actors/rig.ts `blend`).
 * @param {Record<string, number[]>} a @param {Record<string, number[]>} b @param {number} t
 * @returns {Record<string, number[]>}
 */
export function blend(a, b, t) {
	const out = {};
	for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
		const x = a[name] ?? [0, 0, 0, 1], y = b[name] ?? [0, 0, 0, 1];
		if (name === 'root') {
			out[name] = [0, 1, 2].map((k) => (x[k] ?? 0) + ((y[k] ?? 0) - (x[k] ?? 0)) * t);
			continue;
		}
		qa.setFromEuler(eb.set(x[0] ?? 0, x[1] ?? 0, x[2] ?? 0));
		qb.setFromEuler(eb.set(y[0] ?? 0, y[1] ?? 0, y[2] ?? 0));
		eb.setFromQuaternion(qa.slerp(qb, t));
		const size = (x[3] ?? 1) + ((y[3] ?? 1) - (x[3] ?? 1)) * t;
		const off = [4, 5, 6].map((k) => (x[k] ?? 0) + ((y[k] ?? 0) - (x[k] ?? 0)) * t);
		out[name] = off.some((o) => o !== 0) ? [eb.x, eb.y, eb.z, size, ...off] : [eb.x, eb.y, eb.z, size];
	}
	return out;
}

/**
 * How to pose a copy's bones: from where they rest now, each turned as a pose says (a bone it does not name rests; the
 * root moves the first bone), as $lib/actors/rig.ts `poser`.
 * @param {THREE.Bone[]} list
 */
export function poser(list) {
	const byName = Object.fromEntries(list.map((b) => [b.name, b]));
	const rest = list.map((b) => b.position.clone());
	const move = new THREE.Vector3();
	return (p) => {
		list.forEach((b, i) => {
			b.position.copy(rest[i]);
			b.rotation.set(0, 0, 0);
			b.scale.setScalar(1);
		});
		for (const name in p) {
			const t = p[name];
			if (!t) continue;
			if (name === 'root') list[0].position.add(move.set(t[0], t[1], t[2]));
			else {
				const b = byName[name];
				if (!b) continue;
				b.rotation.set(t[0], t[1], t[2]);
				if (t.length >= 4) b.scale.setScalar(t[3]);
				if (t.length === 7) b.position.add(move.set(t[4], t[5], t[6]));
			}
		}
	};
}
