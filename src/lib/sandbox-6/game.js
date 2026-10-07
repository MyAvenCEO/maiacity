/**
 * SANDBOX 6 · THE GAME — the valley on a page: the stage, the sky and the map camera of the sandbox kit, the
 * simulation (./sim.js) run on the clock at the speed chosen, the view (./view.js) drawing it, and the player's hand:
 *
 *   look      click a building or a flag to see it (a rival building to attack it)
 *   build     a building chosen in the menu: the green spots are where it may stand; click one, and a road to the
 *             nearest flag of your network comes with it
 *   road      click a flag (or a building, for its flag), then where the road should go: it finds its way round
 *             what stands there, and sets a flag at its end; go on from that flag, Esc to stop
 *   flag      set a flag, on open ground or on a road (it splits the road: two carriers share it)
 *   demolish  tear down a building, a flag (with its roads) or a road
 *
 * The game saves itself in the browser now and then and goes on where it was. On film (`film: true`) it is always the
 * same valley, played by ./autoplay.js, on the shot's clock: the same shot renders the same frames.
 */
import * as THREE from 'three';
import { connectFilm, createOrbitRig, createSky, createStage, filmDraws, filmHoldsSize, skyTime, worldTime } from '$lib/sandbox-kit';
import { createView } from './view.js';
import { loadGame, newGame, PLAYER, TICK } from './sim.js';
import { createAutoplay } from './autoplay.js';

const SAVE = 'maiacity:sandbox-6:game';
/** the film's valley, and how long it has been played before a shot starts */
const FILM_SEED = 7, FILM_START = 1200;

/** @typedef {'look' | 'build' | 'road' | 'flag' | 'demolish'} Mode */
/** @typedef {{ k: 'building' | 'flag' | 'road', id: number, node: number } | null} Selection */

/**
 * @param {HTMLElement} container
 * @param {{
 *   film?: boolean,
 *   onSelect?: (s: Selection) => void,
 *   onMode?: (mode: Mode, type: string) => void,
 *   onHint?: (text: string) => void,
 *   onProgress?: (label: string) => void
 * }} [o]
 */
export function mountGame(container, o = {}) {
	const film = !!o.film;
	const stage = createStage(container, { fov: 42, far: 1600, maxPixelRatio: 1.5 });
	const { renderer, scene, camera } = stage;
	o.onProgress?.('Growing the valley');
	let sim = film ? filmGame(FILM_START) : (restore() ?? newGame(Math.floor(Math.random() * 1e6)));
	// the valley keeps its own day (Auto): from morning to late afternoon and back over forty minutes of play, never
	// a night to farm in the dark; Manual is the time control's hour, as in every sandbox
	const sky = createSky(renderer, scene, {
		shadowReach: 70,
		shadowMap: 2048,
		fog: { near: 160, far: 520 },
		clock: () => (skyTime.auto ? 12 + 4.5 * Math.sin((sim.state.time / 2400) * Math.PI * 2 - 0.6) : skyTime.hour)
	});
	let view = createView(scene, sim);
	const home = () => view.place(sim.state.buildings[sim.state.hq]?.node ?? 0);
	const start = home();
	camera.position.set(start.x - 3, start.y + 40, start.z + 32);
	const rig = createOrbitRig(camera, renderer.domElement, { minDistance: 7, maxDistance: 130, target: start, floorY: 1.5, moveSpeed: 32 });

	/** a valley played by the autoplayer up to `t` seconds: the same valley every time */
	function filmGame(/** @type {number} */ t) {
		const s = newGame(FILM_SEED);
		const auto = createAutoplay(s, { attack: false });
		for (let k = 0; s.state.time < t; k++) {
			if (k % 30 === 0) auto.tick();
			s.step(TICK);
		}
		return s;
	}
	function restore() {
		try {
			const saved = localStorage.getItem(SAVE);
			return saved ? loadGame(saved) : null;
		} catch {
			return null;
		}
	}
	function save() {
		if (film) return;
		try {
			localStorage.setItem(SAVE, JSON.stringify(sim.state));
		} catch {
			// a full or closed storage: the game goes on, unsaved
		}
	}

	// ── the player's hand ──
	/** @type {Mode} */
	let mode = 'look';
	let buildType = '';
	let roadFrom = -1;
	/** @type {Selection} */
	let selected = null;
	const ray = new THREE.Raycaster();
	const ndc = new THREE.Vector2();
	const canvas = renderer.domElement;
	function aim(/** @type {{ clientX: number, clientY: number }} */ e) {
		const r = canvas.getBoundingClientRect();
		ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
		ray.setFromCamera(ndc, camera);
	}
	function nodeAt(/** @type {{ clientX: number, clientY: number }} */ e) {
		aim(e);
		const hit = ray.intersectObject(view.land, false)[0];
		if (hit) return sim.grid.at(hit.point.x, hit.point.z);
		// over the sea: where the ray meets the water
		const p = new THREE.Vector3();
		return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.3), p) ? sim.grid.at(p.x, p.z) : -1;
	}
	const hint = (/** @type {string} */ text) => o.onHint?.(text);
	function setMode(/** @type {Mode} */ m, type = '') {
		mode = m;
		buildType = m === 'build' ? type : '';
		roadFrom = -1;
		view.road(null);
		view.ghost('', -1, false);
		view.hover(-1);
		refreshSpots();
		if (m === 'road' && selected?.k === 'flag') startRoad(selected.node);
		else if (m === 'road' && selected?.k === 'building') startRoad(sim.grid.nb(selected.node, 5));
		hint(m === 'build' ? 'Click a green spot to build there' : m === 'road' ? (roadFrom >= 0 ? 'Click where the road should go' : 'Click a flag to start a road from') : m === 'flag' ? 'Click open ground or a road to set a flag' : m === 'demolish' ? 'Click a building, a flag or a road to tear it down' : '');
		o.onMode?.(mode, buildType);
	}
	function refreshSpots() {
		if (mode !== 'build' || !buildType) return view.spots([]);
		const list = [];
		for (let n = 0; n < sim.grid.N; n++) if (sim.state.owner[n] === PLAYER && !sim.canBuild(buildType, n)) list.push(n);
		view.spots(list);
	}
	function startRoad(/** @type {number} */ n) {
		const at = sim.at(n);
		if (at?.k === 'flag' && sim.state.flags[at.id].owner === PLAYER) {
			roadFrom = n;
			view.select(n);
			hint('Click where the road should go · Esc to stop');
			return true;
		}
		return false;
	}
	function select(/** @type {Selection} */ s) {
		selected = s;
		view.select(s ? s.node : -1);
		o.onSelect?.(s);
	}
	function click(/** @type {PointerEvent} */ e) {
		const n = nodeAt(e);
		if (mode === 'look') {
			aim(e);
			const bid = view.pickBuilding(ray);
			if (bid) return select({ k: 'building', id: bid, node: sim.state.buildings[bid].node });
			const at = sim.at(n);
			if (at?.k === 'building' || at?.k === 'flag') return select({ k: at.k, id: /** @type {number} */ (at.id), node: n });
			if (at?.k === 'road') return select({ k: 'road', id: /** @type {number} */ (at.id), node: n });
			return select(null);
		}
		if (n < 0) return;
		if (mode === 'build') {
			const r = sim.build(buildType, n, true);
			if (!r.ok) return hint(/** @type {string} */ (r.why));
			const id = /** @type {number} */ (r.id);
			setMode('look');
			select({ k: 'building', id, node: n });
			hint(r.linked ? '' : 'No road could reach it: draw one from its flag');
			return;
		}
		if (mode === 'flag') {
			const r = sim.flag(n);
			hint(r.ok ? 'Flag set' : /** @type {string} */ (r.why));
			return;
		}
		if (mode === 'demolish') {
			const r = sim.demolish(n);
			if (r.ok) {
				select(null);
				hint('Torn down');
			} else hint(/** @type {string} */ (r.why));
			refreshSpots();
			return;
		}
		if (mode === 'road') {
			if (roadFrom < 0) {
				const at = sim.at(n);
				const flagNode = at?.k === 'building' ? sim.grid.nb(n, 5) : n;
				if (!startRoad(flagNode)) hint('Start a road at one of your flags');
				return;
			}
			if (n === roadFrom) return setMode('look');
			const wasFlag = sim.at(n)?.k === 'flag';
			const r = sim.road(roadFrom, n);
			if (!r.ok) return hint(/** @type {string} */ (r.why));
			view.road(null);
			if (wasFlag) {
				hint('Road built');
				setMode('look');
			} else startRoad(n);
		}
	}
	function hoverAt(/** @type {PointerEvent} */ e) {
		if (mode === 'look') return;
		const n = nodeAt(e);
		if (mode === 'build') {
			const why = n < 0 ? 'Off the map' : sim.canBuild(buildType, n);
			view.ghost(buildType, n, !why);
			view.hover(n, why ? '#ff7a6a' : '#9dff8a');
			hint(why || 'Click to build here');
		} else if (mode === 'road' && roadFrom >= 0) {
			const path = n >= 0 ? sim.planRoad(roadFrom, n) : null;
			view.road(path);
			view.hover(n, path ? '#fff6c8' : '#ff7a6a');
			hint(path ? `A road ${path.length - 1} steps long · click to build it` : 'No way for a road there');
		} else if (mode === 'flag') {
			const why = n < 0 ? 'Off the map' : sim.canFlag(n);
			view.hover(n, why ? '#ff7a6a' : '#9dff8a');
			hint(why || 'Click to set a flag');
		} else if (mode === 'demolish') {
			const at = sim.at(n);
			const mine = at && (at.k === 'building' ? sim.state.buildings[at.id]?.owner === PLAYER : at.k === 'flag' ? sim.state.flags[at.id]?.owner === PLAYER : at.k === 'road');
			view.hover(n, mine ? '#ff7a6a' : '#ffffff');
			hint(mine ? `Click to tear down this ${at.k}` : 'Nothing of yours to tear down here');
		} else view.hover(n);
	}

	/** a press that comes up where it went down, soon, is a click; anything else turned the map */
	let press = /** @type {{ x: number, y: number, t: number } | null} */ (null);
	const onDown = (/** @type {PointerEvent} */ e) => {
		if (e.button === 2 && mode !== 'look') return setMode('look');
		press = { x: e.clientX, y: e.clientY, t: e.timeStamp };
	};
	const onUp = (/** @type {PointerEvent} */ e) => {
		const p = press;
		press = null;
		if (!p || e.button !== 0 || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 7 || e.timeStamp - p.t > 500) return;
		click(e);
	};
	/** the cursor's latest place, looked at once a frame */
	let hoverFrame = 0;
	/** @type {PointerEvent | null} */
	let moved = null;
	const onMove = (/** @type {PointerEvent} */ e) => {
		if (e.pointerType !== 'mouse') return;
		moved = e;
		if (hoverFrame) return;
		hoverFrame = requestAnimationFrame(() => {
			hoverFrame = 0;
			if (moved) hoverAt(moved);
		});
	};
	const onKey = (/** @type {KeyboardEvent} */ e) => {
		const t = /** @type {HTMLElement | null} */ (e.target);
		if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
		if (e.key === 'Escape') {
			if (mode !== 'look') setMode('look');
			else select(null);
		} else if (e.key === 'r' || e.key === 'R') setMode('road');
		else if (e.key === 'f' || e.key === 'F') setMode('flag');
		else if (e.key === 'x' || e.key === 'X') setMode('demolish');
		else if (e.key === ' ') {
			e.preventDefault();
			paused = !paused;
			o.onMode?.(mode, buildType);
		}
	};
	canvas.addEventListener('pointerdown', onDown);
	canvas.addEventListener('pointerup', onUp);
	canvas.addEventListener('pointermove', onMove);
	canvas.addEventListener('contextmenu', (e) => e.preventDefault());
	window.addEventListener('keydown', onKey);

	// ── the clock ──
	let speed = 1;
	let paused = false;
	let acc = 0;
	/** bring the valley on to a time (a film's shot clock: from its start, the same valley every time) */
	function simTo(/** @type {number} */ t) {
		if (film && t < sim.state.time - 1e-6) {
			view.dispose();
			sim = filmGame(FILM_START);
			view = createView(scene, sim);
		}
		const auto = film ? createAutoplay(sim, { attack: false }) : null;
		for (let k = 0; sim.state.time < t - 1e-6; k++) {
			if (auto && k % 30 === 0) auto.tick();
			sim.step(TICK);
		}
	}
	let frame = 0, last = performance.now(), spotsClock = 0, saveClock = performance.now();
	const tick = () => {
		const now = performance.now();
		const real = Math.min(0.5, (now - last) / 1000);
		const dt = Math.min(0.1, real);
		last = now;
		const wt = worldTime();
		if (wt !== undefined) simTo(FILM_START + wt);
		else if (!paused) {
			acc += real * speed;
			let steps = 0;
			while (acc >= TICK && steps++ < 80) {
				sim.step(TICK);
				acc -= TICK;
			}
			if (film && steps) createAutoplay(sim, { attack: false }).tick();
		}
		if (mode === 'build' && now - spotsClock > 1000) {
			spotsClock = now;
			refreshSpots();
		}
		if (now - saveClock > 15000) {
			saveClock = now;
			save();
		}
		rig.update(dt);
		sky.follow(rig.controls.target.x, rig.controls.target.z);
		sky.tick(now);
		view.update(wt ?? now / 1000);
		if (!filmDraws()) renderer.render(scene, camera);
		stage.adapt(now, filmHoldsSize());
		frame = requestAnimationFrame(tick);
	};
	tick();
	const onHide = () => document.visibilityState === 'hidden' && save();
	document.addEventListener('visibilitychange', onHide);
	window.addEventListener('pagehide', save);

	// the studio can shoot it
	const filmHold = connectFilm({ sandbox: 'sandbox-6', renderer, scene, camera, hold: rig, sky, animate: (t) => (simTo(FILM_START + t), view.update(t)), extra: { game: () => sim } });

	/** fly the map to a node, keeping the angle it looks from */
	function focus(/** @type {number} */ n) {
		const p = view.place(n);
		const off = camera.position.clone().sub(rig.controls.target);
		rig.controls.target.copy(p);
		camera.position.copy(p).add(off);
	}

	return {
		get sim() {
			return sim;
		},
		setMode,
		get mode() {
			return mode;
		},
		select,
		focus,
		/** the speed of the clock: 0 pauses */
		setSpeed(/** @type {number} */ s) {
			if (s === 0) paused = true;
			else {
				paused = false;
				speed = s;
			}
		},
		get speed() {
			return paused ? 0 : speed;
		},
		/** a fresh valley */
		restart() {
			view.dispose();
			sim = newGame(Math.floor(Math.random() * 1e6));
			view = createView(scene, sim);
			select(null);
			setMode('look');
			focus(sim.state.buildings[sim.state.hq].node);
			paused = false;
			save();
		},
		save,
		move: rig.move,
		dispose() {
			save();
			cancelAnimationFrame(frame);
			document.removeEventListener('visibilitychange', onHide);
			window.removeEventListener('pagehide', save);
			window.removeEventListener('keydown', onKey);
			filmHold.disconnect();
			rig.dispose();
			view.dispose();
			sky.dispose();
			stage.dispose();
		}
	};
}
