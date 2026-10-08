/**
 * SANDBOX 6 · ONE HEX · ON THE PAGE — the stage, the sky and the map camera of the sandbox kit round the two hexes
 * (./scene.js), the labels over the buildings drawn in HTML, and a click to pick a building.
 *
 *   look     drag turns and tilts, the wheel zooms, WASD travels (the kit's orbit rig)
 *   pick     click a dome or the tower to see its numbers
 *   focus    the page switches between the living hex and the tower hex: the camera flies over
 */
import * as THREE from 'three';
import { createOrbitRig, createSky, createStage, skyTime } from '$lib/sandbox-kit';
import { buildWorld } from './scene.js';
import { LIVING, TOWER_HEXES } from './layout.js';
import { KINDS, capOf } from './specs.js';

/** the hour the sky shows on Auto */
export const MORNING = 11.5;

/** where the camera looks from, over each hex */
const VIEWS = {
	living: { target: [0, 0, 20], from: [260, 420, 640] },
	tower: { target: [665.6, 60, 0], from: [665.6 + 330, 380, 620] }
};

/**
 * @param {HTMLElement} container
 * @param {HTMLElement} labelLayer where the labels go
 * @param {{ onPick?: (id: string | null, hex: string | null) => void, onProgress?: (label: string) => void }} [o]
 */
export function mountWorld(container, labelLayer, o = {}) {
	const stage = createStage(container, { fov: 42, near: 1, far: 9000, maxPixelRatio: 1.5 });
	const { renderer, scene, camera } = stage;
	// the hex has no clock of its own: on Auto the sky stands at late morning, Manual sets the hour by hand
	const sky = createSky(renderer, scene, { clock: () => (skyTime.auto ? MORNING : skyTime.hour), shadowReach: 520, shadowMap: 4096, shadowFar: 3200, lightDistance: 1500, shadowGrid: 32, fog: { near: 2200, far: 7500 } });
	o.onProgress?.('Laying out the hexes');
	const world = buildWorld(scene, { living: LIVING, towers: TOWER_HEXES }, o.onProgress);
	let towerId = 't250';
	world.setTower(towerId);

	const v = VIEWS.living;
	camera.position.set(v.from[0], v.from[1], v.from[2]);
	const rig = createOrbitRig(camera, renderer.domElement, { minDistance: 15, maxDistance: 3200, target: new THREE.Vector3(...v.target), floorY: 3, moveSpeed: 260 });

	// ── labels ──
	/** @type {{ el: HTMLElement, at: THREE.Vector3, hex: string, small: boolean, dims: HTMLElement }[]} */
	const labels = [];
	for (const [key, h] of Object.entries(world.hexes))
		for (const b of h.built) {
			const el = document.createElement('div');
			el.className = 'lbl';
			const K = KINDS[b.site.kind];
			const title = b.site.kind === 'tower250' ? (h.plan.tower?.label ?? 'Tower') : b.site.kind === 'factory100' ? b.site.name : K.label;
			const sub = b.site.kind === 'factory100' ? 'Dome100 factory' : b.site.kind === 'dome50' || b.site.kind === 'dome100' ? `${K.people} people` : b.site.kind === 'food150' ? 'Tropical food forest' : b.site.kind === 'util150' ? 'Utilities' : 'Factory, utilities, offices, homes';
			el.innerHTML = `<b>${title}</b><span>${sub}</span>`;
			const dims = document.createElement('em');
			if (b.site.kind === 'tower250' && h.plan.tower) dims.textContent = `Ø${h.plan.tower.D} m · ${h.plan.tower.H} m high`;
			else {
				const c = capOf(K.D);
				dims.textContent = `Ø${K.D} m · ${c.h.toFixed(1)} m high · ${Math.round(c.floor).toLocaleString('en-US')} m²`;
			}
			el.appendChild(dims);
			el.dataset.site = b.id;
			el.addEventListener('click', () => pick(b.id, key));
			labelLayer.appendChild(el);
			labels.push({ el, at: new THREE.Vector3(b.x, b.height + 6, b.z), hex: key, small: b.small, dims });
		}
	let showLabels = true, showDims = false;
	const p = new THREE.Vector3();
	function placeLabels() {
		const w = container.clientWidth, hgt = container.clientHeight;
		const dist = camera.position.distanceTo(rig.controls.target);
		for (const l of labels) {
			const live = showLabels && (l.hex === 'living' || l.hex === towerId) && !(l.small && dist > 1300);
			if (!live) {
				l.el.style.display = 'none';
				continue;
			}
			p.copy(l.at).project(camera);
			if (p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) {
				l.el.style.display = 'none';
				continue;
			}
			l.el.style.display = '';
			l.el.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * hgt}px) translate(-50%, -100%)`;
			l.dims.style.display = showDims ? '' : 'none';
		}
	}

	// ── picking ──
	const ray = new THREE.Raycaster();
	const ndc = new THREE.Vector2();
	/** @type {string | null} */
	let picked = null;
	function pick(/** @type {string | null} */ id, /** @type {string | null} */ hex) {
		picked = id;
		for (const l of labels) l.el.classList.toggle('on', l.el.dataset.site === id && l.hex === hex);
		o.onPick?.(id, hex);
	}
	let down = { x: 0, y: 0 };
	const canvas = renderer.domElement;
	const onDown = (/** @type {PointerEvent} */ e) => (down = { x: e.clientX, y: e.clientY });
	const onUp = (/** @type {PointerEvent} */ e) => {
		if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
		const r = canvas.getBoundingClientRect();
		ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
		ray.setFromCamera(ndc, camera);
		const keys = ['living', towerId];
		const hits = keys.flatMap((k) => world.hexes[k].built.map((b) => ({ b, k }))).map(({ b, k }) => ({ b, k, hit: ray.intersectObject(b.hit, false)[0] })).filter((x) => x.hit).sort((a, c) => a.hit.distance - c.hit.distance);
		if (hits[0]) pick(hits[0].b.id, hits[0].k);
		else pick(null, null);
	};
	canvas.addEventListener('pointerdown', onDown);
	canvas.addEventListener('pointerup', onUp);

	// ── flying between the hexes ──
	/** @type {{ from: THREE.Vector3, to: THREE.Vector3, tFrom: THREE.Vector3, tTo: THREE.Vector3, t: number, start: number } | null} */
	let flight = null;
	function focus(/** @type {'living' | 'tower'} */ hex, /** @type {{ x: number, z: number, r: number, h: number } | null} */ on = null) {
		const vv = VIEWS[hex];
		const tTo = on ? new THREE.Vector3(on.x, on.h * 0.35, on.z) : new THREE.Vector3(...vv.target);
		const to = on ? tTo.clone().add(new THREE.Vector3(on.r * 1.4, on.r * 1.2 + on.h * 0.6, on.r * 2.6 + on.h * 0.4)) : new THREE.Vector3(...vv.from);
		flight = { from: camera.position.clone(), to, tFrom: rig.controls.target.clone(), tTo, t: 0, start: performance.now() };
	}

	let frame = 0, last = performance.now();
	const tick = () => {
		const now = performance.now();
		const dt = Math.min(0.1, (now - last) / 1000);
		if (flight) {
			// on the wall clock, so a slow frame never stretches the flight
			flight.t = Math.min(1, (now - flight.start) / 1400);
			const e = flight.t < 0.5 ? 2 * flight.t * flight.t : 1 - (-2 * flight.t + 2) ** 2 / 2;
			camera.position.lerpVectors(flight.from, flight.to, e);
			rig.controls.target.lerpVectors(flight.tFrom, flight.tTo, e);
			if (flight.t >= 1) flight = null;
		}
		rig.update(dt);
		sky.follow(rig.controls.target.x, rig.controls.target.z);
		sky.tick(now);
		renderer.render(scene, camera);
		placeLabels();
		stage.adapt(now);
		last = now;
		frame = requestAnimationFrame(tick);
	};
	tick();

	return {
		/** switch an overlay: landuse, shell, inside, plants, outline, dims, labels */
		set(/** @type {string} */ name, /** @type {boolean} */ on) {
			if (name === 'labels') showLabels = on;
			else {
				if (name === 'dims') showDims = on;
				world.set(name, on);
			}
			renderer.shadowMap.needsUpdate = true;
		},
		/** Tower250 or Tower200 */
		setTower(/** @type {string} */ id) {
			towerId = id;
			world.setTower(id);
			if (picked) pick(null, null);
			renderer.shadowMap.needsUpdate = true;
		},
		focus,
		/** fly to a building */
		focusSite(/** @type {string} */ id, /** @type {string} */ hex) {
			const b = world.hexes[hex]?.built.find((x) => x.id === id);
			if (b) focus(hex === 'living' ? 'living' : 'tower', { x: b.x, z: b.z, r: b.r, h: b.height });
		},
		pick,
		move: rig.move,
		dispose() {
			cancelAnimationFrame(frame);
			canvas.removeEventListener('pointerdown', onDown);
			canvas.removeEventListener('pointerup', onUp);
			for (const l of labels) l.el.remove();
			rig.dispose();
			sky.dispose();
			stage.dispose();
		}
	};
}
