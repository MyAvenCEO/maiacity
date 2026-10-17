// @ts-nocheck — plain JS, trusted: runs in the page
/*
 * A BUILD ON THE STAGE — any asset the box built (./load.js), shown the way the stage (./stage.js) shows a machine
 * sealed by our kit (./parts.js), from its checked data alone: its parts, labels, shells and cut from its view
 * (./box/view.js, checked by ./box/rebuild.js), what each part is from its card's catalog, its solver's sliders from
 * its card. Nothing of the box runs here. What moves by itself (a machine's solver, an actor's clips, a fire's
 * flames) runs in the box, kept running there (./box/live.js): every frame the stage's step is sent there (the
 * sliders, the controls, the clip, the parts drawn apart or flown in) and what changed comes back as numbers, checked
 * here before this copy follows them. Until the box has it running (and if the box is gone), the copy stands still and
 * its controls are played from the numbers the box wrote down when it built it (./controls.js).
 *
 * It is what the stage calls an asset (`SealedAsset`), and more for the viewer: its controls, an actor's clips and
 * poses, a part under a pointer and a part lit up by the groups of a skinned mesh (a rigged machine, the LifeTrac).
 */
import * as THREE from 'three';
import { labelOf, poserOf, walk } from './controls.js';
import { MOVE_SAMPLES } from './box/view.js';
import { LIGHT, MAT, putLight, putLook } from './box/bake.js';
import { LAB_PLANES, capPatch } from './kit.js';

/** the controls the stage itself plays: drawn apart is its Explode view; built (or pitched) its Assemble move */
export const STAGED = new Set(['explode', 'build', 'pitch']);

const fail = (why) => {
	throw new Error(`refused: ${why}`);
};
const finite = (a, what) => {
	for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) fail(`${what}: a value that is not a number`);
};
const EMPTY = { assemblies: [], parts: [], steps: [], sources: [], ranges: [], play: 'Build it', seconds: 12 };

/**
 * A build, ready for the stage.
 * @param {{ obj: THREE.Object3D, card: any }} built what ./load.js `loadAsset` gave
 * @param {{ start?: (nodes: number) => Promise<{ tick: Function, breakIt: Function, end: Function } | null> }} [o]
 *   how its running build is started in the box (none: it only stands)
 */
export function heroOf({ obj: root, card }, { start } = {}) {
	const nodes = walk(root);
	const view = root.userData.view ?? {};
	const catalog = card.catalog ?? EMPTY;
	const info = new Map((catalog.parts ?? []).map((p) => [p.id, p]));
	const poser = poserOf(root);
	/** the controls by id, and which plays the build (a tent's pitch, else its build) */
	const has = new Set(poser.list.map((c) => c.id));
	const buildBy = has.has('build') ? 'build' : has.has('pitch') ? 'pitch' : null;

	// its parts, by their nodes; a rigged one's by the groups of its skinned mesh
	const parts = (view.parts ?? []).map((p) => ({ obj: nodes[p.node], info: info.get(p.id) ?? { id: p.id, label: p.id }, unit: !!p.unit, groups: p.groups }));
	const byNode = new Map();
	for (const p of parts) if (!p.groups && !byNode.has(p.obj)) byNode.set(p.obj, p.info.id);
	const grouped = parts.filter((p) => p.groups);
	const byGroup = new Map();
	for (const p of grouped) for (const g of p.groups) byGroup.set(g, p.info.id);

	// what the solver reads now (its readings come with each step), its sliders, its labels' live readings
	const lab = view.lab ? labOf(view.lab, card.controls ?? []) : undefined;
	let readings = [];
	const labels = (view.labels ?? []).map((L, i) => ({ obj: nodes[L.node], at: new THREE.Vector3(...L.at), text: L.text, side: L.side, value: L.live ? () => readings[i] ?? '' : undefined }));
	const shells = (view.shells ?? []).map((n) => nodes[n]).filter((m) => m?.isMesh);

	root.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(root);
	const measure = box.isEmpty() ? new THREE.Vector3(1, 1, 1) : box.getSize(new THREE.Vector3());

	/** what the stage last set: drawn apart, built, and the controls a hand set */
	const state = { explode: 0, build: 1, controls: Object.fromEntries(poser.list.map((c) => [c.id, c.rest])), clip: view.clips?.first && view.clips.clips.includes(view.clips.first) ? view.clips.first : view.clips?.clips?.[0] ?? null, pose: null, edits: {}, t: 0 };
	if (view.clips?.first && view.clips.poses?.includes(view.clips.first) && !view.clips.clips.includes(view.clips.first)) {
		state.pose = view.clips.first;
		state.clip = null;
	}

	/** the build kept running in the box, once it is (null: it stands still, its controls played here) */
	let running = null;
	/** the box's first answer is still to come: it tells what moved from the build as built, not from this copy */
	let fresh = false;
	let asking = false;
	let waited = 0;
	let gone = false;
	let sent = '';
	// its break is its solver's, in the box
	if (lab?.breakIt) {
		lab.breakIt.run = () => running?.breakIt(true);
		lab.breakIt.reset = () => running?.breakIt(false);
	}
	if (view.ticks && start)
		start(nodes.length)
			.then((r) => {
				if (gone) return void r?.end();
				running = r;
				fresh = true;
			})
			.catch(() => {});

	/** the poser at what the stage set (its own copy only while nothing runs in the box) */
	function playHere() {
		const want = { ...state.controls };
		if (has.has('explode')) want.explode = state.explode;
		if (buildBy) want[buildBy] = state.build;
		poser.setMany(Object.fromEntries(Object.entries(want).filter(([id, v]) => has.has(id) && poser.get(id) !== v)));
	}

	/** a step's answer, checked, put on this copy */
	function follow(r) {
		const n = r.nodes, N = nodes.length;
		if (!(n instanceof Uint32Array) || !(r.trs instanceof Float32Array) || !(r.visible instanceof Uint8Array)) fail('a step: its lists');
		if (r.trs.length !== n.length * 10 || r.visible.length !== n.length) fail('a step: its lengths');
		finite(r.trs, 'a step');
		// the copy as built again first (its controls at rest), wherever the poser had put it while nothing ran
		if (fresh) ((fresh = false), poser.reset());
		for (let j = 0; j < n.length; j++) {
			const o = nodes[n[j] < N ? n[j] : fail('a step: a node there is not')];
			const T = r.trs, a = j * 10;
			o.position.set(T[a], T[a + 1], T[a + 2]);
			o.quaternion.set(T[a + 3], T[a + 4], T[a + 5], T[a + 6]).normalize();
			o.scale.set(T[a + 7], T[a + 8], T[a + 9]);
			o.visible = r.visible[j] === 1;
			if (!o.matrixAutoUpdate) o.updateMatrix();
		}
		for (const m of Array.isArray(r.morph) ? r.morph : []) {
			const o = nodes[Number.isInteger(m?.node) && m.node < N ? m.node : fail('a step: blend shapes')];
			const w = o.morphTargetInfluences;
			if (!w || !(m.weights instanceof Float32Array) || m.weights.length !== w.length) fail('a step: blend shapes');
			finite(m.weights, 'a step');
			w.splice(0, w.length, ...m.weights);
		}
		for (const m of Array.isArray(r.instances) ? r.instances : []) {
			const o = nodes[Number.isInteger(m?.node) && m.node < N ? m.node : fail('a step: instances')];
			if (!o.isInstancedMesh || !(m.matrices instanceof Float32Array) || m.matrices.length !== o.count * 16) fail('a step: instances');
			finite(m.matrices, 'a step');
			o.instanceMatrix.array.set(m.matrices);
			o.instanceMatrix.needsUpdate = true;
			o.frustumCulled = false;
		}
		// engine 5: a mesh reshaped, a material's look and a light changed (a fire's flicker)
		for (const m of Array.isArray(r.shapes) ? r.shapes : []) {
			const o = nodes[Number.isInteger(m?.node) && m.node < N ? m.node : fail('a step: shapes')];
			const g = o.geometry, p = g?.attributes?.position;
			if (!o.isMesh || !p || !(m.position instanceof Float32Array) || m.position.length !== p.count * 3) fail('a step: shapes');
			finite(m.position, 'a step');
			p.array.set(m.position);
			p.needsUpdate = true;
			const n = g.attributes.normal;
			if (m.normal != null) {
				if (!n || !(m.normal instanceof Float32Array) || m.normal.length !== n.count * 3) fail('a step: normals');
				finite(m.normal, 'a step');
				n.array.set(m.normal);
				n.needsUpdate = true;
			}
			g.computeBoundingSphere();
			o.frustumCulled = false;
		}
		for (const m of Array.isArray(r.looks) ? r.looks : []) {
			const o = nodes[Number.isInteger(m?.node) && m.node < N ? m.node : fail('a step: looks')];
			const mat = Array.isArray(o.material) ? o.material[m.slot] : m.slot === 0 ? o.material : null;
			if (!mat || !(m.values instanceof Float32Array) || m.values.length !== MAT) fail('a step: looks');
			finite(m.values, 'a step');
			putLook(mat, m.values, 0);
		}
		for (const m of Array.isArray(r.lights) ? r.lights : []) {
			const o = nodes[Number.isInteger(m?.node) && m.node < N ? m.node : fail('a step: lights')];
			if (!o.isLight || !(m.values instanceof Float32Array) || m.values.length !== LIGHT) fail('a step: lights');
			finite(m.values, 'a step');
			putLight(o, m.values, 0);
		}
		if (lab && r.read && typeof r.read === 'object') {
			const x = r.read;
			lab.read.value = Number.isFinite(x.value) ? x.value : 0;
			lab.read.state = typeof x.state === 'string' ? x.state.slice(0, 120) : '';
			lab.read.sub = typeof x.sub === 'string' ? x.sub.slice(0, 200) : '';
			lab.read.bad = x.bad === true;
		}
		if (Array.isArray(r.labels)) readings = r.labels.slice(0, labels.length).map((s) => (typeof s === 'string' ? s.slice(0, 80) : ''));
		root.updateMatrixWorld(true);
	}

	/** one step asked of the box: the time since the last, and everything the stage has set */
	function step(dt, env) {
		waited += dt;
		state.t += dt;
		if (asking || !running) return;
		const ask = {
			dt: waited,
			env: { slow: env?.slow ?? 0, cut: env?.cut ?? 0, xray: env?.xray ?? 0 },
			sliders: lab ? Object.fromEntries(Object.entries(lab.controls).map(([k, c]) => [k, c.value])) : undefined,
			controls: state.controls,
			explode: state.explode,
			build: state.build,
			...(state.clip ? { clip: state.clip, t: state.t } : state.pose ? { pose: state.pose, edits: state.edits } : {})
		};
		// nothing new and no time gone: nothing asked
		const said = JSON.stringify({ ...ask, dt: 0, t: 0 });
		if (waited <= 0 && said === sent) return;
		sent = said;
		waited = 0;
		asking = true;
		const r = running;
		r.tick(ask)
			.then((out) => r === running && !gone && follow(out))
			.catch(() => {
				// the box was torn down, it was late, or its answer was refused: the copy stands as it is, its run let go
				if (r === running) running = null;
				r.end?.();
			})
			.finally(() => (asking = false));
	}

	const hero = {
		root,
		card,
		view,
		parts,
		labels,
		shells,
		catalog,
		size: view.size ?? Math.max(measure.x, measure.y, measure.z),
		lab,
		cut: view.cut,
		/** the parts drawn apart by `e` and flown in by `u` (its explode and its build or pitch) */
		pose(e, u = 1) {
			state.explode = e;
			state.build = u;
			if (!running) playHere();
		},
		explode: (k) => hero.pose(k, state.build),
		build: (u) => hero.pose(state.explode, u),
		tick: step,
		partOf(o) {
			for (let x = o; x; x = x.parent) if (byNode.has(x)) return byNode.get(x);
			return null;
		},
		/** the part under a ray's hit: by its node, or by the group of a skinned mesh its face is in */
		partAt(hit) {
			if (grouped.length && hit.object === grouped[0].obj && hit.faceIndex != null) {
				const at = hit.faceIndex * 3;
				const g = hit.object.geometry.groups.findIndex((x) => at >= x.start && at < x.start + x.count);
				return byGroup.get(g) ?? null;
			}
			return hero.partOf(hit.object);
		},
		objOf: (id) => parts.find((p) => p.info.id === id && !p.groups)?.obj ?? null,
		/** a part of a skinned mesh lit up, the rest a ghost if it is shown alone; false for a part the stage lights itself */
		highlight(id, alone) {
			if (!grouped.length) return false;
			paint(id, alone);
			return true;
		},
		/** where a part is now (a rigged one's by its bone, `p.<id>`) */
		centreOf(id) {
			const bone = nodes.find((o) => o.isBone && o.name === `p.${id}`);
			return bone ? bone.getWorldPosition(new THREE.Vector3()) : null;
		},

		/** its controls a hand moves (a door, the tailgate, a fire lit), not the ones the stage plays */
		controls: poser.list.filter((c) => !STAGED.has(c.id)),
		/** whether it builds up by its pitch or its build, and the label */
		buildBy: buildBy && { id: buildBy, label: labelOf(buildBy) },
		explodes: has.has('explode'),
		value: (id) => state.controls[id],
		set(id, v) {
			if (!has.has(id)) return;
			state.controls = { ...state.controls, [id]: v };
			if (!running) playHere();
		},
		/** an actor's clips and poses, and what it does now */
		clips: view.clips ?? null,
		get doing() {
			return state.clip ? { kind: 'clip', name: state.clip } : state.pose ? { kind: 'pose', name: state.pose } : null;
		},
		play(name) {
			state.clip = name;
			state.pose = null;
			state.t = 0;
		},
		hold(name, edits = {}) {
			state.pose = name;
			state.clip = null;
			state.edits = edits;
		},
		/** whether its build is running in the box yet */
		get live() {
			return !!running;
		},
		dispose() {
			gone = true;
			running?.end();
			running = null;
		}
	};

	// a skinned mesh's parts lit up by its groups: its own materials, then a lit one and a ghost one after them
	let paint = () => {};
	if (grouped.length) {
		const mesh = grouped[0].obj;
		const own = mesh.geometry.groups.map((g) => g.materialIndex ?? 0);
		const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
		const lit = new THREE.MeshStandardMaterial({ vertexColors: !!mesh.geometry.attributes.color, roughness: 0.5, emissive: '#ff7a1a', emissiveIntensity: 0.55, side: THREE.DoubleSide });
		const ghost = new THREE.MeshStandardMaterial({ vertexColors: !!mesh.geometry.attributes.color, roughness: 0.8, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide });
		mesh.material = [...mats, lit, ghost];
		const at = mats.length;
		paint = (id, alone) => {
			mesh.geometry.groups.forEach((g, i) => {
				const p = byGroup.get(i);
				g.materialIndex = id && p === id ? at : id && alone ? at + 1 : own[i];
			});
		};
	}
	return hero;
}

/**
 * A machine's solver as the stage reads it: its hero number and its reading now (each step's), its sliders (its
 * card's), how it is computed, its break, and its own moves played back from their tables.
 */
function labOf(L, sliders) {
	const controls = Object.fromEntries(sliders.map((c) => [c.id, { ...c }]));
	const moves = Object.fromEntries(
		Object.entries(L.moves ?? {}).map(([id, m]) => {
			const S = MOVE_SAMPLES, k = m.ids.length;
			/** its sliders' values a share `u` through its loop, between the two steps nearest */
			const at = (u) => {
				const x = (((u % 1) + 1) % 1) * (S - 1), s0 = Math.floor(x), s1 = Math.min(S - 1, s0 + 1), t = x - s0;
				return Object.fromEntries(m.ids.map((c, j) => [c, m.table[s0 * k + j] + (m.table[s1 * k + j] - m.table[s0 * k + j]) * t]));
			};
			return [id, { label: m.label, seconds: m.seconds, note: m.note, at }];
		})
	);
	return {
		hero: L.hero ?? { label: '', unit: '', max: 1 },
		read: { value: 0, state: '', sub: '', bad: false, ...(L.read ?? {}) },
		controls,
		how: L.how,
		moves,
		breakIt: L.breakIt && { label: L.breakIt.label, run: () => {}, reset: () => {} }
	};
}

/**
 * How a build is kept running in the box for the stage: started with its recipe and values, each step and break
 * asked of it. Null when the box cannot keep it (an engine before 4).
 * @param {import('./box/host.js').AssetBox} box @param {{ hash: string, code: string }} recipe
 * @param {Record<string, string> | undefined} given
 */
export function runner(box, recipe, given) {
	return async (nodes) => {
		if (box.engine < 4) return null;
		const { session } = await box.live(recipe, given, nodes);
		const generation = box.generation;
		const alive = () => box.generation === generation;
		return {
			tick: (ask) => (alive() ? box.tick(session, ask) : Promise.reject(new Error('the box was started again'))),
			breakIt: (on) => (alive() ? box.breakIt(session, on) : Promise.resolve()),
			end: () => (alive() ? box.end(session) : Promise.resolve())
		};
	};
}

/**
 * A build's materials made ready for the stage's cut: each opened by its two section planes, and a solid our kit gave
 * section caps in the box (engine 3 says which, and in what colour) its cut face drawn by the kit's own shader code,
 * here in the page, as the kit's machines are drawn on the stage.
 * @param {THREE.Object3D} root
 */
export function forStage(root) {
	const done = new Set();
	root.traverse((o) => {
		for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
			if (done.has(m)) continue;
			done.add(m);
			const cap = m.userData.cap;
			if (m.userData.custom && cap && (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) capPatch(m, cap.color, cap.rough, cap.metal);
			else {
				m.clippingPlanes = LAB_PLANES;
				m.clipIntersection = true;
				m.clipShadows = true;
			}
			m.needsUpdate = true;
		}
	});
}

/**
 * How a build is walked in, read off its own shape (a container's floor, its walls): the floor under a walker is the
 * first face looking up below their knees, and they may step where nothing stands across their way at knee or chest
 * height. Nothing of the box's decides it.
 * @param {THREE.Object3D} root
 */
export function walkOf(root) {
	const ray = new THREE.Raycaster();
	const down = new THREE.Vector3(0, -1, 0), from = new THREE.Vector3(), dir = new THREE.Vector3();
	const solid = (hits) => hits.filter((h) => h.object.visible && h.object.isMesh && !h.object.userData.studio);
	return {
		floorAt(x, z, ground = 0) {
			ray.set(from.set(x, ground + 0.6, z), down);
			ray.far = ground + 3;
			const hit = solid(ray.intersectObject(root, true)).find((h) => (h.face?.normal ? h.face.normal.clone().transformDirection(h.object.matrixWorld).y > 0.5 : true));
			return hit ? hit.point.y : 0;
		},
		canStand(x, z, here, _ground, was) {
			dir.set(x - was.x, 0, z - was.z);
			const d = dir.length();
			if (d < 1e-6) return true;
			dir.divideScalar(d);
			for (const h of [0.45, 1.2]) {
				ray.set(from.set(was.x, here + h, was.z), dir);
				ray.far = d + 0.25;
				if (solid(ray.intersectObject(root, true)).length) return false;
			}
			return true;
		}
	};
}
