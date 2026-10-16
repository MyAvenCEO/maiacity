// @ts-nocheck — plain JS, trusted: world code, runs in the page
/*
 * A BUILDING THAT IS A WORLD IN DISGUISE — the tent and the domes of the Buildings (./index.js) are no single object a
 * recipe could hand back: each is Sandbox 3's interior of its kind ($lib/sandbox-2/interior: its floors, rooms, lamps,
 * water, animals and a forest of our real plants, ticking as it is walked). So the asset box does not build them; the
 * viewer (/app/buildings/, $lib/assets/AssetViewer.svelte) has this build one, alone, as Sandbox 3's village builds it
 * into its own world (mountInterior with a host), and as the Buildings viewer always has:
 *
 * - in a scene of its own, drawn on the viewer's canvas with its camera: the light and the ground every building has
 *   always stood in here (a soft sky light, a key with its shadow, the round ground of ./ground.js, no land round it);
 * - a little at a time, saying what it is doing, the meadow it lays round itself hidden as it comes, stopped when
 *   another is picked;
 * - walked through its door and round on its own floors, or out on the round ground round it, never off its edge.
 *
 * `raiseInside(item, v, host)` → `{ scene, ghost, walk, measured, ready, frame(t), draw(), dispose() }`: `ghost` is
 * where it will stand (the camera framed on it at once, `onGhost`), `ready` settles once it stands, with its `measured`
 * box and its `walk` (null if it was stopped or failed), `frame` each frame with the seconds since it was raised, `draw`
 * to draw it. The renderer draws filmic (ACES) while it stands, as this viewer always drew it, and as before once it is
 * let go of (`dispose`).
 */
import * as THREE from 'three';
import { atOrLatest } from '$lib/app/versions.js';
import { disposeObject } from '$lib/app/view3d.js';
import { groundRadius, roundGround } from './ground.js';

/** how many steps a dome's build reports, for a bar of how far it is */
export const STEPS = 5;

/**
 * A dome (or the tent) of the Buildings, raised alone.
 * @param {import('./index.js').Dome} item @param {number} v the version shown
 * @param {{ renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, box: HTMLElement, low?: boolean, onStep?: (label: string, done: number) => void, onGhost?: (b: THREE.Box3) => void }} host
 *   `onStep` hears each step of its build (what it is doing, how many are done of STEPS); `onGhost` where it will
 *   stand, as soon as that is known
 */
export function raiseInside(item, v, { renderer, camera, box, low = false, onStep, onGhost }) {
	const kind = atOrLatest(item.versions, v).build;
	const scene = new THREE.Scene();
	scene.background = new THREE.Color('#e9e6e0');
	scene.add(new THREE.HemisphereLight('#ffffff', '#b9b2a6', 1.2));
	const key = new THREE.DirectionalLight('#fff4e6', 2.2);
	key.castShadow = true;
	key.shadow.mapSize.setScalar(low ? 1024 : 2048);
	scene.add(key, key.target);
	/** the round ground under it, and its radius: a walk keeps to it */
	let ground = null, groundR = 0;
	let stopped = false, building = true, frames = 0, done = 0;
	/** @type {import('$lib/sandbox-2/interior/interior').EmbeddedDome | null} */
	let dome = null;

	/** the round ground under a building of this measure, and the key light over it, its shadow framed to it @param {THREE.Box3} b */
	const place = (b) => {
		if (ground) {
			scene.remove(ground);
			disposeObject(ground);
		}
		const s = b.getSize(new THREE.Vector3()), mid = b.getCenter(new THREE.Vector3());
		groundR = groundRadius(Math.hypot(s.x, s.z) / 2);
		ground = roundGround(groundR);
		ground.position.set(mid.x, 0, mid.z);
		scene.add(ground);
		const reach = Math.max(s.x, s.y, s.z);
		key.position.set(mid.x + reach * 2, reach * 3, mid.z + reach * 1.5);
		key.target.position.copy(mid);
		const sh = key.shadow.camera;
		sh.left = sh.bottom = -reach * 1.5;
		sh.right = sh.top = reach * 1.5;
		sh.near = 0.01;
		sh.far = reach * 10;
		sh.updateProjectionMatrix();
		key.shadow.normalBias = reach * 0.004; // a texel or two: no shadow acne on big flat faces
	};

	/**
	 * A dome without the land a village lays round it (a meadow reaching far past it): every piece wider than the
	 * dome's own reach is hidden, so it stands on the round ground alone. Hands back what is left, measured.
	 * @param {THREE.Object3D} root @param {number} R
	 */
	const keepToItself = (root, R) => {
		const own = new THREE.Box3();
		root.updateMatrixWorld(true);
		root.traverse((o) => {
			if (!o.isMesh) return;
			const bb = new THREE.Box3().setFromObject(o);
			if (bb.isEmpty()) return;
			const z = bb.getSize(new THREE.Vector3());
			if (Math.max(z.x, z.z) <= R * 2.6) own.union(bb);
			else o.visible = false;
		});
		return own;
	};

	/** its radius (m), once its kind is read */
	let R = 0;
	const handle = {
		scene,
		/** @type {THREE.Box3 | null} where it will stand, as soon as its kind says how big it is: the camera framed on it meanwhile */
		ghost: null,
		/** @type {{ x: number, z: number, yaw: number, floorAt: Function, canStand: Function, lamps: number[][] } | null} how it is walked, once it stands */
		walk: null,
		/** @type {THREE.Box3 | null} its measure, once it stands (without the land it lays round itself) */
		measured: null,
		/** @type {Promise<typeof handle | null>} */
		ready: Promise.resolve(null),
		/** each frame, the seconds since it was raised: it ticks once it stands; while it is built, the land it lays round itself is hidden as it comes */
		frame(t) {
			if (building && R && ++frames % 20 === 0) scene.children.forEach((o) => o !== scene && o.isScene && keepToItself(o, R));
			dome?.update(t);
		},
		draw() {
			renderer.render(scene, camera);
		},
		dispose() {
			if (stopped) return;
			stopped = true;
			dome?.dispose();
			dome = null;
			if (ground) disposeObject(ground);
			ground = null;
			renderer.toneMapping = was.tm;
			renderer.toneMappingExposure = was.ex;
		}
	};
	// drawn as the Buildings have always drawn it, filmic, for as long as it stands: its shaders are made so as it is built
	const was = { tm: renderer.toneMapping, ex: renderer.toneMappingExposure };
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1;

	handle.ready = (async () => {
		onStep?.('Opening the doors', done);
		const interior = await import('$lib/sandbox-2/interior/interior');
		if (stopped) return null;
		const r = (R = interior.DOMES[kind].diameter / 2);
		// meanwhile it stands where it will, the ground laid
		handle.ghost = new THREE.Box3(new THREE.Vector3(-r, 0, -r), new THREE.Vector3(r, r * (kind === 'tent' ? 1.2 : 0.55), r));
		place(handle.ghost);
		onGhost?.(handle.ghost);
		const flora = item.flora ? await import('$lib/sandbox-2/interior/sandbox5.js').then(({ SANDBOX_5 }) => ({ garden: SANDBOX_5.flora.inside, seed: SANDBOX_5.flora.seed })) : undefined;
		if (stopped) return null;
		const h = await interior
			.mountInterior(
				box,
				kind,
				(label) => {
					if (stopped || label === 'ready') return;
					onStep?.(label, ++done);
				},
				{
					host: { scene, camera, renderer, x: 0, z: 0 },
					cancelled: () => stopped,
					hurry: () => true,
					// a dome planted with our real plants grows the warm garden Sandbox 4 grows under its glass
					flora
				}
			)
			.catch(() => null);
		building = false;
		if (!h) return null;
		if (stopped || !h.embedded) {
			h.dispose();
			return null;
		}
		const e = (dome = h.embedded);
		e.setHour(13);
		const own = keepToItself(e.root, r);
		const measured = own.isEmpty() ? new THREE.Box3().setFromObject(e.root) : own;
		place(measured);
		// in by the north door, or the south where there is none (the large dome's pond is on its north)
		const door = interior.doorsOf(kind).includes(0) ? 0 : Math.PI;
		const out = r + Math.max(2, r * 0.12);
		const at = ground.position;
		handle.measured = measured;
		handle.walk = {
			x: out * Math.sin(door),
			z: out * Math.cos(door),
			yaw: door,
			floorAt: e.floorAt,
			// in through its door and round on its own floors, or out on the ground round it, never off its edge
			canStand: (x, z, here, g, from) => {
				if (Math.hypot(x - at.x, z - at.z) >= groundR - 0.4) return false;
				const nf = e.floorAt(x, z, g);
				const outside = nf < 0.5 && here < 0.5 && Math.hypot(x, z) > r + 0.6;
				return (outside || e.inside(x, z, nf)) && !e.blocked(x, z, here) && !e.hits(x, z, nf, from);
			},
			lamps: []
		};
		return handle;
	})();
	return handle;
}
