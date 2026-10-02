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

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

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
	/** what the world is staged for now: where the walker stands, which set is built */
	let staged = '';
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
	/** Stand where the shot needs the world loaded, build its set, and wait until the world has built what it needs. */
	async function stage(/** @type {Spec} */ spec) {
		if (!shows(spec)) throw new Error(`this shot is in ${spec.world.sandbox}${spec.world.area ? ` (${spec.world.area})` : ''}, and this page is ${here.sandbox}${here.area ? ` (${here.area})` : ''}: open ${filmPath(spec.world)}`);
		const v = await mounted();
		const key = JSON.stringify([spec.world.stand, spec.world.dome ?? null, spec.world.props ?? null]);
		if (key === staged && v.film.holds(spec.world)) return;
		clock.leave(); // what a world builds (the domes) it builds on the page's own clock, a little every frame
		if (spec.world.props && !w.__props) sets[/** @type {keyof typeof sets} */ (spec.world.props)]?.(spec.world.seed);
		// the world stands where the shot needs it loaded, and resolves once everything the shot can see is built
		await v.film.stage({ ...spec.world, name: spec.meta?.name });
		await settled(v);
		staged = key;
	}

	/** Nothing still streaming in: no loader busy, every shader compiled. */
	async function settled(/** @type {any} */ v) {
		const T = v.THREE;
		while (T.DefaultLoadingManager.itemsLoaded < T.DefaultLoadingManager.itemsTotal) await sleep(100);
		await v.renderer.compileAsync(v.scene, v.camera);
	}

	/** Set the whole world for one instant of a shot. */
	function set(/** @type {any} */ v, /** @type {Spec} */ spec, /** @type {number} */ t, /** @type {Shape} */ shape, /** @type {number} */ aspect) {
		const e = evaluate(spec, t, shape);
		w.__interiorHour = e.hour;
		clock.world(e.clock);
		// a set is in the shots that name it, and nowhere else
		for (const [name, group] of Object.entries(w.__sets ?? {})) /** @type {any} */ (group).visible = name === spec.world.props;
		if (spec.world.props) w.__props?.(e.clock);
		v.camera.fov = e.fov;
		v.camera.aspect = aspect;
		v.camera.updateProjectionMatrix();
		v.fly(...e.pose);
		v.film.advance(e.clock, e.lights);
		return e;
	}

	/** The linear frame at t (all its shutter samples accumulated), w×h. */
	function linear(/** @type {any} */ v, /** @type {Spec} */ spec, /** @type {number} */ t, /** @type {Shape} */ shape, /** @type {number} */ W, /** @type {number} */ H, blur = true) {
		const times = blur ? shutterTimes(spec, t) : [t];
		/** @type {any} */
		let frame = null, first = null;
		for (const [i, ts] of times.entries()) {
			const e = set(v, spec, ts, shape, W / H);
			first ??= e;
			frame = gpu().sample(v.scene, v.camera, W, H, i, times.length);
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
		const key = fingerprint(spec);
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
		return out;
	}

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
		/** @param {any[]} specs */
		prepare(specs) {
			return one(async () => {
				const all = specs.map(normalize).filter(shows);
				const v = await mounted();
				// everything these shots need, kept built whichever shot asks last
				v.film.keep(all.map((s) => s.world));
				for (const s of all) await stage(s);
				for (const s of all) await exposureOf(s);
			});
		},
		/** @param {any} spec */
		meter(spec) {
			return one(async () => {
				const ev = await exposureOf(normalize(spec));
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
		 * @param {FrameAsk & { view?: { lut?: Lut | string | null, grade?: Lut | null }, quality?: 'proxy' | 'final' }} ask
		 */
		async show({ spec: raw, t, shape, width, height, view = {}, quality = 'proxy' }) {
			const spec = normalize(raw), to = shape ?? spec.aspect;
			const v = await mounted();
			const ev = await exposureOf(spec);
			await stage(spec);
			clock.enter();
			w.__filmDraw = true;
			const os = quality === 'final' ? 1.5 : 1;
			const W = Math.round(width * os), H = Math.round(height * os);
			const { frame, at } = linear(v, spec, t, to, W, H, quality === 'final');
			gpu().view(frame, width, height, 2 ** (evAt(ev, t) + at.stops), os > 1 ? 3 : 1, view);
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
