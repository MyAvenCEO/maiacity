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

/** @typedef {import('./types.js').Cdl} Cdl */
/** @typedef {import('./types.js').CameraKey} CameraKey */
/** @typedef {import('./types.js').Shape} Shape */
/** @typedef {import('./types.js').ShotSpec} ShotSpec */
/** What film mode draws a frame through: the clip's grade and the output LUT, cubes the Mac bakes (RGB triples, red fastest). */
/** @typedef {{ lut: { size: number, data: Float32Array } | null, grade: { size: number, data: Float32Array } | null }} FilmView */
/** `meter: false` while the timeline plays: a shot not metered yet is not metered at its cut (film mode draws it at the exposure drawn last);
 * `wait`: the most a cut holds the picture for its shot's staging (ms) before it is drawn as the world has it */
/** @typedef {{ spec: ShotSpec, t: number, shape: Shape, width: number, height: number, view: FilmView, meter?: boolean, wait?: number }} ShowArgs */
/**
 * The film-mode API of a sandbox (contract C3).
 * @typedef {{
 *   ready(): Promise<void>,
 *   prepare(specs: ShotSpec[], opts?: { live?: boolean, meter?: boolean }): Promise<void | boolean>,
 *   plays?(on: boolean): void,
 *   keep?(specs: ShotSpec[]): void | Promise<void>,
 *   dress?(specs: ShotSpec[]): Promise<void>,
 *   held?(specs: ShotSpec[]): Promise<boolean[]>,
 *   look?(view: FilmView): void,
 *   show(o: ShowArgs): void | boolean | Promise<void | boolean>,
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

/** @type {WeakMap<object, string>} */
const keys = new WeakMap();
/**
 * What a shot needs the world readied as: its world (where the walker stands, the dome, the set), worked out once per
 * spec object (asked for every frame). Never the whole spec: a key moved, a lens or an hour changed while editing is
 * the same world, drawn at once, not a shot to prepare again (keyed by the whole spec, every edit in 3D or Edit was
 * "not ready" and showed the stand-in).
 * @param {ShotSpec} s
 */
const specKey = (s) => {
	let k = keys.get(s);
	if (k === undefined) {
		// the world's clock is where its story is at, not what is built: the V1 intro's shots, one after another on the
		// same seat, are one world readied once
		const { clock, ...w } = /** @type {Record<string, unknown>} */ (s.world ?? {});
		keys.set(s, (k = JSON.stringify(w)));
	}
	return k;
};
/** @type {WeakMap<object, string>} */
const wholes = new WeakMap();
/** the whole shot as data (its exposure is metered by it), once per spec object @param {ShotSpec} s */
const wholeKey = (s) => {
	let k = wholes.get(s);
	if (k === undefined) wholes.set(s, (k = JSON.stringify(s)));
	return k;
};
/** how often the GPU may drop the world before the viewer stops loading it again (the proxies play) */
const LOSSES = 3;
const LOSS_WINDOW = 5 * 60_000;
/** how often a world page that never came up is loaded again before the stand-ins play for good */
const RELOADS = 2;
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
	/**
	 * each prepare's end, for when the page it was asked of goes (the GPU dropped it, another world came): that page
	 * never answers, and whoever waited on it waited for ever, told every 15 s that the shot was still preparing
	 * @type {Set<() => void>}
	 */
	ends = new Set();
	/** every prepare under way given up: the page it was asked of is gone */
	forget() {
		for (const end of this.ends) end();
		this.ends.clear();
		this.preparing.clear();
	}
	/** how far the world's resolution is stepped down to keep up (1 = full proxy HD): drop resolution, never frames */
	scale = $state(1);
	/** the last frames' times (ms): the resolution steps on their median, so one slow frame (a cut, a restage) moves nothing */
	took = /** @type {number[]} */ ([]);
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
	 * the long edge of the program monitor in device pixels (the monitor sets it as it is laid out): the live world draws
	 * no bigger than it is seen, as a game draws at its canvas's size — the proxy frame (HD) only on a monitor that big
	 */
	px = 1920;
	/** when the GPU dropped the world (its WebGL context lost), the last few times (ms) */
	losses = /** @type {number[]} */ ([]);
	/**
	 * the world (`specKey`) whose frame is on the world's canvas now: until one is drawn there the canvas is empty, and
	 * shown it was a black frame under "live world"
	 */
	drawn = $state('');
	/** when a world frame was last drawn on the canvas (performance.now) */
	drawnAt = -Infinity;
	/** how often the page in the iframe was loaded again because it never came up */
	reloads = 0;
	/** the shots whose exposure film mode has metered (or is metering), by the whole shot */
	metered = new Set();
	/** a metering of the shots ahead under way */
	metering = false;

	/**
	 * Starts the world in its iframe and waits for film mode to answer. After `wait` ms without it the viewer says it is
	 * unavailable (the stand-ins and proxies play), but it keeps looking, more slowly, for up to `patience` ms: a big
	 * world on a slow GPU comes up late, and then the live world simply takes over.
	 * @param {HTMLIFrameElement} iframe @param {string} url
	 */
	async attach(iframe, url, wait = 20000, patience = 300000) {
		if (this.iframe === iframe && this.url === url && this.state !== 'off') return;
		// another world, or the same one in another iframe (each tab mounts its own monitor): its own page, and nothing
		// the last one had ready — a prepare still waiting on a page that is gone held that page's whole world alive,
		// and its shots counted as ready (or preparing for ever) in a world that had built none of them
		if (this.url !== url || this.iframe !== iframe) {
			this.film = null;
			this.drawn = '';
			this.reloads = 0;
			this.metered.clear();
			this.readyShots.clear();
			this.forget();
			this.queued = null;
			this.busy = false;
		}
		this.iframe = iframe;
		this.url = url;
		this.state = 'loading';
		// the Mac's jobs render no world proxy while this world is open (./jobs/mac.js)
		void import('./jobs/mac.js').then((m) => m.studioWorld(true));
		if (iframe.getAttribute('src') !== url) {
			// the world's page going is never taken for the one coming: until the new page replaces it (a while later) it
			// still answers with its own `__film`, and taken, the viewer was "ready" on a page about to go — every prepare
			// and frame asked of it never answered, and Player 2's intro, opened after Player 1's, showed its stand-in for good
			try {
				const old = /** @type {(Window & { __film?: Film, __lost?: boolean }) | null} */ (iframe.contentWindow);
				// (only a film page: the empty first page's window is the one the next page keeps)
				if (old?.__film) old.__lost = true;
			} catch {
				/* another origin */
			}
			iframe.src = url;
		}
		const t0 = performance.now();
		while (performance.now() - t0 < patience && this.iframe === iframe && this.url === url) {
			/** @type {Film | undefined} */
			let film;
			try {
				// (a page whose context the GPU dropped is going: never taken for the fresh one coming)
				const win = /** @type {(Window & { __film?: Film, __lost?: boolean }) | null} */ (iframe.contentWindow);
				film = win?.__lost ? undefined : win?.__film;
			} catch {
				break; // another origin: not film mode
			}
			if (film && typeof film.show === 'function') {
				forwardConsole(/** @type {Window} */ (iframe.contentWindow), 'world');
				this.forwardKeys(/** @type {Window} */ (iframe.contentWindow));
				try {
					// a page that goes meanwhile never answers: looked for again, never waited on for ever
					if (!(await this.whileThere(iframe, url, film, film.ready()))) continue;
					if (this.url !== url) return;
					// once the world is up: its canvas is there
					this.watchLoss(/** @type {Window} */ (iframe.contentWindow), iframe, url);
					this.film = film;
					// a world page that comes while the timeline plays (a cut to another world) plays too
					if (this.rolling) this.plays(true);
					this.state = 'ready';
					// loaded again after the GPU dropped it: nothing to say any more
					if (this.error.startsWith('the GPU dropped')) this.error = '';
					return;
				} catch (e) {
					// said, and asked again: a world that could not get ready once (a shader, a load) often can the next time
					this.error = `ready: ${/** @type {Error} */ (e)?.message ?? e}`;
					console.warn(`world: ${this.error}`);
				}
			}
			const waited = performance.now() - t0;
			if (waited > wait && this.state === 'loading') {
				this.state = 'unavailable';
				console.warn(`world: no film mode at ${url} after ${Math.round(waited / 1000)} s${this.error ? ` (${this.error})` : ''}: the stand-ins play`);
			}
			await new Promise((r) => setTimeout(r, waited > wait ? 2000 : 250));
		}
		if (this.iframe !== iframe || this.url !== url) return;
		this.state = 'unavailable';
		// a page that never came up is loaded again, a few times (it was left a stand-in for good)
		if (this.reloads >= RELOADS) return;
		this.reloads++;
		console.warn(`world: ${url} never came up: loading it again (${this.reloads} of ${RELOADS})`);
		this.state = 'off';
		// (the page going is never taken for the fresh one coming)
		try {
			/** @type {any} */ (iframe.contentWindow).__lost = true;
		} catch {
			/* another origin */
		}
		iframe.src = 'about:blank';
		void this.attach(iframe, url, wait, patience);
	}

	/**
	 * Whether `p` answered while the iframe still held the page of `film` (and the viewer still wants `url` there):
	 * false as soon as that page is gone or going.
	 * @param {HTMLIFrameElement} iframe @param {string} url @param {Film} film @param {Promise<unknown>} p
	 * @returns {Promise<boolean>}
	 */
	whileThere(iframe, url, film, p) {
		return new Promise((resolve, reject) => {
			const there = () => {
				try {
					const win = /** @type {(Window & { __film?: Film, __lost?: boolean }) | null} */ (iframe.contentWindow);
					return this.iframe === iframe && this.url === url && !win?.__lost && win?.__film === film;
				} catch {
					return false;
				}
			};
			const id = setInterval(() => there() || (clearInterval(id), resolve(false)), 250);
			p.then(
				() => (clearInterval(id), resolve(there())),
				(e) => (clearInterval(id), reject(e))
			);
		});
	}

	/**
	 * The GPU may drop the world's WebGL context (The OS's WebView on a Mac short of memory): every shader it is asked to
	 * compile after that fails ("Argument 1 ('shader') to WebGL2RenderingContext.shaderSource…") and nothing it draws
	 * shows. The world is then loaded again in a fresh page — a new context, its memory given back — up to LOSSES times
	 * in LOSS_WINDOW; after that the proxies and stand-ins play, said on the monitor.
	 * @param {Window} win @param {HTMLIFrameElement} iframe @param {string} url
	 */
	watchLoss(win, iframe, url) {
		const w = /** @type {Window & { __lossWatched?: boolean, __lost?: boolean, __world?: { renderer?: { domElement?: HTMLCanvasElement } } }} */ (win);
		const canvas = w.__world?.renderer?.domElement ?? win.document.querySelector('canvas');
		if (w.__lossWatched || !canvas) return;
		w.__lossWatched = true;
		canvas.addEventListener('webglcontextlost', () => {
			w.__lost = true;
			if (this.iframe !== iframe || this.url !== url) return;
			const now = performance.now();
			this.losses = [...this.losses.filter((t) => now - t < LOSS_WINDOW), now];
			const again = this.losses.length <= LOSSES;
			this.error = `the GPU dropped the world (its WebGL context was lost)${again ? ': loading it again' : ` ${this.losses.length} times: the proxies play`}`;
			console.warn(`world: ${this.error}`);
			this.film = null;
			this.drawn = '';
			this.metered.clear();
			this.readyShots.clear();
			this.forget();
			this.queued = null;
			this.busy = false;
			if (!again) return void (this.state = 'unavailable');
			// a page of its own again: the lost context and everything it held go with the old one
			this.state = 'off';
			iframe.src = 'about:blank';
			void this.attach(iframe, url);
		});
	}

	/**
	 * A click on the world gives it the keyboard: Space still plays and stops the timeline (handed to the studio),
	 * unless a move is being flown by hand.
	 * @param {Window} win
	 */
	forwardKeys(win) {
		const w = /** @type {Window & { __keysForwarded?: boolean }} */ (win);
		if (w.__keysForwarded) return;
		w.__keysForwarded = true;
		win.addEventListener(
			'keydown',
			(e) => {
				if (e.code !== 'Space' || this.recording) return;
				e.preventDefault();
				e.stopImmediatePropagation();
				window.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, code: e.code, bubbles: true, cancelable: true }));
			},
			true
		);
	}

	/** playback stopped: the frame waiting to be drawn is dropped */
	halt() {
		this.queued = null;
		this.plays(false);
	}

	/**
	 * The timeline plays (`on`) or stands, said to film mode: while it plays, nothing is staged there but the shot on
	 * screen, so no prepare begun while it stood holds a cut back (src/lib/film `plays`). @param {boolean} on
	 */
	plays(on) {
		this.rolling = on;
		void Promise.resolve(this.film?.plays?.(on)).catch(() => {});
	}
	/** whether the timeline plays, as last said (`plays`) */
	rolling = false;

	detach() {
		void import('./jobs/mac.js').then((m) => m.studioWorld(false));
		this.film = null;
		this.drawn = '';
		this.metered.clear();
		this.iframe = null;
		this.url = '';
		this.state = 'off';
		this.readyShots.clear();
		this.forget();
	}

	/** @param {ShotSpec} spec */
	isReady = (spec) => this.state === 'ready' && this.holds(spec) && this.readyShots.has(specKey(spec));
	/**
	 * the live world shows this shot: a frame of its world drawn on the canvas. Drawn is enough: a cut while the
	 * timeline plays draws its shot as the world has it (the rest streaming in), and waiting for a prepare to say it is
	 * ready as well showed the stand-in or a proxy still loading at every cut to a new stand
	 * @param {ShotSpec} spec
	 */
	isLive = (spec) => this.state === 'ready' && !!this.film && this.holds(spec) && this.drawn === specKey(spec);

	/** whether the world in the iframe is the one this shot is in (only its shots are prepared and drawn there) @param {ShotSpec} spec */
	holds = (spec) => !!this.url && (this.url.endsWith(pathOf(spec)) || !this.url.includes('/games/'));

	/**
	 * Loads and keeps everything these shots need (every dome, set and area); resolves when all are ready. `meter:
	 * false` while the timeline plays: staged only, metered once it stops (`meterAhead`).
	 * @param {ShotSpec[]} specs @param {{ meter?: boolean }} [opts] @returns {Promise<void>}
	 */
	prepare(specs, { meter = true } = {}) {
		const film = this.film;
		if (!film) return Promise.resolve();
		specs = specs.filter((s) => this.holds(s));
		// one prepare per world staged (shots in the same place share it)
		const todo = [...new Map(specs.map((s) => [specKey(s), s])).values()].filter((s) => !this.readyShots.has(specKey(s)) && !this.preparing.has(specKey(s)));
		for (const s of todo) {
			const k = specKey(s);
			const t0 = performance.now();
			const slow = setInterval(() => console.warn(`world: still preparing ${s.meta?.name ?? 'a shot'} after ${Math.round((performance.now() - t0) / 1000)} s`), 15000);
			/** @type {() => void} */
			let end = () => {};
			const gone = new Promise((r) => (end = () => r(false)));
			this.ends.add(end);
			/** @type {Promise<void>} */
			// prepared only where it was all done: a prepare the timeline's play cut short (false) is asked again once it stands
			const p = Promise.race([film.prepare([s], { live: true, meter }).then((r) => r !== false), gone])
				.then((done) => void (done && this.film === film && this.readyShots.add(k)))
				.catch((/** @type {Error} */ e) => {
					this.error = `prepare: ${e?.message ?? e}`;
					console.warn(`world: ${this.error}`);
				})
				.finally(() => {
					clearInterval(slow);
					this.ends.delete(end);
					if (this.preparing.get(k) === p) this.preparing.delete(k);
				});
			this.preparing.set(k, p);
		}
		return Promise.all(specs.map((s) => this.preparing.get(specKey(s)) ?? Promise.resolve())).then(() => {});
	}

	/**
	 * Keeps built what these shots will see, nothing staged: while the timeline plays, the shots ahead (the world builds
	 * them as it can, never moving away from the shot on screen).
	 * @param {ShotSpec[]} specs
	 */
	keep(specs) {
		const film = this.film;
		if (!film?.keep) return;
		const mine = specs.filter((s) => this.holds(s));
		// asked every frame: said to the world only when the shots ahead change
		const key = mine.map(wholeKey).join('\n');
		if (key === this.kept && film === this.keptBy) return;
		this.kept = key;
		this.keptBy = film;
		void Promise.resolve(film.keep(mine)).catch(() => {});
	}
	/**
	 * The whole timeline's shots, before it plays (src/lib/film `dress`): the sets they name built, and what their
	 * cameras see kept built after the shots ahead, as the world's budget holds. Asked every frame while stopped: said
	 * to the world only when the shots change, or `again` (Play: what was built since drawn once out of sight).
	 * @param {ShotSpec[]} specs @param {{ again?: boolean }} [opts] @returns {Promise<void>}
	 */
	dress(specs, { again = false } = {}) {
		const film = this.film;
		if (!film?.dress) return Promise.resolve();
		const mine = specs.filter((s) => this.holds(s));
		// by where each shot stands, not its camera: a key moved while a shot is edited dresses nothing again
		const keys = mine.map(specKey);
		const same = keys.length === this.dressed.length && keys.every((k, i) => k === this.dressed[i]);
		if (!again && same && film === this.dressedBy && this.dressing) return this.dressing;
		this.dressed = keys;
		this.dressedBy = film;
		/** @type {() => void} */
		let end = () => {};
		const gone = new Promise((r) => (end = () => r(undefined)));
		this.ends.add(end);
		const p = Promise.race([Promise.resolve(film.dress(mine)), gone])
			.then(() => {})
			.catch((/** @type {Error} */ e) => console.warn(`world: the timeline was not dressed: ${e?.message ?? e}`))
			.finally(() => this.ends.delete(end));
		this.dressing = p;
		return p;
	}
	/** that dressing, the shots it was asked for (by `specKey`) and of which film page @type {Promise<void> | null} */
	dressing = null;
	/** @type {string[]} */
	dressed = [];
	/** @type {Film | null} */
	dressedBy = null;
	/**
	 * The shots ahead the world already holds (a world that streams by view: built while the shots before them play)
	 * count as ready: at their cut the live world draws them at once, only a move of its camera. Asked four times a
	 * second, not every frame. @param {ShotSpec[]} specs
	 */
	markHeld(specs) {
		const film = this.film, now = performance.now();
		if (!film?.held || now - this.heldAt < 250) return;
		this.heldAt = now;
		const mine = specs.filter((s) => this.holds(s));
		void film.held(mine).then((h) => h.forEach((ok, i) => ok && this.film === film && this.readyShots.add(specKey(mine[i])))).catch(() => {});
	}
	/**
	 * The views the shots ahead are drawn through (their grades, the output), sent to the GPU before their cuts.
	 * @param {FilmView[]} views
	 */
	look(views) {
		const film = this.film;
		if (!film?.look) return;
		if (film !== this.lookedBy) (this.looked = new WeakSet()), (this.lookedBy = film);
		for (const v of views) {
			const k = v.grade ?? v.lut;
			if (!k || this.looked.has(k)) continue;
			this.looked.add(k);
			film.look(v);
		}
	}
	/** the views sent (by their grade), not sent again every frame, and to which film page @type {WeakSet<object>} */
	looked = new WeakSet();
	/** @type {Film | null} */
	lookedBy = null;
	/** when `markHeld` last asked */
	heldAt = 0;
	/** the shots ahead last kept (by the whole shot), and by which film page */
	kept = '';
	/** @type {Film | null} */
	keptBy = null;

	/** stands the world where this shot is staged, nothing metered @param {ShotSpec} spec @returns {Promise<void>} */
	standAt(spec) {
		if (!this.film || !this.holds(spec)) return Promise.resolve();
		return this.film.prepare([spec], { live: true, meter: false }).then(() => {}, () => {});
	}

	/**
	 * Meters the exposure of these shots, one at a time, while `still()` holds (the timeline stopped). Metering a shot
	 * renders it at five moments across it, which moves a world whose story runs on a timeline (the V1 intro) away and
	 * back: done while the timeline plays, every cut to a shot not metered yet hitched. Stopped, it is done ahead.
	 * @param {ShotSpec[]} specs @param {() => boolean} still
	 */
	async meterAhead(specs, still) {
		const film = this.film;
		if (this.metering || !film?.meter) return;
		this.metering = true;
		try {
			for (const s of specs) {
				if (!still() || this.film !== film) return;
				const k = wholeKey(s);
				if (this.metered.has(k) || !this.holds(s) || !this.readyShots.has(specKey(s))) continue;
				this.metered.add(k);
				await film.meter(s).catch(() => this.metered.delete(k));
			}
		} finally {
			this.metering = false;
		}
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
		const k = this.scale * Math.min(1, Math.max(320, this.px) / Math.max(o.width, o.height));
		const w = Math.round(o.width * k), h = Math.round(o.height * k);
		Promise.resolve(this.film.show({ ...o, width: w, height: h }))
			.then((drew) => {
				if (drew === false || !this.film) return;
				this.drawn = specKey(o.spec);
				this.drawnAt = performance.now();
			})
			.catch((/** @type {Error} */ e) => void (this.error = `show: ${e?.message ?? e}`))
			.finally(() => {
				// the resolution steps (1, ¾, ½, ⅓) on the median of the last frames: each step reallocates the targets,
				// so it moves rarely — down when frames are slow, up again only when they are well within time
				this.took.push(performance.now() - t0);
				if (this.took.length >= 12) {
					const median = [...this.took].sort((a, b) => a - b)[6];
					const steps = [1, 0.75, 0.5, 0.35], i = Math.max(0, steps.indexOf(this.scale));
					if (median > 45 && i < steps.length - 1) this.scale = steps[i + 1];
					else if (median < 18 && i > 0) this.scale = steps[i - 1];
					this.took = [];
				}
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
