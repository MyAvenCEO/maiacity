// @ts-nocheck — plain JS
/*
 * THE ASSET VIEWER'S CORE — what every viewer that shows a build on the asset stage shares: the repo's own viewer
 * (./AssetViewer.svelte, the Buildings) and a vault's (./VaultAsset.svelte, the avenDB app's Assets), and in part an
 * asset's own page (./AssetPage.svelte) and a plant's card in Sandbox 5 ($lib/sandbox-2/interior/PlantLook.svelte),
 * which keep their own lights. Their bar, panel and readout are drawn by ./ViewerParts.svelte.
 *
 *   openStage   the stage renderer ($lib/render/stage.js) in the viewer's box, and the paper studio on it (./stage.js),
 *               its resolution following the frame rate
 *   camerawork  the camera on what is shown: framed as built, gliding to a new framing, following a plant as it grows,
 *               turning to a part, backing off while it is drawn apart
 *   onTap       a tap on the canvas, not a drag round it
 *   letGoOf     a build let go of, on the stage and on the graphics card
 *   asker       which build asked for is still the one wanted
 *   loop        the frame loop, by the wall clock
 *   safeArea    the part of the canvas no card covers
 *
 * and what the bar offers of a build (`VIEWS`, `viewsOf`, `movesOf`, `tabbed`), and how a reading is written (`num`,
 * `measure`). Nothing here reads the repo's recipes or the vault's: where a build comes from is the viewer's.
 */
import { adaptiveResolution, disposeObject, lowPower, topPixelRatio } from '$lib/render/core.js';
import { fit } from '$lib/app/turntable.js';

/** the stage's views (how it is looked at, any at once), as the bar names them */
export const VIEWS = /** @type {const} */ ([
	['explode', 'Explode'],
	['cut', 'Cut away'],
	['xray', 'X-ray'],
	['labels', 'Labels'],
	['slow', 'Slow']
]);

/** what the bar shows as tabs of a parameter rather than a slider: one with named steps (a plant's stages) */
export const tabbed = (p) => Array.isArray(p.names) && p.names.length > 1 && p.names.length <= 12;

/** the views that apply to build `hero`, a rig drawn apart by its own pose (`rigApart`) exploding as well */
export const viewsOf = (hero, rigApart) =>
	hero ? VIEWS.filter(([k]) => (k === 'explode' ? hero.explodes || !!rigApart : k === 'xray' ? hero.shells.length > 0 : k === 'labels' ? hero.labels.length > 0 : k === 'slow' ? !!hero.view.ticks : true)) : [];

/**
 * The moves build `hero` plays: Grow (stage after stage, a plant's), Run, its own, an actor's clips, Assemble (its
 * build or pitch). A rig's own assemble is its Assemble; its explode is the Explode view, not a move. `play` names its
 * Assemble as its catalog does (a viewer that lists its parts), where that says otherwise.
 * @param {any} hero
 * @param {{ staged?: any, growing?: boolean, rigApart?: string | null, play?: string | null }} o
 * @returns {[string, string][]}
 */
export function movesOf(hero, { staged = null, growing = false, rigApart = null, play = null } = {}) {
	if (!hero) return [];
	const lab = hero.lab ?? null, clips = hero.clips ?? null;
	const out = [];
	if (staged) out.push(['grow', growing ? 'Growing…' : 'Grow']);
	if (lab) out.push(['run', 'Run'], ...Object.entries(lab.moves ?? {}).map(([k, m]) => [k, m.label]));
	for (const c of clips?.clips ?? []) if (!(rigApart && c === 'explode')) out.push([`clip:${c}`, c === 'assemble' ? 'Assemble' : c]);
	if (hero.buildBy) out.push(['assemble', hero.buildBy.id === 'pitch' ? 'Pitch it' : play && play !== 'Build it' ? play : 'Assemble']);
	if (!lab && hero.buildBy && !clips?.clips?.length) out.unshift(['run', 'Still']);
	return out;
}

/** a reading, in English digits */
export const num = (v, digits = 0) => v.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
/** a length in metres, in the unit that reads best */
export const measure = (v) => (v < 0.01 ? `${Math.round(v * 10000) / 10} mm` : v < 1 ? `${Math.round(v * 1000) / 10} cm` : `${Math.round(v * 100) / 100} m`);

/**
 * The stage up in `box`: the stage renderer ($lib/render/stage.js), the canvas in the box, the camera (its field of
 * view widened on an upright canvas, $lib/app/turntable.js) and the controls, the canvas kept to the box, and the paper
 * studio with it (./stage.js); the canvas fitted now, and its resolution following the frame rate, held while `hold`
 * says so (a build being made). A browser that gives the page no 3D drawing throws, with nothing left behind.
 * @param {HTMLElement} box
 * @param {{ onLost?: () => void, hold?: () => boolean }} [o]
 */
export async function openStage(box, { onLost, hold } = {}) {
	const THREE = await import('three');
	const { createStageRenderer } = await import('$lib/render/stage.js');
	const { Stage } = await import('./stage.js');
	const low = lowPower();
	/** @type {any} */
	let view, stage;
	try {
		view = createStageRenderer(box, { pixelRatio: topPixelRatio(low), shadows: 'soft', onLost, fov: 40, turntable: true, fit, onResize: (w, h) => stage?.resize(w, h) });
		stage = new Stage(view.renderer, view.camera, { low });
	} catch (e) {
		view?.dispose?.();
		throw e;
	}
	const { renderer, camera, controls } = view;
	const resize = view.resize;
	resize();
	const adapt = adaptiveResolution(renderer, { top: topPixelRatio(low), hold, onChange: resize });
	return { THREE, view, stage, renderer, camera, controls, low, resize, adapt };
}

/**
 * The camera on what is shown. `framed` is what is shown, as built (its middle and its measure); `frame` puts the
 * camera on it, or on `on` (a part of it), there at once or `smooth`ly from where it is; `reframe` after a new build;
 * `aimAt` turns to a point; and `step` moves it on each frame, by the wall clock, however slow the frames.
 * @param {typeof import('three')} THREE
 * @param {import('three').PerspectiveCamera} camera
 * @param {any} controls
 */
export function camerawork(THREE, camera, controls) {
	/** where the camera stands from what it aims at, for each metre of an asset's reach */
	const BACK = new THREE.Vector3(1.5, 0.7, 1.9);
	const look = new THREE.Vector3();
	const spread = new THREE.Box3(), spreadSize = new THREE.Vector3(), bonePoint = new THREE.Vector3();
	/** how far it spreads now: its meshes, and a rig's bones where they stand (a skin's own bounds stay as bound) */
	const spreadOf = (root) => {
		spread.setFromObject(root);
		root.traverse((o) => o.isBone && spread.expandByPoint(bonePoint.setFromMatrixPosition(o.matrixWorld)));
		return spread.getSize(spreadSize).length();
	};
	/** a framing's aim: a little under its middle, clear of the readout at the foot; its reach, and how far back the camera stands */
	const aimOf = ({ centre, size: s }) => {
		const reach = Math.max(s.x, s.y, s.z, 0.01) * 1.15;
		return { at: centre.clone().add(new THREE.Vector3(0, -0.12 * s.y, 0)), reach, back: reach * BACK.length() };
	};
	const cam = {
		/** @type {{ centre: import('three').Vector3, size: import('three').Vector3 } | null} */
		framed: null,
		/** the camera gliding to a new framing (a plant grown a stage), from where it was */
		glide: null,
		/** the camera following a plant as it grows: where it aims and how far back it stands, the way it looks kept */
		follow: null,
		/** a point the camera turns to (a part tapped) */
		aim: null,
		/** how far the camera has backed off for an asset drawn apart (1: not at all), and how far it wants to */
		apart: { now: 1, want: 1, since: 0 },
		aimOf,
		/** the camera on the asset shown, as built (or on `on`, a part of it): there at once, or `smooth`ly from where it is */
		frame(smooth = false, on = cam.framed) {
			if (!on) return;
			Object.assign(cam.apart, { now: 1, want: 1, since: 0 });
			const { at, reach } = aimOf(on);
			const to = at.clone().addScaledVector(BACK, reach);
			cam.aim = null;
			cam.follow = null;
			cam.glide = smooth ? { t: 0, from: [camera.position.clone(), controls.target.clone()], to: [to, at] } : null;
			if (!smooth) {
				controls.target.copy(at);
				camera.position.copy(to);
			}
			// while it glides, near and far hold both framings
			camera.near = smooth ? Math.min(camera.near, reach / 300) : reach / 300;
			camera.far = smooth ? Math.max(camera.far, reach * 80) : reach * 80;
			camera.updateProjectionMatrix();
		},
		/**
		 * A build shown, `centre` and `size` as built: framed on it when it is a new asset (`fresh`); the same one built
		 * anew keeps the camera where it is, unless it grew or shrank by much (a plant a stage on, its fruit alone): then
		 * the camera glides there; a plant `growing`, the camera follows it as it grows, looking from where it looks.
		 */
		reframe(centre, size, { fresh = false, growing = false } = {}) {
			const before = cam.framed?.size, big = (v) => Math.max(v.x, v.y, v.z, 1e-6);
			const grew = before ? big(size) / big(before) : 1;
			cam.framed = { centre, size };
			if (fresh) cam.frame();
			else if (growing) cam.follow = aimOf(cam.framed);
			else if (grew > 1.25 || grew < 0.8) cam.frame(true);
		},
		/** the camera turned to point `p` (a part's middle), from where it stands */
		aimAt(p) {
			cam.aim = p;
		},
		/**
		 * One frame on: the glide, the follow, the turn to a point, and, `spread` saying the asset is drawn apart
		 * (`{ root, out }`), backing off so every part stays in view and coming back as they close. Not the controls'
		 * own update, which is the viewer's.
		 */
		step(wall, growing = false, spread = null) {
			const { glide, follow, aim, apart } = cam;
			if (glide) {
				const k = Math.min(1, (glide.t += wall) / 0.9), e = k * k * (3 - 2 * k);
				camera.position.lerpVectors(glide.from[0], glide.to[0], e);
				controls.target.lerpVectors(glide.from[1], glide.to[1], e);
				if (k >= 1) cam.glide = null;
			}
			if (follow) {
				const k = 1 - Math.exp(-wall * 4);
				look.copy(camera.position).sub(controls.target);
				controls.target.lerp(follow.at, k);
				const d = look.length();
				look.setLength(d + (follow.back - d) * k);
				camera.position.copy(controls.target).add(look);
				camera.near = Math.min(camera.near, follow.reach / 300);
				camera.far = Math.max(camera.far, follow.reach * 80);
				camera.updateProjectionMatrix();
				if (!growing && Math.abs(follow.back - d) < follow.back * 0.01 && controls.target.distanceTo(follow.at) < follow.reach * 0.01) cam.follow = null;
			}
			if (aim) {
				controls.target.lerp(aim, 0.12);
				if (controls.target.distanceTo(aim) < 0.002) cam.aim = null;
			}
			const framed = cam.framed;
			if (spread && framed && (spread.out || apart.now !== 1)) {
				if ((apart.since += wall) > 0.25) {
					apart.since = 0;
					apart.want = spread.out ? Math.max(1, spreadOf(spread.root) / Math.max(1e-3, framed.size.length())) : 1;
				}
				const next = apart.now + (apart.want - apart.now) * Math.min(1, wall * 3);
				camera.position.sub(controls.target).multiplyScalar(next / apart.now).add(controls.target);
				apart.now = apart.want === 1 && Math.abs(next - 1) < 1e-3 ? 1 : next;
			}
		}
	};
	return cam;
}

/**
 * A tap on `el`, not a drag round it (the pointer moved no more than a few pixels): `then(x, y)` with where it was in
 * the canvas's own terms, -1 to 1 each way, y up.
 * @param {HTMLElement} el @param {(x: number, y: number) => void} then
 */
export function onTap(el, then) {
	/** @type {{ x: number, y: number } | null} */
	let down = null;
	el.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
	el.addEventListener('pointerup', (e) => {
		const was = down;
		down = null;
		if (!was || Math.hypot(e.clientX - was.x, e.clientY - was.y) > 6) return;
		const r = el.getBoundingClientRect();
		then(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
	});
}

/** the build shown (./hero.js), let go of: on `stage`, and on the graphics card */
export const letGoOf = (stage) => (h) => {
	if (!h) return;
	h.dispose();
	if (stage.root === h.root) stage.clear();
	disposeObject(h.root, { textures: false });
};

/**
 * Which build asked for is still the one wanted: `ask()` asks for one and hands back its number, `is(n)` whether it is
 * still the last asked for, and `drop()` wants none (the viewer was left).
 */
export function asker() {
	let last = 0;
	return { ask: () => ++last, is: (n) => n === last, drop: () => void last++ };
}

/**
 * The frame loop: `tick(wall, dt, now)` each frame, `wall` the seconds since the last (to 1 s, for the eases by the
 * wall clock), `dt` the same to 1/20 s (for the stage's own time); the loop stopped by what it hands back.
 * @param {(wall: number, dt: number, now: number) => void} tick
 */
export function loop(tick) {
	let raf = 0, last = performance.now();
	const frame = () => {
		const now = performance.now(), wall = Math.min(1, (now - last) / 1000);
		last = now;
		tick(wall, Math.min(0.05, wall), now);
		raf = requestAnimationFrame(frame);
	};
	frame();
	return () => cancelAnimationFrame(raf);
}

/**
 * The part of the canvas in `box` no card covers, so the labels' text stays in view: a wide card above it, a narrow
 * one at its right or its foot. `inView` counts only a card that is beside the canvas, top to bottom (the vault's
 * viewer, in the page's column).
 * @param {HTMLElement} box @param {{ inView?: boolean }} [o]
 */
export function safeArea(box, { inView = false } = {}) {
	const b = box.getBoundingClientRect();
	const safe = { left: 0, right: b.width, top: 0, bottom: b.height };
	for (const el of (box.closest('.view') ?? (inView ? null : box.parentElement))?.querySelectorAll('.card') ?? []) {
		const r = el.getBoundingClientRect();
		if (!r.width || !r.height || (inView && (r.top >= b.bottom || r.bottom <= b.top))) continue;
		const l = r.left - b.left, t = r.top - b.top;
		if (r.width > b.width * 0.6) safe.top = Math.max(safe.top, t + r.height);
		else if (l > b.width / 2) safe.right = Math.min(safe.right, l);
		else if (t > b.height / 2) safe.bottom = Math.min(safe.bottom, t);
	}
	return safe;
}
