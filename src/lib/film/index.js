// FILM MODE — a sandbox as a film camera (/games/<sandbox>/?film&area=…, game/film/worlds.js). The page installs this
// before the world mounts; it takes over the clocks (clock.js), then, once the world is up — handed over by the world
// as window.__world (src/lib/sandbox-kit/film.js: the same contract in every sandbox) — offers window.__film (contract C3 in
// scripts/film/PLAN.md) to whoever drives it: the studio (an iframe, frame by frame from the timeline's clock), the Mac
// app's unseen world (vault/app/src/world_driver.js: world shots' proxies and the final render's plates), the shoot
// CLI (scripts/film/world/render.mjs, through puppeteer) or a person at the console.
//
//   await __film.ready(spec?)                          the world up, the shot's dome and set built, nothing streaming
//   await __film.prepare(specs)                        every area, dome and set these shots need, built and kept
//   await __film.show({ spec, t, shape, width, height, view: { lut, grade }, quality })  that frame, on the canvas
//   await __film.capture({ spec, t, shape, width, height, oversample })  → ArrayBuffer: the frame as 10-bit ACEScct,
//                                                      packed x2bgr10le, top row first (width·height·4 bytes)
//   await __film.meter(spec)                           the exposure (EV, stops of gain) a shot is metered at
//   __film.record.start() … __film.record.stop()       fly (walk) by hand; get the camera keys back
//
// Every frame is set from the shot alone: the world's clock, the camera, the hour, the lights and the exposure, the
// shadows drawn again — never from the frame before — so the same shot renders the same pixels every time.
import { evaluate, fingerprint, normalize, shutterTimes } from '../../../game/film/shot.js';
import { keysFromFlight } from '../../../game/film/camera.js';
import { filmPath, worldOfPath } from '../../../game/film/worlds.js';
import { installClock } from './clock.js';
import { createPipeline } from './pipeline.js';
import { sets } from './sets.js';

/** @typedef {import('../../../game/film/shot.js').Spec} Spec @typedef {import('../../../game/film/shot.js').Shape} Shape */
/** @typedef {import('./pipeline.js').Lut} Lut */
/** @typedef {{ spec: any, t: number, shape?: Shape, width: number, height: number }} FrameAsk */

/** The version of the film camera's maths: part of every fingerprint a render reports. */
export const FILM_VERSION = 1;

const MIDDLE_GREY = 0.18;
/** a shot is metered at a fixed size, whatever size it is rendered at, so a proxy and a 4K plate agree */
const METER_WIDTH = 160;
/** a time-lapse (meter: 'ramp') is metered every half second of the shot and eased between */
const RAMP_EVERY = 0.5;
/** where the live viewer keeps the exposures it metered (sessionStorage: this app's run, never a build before), and how many at most */
const REMEMBERED = 'film:exposures';
const REMEMBER_AT_MOST = 2000;
/** the longest the live viewer waits on a shot's staging (the world built where it stands): after it, drawn as it is */
const STAGE_LIMIT = 30000;

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
/** the page's frames drawn so far: said when a shot takes long to stage, so a page whose frames are held back shows */
let frames = 0;
if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function count() {
	frames++;
	requestAnimationFrame(count);
});

/**
 * Install film mode: the clocks now, the camera once the world has handed itself over (`window.__world`). Call before
 * mounting the world.
 * @param {{ base?: string }} [opts]  the site's base path (for /film-build.json and the other worlds' film pages)
 */
export function startFilm({ base = '' } = {}) {
	const w = /** @type {any} */ (window);
	if (w.__film) return w.__film;
	const clock = installClock();
	// the film draws the canvas itself, only when asked: the world never spends a frame drawing for nobody, and the
	// domes it builds get the time instead (SwiftShader draws a frame in seconds)
	w.__filmDraw = true;
	// the world's ambience would play over the timeline's sound: on film it is silent
	HTMLMediaElement.prototype.play = function () {
		return Promise.resolve();
	};

	/** @type {ReturnType<typeof createPipeline> | null} */
	let pipe = null;
	const gpu = () => {
		if (!pipe) throw new Error('the world is not up yet');
		return pipe;
	};
	// the world this page is (its address says), and the world film mode drives: `__world` (`__village` is Sandbox 4's
	// older name for it)
	const here = worldOfPath(location.href) ?? { sandbox: 'sandbox-4' };
	const world = () => w.__world ?? w.__village;
	/** whether a shot is in this page's world @param {Spec} spec */
	const shows = (spec) => spec.world.sandbox === here.sandbox && (spec.world.area ?? null) === (here.area ?? null);
	/** @type {Map<string, number | [number, number][]>} metered exposures by the shot's picture fingerprint */
	const metered = new Map();
	// the live viewer's exposures, as metered before in this run of the app: a world page loaded anew (the other seat, a
	// reload) draws a shot metered once at its exposure at once, never metering it again at its cut. A plate always
	// meters its own (`metered`).
	/** @type {Record<string, number | [number, number][]>} */
	const remembered = (() => {
		try {
			return JSON.parse(sessionStorage.getItem(REMEMBERED) ?? '{}') ?? {};
		} catch {
			return {};
		}
	})();
	const rememberedKey = (/** @type {Spec} */ spec) => `${FILM_VERSION}:${build?.hash ?? 'dev'}:${printOf(spec)}`;
	const remember = (/** @type {Spec} */ spec, /** @type {number | [number, number][]} */ ev) => {
		remembered[rememberedKey(spec)] = ev;
		const keys = Object.keys(remembered);
		for (const k of keys.slice(0, Math.max(0, keys.length - REMEMBER_AT_MOST))) delete remembered[k];
		try {
			sessionStorage.setItem(REMEMBERED, JSON.stringify(remembered));
		} catch {
			/* no storage here (a private page): metered again next time */
		}
	};
	/** the exposure the live viewer drew last (a shot not metered yet is drawn at it while the timeline plays) */
	let lastEv = 0;
	// the live viewer asks for a frame of the same shot object many times a second: its normal form and its fingerprint
	// are worked out once per object (a spec is data: an edit is a new object)
	/** @type {WeakMap<object, Spec>} */
	const normals = new WeakMap();
	/** @param {any} raw @returns {Spec} */
	const normal = (raw) => {
		if (!raw || typeof raw !== 'object') return normalize(raw);
		let n = normals.get(raw);
		if (!n) normals.set(raw, (n = normalize(raw)));
		return n;
	};
	/** @type {WeakMap<object, string>} */
	const prints = new WeakMap();
	/** @param {Spec} spec */
	const printOf = (spec) => {
		let k = prints.get(spec);
		if (k === undefined) prints.set(spec, (k = fingerprint(spec)));
		return k;
	};
	/** what the world is staged for now: where the walker stands, which set is built */
	let staged = '';
	/** the shot the walker is being moved for now (a stage under way), else '' */
	let staging = '';
	/** the shot drawn before its world was all there (past its wait), while the rest streams in, else '' */
	let streaming = '';
	/** what has been staged and settled (loads done, shaders compiled) before: staged there again while the world
	 * still holds it, nothing new is built, so nothing is compiled again (compiling the whole scene at every cut hitched) */
	const settledFor = new Set();
	/** @type {{ commit: string, hash: string, file?: string } | null} */
	let build = null;
	const buildKnown = fetch(`${base}/film-build.json`)
		.then((r) => (r.ok ? r.json() : null))
		.then((b) => (build = b && b.commit && b.hash ? b : null))
		.catch(() => null);

	const mounted = async () => {
		while (!world()?.film) await sleep(100);
		if (!pipe) pipe = createPipeline(world().renderer);
		return world();
	};

	// One thing at a time: every staging moves the walker (the world builds the domes near where it stands), so two
	// shots staged at once pull it back and forth and neither world ever gets built. Callers queue.
	/** @type {Promise<unknown>} */
	let line = Promise.resolve();
	/** @template T @param {() => Promise<T>} job @returns {Promise<T>} */
	const one = (job) => {
		const run = line.then(job, job);
		line = run.catch(() => {});
		return run;
	};
	/**
	 * Stand where the shot needs the world loaded, build its set, and wait until the world has built what it needs — at
	 * most `limit` ms (the live viewer's), then drawn as it is; a render waits for all of it.
	 */
	async function stage(/** @type {Spec} */ spec, limit = Infinity) {
		if (!shows(spec)) throw new Error(`this shot is in ${spec.world.sandbox}${spec.world.area ? ` (${spec.world.area})` : ''}, and this page is ${here.sandbox}${here.area ? ` (${here.area})` : ''}: open ${filmPath(spec.world)}`);
		const v = await mounted();
		const key = keyOf(spec);
		const held = v.film.holds(spec.world);
		if (key === staged && held) return;
		const known = held && settledFor.has(key);
		// the walker leaves the shot staged last: no frame of that shot is drawn until it stands there again
		staged = '';
		staging = key;
		clock.leave(); // what a world builds (the domes) it builds on the page's own clock, a little every frame
		if (spec.world.props && !w.__props) sets[/** @type {keyof typeof sets} */ (spec.world.props)]?.(spec.world.seed);
		// the world stands where the shot needs it loaded, and resolves once everything the shot can see is built
		try {
			// the live viewer never waits for ever: a world that never says it is staged (an asset that never came) held
			// every shot after it in the line, and it showed stand-ins for good. Past the limit the shot is drawn as the
			// world has it, the rest streaming in
			const done = (async () => {
				const slow = setTimeout(() => console.warn(`film: ${spec.meta?.name ?? 'a shot'} still being staged after ${LOAD_WAIT / 1000} s (frames drawn: ${frames})`), LOAD_WAIT);
				try {
					await v.film.stage({ ...spec.world, name: spec.meta?.name });
				} finally {
					clearTimeout(slow);
				}
				if (!known) {
					const s0 = performance.now();
					await settled(v);
					const took = performance.now() - s0;
					if (took > 300) console.warn(`film: ${spec.meta?.name ?? 'a shot'}: loads and shaders settled in ${Math.round(took)} ms`);
				}
				settledFor.add(key);
			})();
			const late = limit < Infinity && (await Promise.race([done.then(() => false), sleep(limit).then(() => true)]));
			if (late) {
				// drawn as it is until the rest is in: not staged again every frame meanwhile (each would move the walker
				// and wait once more)
				streaming = key;
				done.catch(() => {}).finally(() => void (streaming === key && (streaming = '')));
				console.warn(`film: ${spec.meta?.name ?? 'a shot'} still loading after ${limit / 1000} s: drawn as it is, the rest streams in`);
			} else await done;
			staged = key;
		} finally {
			if (staging === key) staging = '';
		}
	}
	/** what a shot needs the world staged as: where the walker stands, its dome, its set */
	const keyOf = (/** @type {Spec} */ spec) => JSON.stringify([spec.world.stand, spec.world.dome ?? null, spec.world.props ?? null]);

	/** Nothing still streaming in: no loader busy, every shader compiled. */
	async function settled(/** @type {any} */ v) {
		const T = v.THREE, m = T.DefaultLoadingManager, t0 = performance.now();
		// a load that never ends (a file the page cannot read) holds no shot back for ever: after LOAD_WAIT it is said and
		// the world goes on with what it has
		while (m.itemsLoaded < m.itemsTotal) {
			if (performance.now() - t0 > LOAD_WAIT) {
				console.warn(`film: ${m.itemsTotal - m.itemsLoaded} of ${m.itemsTotal} loads still open after ${LOAD_WAIT / 1000} s: going on without them`);
				break;
			}
			await sleep(100);
		}
		const compiled = v.renderer.compileAsync(v.scene, v.camera);
		if ((await Promise.race([compiled.then(() => true), sleep(LOAD_WAIT).then(() => false)])) === false) console.warn(`film: the shaders still compiling after ${LOAD_WAIT / 1000} s: going on`);
	}
	/** how long a shot waits for the world's loads and shaders before it goes on without them (ms) */
	const LOAD_WAIT = 20000;

	/** the world camera's own nearest distance, for the shots whose lens names none @type {number | undefined} */
	let baseNear;
	/** Set the whole world for one instant of a shot (`live`: for the live viewer, its shadows drawn again only when the world's own rules say so). */
	function set(/** @type {any} */ v, /** @type {Spec} */ spec, /** @type {number} */ t, /** @type {Shape} */ shape, /** @type {number} */ aspect, live = false) {
		const e = evaluate(spec, t, shape);
		w.__interiorHour = e.hour;
		clock.world(e.clock);
		// a set is in the shots that name it, and nowhere else
		for (const [name, group] of Object.entries(w.__sets ?? {})) /** @type {any} */ (group).visible = name === spec.world.props;
		if (spec.world.props) w.__props?.(e.clock);
		v.camera.aspect = aspect;
		// the world's own camera (camera kind `world`): its lens and its moves are the world's; else the shot's, its
		// pose perhaps in one of the world's frames (camera `frame`)
		if (e.own && v.release) v.release();
		else {
			baseNear ??= v.camera.near;
			v.camera.fov = e.fov;
			v.camera.near = e.near ?? baseNear;
			v.fly(...e.pose, e.frame);
		}
		v.camera.updateProjectionMatrix();
		v.film.advance(e.clock, e.lights, e.parts, live);
		return e;
	}

	/**
	 * The linear frame at t (all its shutter samples accumulated), w×h. `live`: the live viewer's preview, as light as a
	 * game's own frame (no multisampling, the shadows only when they change); never a plate, a still or a meter.
	 */
	function linear(/** @type {any} */ v, /** @type {Spec} */ spec, /** @type {number} */ t, /** @type {Shape} */ shape, /** @type {number} */ W, /** @type {number} */ H, blur = true, live = false) {
		const times = blur ? shutterTimes(spec, t) : [t];
		/** @type {any} */
		let frame = null, first = null;
		for (const [i, ts] of times.entries()) {
			const e = set(v, spec, ts, shape, W / H, live);
			first ??= e;
			frame = gpu().sample(v.scene, v.camera, W, H, i, times.length, !live);
		}
		return { frame, at: /** @type {ReturnType<typeof evaluate>} */ (first) };
	}

	/** The log-average luminance of the shot at t, at the meter's fixed size, framed as composed. */
	function lumAt(/** @type {any} */ v, /** @type {Spec} */ spec, /** @type {number} */ t) {
		const a = { '1:1': 1, '16:9': 16 / 9, '9:16': 9 / 16, '4:5': 4 / 5 }[spec.aspect];
		const W = METER_WIDTH, H = Math.max(8, Math.round(METER_WIDTH / a));
		return gpu().meter(linear(v, spec, t, spec.aspect, W, H, false).frame);
	}

	/** The exposure (stops of gain before `stops`) a shot is metered at: a number, or [t, ev] keys for a ramp. */
	async function exposureOf(/** @type {Spec} */ spec) {
		if (spec.exposure.ev !== undefined && spec.exposure.meter !== 'ramp') return spec.exposure.ev;
		const key = printOf(spec);
		const known = metered.get(key);
		if (known !== undefined) return known;
		const v = await mounted();
		await stage(spec);
		clock.enter();
		const ev = (/** @type {number} */ L) => Math.log2(MIDDLE_GREY / L);
		let out;
		if (spec.exposure.meter === 'ramp') {
			const n = Math.max(1, Math.ceil(spec.seconds / RAMP_EVERY));
			out = Array.from({ length: n + 1 }, (_, k) => {
				const t = (spec.seconds * k) / n;
				return /** @type {[number, number]} */ ([t, Math.round(ev(lumAt(v, spec, t)) * 1e4) / 1e4]);
			});
		} else {
			// held for the whole shot: the log-average of five moments across it, as a camera metering the scene
			const ts = [0.02, 0.25, 0.5, 0.75, 0.98].map((k) => k * spec.seconds);
			const logs = ts.map((t) => Math.log(lumAt(v, spec, t)));
			out = Math.round(ev(Math.exp(logs.reduce((a, b) => a + b, 0) / logs.length)) * 1e4) / 1e4;
		}
		metered.set(key, out);
		remember(spec, out);
		return out;
	}

	/** The exposure the live viewer knows for a shot without metering it: its own, metered here, or remembered. */
	const knownExposure = (/** @type {Spec} */ spec) => {
		if (spec.exposure.ev !== undefined && spec.exposure.meter !== 'ramp') return spec.exposure.ev;
		return metered.get(printOf(spec)) ?? remembered[rememberedKey(spec)];
	};

	const evAt = (/** @type {number | [number, number][]} */ ev, /** @type {number} */ t) => {
		if (typeof ev === 'number') return ev;
		if (t <= ev[0][0]) return ev[0][1];
		for (let i = 1; i < ev.length; i++) if (t < ev[i][0]) return ev[i - 1][1] + ((ev[i][1] - ev[i - 1][1]) * (t - ev[i - 1][0])) / (ev[i][0] - ev[i - 1][0]);
		return ev[ev.length - 1][1];
	};

	/** @type {{ t0: number, samples: { t: number, pose: [number, number, number, number, number], fov: number }[], frame: number } | null} */
	let recording = null;

	const film = {
		FILM_VERSION,
		/** the world this page is: { sandbox, area? } */
		world: here,
		/** whether a shot is in this page's world (else it is drawn on `pathOf(spec.world)`) */
		shows: (/** @type {any} */ spec) => shows(normalize(spec)),
		/** the film page of another world, from this site's root */
		pathOf: (/** @type {{ sandbox?: string, area?: string }} */ world) => `${base}${filmPath(world)}`,
		get virtual() {
			return clock.virtual;
		},
		/** the page's clock, for scripts that step it themselves (scripts/film before film mode) */
		enter: () => clock.enter(),
		leave: () => clock.leave(),
		step: (/** @type {number} */ ms) => clock.step(ms),
		/** the game build this page is: { commit, hash } from /film-build.json, or null on a dev server */
		get build() {
			return build;
		},
		/** @param {any} [spec] */
		ready(spec) {
			return one(async () => {
				await buildKnown;
				const v = await mounted();
				if (spec) await stage(normalize(spec));
				else await settled(v);
			});
		},
		/**
		 * @param {any[]} specs @param {{ live?: boolean, meter?: boolean }} [opts] `live`: for the live viewer, each
		 * staging waited on at most STAGE_LIMIT; `meter: false`: not metered now (while the timeline plays: metering
		 * renders a shot at five moments, and the world, moved there and back, hitched the shot on screen)
		 */
		prepare(specs, { live = false, meter = true } = {}) {
			return one(async () => {
				const all = specs.map(normal).filter(shows);
				const v = await mounted();
				// everything these shots need, kept built whichever shot asks last
				v.film.keep(all.map((s) => s.world));
				for (const s of all) await stage(s, live ? STAGE_LIMIT : Infinity);
				if (meter) for (const s of all) if (!live || knownExposure(s) === undefined) await exposureOf(s);
			});
		},
		/** the live viewer's metering ahead: a shot it knows the exposure of is not metered again @param {any} spec */
		meter(spec) {
			return one(async () => {
				const n = normalize(spec);
				const ev = knownExposure(n) ?? (await exposureOf(n));
				return typeof ev === 'number' ? ev : ev.reduce((a, k) => a + k[1], 0) / ev.length;
			});
		},
		/** the metered exposure as the render uses it: a number, or [t, ev] keys for a time-lapse @param {any} spec */
		exposure(spec) {
			return one(() => exposureOf(normalize(spec)));
		},
		/**
		 * The log frame. `oversample` (default 1.5) renders bigger and filters down on the GPU.
		 * @param {FrameAsk & { oversample?: number }} ask @returns {Promise<ArrayBuffer>}
		 */
		capture({ spec: raw, t, shape, width, height, oversample = 1.5 }) {
			return one(async () => {
				const spec = normalize(raw), to = shape ?? spec.aspect;
				const v = await mounted();
				const ev = await exposureOf(spec);
				await stage(spec);
				clock.enter();
				w.__filmDraw = true;
				const W = Math.round(width * oversample), H = Math.round(height * oversample);
				const { frame, at } = linear(v, spec, t, to, W, H);
				const gain = 2 ** (evAt(ev, t) + at.stops);
				const taps = oversample > 1 ? 3 : 1;
				return /** @type {ArrayBuffer} */ (gpu().encode(frame, width, height, gain, taps).buffer);
			});
		},
		/**
		 * Draw a frame on the page's canvas through the view transform. quality 'proxy' (default): no oversampling, no
		 * shutter blur — the live world viewer; 'final': as the plate.
		 * `meter: false` (the timeline playing): a shot not metered yet is drawn at the exposure drawn last, never metered
		 * at its cut (five renders there and back hitched it); it is metered once the timeline stops.
		 * `wait`: the most a 'proxy' frame waits for its shot's staging (ms, default STAGE_LIMIT) before it is drawn as the
		 * world has it, the rest streaming in as it does in the game: while the timeline plays, a cut to a shot that stands
		 * elsewhere holds the picture no longer than that (waiting the whole staging out hitched every cut there).
		 * @param {FrameAsk & { view?: { lut?: Lut | string | null, grade?: Lut | null }, quality?: 'proxy' | 'final', meter?: boolean, wait?: number }} ask
		 * @returns {Promise<boolean>} whether the frame was drawn (not while the world is being staged for another shot)
		 */
		async show({ spec: raw, t, shape, width, height, view = {}, quality = 'proxy', meter = true, wait = STAGE_LIMIT }) {
			const spec = normal(raw), to = shape ?? spec.aspect;
			const v = await mounted();
			// the world is being readied for another shot (a prepare): never draw this one with the walker elsewhere —
			// the last frame stays up
			const key = keyOf(spec);
			if (staging && staging !== key) return false;
			const t0 = performance.now();
			const live = quality !== 'final';
			const known = live ? knownExposure(spec) : undefined;
			const ev = known ?? (live && !meter ? lastEv : await exposureOf(spec));
			if (live) lastEv = typeof ev === 'number' ? ev : ev.reduce((a, k) => a + k[1], 0) / ev.length;
			const t1 = performance.now();
			// restaged in line with the prepares, never beside one (two at once pull the walker back and forth)
			if (staged !== key || (streaming !== key && !v.film.holds(spec.world))) await one(() => stage(spec, quality === 'final' ? Infinity : wait));
			const t2 = performance.now();
			clock.enter();
			w.__filmDraw = true;
			const os = quality === 'final' ? 1.5 : 1;
			const W = Math.round(width * os), H = Math.round(height * os);
			const { frame, at } = linear(v, spec, t, to, W, H, quality === 'final', quality !== 'final');
			gpu().view(frame, width, height, 2 ** (evAt(ev, t) + at.stops), os > 1 ? 3 : 1, view);
			// a frame that took a hitch's time says what it spent it on (the studio's log): a cut's first frame should cost
			// what any other does, all its work done in the prepare
			const t3 = performance.now();
			if (quality !== 'final' && t3 - t0 > 100) console.warn(`film: ${spec.meta?.name ?? 'a shot'} at ${t.toFixed(2)} s took ${Math.round(t3 - t0)} ms — exposure ${Math.round(t1 - t0)}, staging ${Math.round(t2 - t1)}, drawing ${Math.round(t3 - t2)}`);
			// the frame is drawn: the page's clock runs again until the next, so the world keeps building what the
			// shots ahead need while the timeline plays (held, every dome build would wait for a step that never comes)
			clock.leave();
			return true;
		},
		/**
		 * A still through the view (the storyboard): show() it, then the canvas as an image.
		 * @param {FrameAsk & { view?: { lut?: Lut | string | null, grade?: Lut | null }, quality?: 'proxy' | 'final', type?: string }} ask
		 * @returns {Promise<Blob>}
		 */
		async still(ask) {
			await film.show(ask);
			// in the same task as the draw, before the canvas is presented and cleared
			const canvas = world().renderer.domElement;
			return new Promise((resolve, reject) => canvas.toBlob((/** @type {Blob | null} */ b) => (b ? resolve(b) : reject(new Error('no still'))), ask.type ?? 'image/png', 0.92));
		},
		/**
		 * For comparing with the films made before film mode: the same frame as the game draws it (tone-mapped to 8-bit
		 * sRGB on the canvas, the lens opened by `exposure` as the old shot lists did), as a PNG. Diagnostics only.
		 * @param {FrameAsk & { exposure?: number }} ask @returns {Promise<Blob>}
		 */
		async legacy({ spec: raw, t, shape, width, height, exposure = 1 }) {
			const spec = normalize(raw), to = shape ?? spec.aspect;
			const v = await mounted();
			await stage(spec);
			clock.enter();
			w.__filmDraw = true;
			w.__exposure = exposure;
			set(v, spec, t, to, width / height);
			v.renderer.setPixelRatio(1);
			v.renderer.setSize(width, height, false);
			v.renderer.setRenderTarget(null);
			v.renderer.render(v.scene, v.camera);
			w.__exposure = undefined;
			const canvas = v.renderer.domElement;
			return new Promise((resolve, reject) => canvas.toBlob((/** @type {Blob | null} */ b) => (b ? resolve(b) : reject(new Error('no frame'))), 'image/png'));
		},
		/**
		 * The log encode checked against game/film/color.js: known linear values (as the half-float frame holds them)
		 * through the GPU's matrix, ACEScct curve and x2bgr10le packing, unpacked here and compared code by code.
		 * @returns {Promise<{ pixels: number, exact: number, maxDiff: number, rows: [number[], number[], number[]][] }>}
		 */
		async selfTest() {
			const v = await mounted(), T = v.THREE;
			const lin = [-0.01, 0, 1e-4, 0.001, 0.0078125, 0.02, 0.05, 0.18, 0.5, 1, 2, 8, 16, 64, 222, 1000];
			const W = lin.length, H = 2;
			const half = new Uint16Array(W * H * 4);
			for (let y = 0; y < H; y++)
				for (let x = 0; x < W; x++) {
					// row 0 grey, row 1 coloured: r, g/3, b·2
					const rgb = y === 0 ? [lin[x], lin[x], lin[x]] : [lin[x], lin[x] / 3, lin[x] * 2];
					rgb.forEach((c, i) => (half[(y * W + x) * 4 + i] = T.DataUtils.toHalfFloat(c)));
					half[(y * W + x) * 4 + 3] = T.DataUtils.toHalfFloat(1);
				}
			const tex = new T.DataTexture(half, W, H, T.RGBAFormat, T.HalfFloatType);
			tex.minFilter = tex.magFilter = T.NearestFilter;
			tex.needsUpdate = true;
			const bytes = gpu().encode(tex, W, H, 1, 1);
			tex.dispose();
			const { REC709_TO_AP1: M, toCct } = await import('../../../game/film/color.js');
			let exact = 0, maxDiff = 0;
			/** @type {[number[], number[], number[]][]} */
			const rows = [];
			for (let y = 0; y < H; y++)
				for (let x = 0; x < W; x++) {
					// the encoded frame is top row first: image row y is the texture's row H−1−y
					const src = H - 1 - y, rgb = [0, 1, 2].map((i) => T.DataUtils.fromHalfFloat(half[(src * W + x) * 4 + i]));
					const ap1 = M.map((r) => r[0] * rgb[0] + r[1] * rgb[1] + r[2] * rgb[2]);
					const expect = ap1.map((c) => Math.min(1023, Math.max(0, Math.round(toCct(c) * 1023))));
					const o = (y * W + x) * 4, word = (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0;
					const got = [word & 1023, (word >>> 10) & 1023, (word >>> 20) & 1023];
					const d = Math.max(...got.map((g, i) => Math.abs(g - expect[i])));
					maxDiff = Math.max(maxDiff, d);
					if (d === 0) exact++;
					rows.push([rgb, expect, got]);
				}
			return { pixels: W * H, exact, maxDiff, rows };
		},
		/** Give the canvas and the clocks back to the world (to walk it, to record a move). */
		release() {
			w.__filmDraw = false;
			clock.world(undefined);
			clock.leave();
			// walked by hand from here: the next shot stages again (where the walker stands now is no shot's), and the
			// sky follows the page's own hour
			staged = '';
			delete w.__interiorHour;
			const v = world();
			if (v) {
				v.renderer.setPixelRatio(Math.min(1.25, window.devicePixelRatio));
				v.renderer.setSize(v.renderer.domElement.parentElement?.clientWidth ?? 640, v.renderer.domElement.parentElement?.clientHeight ?? 480);
			}
		},
		record: {
			/** Start recording the camera as it is walked or flown by hand (the world runs on its own clock). */
			start() {
				film.release();
				const v = world();
				if (!v) throw new Error('the world is not up yet');
				const rec = { t0: performance.now(), samples: /** @type {any[]} */ ([]), frame: 0 };
				recording = rec;
				const grab = () => {
					if (recording !== rec) return;
					const c = v.camera;
					// yaw and pitch as the film flies them; a map's camera (the orbit rig) turns in another order: from where it looks
					let yaw = c.rotation.y, pitch = c.rotation.x;
					if (c.rotation.order !== 'YXZ') {
						const d = c.getWorldDirection(new v.THREE.Vector3());
						yaw = Math.atan2(-d.x, -d.z);
						pitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
					}
					rec.samples.push({ t: (performance.now() - rec.t0) / 1000, pose: [c.position.x, c.position.y, c.position.z, yaw, pitch], fov: c.fov });
					rec.frame = requestAnimationFrame(grab);
				};
				grab();
			},
			/** Stop, and get the move back as camera keys (smoothed, thinned): { kind: 'keys', keys } is a camera. */
			stop() {
				const rec = recording;
				recording = null;
				if (!rec) return [];
				cancelAnimationFrame(rec.frame);
				return keysFromFlight(rec.samples);
			}
		}
	};
	w.__film = film;
	return film;
}
