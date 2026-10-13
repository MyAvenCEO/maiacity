/**
 * SANDBOX 6 · ONE VILLAGE · ON THE PAGE — the stage, the sky and the map camera of the sandbox kit round the village's
 * seven hexes (./scene.js), the labels over the hexes and buildings drawn in HTML, and a click to pick a building.
 *
 *   look     drag turns and tilts, the wheel zooms, WASD travels (the kit's orbit rig)
 *   pick     click a dome or the tower to see its numbers
 *   focus    the page flies over the whole village, the tower hex or one living hex
 *   labels   from afar one label a hex; closer, the buildings round where the camera looks, and with the land-use map on
 *            each patch of outdoor land, its use and size
 *   time     the build-out (./buildout.js) at a month: only what is begun stands, its labels and picks with it
 */
import * as THREE from 'three';
import { createOrbitRig, createSky, createStage, skyTime } from '$lib/sandbox-kit';
import { buildWorld } from './scene.js';
import { VILLAGE, USES, landPatches } from './layout.js';
import { KINDS, capOf } from './specs.js';
import { phaseAt } from './buildout.js';

/** the hour the sky shows on Auto */
export const MORNING = 11.5;

/** where the camera looks from: over the village, or over a hex (from the south-east, as high as it is far) */
const VILLAGE_VIEW = { target: [0, 0, 60], from: [700, 1350, 1750] };
const hexView = (/** @type {number} */ x, /** @type {number} */ z, tower = false) => ({ target: [x, tower ? 50 : 0, z + 20], from: [x + 280, tower ? 400 : 420, z + 620] });

/**
 * The scene's timeline at month t of a build-out plan: each dome's phase and how far through it, the camp, how grown
 * the planted land is (drawn reaching its full size in ~10 years for the food forest, ~15 for the timber woods, ~4 for
 * bamboo), the geothermal works, and a line for each hex's label.
 * @param {any} plan @param {number} t
 */
export function timelineAt(plan, t) {
	/** @type {Record<string, Record<string, { phase: string, f: number }>>} */
	const sites = {};
	/** @type {Record<string, { done: number, of: number, up: number, beds: number }>} */
	const count = {};
	/** @type {Record<string, any>} */
	const byId = {};
	for (const s of plan.steps) {
		byId[s.id] = s;
		if (!s.phases.some((/** @type {any} */ p) => p.id === 'shell')) continue;
		const a = phaseAt(s, t);
		const i = s.phases.findIndex((/** @type {any} */ p) => p.id === a.phase);
		const from = i > 0 ? s.phases[i - 1].to : 0, to = i >= 0 ? s.phases[i].to : 1;
		const f = a.phase === 'none' ? 0 : a.phase === 'done' ? 1 : Math.min(1, Math.max(0, (a.p - from) / Math.max(1e-6, to - from)));
		(sites[s.hex] ??= {})[s.site] = { phase: a.phase, f };
		const c = (count[s.hex] ??= { done: 0, of: 0, up: 0, beds: 0 });
		c.of++;
		if (a.phase === 'done') {
			c.done++;
			c.beds += s.beds ?? 0;
		} else if (a.phase !== 'none') c.up++;
	}
	const mo = plan.months[Math.max(0, Math.min(plan.months.length - 1, Math.floor(t)))];
	// the camp: its containers set as the starter camp (or a move) goes on
	/** @type {{ hex: string, n: Record<string, number> } | null} */
	let camp = null;
	// the camp stands from the day its first container is set until every home is built
	const first = plan.steps.find((/** @type {any} */ s) => s.kind === 'camp');
	const gone = plan.totals.campGone;
	const campHex = mo.camp ?? (first && first.start !== null && t >= first.start && (gone === null || t < gone) ? first.hex : null);
	if (campHex) {
		const step = byId[`${campHex}/camp`];
		const p = step ? Math.max(0.12, phaseAt(step, t).p) : 1;
		/** @type {Record<string, number>} */
		const n = {};
		for (const k of plan.kit.items) if (['live', 'sanitary', 'kitchen', 'workshop', 'office'].includes(k.id)) n[k.id] = Math.max(k.id === 'live' ? 1 : 0, Math.round(k.n * p));
		camp = { hex: campHex, n };
	}
	const age = (/** @type {string} */ id) => {
		const s = byId[id];
		return !s || s.start === null || t < s.start ? null : t - s.start;
	};
	const grown = (/** @type {number | null} */ a, /** @type {number} */ first, /** @type {number} */ months) => (a === null ? 0 : Math.min(1, first + ((1 - first) * a) / months));
	/** @type {Record<string, Record<string, number>>} */
	const grow = {};
	for (const h of VILLAGE) {
		if (h.plan.tower) {
			const a = age(`${h.key}/fields`);
			grow[h.key] = { woods: grown(a, 0.12, 180), bamboo: grown(a, 0.2, 48), forest: grown(a, 0.15, 120) };
		} else grow[h.key] = { forest: grown(age(`${h.key}/forest`), 0.15, 120), woods: 1, bamboo: 1 };
	}
	const geoStep = plan.steps.find((/** @type {any} */ s) => s.kind === 'geothermal');
	const geothermal = geoStep ? phaseAt(geoStep, t).phase : 'none';
	/** @type {Record<string, string>} */
	const hexText = {};
	/** @type {Record<string, string>} */
	const hexHead = {};
	for (const h of VILLAGE) {
		const c = count[h.key];
		const st = plan.settlements?.find((/** @type {any} */ x) => x.key === h.key);
		const coop = st?.coop ?? '';
		hexHead[h.key] = coop || h.label;
		const founded = st?.founded ?? null;
		if (!c || (c.done === 0 && c.up === 0)) hexText[h.key] = founded !== null && t >= founded ? `founded ${plan.months[Math.min(founded, plan.months.length - 1)]?.label ?? ''} · roads and planting` : `Not begun${founded !== null ? ` · starts ${plan.months[Math.min(founded, plan.months.length - 1)]?.label ?? ''}` : ''}`;
		else hexText[h.key] = `${c.done} of ${c.of} domes${c.up ? ` (+${c.up})` : ''}${c.beds ? ` · ${c.beds.toLocaleString('en-US')} beds` : ''}${campHex === h.key ? ` · camp ${plan.kit.campBeds}` : ''}`;
	}
	/** @type {Record<string, boolean>} */
	const begun = {};
	for (const st of plan.settlements ?? []) begun[st.key] = st.founded !== null && t >= st.founded;
	return { sites, camp, grow, geothermal, hexText, hexHead, begun, cranes: true };
}

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
	/** @type {{ el: HTMLElement, at: THREE.Vector3, hex: string, small: boolean, whole: boolean, dims: HTMLElement | null, land?: boolean, site?: string, only?: string, sub?: HTMLElement | null, head?: HTMLElement | null, title?: string }[]} */
	const labels = [];
	for (const [key, h] of Object.entries(world.hexes)) {
		// the hex's own label, for the view from afar
		const el = document.createElement('div');
		el.className = 'lbl hex';
		el.innerHTML = `<b>${h.label}</b><span>${o.people?.(key) ?? ''}</span>`;
		el.addEventListener('click', () => focusHex(key));
		labelLayer.appendChild(el);
		labels.push({ el, at: new THREE.Vector3(h.x, h.plan.tower ? h.plan.tower.H + 20 : 60, h.z), hex: key, small: false, whole: true, dims: null, sub: el.querySelector('span'), head: el.querySelector('b'), title: h.label });
		for (const b of h.built) {
			const el = document.createElement('div');
			el.className = 'lbl';
			const K = KINDS[b.site.kind];
			const title = b.site.kind === 'tower' ? (h.plan.tower?.label ?? 'Tower') : b.site.kind === 'factory120' ? b.site.name : K.label;
			const sub = b.site.kind === 'factory120' ? 'Dome120 factory' : b.site.kind === 'dome40' || b.site.kind === 'dome80' ? `${K.people} people, ${K.storeys} storeys` : b.site.kind === 'food120' ? 'Food forest under glass' : b.id === 'centre' ? 'Utilities and community halls' : b.site.kind === 'util120' ? 'Utilities' : 'Factory, utilities, offices, homes';
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
			labels.push({ el, at: new THREE.Vector3(b.x, b.height + 6, b.z), hex: key, small: b.small, whole: false, dims, site: b.id, only: b.only });
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
	/** on the timeline: what stands at the moment shown, by hex and site (null: the finished village) @type {Record<string, Record<string, { phase: string, f?: number }>> | null} */
	let at = null;
	/** whether a building is there to label and pick: the finished village has the tower, the timeline the centre's Dome120 and what is begun */
	const there = (/** @type {string} */ hex, /** @type {string | undefined} */ site, /** @type {string | undefined} */ only) => {
		if (!site) return true;
		if (only && only !== (at ? 'timeline' : 'finished')) return false;
		return !at || (at[hex]?.[site]?.phase ?? 'done') !== 'none';
	};
	const p = new THREE.Vector3();
	function placeLabels() {
		const w = container.clientWidth, hgt = container.clientHeight;
		const t = rig.controls.target;
		const dist = camera.position.distanceTo(t);
		// from afar a label a hex; closer, the buildings within reach of where the camera looks
		const far = dist > 1600;
		const reach = Math.max(420, dist * 0.75);
		for (const l of labels) {
			const live = showLabels && (!l.land || showLand) && there(l.hex, l.site, l.only) && (far ? l.whole : !l.whole && Math.hypot(l.at.x - t.x, l.at.z - t.z) < reach && !(l.small && dist > 1100));
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
		const hits = keys.flatMap((k) => world.hexes[k].built.filter((b) => there(k, b.id, b.only)).map((b) => ({ b, k }))).map(({ b, k }) => ({ b, k, hit: ray.intersectObject(b.hit, false)[0] })).filter((x) => x.hit).sort((a, c) => a.hit.distance - c.hit.distance);
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
		/**
		 * Show the build-out plan at month t (a fraction runs within the month), or the finished village (plan null).
		 * @param {any} plan buildPlan()'s plan
		 * @param {number} t
		 */
		setTime(plan, t) {
			if (!plan) {
				at = null;
				world.timeline(null);
				for (const l of labels)
					if (l.whole) {
						if (l.sub) l.sub.textContent = o.people?.(l.hex) ?? '';
						if (l.head) l.head.textContent = l.title ?? '';
					}
				renderer.shadowMap.needsUpdate = true;
				return;
			}
			const T = timelineAt(plan, t);
			at = T.sites;
			world.timeline(T);
			for (const l of labels)
				if (l.whole) {
					if (l.sub) l.sub.textContent = T.hexText[l.hex] ?? '';
					if (l.head) l.head.textContent = T.hexHead[l.hex] ?? l.title ?? '';
				}
			renderer.shadowMap.needsUpdate = true;
		},
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
