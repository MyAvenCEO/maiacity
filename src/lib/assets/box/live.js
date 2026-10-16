// @ts-nocheck — plain JS, runs inside the box
/*
 * A BUILD KEPT RUNNING — what moves by itself (a machine's solver, an actor's clips, a fire's flames) moves by its own
 * functions, which never leave the box. So a viewer that shows one asks the box to keep a build of it (`open`) and to
 * tick it, frame by frame (`tick`): the box sets what the page asks (the solver's sliders, the controls, the clip and
 * its time, a pose held, the parts drawn apart or flown in), runs one step of it, and hands back only what changed
 * since the last step, as numbers: each node moved (its place, turn and size, by its place in the walk of the tree,
 * the order the page built it in, ./serialize.js), shown or hidden, its blend shapes, its instances; each mesh
 * reshaped, its positions and normals (engine 5), each material's look and each light that changed (./bake.js
 * `MAT`, `LIGHT`: a fire's flicker); and what the solver reads now (its hero number, its labels' readings, its
 * sliders). The page checks them (../hero.js) and puts them on its own copy, which nothing of the box's touches.
 *
 * A session is one build; a box keeps a few (the last ones ticked), and a torn-down box has none (the page then shows
 * its copy standing still).
 */
import { LIGHT, MAT, SLOTS, lightOf, lookOf, materialsOf, offered, reshaped, shapeOf, trsOf } from './bake.js';

/** sessions a box keeps at once: the last ones ticked */
const KEEP = 4;
const EPS = 1e-6;
/** the longest step of time one tick may take (s) */
const LONGEST = 0.25;

const walk = (root) => {
	const list = [];
	root.traverse((o) => list.push(o));
	return list;
};
const finite = (x, or = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : or);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const short = (s, n = 200) => (typeof s === 'string' ? s.slice(0, n) : s == null ? '' : String(s).slice(0, n));

/** @type {Map<number, object>} */
const sessions = new Map();
let next = 1;

/**
 * Keeps a build running. `obj` as its builder made it (`cast` its rig, if it came in one); `nodes` how many nodes the
 * page built of it, which must be this one's (the same recipe, the same values, the same tree).
 * @returns {{ session: number, nodes: number }}
 */
export function open(obj, cast, nodes) {
	const list = walk(obj);
	if (Number.isInteger(nodes) && nodes !== list.length) throw new Error(`built here with ${list.length} nodes, not ${nodes}`);
	const u = obj.userData ?? {};
	const asset = u.asset ?? cast?.asset ?? null;
	const controls = new Map(offered(u).map((c) => [c.id, { ...c, value: null }]));
	// a sealed asset is drawn apart and built up by its own pose, after its solver has stepped
	if (asset) {
		controls.delete('explode');
		controls.delete('build');
	}
	const last = {
		trs: new Float32Array(list.length * 10),
		visible: new Uint8Array(list.length),
		morph: new Map(),
		instances: new Map(),
		looks: new Map(),
		lights: new Map(),
		shapes: new Map()
	};
	list.forEach((o, i) => {
		trsOf(o, last.trs, i * 10);
		last.visible[i] = o.visible ? 1 : 0;
		if (o.morphTargetInfluences?.length) last.morph.set(i, Float32Array.from(o.morphTargetInfluences));
		if (o.isInstancedMesh) last.instances.set(i, Float32Array.from(o.instanceMatrix.array.subarray(0, o.count * 16)));
		const mats = materialsOf(o).slice(0, SLOTS);
		if (mats.length) {
			const v = new Float32Array(mats.length * MAT);
			mats.forEach((m, k) => lookOf(m, v, k * MAT));
			last.looks.set(i, v);
		}
		if (o.isLight) {
			const v = new Float32Array(LIGHT);
			lightOf(o, v, 0);
			last.lights.set(i, v);
		}
		const sh = shapeOf(o);
		if (sh) last.shapes.set(i, sh);
	});
	const id = next++;
	sessions.set(id, { obj, cast, asset, list, controls, last, time: 0, broken: false, used: 0 });
	while (sessions.size > KEEP) {
		let oldest = null;
		for (const [k, s] of sessions) if (!oldest || s.used < sessions.get(oldest).used) oldest = k;
		end(oldest);
	}
	return { session: id, nodes: list.length };
}

const sessionOf = (id) => sessions.get(id) ?? (() => {
	throw new Error(`no session ${String(id).slice(0, 20)} (the box was started again)`);
})();

/**
 * One step: what the page asks set, the build stepped, and what changed since the last step.
 * @param {number} id
 * @param {{ dt?: number, env?: object, sliders?: Record<string, number>, controls?: Record<string, number>, explode?: number, build?: number, clip?: string, t?: number, pose?: string, edits?: Record<string, number[]> }} ask
 */
export function tick(id, ask = {}) {
	const s = sessionOf(id);
	s.used = performance.now();
	const dt = clamp(finite(ask.dt), 0, LONGEST);
	s.time += dt;
	const env = { broken: s.broken, time: s.time, slow: clamp(finite(ask.env?.slow), 0, 1), cut: clamp(finite(ask.env?.cut), 0, 1), xray: clamp(finite(ask.env?.xray), 0, 1) };
	const lab = s.asset?.lab;
	// the solver's sliders, each kept between its ends
	if (lab?.controls && ask.sliders && typeof ask.sliders === 'object')
		for (const [k, v] of Object.entries(ask.sliders)) {
			const c = lab.controls[k];
			if (c && Number.isFinite(v)) c.value = clamp(v, finite(c.min, -Infinity), finite(c.max, Infinity));
		}
	// the builder's own controls, each set only when it changed
	if (ask.controls && typeof ask.controls === 'object')
		for (const [k, v] of Object.entries(ask.controls)) {
			const c = s.controls.get(k);
			if (!c || !Number.isFinite(v)) continue;
			const x = clamp(v, 0, 1);
			if (c.value !== x) {
				c.value = x;
				c.set(c.choice ? Math.round(x) : x);
			}
		}
	if (s.asset) s.asset.tick(dt, env);
	else if (typeof s.obj.userData?.tick === 'function') s.obj.userData.tick(s.time);
	// an actor: its clip at its time, or a pose held (a hand's turns of its joints over it)
	const rig = s.cast?.rig;
	if (rig?.pose) {
		const clip = typeof ask.clip === 'string' && Object.hasOwn(s.cast.clips ?? {}, ask.clip) ? s.cast.clips[ask.clip] : null;
		if (clip) rig.pose(clip(finite(ask.t, s.time)) ?? {});
		else if (typeof ask.pose === 'string' && Object.hasOwn(s.cast.poses ?? {}, ask.pose)) {
			const edits = {};
			if (ask.edits && typeof ask.edits === 'object')
				for (const [b, t] of Object.entries(ask.edits)) if (Array.isArray(t) && t.length === 3 && t.every(Number.isFinite)) edits[b] = t.map(Number);
			rig.pose({ ...s.cast.poses[ask.pose], ...edits });
		}
	}
	if (s.asset) s.asset.pose(clamp(finite(ask.explode), 0, 1), clamp(finite(ask.build, 1), 0, 1));
	return { ...changes(s), ...readings(s) };
}

/** what changed on the build since the last step, as numbers */
function changes(s) {
	const { list, last } = s;
	const nodes = [], trs = [], visible = [], morph = [], instances = [], shapes = [], looks = [], lights = [];
	const cur = new Float32Array(10), look = new Float32Array(MAT), light = new Float32Array(LIGHT);
	list.forEach((o, i) => {
		trsOf(o, cur, 0);
		const vis = o.visible ? 1 : 0;
		let moved = vis !== last.visible[i];
		for (let k = 0; k < 10 && !moved; k++) moved = Math.abs(cur[k] - last.trs[i * 10 + k]) > EPS;
		if (moved) {
			nodes.push(i);
			for (let k = 0; k < 10; k++) trs.push(cur[k]);
			visible.push(vis);
			last.trs.set(cur, i * 10);
			last.visible[i] = vis;
		}
		const w = o.morphTargetInfluences, was = last.morph.get(i);
		if (w?.length && was && w.length === was.length && w.some((x, k) => Math.abs(x - was[k]) > EPS)) {
			was.set(w);
			morph.push({ node: i, weights: Float32Array.from(w) });
		}
		const m = o.isInstancedMesh ? o.instanceMatrix.array : null, mw = last.instances.get(i);
		if (m && mw) {
			let any = false;
			for (let k = 0; k < mw.length && !any; k++) any = Math.abs(m[k] - mw[k]) > EPS;
			if (any) {
				mw.set(m.subarray(0, mw.length));
				instances.push({ node: i, matrices: Float32Array.from(mw) });
			}
		}
		const lw = last.looks.get(i);
		if (lw)
			materialsOf(o).slice(0, lw.length / MAT).forEach((x, k) => {
				lookOf(x, look, 0);
				let any = false;
				for (let q = 0; q < MAT && !any; q++) any = Math.abs(look[q] - lw[k * MAT + q]) > EPS;
				if (!any) return;
				lw.set(look, k * MAT);
				looks.push({ node: i, slot: k, values: Float32Array.from(look) });
			});
		const ll = last.lights.get(i);
		if (ll) {
			lightOf(o, light, 0);
			let any = false;
			for (let q = 0; q < LIGHT && !any; q++) any = Math.abs(light[q] - ll[q]) > EPS;
			if (any) {
				ll.set(light);
				lights.push({ node: i, values: Float32Array.from(light) });
			}
		}
		const shape = last.shapes.get(i);
		const now = shape ? reshaped(o, shape) : null;
		if (shape && o.geometry?.attributes?.position) {
			// what it stands as now, the next step's to change from (its versions, even when its numbers came back)
			const p = o.geometry.attributes.position, n = o.geometry.attributes.normal;
			shape.g = o.geometry;
			shape.pv = p.version ?? p.data?.version;
			shape.nv = n ? n.version ?? n.data?.version : -1;
			shape.index = o.geometry.index;
			if (now) {
				shape.p.set(now.p);
				if (shape.n && now.n) shape.n.set(now.n);
				shapes.push({ node: i, position: Float32Array.from(now.p), normal: now.n ? Float32Array.from(now.n) : null });
			}
		}
	});
	return { nodes: Uint32Array.from(nodes), trs: Float32Array.from(trs), visible: Uint8Array.from(visible), morph, instances, shapes, looks, lights };
}

/** what the solver reads now: its hero number, its labels' live readings, its sliders */
function readings(s) {
	const lab = s.asset?.lab;
	if (!lab) return {};
	const r = lab.read ?? {};
	const read = { value: finite(r.value), state: short(r.state, 120), sub: short(r.sub, 200), bad: !!r.bad };
	const labels = (s.asset.labels ?? []).slice(0, 256).map((L) => {
		if (typeof L.value !== 'function') return '';
		try {
			return short(L.value(), 80);
		} catch {
			return '';
		}
	});
	const sliders = {};
	for (const [k, c] of Object.entries(lab.controls ?? {}).slice(0, 64)) if (Number.isFinite(c?.value)) sliders[k] = c.value;
	return { read, labels, sliders };
}

/** a machine broken its own way (its solver decides how), or mended */
export function breakIt(id, on) {
	const s = sessionOf(id);
	const b = s.asset?.lab?.breakIt;
	if (!b || s.broken === !!on) return {};
	s.broken = !!on;
	const env = { broken: s.broken, time: s.time, slow: 0, cut: 0, xray: 0 };
	if (on) b.run(env);
	else b.reset(env);
	return {};
}

/** a session ended: its build let go of */
export function end(id) {
	const s = sessions.get(id);
	if (!s) return {};
	sessions.delete(id);
	s.obj.traverse((o) => {
		o.geometry?.dispose?.();
	});
	return {};
}

/** the transfer list of a tick's answer (its arrays moved, not copied) */
export const moved = (x) =>
	[x.nodes, x.trs, x.visible, ...(x.morph ?? []).map((m) => m.weights), ...(x.instances ?? []).map((m) => m.matrices), ...(x.shapes ?? []).flatMap((m) => [m.position, m.normal]), ...(x.looks ?? []).map((m) => m.values), ...(x.lights ?? []).map((m) => m.values)]
		.filter((a) => a?.buffer)
		.map((a) => a.buffer);
