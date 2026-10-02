// The world viewer: a live sandbox in film mode (contract C3), in an iframe of the same origin, slaved to the
// timeline's clock through `window.__film`. It draws the exact frame of a world shot the timeline asks for — at proxy
// level, through the same view transform as the proxies — and records a camera move flown by hand.
//
// Each shot names its world (game/film/worlds.js): the iframe holds one world at a time — the one the clip under the
// playhead is in — and moves to another world's film page when the timeline cuts to it. While it does, and whenever
// the iframe never grows a `__film`, the program monitor falls back to the shot's HD proxy, else to a drawn
// placeholder (the shot's name, time, hour and camera) — see `placeholder()`.
import { SvelteSet } from 'svelte/reactivity';
import { forwardConsole } from '$lib/native';
import { filmPath } from '../../../game/film/worlds.js';

/** @typedef {import('$lib/auth/client').Cdl} Cdl */
/** @typedef {import('$lib/auth/client').CameraKey} CameraKey */
/** @typedef {import('$lib/auth/client').Shape} Shape */
/** @typedef {import('$lib/auth/client').ShotSpec} ShotSpec */
/** What film mode draws a frame through: the clip's grade and the output LUT, cubes the Mac bakes (RGB triples, red fastest). */
/** @typedef {{ lut: { size: number, data: Float32Array } | null, grade: { size: number, data: Float32Array } | null }} FilmView */
/** @typedef {{ spec: ShotSpec, t: number, shape: Shape, width: number, height: number, view: FilmView }} ShowArgs */
/**
 * The film-mode API of a sandbox (contract C3).
 * @typedef {{
 *   ready(): Promise<void>,
 *   prepare(specs: ShotSpec[]): Promise<void>,
 *   show(o: ShowArgs): void | Promise<void>,
 *   capture?(o: { spec: ShotSpec, t: number, shape: Shape, width: number, height: number }): Promise<ArrayBuffer>,
 *   meter?(spec: ShotSpec): Promise<number>,
 *   record: { start(): void, stop(): CameraKey[] | Promise<CameraKey[]> }
 * }} Film
 */
/** @typedef {'off' | 'loading' | 'ready' | 'unavailable'} WorldState */

/**
 * Where a world's film mode lives (the shot's world; Sandbox 4 when none); `?world=<url>` on the studio's address
 * points it elsewhere (a test double).
 * @param {string} base @param {{ sandbox?: string, area?: string }} [world]
 */
export const worldUrl = (base, world = {}) => {
	try {
		const o = new URL(location.href).searchParams.get('world');
		if (o && o.startsWith('/')) return o;
	} catch {
		/* default */
	}
	return `${base}${filmPath(world)}`;
};

/** @param {ShotSpec} s */
const specKey = (s) => JSON.stringify(s);
/** the film page a shot's world is drawn on @param {ShotSpec} s */
const pathOf = (s) => filmPath(s.world);

export class WorldViewer {
	/** @type {WorldState} */
	state = $state('off');
	/**
	 * the shots whose world is loaded and kept (by the spec's JSON)
	 * @type {SvelteSet<string>}
	 */
	readyShots = new SvelteSet();
	/** @type {Map<string, Promise<void>>} */
	preparing = new Map();
	/** how far the world's resolution is stepped down to keep up (1 = full proxy HD): drop resolution, never frames */
	scale = $state(1);
	/** @type {HTMLIFrameElement | null} */
	iframe = null;
	/** the film page in the iframe now: which world it holds */
	url = $state('');
	/** @type {Film | null} */
	film = null;
	busy = false;
	/** @type {ShowArgs | null} */
	queued = null;
	recording = $state(false);
	/** the last thing film mode refused (a shot it could not prepare or draw), said on the monitor */
	error = $state('');

	/**
	 * Starts the world in its iframe and waits for film mode to answer. After `wait` ms without it the viewer says it is
	 * unavailable (the stand-ins and proxies play), but it keeps looking, more slowly, for up to `patience` ms: a big
	 * world on a slow GPU comes up late, and then the live world simply takes over.
	 * @param {HTMLIFrameElement} iframe @param {string} url
	 */
	async attach(iframe, url, wait = 20000, patience = 300000) {
		if (this.iframe === iframe && this.url === url && this.state !== 'off') return;
		// another world: its own page, and nothing the last one had ready
		if (this.url !== url) {
			this.film = null;
			this.readyShots.clear();
			this.preparing.clear();
			this.queued = null;
			this.busy = false;
		}
		this.iframe = iframe;
		this.url = url;
		this.state = 'loading';
		if (iframe.getAttribute('src') !== url) iframe.src = url;
		const t0 = performance.now();
		while (performance.now() - t0 < patience && this.iframe === iframe && this.url === url) {
			/** @type {Film | undefined} */
			let film;
			try {
				film = /** @type {(Window & { __film?: Film }) | null} */ (iframe.contentWindow)?.__film;
			} catch {
				break; // another origin: not film mode
			}
			if (film && typeof film.show === 'function') {
				forwardConsole(/** @type {Window} */ (iframe.contentWindow), 'world');
				try {
					await film.ready();
					if (this.url !== url) return;
					this.film = film;
					this.state = 'ready';
					return;
				} catch {
					break;
				}
			}
			const waited = performance.now() - t0;
			if (waited > wait && this.state === 'loading') this.state = 'unavailable';
			await new Promise((r) => setTimeout(r, waited > wait ? 2000 : 250));
		}
		if (this.iframe === iframe && this.url === url) this.state = 'unavailable';
	}

	detach() {
		this.film = null;
		this.iframe = null;
		this.url = '';
		this.state = 'off';
		this.readyShots.clear();
		this.preparing.clear();
	}

	/** @param {ShotSpec} spec */
	isReady = (spec) => this.state === 'ready' && this.holds(spec) && this.readyShots.has(specKey(spec));

	/** whether the world in the iframe is the one this shot is in (only its shots are prepared and drawn there) @param {ShotSpec} spec */
	holds = (spec) => !!this.url && (this.url.endsWith(pathOf(spec)) || !this.url.includes('/games/'));

	/**
	 * Loads and keeps everything these shots need (every dome, set and area); resolves when all are ready.
	 * @param {ShotSpec[]} specs @returns {Promise<void>}
	 */
	prepare(specs) {
		const film = this.film;
		if (!film) return Promise.resolve();
		specs = specs.filter((s) => this.holds(s));
		const todo = specs.filter((s) => !this.readyShots.has(specKey(s)) && !this.preparing.has(specKey(s)));
		for (const s of todo) {
			const k = specKey(s);
			const t0 = performance.now();
			const slow = setInterval(() => console.warn(`world: still preparing ${s.meta?.name ?? 'a shot'} after ${Math.round((performance.now() - t0) / 1000)} s`), 15000);
			const p = film
				.prepare([s])
				.then(() => void this.readyShots.add(k))
				.catch((/** @type {Error} */ e) => {
					this.error = `prepare: ${e?.message ?? e}`;
					console.warn(`world: ${this.error}`);
				})
				.finally(() => (clearInterval(slow), this.preparing.delete(k)));
			this.preparing.set(k, p);
		}
		return Promise.all(specs.map((s) => this.preparing.get(specKey(s)) ?? Promise.resolve())).then(() => {});
	}

	/**
	 * Draws one frame. A frame asked for while the last is still drawing replaces the waiting one (the newest time
	 * wins), and a slow frame steps the resolution down — the picture keeps up with the clock.
	 */
	/** @param {ShowArgs} o */
	show(o) {
		if (!this.film || !this.holds(o.spec)) return;
		if (this.busy) return void (this.queued = o);
		this.busy = true;
		const t0 = performance.now();
		const w = Math.round(o.width * this.scale), h = Math.round(o.height * this.scale);
		Promise.resolve(this.film.show({ ...o, width: w, height: h }))
			.catch((/** @type {Error} */ e) => void (this.error = `show: ${e?.message ?? e}`))
			.finally(() => {
				const took = performance.now() - t0;
				if (took > 45 && this.scale > 0.35) this.scale = Math.max(0.35, this.scale * 0.8);
				else if (took < 16 && this.scale < 1) this.scale = Math.min(1, this.scale * 1.1);
				this.busy = false;
				const next = this.queued;
				this.queued = null;
				if (next) this.show(next);
			});
	}

	startRecording() {
		if (!this.film) return false;
		this.film.record.start();
		this.recording = true;
		return true;
	}
	/** @returns {Promise<CameraKey[]>} */
	async stopRecording() {
		if (!this.film || !this.recording) return [];
		this.recording = false;
		return (await this.film.record.stop()) ?? [];
	}
}

/**
 * The stand-in for a world frame when film mode is not there: a sky by the hour, the horizon by the camera's pitch, and
 * the shot's name and time — enough to cut and time against. Drawn on a 2D canvas the viewer shows in its place.
 */
/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ name: string, t: number, seconds: number, hour: number, pose: number[], fov: number, note: string }} o
 */
export function placeholder(canvas, o) {
	const g = canvas.getContext('2d');
	if (!g) return;
	const w = canvas.width, h = canvas.height;
	const day = Math.max(0, Math.sin(((o.hour - 6) / 12) * Math.PI));
	/** @param {number} a */
	const sky = (a) => `rgb(${Math.round(20 + 150 * day * a)} ${Math.round(30 + 170 * day * a)} ${Math.round(60 + 170 * day)})`;
	const grd = g.createLinearGradient(0, 0, 0, h);
	grd.addColorStop(0, sky(0.7));
	grd.addColorStop(1, sky(1));
	g.fillStyle = grd;
	g.fillRect(0, 0, w, h);
	const horizon = h / 2 + Math.tan(o.pose[4] ?? 0) * h * 1.2;
	g.fillStyle = `rgb(${Math.round(40 + 60 * day)} ${Math.round(55 + 80 * day)} ${Math.round(40 + 40 * day)})`;
	g.fillRect(0, horizon, w, h - horizon);
	// the camera's heading as a moving mark along the horizon
	const x = (((((o.pose[3] ?? 0) / (2 * Math.PI)) % 1) + 1) % 1) * w;
	g.fillStyle = 'rgb(255 255 255 / 0.5)';
	for (let k = -1; k <= 1; k++) g.fillRect(x + k * w - 1, horizon - 18, 2, 18);
	g.fillStyle = '#fff';
	g.font = `600 ${Math.round(h / 16)}px system-ui, sans-serif`;
	g.fillText(o.name, w * 0.05, h * 0.14);
	g.font = `${Math.round(h / 26)}px ui-monospace, monospace`;
	g.fillStyle = 'rgb(255 255 255 / 0.85)';
	g.fillText(`${o.t.toFixed(2)} / ${o.seconds.toFixed(2)} s · ${o.hour.toFixed(1)} h · ${o.fov.toFixed(0)}° · pos ${o.pose.slice(0, 3).map((v) => v.toFixed(0)).join(', ')}`, w * 0.05, h * 0.22);
	g.fillStyle = 'rgb(255 255 255 / 0.7)';
	g.fillText(o.note, w * 0.05, h * 0.92);
}
