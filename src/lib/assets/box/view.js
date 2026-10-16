// @ts-nocheck — plain JS, runs inside the box
/*
 * WHAT A VIEWER NEEDS OF A BUILD, AS DATA — read in the box off what a builder left on its object (./engine.js), so
 * the page can show any asset the way the stage shows a machine (../stage.js) without one of its functions:
 *
 *   parts    each part a mechanic would name, by its node (its place in the walk of the tree, ./bake.js): a sealed
 *            asset's (../parts.js, a whole carried asset `unit`), a thing's own (`userData.parts`), or a rigged one's,
 *            by the groups of its skinned mesh (`rig.parts`); what each is, is in the card's catalog (../card.js)
 *   labels   the names pinned on parts: the node, the point on it, the text, which side, whether it has a live reading
 *   shells   the casings the x-ray looks through, by node
 *   cut      where its section planes sweep from; `size` its largest measure (m)
 *   lab      a machine's solver as data: its hero number and how it reads now, how it is computed, the name of its
 *            break, and its own moves, each played here from 0 to 1 and written down as its sliders' values (the
 *            sliders themselves are on its card, ../card.js)
 *   clips    a rigged actor's clips and held poses, by name, the one it shows first, the poses as data and its bones;
 *            and every clip played here and written down as tables (`motion`, ./clips.js), for the page to play its
 *            copies by, any number of them, each at its own time (engine 5)
 *   ticks    whether it moves by itself (a solver, a clip, a flame): the page then asks the box to tick it (./live.js)
 *   roof     the nodes a building's roof is made of; `walk` where it is walked in from, and its lamps
 *   note     what it says of itself, when it shows nothing (a fruit that has not set yet)
 *
 * Everything here is checked again in the page (./rebuild.js `viewOf`), as everything that leaves the box is.
 */
import { motionOf } from './clips.js';

/** steps a machine's own move is written down at, from the start of its loop to its end */
export const MOVE_SAMPLES = 49;

/** an id as a card writes one: small letters, digits and dashes (a rig's part `coil-D1` is `coil-d1`) */
export const idOf = (id) => String(id).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+/, '').slice(0, 80) || 'part';

/** a rigged machine's catalog as its card lists it: every part's and assembly's id written as a card's */
export function catalogOf(c) {
	return {
		...c,
		assemblies: c.assemblies?.map((a) => ({ ...a, id: idOf(a.id) })),
		parts: c.parts?.map((p) => ({ ...p, id: idOf(p.id), assembly: p.assembly && idOf(p.assembly) }))
	};
}

/** every node of the tree, each before its children: how a part is named (as ./bake.js) */
const walk = (root) => {
	const list = [];
	root.traverse((o) => list.push(o));
	return list;
};

const text = (s, n = 200) => (typeof s === 'string' ? s.slice(0, n) : s == null ? undefined : String(s).slice(0, n));
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
const v3 = (a) => (Array.isArray(a) && a.length === 3 && a.every((x) => Number.isFinite(x)) ? a.map(Number) : undefined);
/** plain data, copied, nothing of the object riding along (and none of it too big) */
const plain = (x, most = 64_000) => {
	if (x == null) return undefined;
	try {
		const s = JSON.stringify(x);
		return s && s.length <= most ? JSON.parse(s) : undefined;
	} catch {
		return undefined;
	}
};
const set = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** how big a rigged actor is (m): the ball about its mesh as it rests */
function radiusOf(rig) {
	const g = rig?.object?.geometry;
	if (!g?.attributes?.position) return 1;
	try {
		g.computeBoundingSphere();
		return g.boundingSphere?.radius || 1;
	} catch {
		return 1;
	}
}

/**
 * A build's view.
 * @param {import('three').Object3D} root as its builder made it (and put back after its controls were played)
 * @param {any} [cast] the rig it came in, for an actor (`{ rig, clips, poses, first }`, $lib/actors/rig.ts)
 */
export function viewOf(root, cast) {
	const nodes = walk(root);
	const index = new Map(nodes.map((o, i) => [o, i]));
	const at = (o) => index.get(o) ?? -1;
	const u = root.userData ?? {};
	const asset = u.asset ?? cast?.asset;
	const view = {};

	// the parts: a sealed asset's, else a thing's own, else a rigged one's by the groups of its mesh
	const parts = [];
	if (Array.isArray(asset?.parts))
		for (const p of asset.parts) {
			const n = at(p.obj);
			if (n >= 0 && p.info?.id) parts.push(set({ id: text(p.info.id, 80), node: n, unit: p.unit ? true : undefined }));
		}
	else if (u.parts && typeof u.parts === 'object')
		for (const [id, o] of Object.entries(u.parts)) {
			const n = at(o);
			if (n >= 0) parts.push({ id: text(id, 80), node: n });
		}
	if (!parts.length && Array.isArray(cast?.rig?.parts)) {
		let mesh = null;
		root.traverse((o) => (mesh ??= o.isSkinnedMesh ? o : null));
		const n = mesh ? at(mesh) : -1;
		if (n >= 0) {
			const groups = new Map();
			cast.rig.parts.forEach((id, g) => id && groups.set(id, [...(groups.get(id) ?? []), g]));
			for (const [id, list] of groups) parts.push({ id: idOf(id), node: n, groups: list.slice(0, 1024) });
		}
	}
	if (parts.length) view.parts = parts.slice(0, 4096);

	if (Array.isArray(asset?.labels) && asset.labels.length)
		view.labels = asset.labels
			.map((L) => set({ node: at(L.obj), at: v3(L.at?.toArray?.()) ?? [0, 0, 0], text: text(L.text, 80) ?? '', side: L.side === 'left' || L.side === 'right' ? L.side : undefined, live: typeof L.value === 'function' ? true : undefined }))
			.filter((L) => L.node >= 0)
			.slice(0, 256);
	if (Array.isArray(asset?.shells) && asset.shells.length) view.shells = [...new Set(asset.shells.map(at).filter((n) => n >= 0))].slice(0, 4096);
	if (asset?.cut) view.cut = set({ a: v3(asset.cut.a), b: v3(asset.cut.b), center: v3(asset.cut.center), reach: num(asset.cut.reach), offset: num(asset.cut.offset) });
	if (num(asset?.size)) view.size = asset.size;

	const lab = asset?.lab;
	if (lab) {
		view.lab = set({
			hero: plain(lab.hero, 2000),
			read: plain(lab.read, 2000),
			how: plain(lab.how, 16_000),
			breakIt: lab.breakIt ? { label: text(lab.breakIt.label, 80) ?? 'Break it' } : undefined,
			moves: movesOf(lab.moves, lab.controls ?? {})
		});
	}

	if (cast?.clips && typeof cast.clips === 'object') {
		const clips = Object.keys(cast.clips).filter((k) => typeof cast.clips[k] === 'function').slice(0, 64).map((k) => text(k, 40));
		const poses = cast.poses && typeof cast.poses === 'object' ? Object.keys(cast.poses).slice(0, 64).map((k) => text(k, 40)) : [];
		// the poses it holds as data, for a hand to turn a joint of and copy out; its bones by name
		const held = poses.length ? plain(cast.poses, 64_000) : undefined;
		const bones = Array.isArray(cast.rig?.names) ? cast.rig.names.slice(0, 512).map((k) => text(k, 40)) : undefined;
		const motion = clips.length ? motionOf(cast, radiusOf(cast.rig)) : undefined;
		if (clips.length || poses.length) view.clips = set({ clips, poses, first: text(cast.first, 40), held, bones, motion });
	}

	view.ticks = !!(lab || typeof u.tick === 'function' || view.clips);

	const roof = u.roof?.isObject3D ? [u.roof] : Array.isArray(u.roof) ? u.roof : [];
	const roofNodes = roof.map(at).filter((n) => n >= 0);
	if (roofNodes.length) view.roof = roofNodes;
	// how it is walked: where a walker starts and the lamps lit inside (its floors and walls are read off its shape)
	const w = u.walk;
	if (w && typeof w === 'object') {
		const lamps = Array.isArray(w.lamps) ? w.lamps.slice(0, 64).map(v3).filter(Boolean) : [];
		const start = set({ x: num(w.x), z: num(w.z), yaw: num(w.yaw), lamps });
		if (start.x !== undefined && start.z !== undefined) view.walk = start;
	}
	// what it says of itself when there is nothing to show (a fruit not set yet)
	if (typeof u.note === 'string') view.note = text(u.note, 200);
	return view;
}

/**
 * A machine's own moves, each played from the start of its loop to its end and written down as the sliders it sets.
 * @param {Record<string, any>} [moves] @param {Record<string, any>} controls
 */
function movesOf(moves, controls) {
	if (!moves || typeof moves !== 'object') return undefined;
	const out = {};
	for (const [id, m] of Object.entries(moves).slice(0, 16)) {
		if (typeof m?.at !== 'function' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(id)) continue;
		const S = MOVE_SAMPLES;
		const rows = [];
		try {
			for (let s = 0; s < S; s++) rows.push(m.at(s / (S - 1)) ?? {});
		} catch {
			continue;
		}
		const ids = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => k in controls).slice(0, 16);
		const table = new Float32Array(S * ids.length);
		rows.forEach((r, s) => ids.forEach((k, j) => (table[s * ids.length + j] = Number.isFinite(r[k]) ? r[k] : (controls[k].value ?? 0))));
		out[id] = set({ label: text(m.label, 80) ?? id, seconds: num(m.seconds) > 0 ? m.seconds : 4, note: text(m.note, 200), ids, table });
	}
	return Object.keys(out).length ? out : undefined;
}
