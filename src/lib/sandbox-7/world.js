/**
 * SANDBOX 6 · ONE VILLAGE · ON THE PAGE — the stage, the sky and the map camera of the sandbox kit round the village's
 * seven hexes (./scene.js), the labels over the hexes and buildings drawn in HTML, and a click to pick a building.
 *
 *   look     drag turns and tilts, the wheel zooms, WASD travels (the kit's orbit rig)
 *   pick     click a dome or the tower to see its numbers
 *   focus    the page flies over the whole village, the tower hex or one living hex
 *   labels   from afar one label a hex; closer, the buildings round where the camera looks, and with the land-use map on
 *            each patch of outdoor land, its use and size
 */
import * as THREE from 'three';
import { createOrbitRig, createSky, createStage, skyTime } from '$lib/sandbox-kit';
import { buildWorld } from './scene.js';
import { VILLAGE, USES, landPatches } from './layout.js';
import { KINDS, capOf } from './specs.js';

/** the hour the sky shows on Auto */
export const MORNING = 11.5;

/** where the camera looks from: over the village, or over a hex (from the south-east, as high as it is far) */
const VILLAGE_VIEW = { target: [0, 0, 60], from: [700, 1350, 1750] };
const hexView = (/** @type {number} */ x, /** @type {number} */ z, tower = false) => ({ target: [x, tower ? 50 : 0, z + 20], from: [x + 280, tower ? 400 : 420, z + 620] });

/**
 * @param {HTMLElement} container
 * @param {HTMLElement} labelLayer where the labels go
 * @param {{ onPick?: (id: string | null, hex: string | null) => void, onProgress?: (label: string) => void, people?: (hex: string) => string }} [o]
 */
export function mountWorld(container, labelLayer, o = {}) {
	const stage = createStage(container, { fov: 42, near: 2, far: 12000, maxPixelRatio: 1.5 });
	const { renderer, scene, camera } = stage;
	// the village has no clock of its own: on Auto the sky stands at late morning, Manual sets the hour by hand
	const sky = createSky(renderer, scene, { clock: () => (skyTime.auto ? MORNING : skyTime.hour), shadowReach: 560, shadowMap: 4096, shadowFar: 3600, lightDistance: 1700, shadowGrid: 32, fog: { near: 3200, far: 11000 } });
	o.onProgress?.('Laying out the village');
	const world = buildWorld(scene, VILLAGE, o.onProgress);

	const v = VILLAGE_VIEW;
	camera.position.set(v.from[0], v.from[1], v.from[2]);
	const rig = createOrbitRig(camera, renderer.domElement, { minDistance: 15, maxDistance: 5200, target: new THREE.Vector3(...v.target), floorY: 3, moveSpeed: 320 });

	// ── labels ──
	/** @type {{ el: HTMLElement, at: THREE.Vector3, hex: string, small: boolean, whole: boolean, dims: HTMLElement | null, land?: boolean }[]} */
	const labels = [];
	for (const [key, h] of Object.entries(world.hexes)) {
		// the hex's own label, for the view from afar
		const el = document.createElement('div');
		el.className = 'lbl hex';
		el.innerHTML = `<b>${h.label}</b><span>${o.people?.(key) ?? ''}</span>`;
		el.addEventListener('click', () => focusHex(key));
		labelLayer.appendChild(el);
		labels.push({ el, at: new THREE.Vector3(h.x, h.plan.tower ? h.plan.tower.H + 20 : 60, h.z), hex: key, small: false, whole: true, dims: null });
		for (const b of h.built) {
			const el = document.createElement('div');
			el.className = 'lbl';
			const K = KINDS[b.site.kind];
			const title = b.site.kind === 'tower' ? (h.plan.tower?.label ?? 'Tower') : b.site.kind === 'factory120' ? b.site.name : K.label;
			const sub = b.site.kind === 'factory120' ? 'Dome120 factory' : b.site.kind === 'dome40' || b.site.kind === 'dome80' ? `${K.people} people, ${K.storeys} storeys` : b.site.kind === 'food120' ? 'Tropical food forest' : b.site.kind === 'util120' ? 'Utilities' : 'Factory, utilities, offices, homes';
			el.innerHTML = `<b>${title}</b><span>${sub}</span>`;
			const dims = document.createElement('em');
			if (b.site.kind === 'tower' && h.plan.tower) dims.textContent = `Ø${h.plan.tower.D} m · ${h.plan.tower.H} m high`;
			else {
				const c = capOf(K.D);
				dims.textContent = `Ø${K.D} m · ${c.h.toFixed(1)} m high · ${Math.round(c.floor).toLocaleString('en-US')} m²`;
			}
			el.appendChild(dims);
			el.dataset.site = b.id;
			el.dataset.hex = key;
			el.addEventListener('click', () => pick(b.id, key));
			labelLayer.appendChild(el);
			labels.push({ el, at: new THREE.Vector3(b.x, b.height + 6, b.z), hex: key, small: b.small, whole: false, dims });
		}
	}
	// the land's patches, worked out once a plan (the living hexes share two)
	/** @type {Map<object, ReturnType<typeof landPatches>>} */
	const patchesOf = new Map();
	for (const [key, h] of Object.entries(world.hexes)) {
		if (!patchesOf.has(h.land)) patchesOf.set(h.land, landPatches(h.land));
		for (const q of patchesOf.get(h.land) ?? []) {
			const el = document.createElement('div');
			el.className = 'lbl land';
			el.innerHTML = `<b><i style="background:${USES[q.use].map}"></i>${USES[q.use].label}</b><span>${(q.m2 / 1e4).toFixed(1)} ha</span>`;
			// first in the layer, so the buildings' labels stand over them
			labelLayer.prepend(el);
			labels.push({ el, at: new THREE.Vector3(q.x + h.x, 2, q.z + h.z), hex: key, small: false, whole: false, dims: null, land: true });
		}
	}
	let showLabels = true, showDims = false, showLand = false;
	const p = new THREE.Vector3();
	function placeLabels() {
		const w = container.clientWidth, hgt = container.clientHeight;
		const t = rig.controls.target;
		const dist = camera.position.distanceTo(t);
		// from afar a label a hex; closer, the buildings within reach of where the camera looks
		const far = dist > 1600;
		const reach = Math.max(420, dist * 0.75);
		for (const l of labels) {
			const live = showLabels && (!l.land || showLand) && (far ? l.whole : !l.whole && Math.hypot(l.at.x - t.x, l.at.z - t.z) < reach && !(l.small && dist > 1100));
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
			if (l.dims) l.dims.style.display = showDims ? '' : 'none';
		}
	}

	// ── picking ──
	const ray = new THREE.Raycaster();
	const ndc = new THREE.Vector2();
	/** @type {string | null} */
	let picked = null;
	function pick(/** @type {string | null} */ id, /** @type {string | null} */ hex) {
		picked = id;
		for (const l of labels) l.el.classList.toggle('on', !l.whole && !l.land && l.el.dataset.site === id && l.hex === hex);
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
		const keys = Object.keys(world.hexes);
		const hits = keys.flatMap((k) => world.hexes[k].built.map((b) => ({ b, k }))).map(({ b, k }) => ({ b, k, hit: ray.intersectObject(b.hit, false)[0] })).filter((x) => x.hit).sort((a, c) => a.hit.distance - c.hit.distance);
		if (hits[0]) pick(hits[0].b.id, hits[0].k);
		else pick(null, null);
	};
	canvas.addEventListener('pointerdown', onDown);
	canvas.addEventListener('pointerup', onUp);

	// ── flying over the village ──
	/** @type {{ from: THREE.Vector3, to: THREE.Vector3, tFrom: THREE.Vector3, tTo: THREE.Vector3, t: number, start: number } | null} */
	let flight = null;
	/** fly to a view, or to a building (its middle, radius and height) */
	function fly(/** @type {{ target: number[], from: number[] }} */ vv, /** @type {{ x: number, z: number, r: number, h: number } | null} */ on = null) {
		const tTo = on ? new THREE.Vector3(on.x, on.h * 0.35, on.z) : new THREE.Vector3(...vv.target);
		const to = on ? tTo.clone().add(new THREE.Vector3(on.r * 1.4, on.r * 1.2 + on.h * 0.6, on.r * 2.6 + on.h * 0.4)) : new THREE.Vector3(...vv.from);
		flight = { from: camera.position.clone(), to, tFrom: rig.controls.target.clone(), tTo, t: 0, start: performance.now() };
	}
	/** fly over the whole village, or a hex by its key */
	function focusHex(/** @type {string} */ key) {
		const h = world.hexes[key];
		fly(h ? hexView(h.x, h.z, !!h.plan.tower) : VILLAGE_VIEW);
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
				if (name === 'landuse') showLand = on;
				world.set(name, on);
			}
			renderer.shadowMap.needsUpdate = true;
		},
		focusHex,
		/** fly to a building */
		focusSite(/** @type {string} */ id, /** @type {string} */ hex) {
			const b = world.hexes[hex]?.built.find((x) => x.id === id);
			if (b) fly(VILLAGE_VIEW, { x: b.x, z: b.z, r: b.r, h: b.height });
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
