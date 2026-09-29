// The world viewer: a live Sandbox 4 in film mode (contract C3), in an iframe of the same origin, slaved to the
// timeline's clock through `window.__film`. It draws the exact frame of a world shot the timeline asks for — at proxy
// level, through the same view transform as the proxies — and records a camera move flown by hand.
//
// ADAPTER: film mode (`/games/sandbox-4/?film`, stream B) does not exist on this branch yet. When the iframe never
// grows a `__film`, the viewer is `unavailable` and the program monitor falls back to the shot's HD proxy, else to a
// drawn placeholder (the shot's name, time, hour and camera) — see `placeholder()`. Nothing to remove when B lands:
// the same code finds `__film` and uses it; delete `placeholder()` only if the placeholder is no longer wanted.
import { SvelteSet } from 'svelte/reactivity';

/** @typedef {import('$lib/auth/client').Cdl} Cdl */
/** @typedef {import('$lib/auth/client').CameraKey} CameraKey */
/** @typedef {import('$lib/auth/client').Shape} Shape */
/** @typedef {import('$lib/auth/client').ShotSpec} ShotSpec */
/** @typedef {{ lut: import('./luts.js').Lut | null, grade: Cdl | null, look?: Cdl | null }} FilmView */
/** @typedef {{ spec: ShotSpec, t: number, shape: Shape, width: number, height: number, view: FilmView }} ShowArgs */
/**
 * The film-mode API of Sandbox 4 (contract C3).
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
 * Where film mode lives; `?world=<url>` on the studio's address points it elsewhere (a test double).
 * @param {string} base
 */
export const worldUrl = (base) => {
	try {
		const o = new URL(location.href).searchParams.get('world');
		if (o && o.startsWith('/')) return o;
	} catch {
		/* default */
	}
	return `${base}/games/sandbox-4/?film`;
};

/** @param {ShotSpec} s */
const specKey = (s) => JSON.stringify(s);

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
	/** @type {Film | null} */
	film = null;
	busy = false;
	/** @type {ShowArgs | null} */
	queued = null;
	recording = $state(false);

	/**
	 * Starts the world in its iframe and waits (up to `wait` ms) for film mode to answer.
	 * @param {HTMLIFrameElement} iframe @param {string} url
	 */
	async attach(iframe, url, wait = 20000) {
		if (this.iframe === iframe && this.state !== 'off') return;
		this.iframe = iframe;
		this.state = 'loading';
		if (iframe.getAttribute('src') !== url) iframe.src = url;
		const t0 = performance.now();
		while (performance.now() - t0 < wait) {
			/** @type {Film | undefined} */
			let film;
			try {
				film = /** @type {(Window & { __film?: Film }) | null} */ (iframe.contentWindow)?.__film;
			} catch {
				break; // another origin: not film mode
			}
			if (film && typeof film.show === 'function') {
				try {
					await film.ready();
					this.film = film;
					this.state = 'ready';
					return;
				} catch {
					break;
				}
			}
			await new Promise((r) => setTimeout(r, 250));
		}
		this.state = 'unavailable';
	}

	detach() {
		this.film = null;
		this.iframe = null;
		this.state = 'off';
		this.readyShots.clear();
		this.preparing.clear();
	}

	/** @param {ShotSpec} spec */
	isReady = (spec) => this.state === 'ready' && this.readyShots.has(specKey(spec));

	/**
	 * Loads and keeps everything these shots need (every dome, set and area); resolves when all are ready.
	 * @param {ShotSpec[]} specs @returns {Promise<void>}
	 */
	prepare(specs) {
		const film = this.film;
		if (!film) return Promise.resolve();
		const todo = specs.filter((s) => !this.readyShots.has(specKey(s)) && !this.preparing.has(specKey(s)));
		for (const s of todo) {
			const k = specKey(s);
			const p = film
				.prepare([s])
				.then(() => void this.readyShots.add(k))
				.catch(() => {})
				.finally(() => this.preparing.delete(k));
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
		if (!this.film) return;
		if (this.busy) return void (this.queued = o);
		this.busy = true;
		const t0 = performance.now();
		const w = Math.round(o.width * this.scale), h = Math.round(o.height * this.scale);
		Promise.resolve(this.film.show({ ...o, width: w, height: h }))
			.catch(() => {})
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
