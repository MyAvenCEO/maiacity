// THE CUT PROBE — plays a world timeline through the studio's own world viewer (src/lib/studio/world.svelte.js), as the
// studio's Edit tab plays it, and says what every cut between two world shots costs: the longest the picture stood
// still around it, and what the frames there spent their time on (src/lib/film `__filmTrace`: the world set to its
// moment, rendered, viewed, staged; the world's own frames between two draws). A smooth cut costs what any frame does.
//
//   node scripts/film/world/cuts.mjs --timeline v1-A|v1-B|v2-C|village [--film village.json] [--from 0] [--seconds 60]
//     [--px 1280] [--site http://127.0.0.1:5173] [--engine chrome|webkit] [--meter all|ahead] [--grade clip|none]
//     [--warm all|shown|off] [--ready play|stand] [--stand 180] [--size 1920x1080] [--heap] [--trace] [--out cuts.json]
//
// `--ready play` (the default): before it plays, the world is readied as the studio's Play readies it
// (src/lib/studio/studio.svelte.js `preparePlayback`): the sets built, every shot played readied in turn
// (`readyShot`), the world stood where the play starts. `--ready stand`: it stands stopped instead, at most `--stand`
// seconds, as the studio stands while a timeline is open, for the world to build what the shots played see (it plays as
// soon as the world holds them all).
//
// `--grade clip` (the default) draws every clip through a grade of its own and the output LUT, as the studio draws a
// timeline graded clip by clip (the cubes made here at the Mac's sizes: 33³, the output 65³), the grades of the shots
// ahead sent before their cuts as the studio sends them.
//
// The site is a dev server (the viewer is imported from its sources): `VITE_RECIPE_FEED=dev bun run dev`. The V1
// intros' shots are the world's own (`__world.intro.shots()`); the first village's are its film's (`--film`: the film's JSON,
// as films/legacy/the-first-village.json held it before the films moved into avenDB; `git show
// bc244eda^:films/legacy/the-first-village.json` brings it back).
// `--heap` (Chrome): what the page allocated while it played, by the place that allocated it and the calls that led
// there (the sampling heap profiler, the objects collected since counted too: what the garbage collections had to
// sweep, the long frames with no script in them). `--trace` (Chrome): Chrome's own trace while it played, and for the
// longest tasks of the page's main thread and of the GPU process's, what each spent its time on (its events by their
// own time: a garbage collection, the page's scripts, a paint, the draws the GPU process ran): what a long frame with no
// script in it waited on. A trace is large: keep it to a stretch of the timeline (`--seconds 20`). `--size` is the
// frames' size (the container's software renderer draws a small one in a time a Mac draws the full one).
// `--firsts`: what the GPU drew for the first time while it played (each geometry's first draw: the thing, its bytes,
// into the shadow maps or the frame), by cut: a thing the warming (src/lib/film/warm.js) never saw before its shot, sent
// to the GPU on the cut's own frame (the hens' rigs at the village's sunrise, 2026-10-21). The world's first window only.
// Engines: chrome (puppeteer-core; CHROME, by default Google Chrome on a Mac, the container's Chromium elsewhere) or
// webkit (Playwright's, the engine of the Mac app; PLAYWRIGHT names the module where it is installed). Timings mean
// something only on a real GPU: on a Mac, never in a software renderer.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = Object.fromEntries(
	process.argv
		.slice(2)
		.join(' ')
		.split(/\s*--/)
		.filter(Boolean)
		.map((a) => {
			const [k, ...v] = a.split(/\s+/);
			return [k, v.join(' ') || 'true'];
		})
);
const site = (args.site ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const which = args.timeline ?? 'v1-A';
const engine = args.engine ?? 'chrome';
/** a frame that stands longer than this is a hitch (ms): two frames at 60 Hz, and a little */
const HITCH = 40;

/**
 * The places that allocated the most, each with the calls that led there most (a sampling heap profile).
 * @param {any} profile @returns {{ mb: number, top: { at: string, mb: number, via: string[] }[] }}
 */
function allocators(profile) {
	const where = (/** @type {any} */ f) => `${f.functionName || '(anonymous)'} ${String(f.url).replace(/^.*\/(src|node_modules)\//, '$1/').replace(/\?.*$/, '')}:${f.lineNumber + 1}`;
	/** @type {Map<string, { bytes: number, via: Map<string, number> }>} */
	const sites = new Map();
	const mb = (/** @type {number} */ n) => Math.round(n / 1e5) / 10;
	let total = 0;
	const walk = (/** @type {any} */ n, /** @type {string[]} */ up) => {
		const here = [where(n.callFrame), ...up.slice(0, 5)];
		if (n.selfSize) {
			total += n.selfSize;
			const site = sites.get(here[0]) ?? { bytes: 0, via: new Map() };
			const via = here.slice(1, 5).join(' < ');
			site.bytes += n.selfSize;
			site.via.set(via, (site.via.get(via) ?? 0) + n.selfSize);
			sites.set(here[0], site);
		}
		for (const c of n.children ?? []) walk(c, here);
	};
	walk(profile.head, []);
	return {
		mb: mb(total),
		top: [...sites]
			.sort((a, b) => b[1].bytes - a[1].bytes)
			.slice(0, 25)
			.map(([at, s]) => ({ at, mb: mb(s.bytes), via: [...s.via].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([v, n]) => `${mb(n)} MB < ${v}`) }))
	};
}

/** what Chrome's trace records (`--trace`): the threads' tasks, the page's scripts, paints and collections, the GPU
 * process's work (ANGLE's too) */
const TRACED = ['toplevel', 'devtools.timeline', 'v8', 'v8.execute', 'disabled-by-default-v8.gc', 'gpu', 'gpu.angle', 'blink.console'];

/**
 * The longest tasks of the page's main thread and of the GPU process's while it played (ms from the play's start),
 * each with what it spent its time on: its events by their own time. And over the whole play, what the page's main
 * thread spent most on.
 * @param {any[]} events @returns {Record<string, any>}
 */
function tasks(events) {
	/** @type {Map<string, string>} */
	const names = new Map();
	for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') names.set(`${e.pid}:${e.tid}`, e.args?.name);
	const play = events.find((e) => e.name === 'TimeStamp' && /probe: play/.test(JSON.stringify(e.args ?? {})));
	const t0 = play?.ts ?? events.reduce((m, e) => (e.ts && e.ts < m ? e.ts : m), Infinity);
	/** @type {Map<string, any[]>} */
	const byThread = new Map();
	for (const e of events) {
		if (e.ph !== 'X' || e.dur === undefined) continue;
		const k = `${e.pid}:${e.tid}`;
		if (!byThread.has(k)) byThread.set(k, []);
		/** @type {any[]} */ (byThread.get(k)).push(e);
	}
	const ms = (/** @type {number} */ us) => Math.round(us / 1000);
	/** each event's own time (less the events inside it), summed by name @param {any[]} xs sorted */
	const own = (xs) => {
		/** @type {Map<string, number>} */
		const by = new Map();
		/** @type {any[]} */
		const stack = [];
		for (const e of xs) {
			while (stack.length && e.ts >= stack[stack.length - 1].ts + stack[stack.length - 1].dur) stack.pop();
			const up = stack[stack.length - 1];
			if (up) by.set(up.name, (by.get(up.name) ?? 0) - e.dur);
			by.set(e.name, (by.get(e.name) ?? 0) + e.dur);
			stack.push(e);
		}
		return [...by].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, d]) => `${ms(d)} ms ${n}`);
	};
	/** @type {Record<string, any>} */
	const out = {};
	for (const [label, name] of [['page', 'CrRendererMain'], ['gpu', 'CrGpuMain']]) {
		// the busiest thread of that name (the page's renderer, not another's)
		const xs = [...byThread].filter(([k]) => names.get(k) === name).sort((a, b) => b[1].length - a[1].length)[0]?.[1];
		if (!xs) continue;
		xs.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
		/** @type {any[]} */
		const outer = [];
		let end = -Infinity;
		for (const e of xs) if (e.ts >= end) (outer.push(e), (end = e.ts + e.dur));
		out[label] = {
			spent: own(xs),
			longest: outer
				.filter((e) => e.dur > HITCH * 1000)
				.sort((a, b) => b.dur - a.dur)
				.slice(0, 20)
				.map((task) => ({ at: ms(task.ts - t0), ms: ms(task.dur), spent: own(xs.filter((e) => e.ts >= task.ts && e.ts + e.dur <= task.ts + task.dur)) }))
				.sort((a, b) => a.at - b.at)
		};
	}
	return out;
}

/** @returns {{ path: string, clips: { spec: any, in: number, dur: number }[] | null }} */
function timeline() {
	if (/^v[12]-[ABC]$/.test(which)) return { path: `/games/maiacity-${which.slice(0,2)}/?film&area=${which.slice(3)}`, clips: null };
	if (which !== 'village') throw new Error(`--timeline v1-A, v1-B, v2-C or village, not ${which}`);
	const film = JSON.parse(readFileSync(args.film ?? join(root, 'films/legacy/the-first-village.json'), 'utf8'));
	const clips = film.timeline.clips
		.filter((/** @type {any} */ c) => c.track === 'V1' && c.kind === 'world')
		.sort((/** @type {any} */ a, /** @type {any} */ b) => a.start - b.start)
		.map((/** @type {any} */ c) => ({ spec: film.shots[`${c.shot}@${c.shotVersion}`]?.spec, in: c.in ?? 0, dur: c.dur }))
		.filter((/** @type {any} */ c) => c.spec);
	return { path: '/games/sandbox-4/?film', clips };
}

async function launch() {
	if (engine === 'webkit') {
		const { webkit } = await import(process.env.PLAYWRIGHT ?? 'playwright');
		const browser = await webkit.launch({ headless: true });
		const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
		return { browser, page };
	}
	const { default: puppeteer } = await import('puppeteer-core');
	const mac = process.platform === 'darwin';
	const chromium = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
	const executablePath = process.env.CHROME ?? (mac ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : chromium);
	if (!existsSync(executablePath)) throw new Error(`no browser at ${executablePath} (CHROME names one)`);
	const gl = mac ? ['--use-gl=angle', '--use-angle=metal'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
	const browser = await puppeteer.launch({ executablePath, headless: true, protocolTimeout: 0, args: [...gl, '--no-sandbox', '--ignore-gpu-blocklist', '--window-size=1280,800', '--autoplay-policy=no-user-gesture-required'] });
	const page = await browser.newPage();
	await page.setViewport({ width: 1280, height: 800 });
	return { browser, page };
}

const { path, clips } = timeline();
const { browser, page } = await launch();
/** what the page allocated while it played (`--heap`), and what Chrome's trace saw then (`--trace`) @type {any} */
let heap = null, chromeTrace = null;
const recording = (!!args.heap || !!args.trace) && engine === 'chrome';
if (recording) {
	const cdp = args.heap ? await page.createCDPSession() : null;
	await page.exposeFunction('__probeRecord', async (/** @type {string} */ what) => {
		if (what === 'start') {
			if (cdp) await cdp.send('HeapProfiler.startSampling', { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
			if (args.trace) await page.tracing.start({ categories: TRACED });
			return;
		}
		if (cdp) heap = allocators((await cdp.send('HeapProfiler.stopSampling')).profile);
		if (args.trace) chromeTrace = tasks(JSON.parse(Buffer.from(/** @type {Uint8Array} */ (await page.tracing.stop())).toString('utf8')).traceEvents);
	});
}
const started = Date.now();
const say = (/** @type {string} */ s) => console.error(`[${((Date.now() - started) / 1000).toFixed(1)} s] ${s}`);
/** @type {string[]} */
const warnings = [];
page.on('console', (/** @type {any} */ m) => {
	const t = m.text();
	if (t.startsWith('probe: ')) say(t.slice(7));
	else if (/^(film|world|assets|maiacity|recipes)/.test(t) || ['warning', 'warn', 'error'].includes(m.type())) { warnings.push(t.slice(0, 1200)); console.error(t.slice(0, 1200)); }
});
page.on('pageerror', (/** @type {any} */ e) => warnings.push(`page error: ${e.message}`));
// a page of the site (any: a missing one) to hold the viewer and the world's iframe, of the same origin
await page.goto(`${site}/__cuts`, { waitUntil: 'domcontentloaded' });
const report = await page.evaluate(
	async (/** @type {any} */ o) => {
		const log = (/** @type {string} */ s) => console.log(`probe: ${s}`);
		document.body.innerHTML = '<iframe id="world" style="position:fixed;inset:0;width:100%;height:100%;border:0;background:#000"></iframe>';
		const { WorldViewer } = await import('/src/lib/studio/world.svelte.js');
		const iframe = /** @type {HTMLIFrameElement} */ (document.getElementById('world'));
		// what the film's warming draws (src/lib/film/warm.js): a trial's switch, read from this page
		if (o.warm) /** @type {any} */ (window).__filmWarm = o.warm;
		const viewer = new WorldViewer();
		viewer.px = o.px;
		const t0 = performance.now();
		await viewer.attach(iframe, o.path, 600000, 900000);
		if (viewer.state !== 'ready') return { error: `the world is ${viewer.state}: ${viewer.error}` };
		log(`the world is up after ${Math.round(performance.now() - t0)} ms`);
		let win = /** @type {any} */ (iframe.contentWindow);
		// the first draw of each geometry while it plays (`--firsts`), wrapped round the world's renderer
		const firsts = { on: false, list: /** @type {{ at: number, what: string, kb: number, into: string }[]} */ ([]) };
		if (o.firsts) {
			const r = win.__world.renderer, seen = new WeakSet(), draw = r.renderBufferDirect;
			const bytes = (/** @type {any} */ g) => [...Object.values(g.attributes ?? {}), g.index].reduce((a, x) => a + (x?.array?.byteLength ?? 0), 0);
			const named = (/** @type {any} */ x) => {
				const out = [];
				for (let p = x, k = 0; p && k < 4; p = p.parent, k++) out.push(p.name || p.type);
				return out.join(' < ');
			};
			r.renderBufferDirect = function (/** @type {any} */ camera, /** @type {any} */ scene, /** @type {any} */ geometry, /** @type {any} */ material, /** @type {any} */ object) {
				if (geometry && !seen.has(geometry)) {
					seen.add(geometry);
					if (firsts.on)
						firsts.list.push({ at: performance.now(), what: named(object), kb: Math.round((bytes(geometry) + (object.instanceMatrix?.array?.byteLength ?? 0)) / 1024), into: `${material?.type} ${camera?.layers?.isEnabled?.(31) ? 'warming' : camera?.isOrthographicCamera ? 'shadow' : 'frame'}` });
				}
				return draw.apply(this, /** @type {any} */ (arguments));
			};
		}
		// the timeline: the clips back to back, each its shot from `in` for `dur`
		let at = 0;
		const list = (o.clips ?? win.__world.intro.shots().map((/** @type {any} */ spec) => ({ spec, in: 0, dur: spec.seconds }))).map((/** @type {any} */ c, /** @type {number} */ i) => {
			const clip = { i, start: at, in: c.in, dur: c.dur, spec: c.spec, name: c.spec.meta?.name ?? `shot ${i + 1}` };
			at += c.dur;
			return clip;
		});
		const from = o.from, to = Math.min(at, from + o.seconds);
		const under = (/** @type {number} */ t) => list.find((c) => t >= c.start && t < c.start + c.dur);
		const ahead = (/** @type {number} */ t) => list.filter((c) => c.start + c.dur > t).slice(0, 3).map((c) => c.spec);
		// the shots the studio keeps built while it plays: those of the next 20 s, at least three, at most eight
		// (src/lib/studio/studio.svelte.js KEEP_AHEAD, KEEP_SHOTS)
		const kept = (/** @type {number} */ t) => list.filter((c) => c.start + c.dur > t).filter((c, i) => i < 3 || (i < 8 && c.start < t + 20)).map((c) => c.spec);
		// the views: the output LUT, and a grade for every clip (the Mac's sizes), as the studio draws them
		const cube = (/** @type {number} */ n, /** @type {number} */ k) => {
			const data = new Float32Array(n * n * n * 3);
			for (let b = 0, i = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++, i += 3) (data[i] = (r / (n - 1)) ** (1 + k * 0.01)), (data[i + 1] = g / (n - 1)), (data[i + 2] = b / (n - 1));
			return { size: n, data };
		};
		const odt = o.grade === 'none' ? null : cube(65, 0);
		const grades = list.map((/** @type {any} */ c) => (o.grade === 'none' ? null : cube(33, c.i + 1)));
		const viewOf = (/** @type {any} */ c) => ({ lut: odt, grade: grades[c.i] });
		// stopped first, as the studio is before Play: the shots from the playhead prepared and metered, the world stood
		// where the play starts (src/lib/studio/studio.svelte.js `preparePlayback`, `meterAhead`)
		const first = list.filter((c) => c.start + c.dur > from);
		// the draws followed from here (a trace not kept yet): a shader first drawn while the shots were prepared is not
		// counted as first drawn at a cut
		win.__filmTrace = [];
		const p0 = performance.now();
		// (a world that loses its GPU meanwhile is loaded again: its shots prepared again, a few times)
		for (let k = 0; k < 3; k++) {
			const film = viewer.film;
			// (the sets of every shot built too, as the stopped studio builds them: `dress`)
			await Promise.all([viewer.dress?.(list.map((c) => c.spec)), viewer.prepare(first.slice(0, 3).map((c) => c.spec))]);
			if (viewer.film === film && viewer.state === 'ready') break;
			log('the world was loaded again while its shots were prepared: preparing them again');
			while (viewer.state !== 'ready' && performance.now() - p0 < 900000) await new Promise((r) => setTimeout(r, 250));
			win = /** @type {any} */ (iframe.contentWindow);
			win.__filmTrace = [];
		}
		// the studio stands stopped a while before Play, building what every shot sees (`dress`): waited for here until
		// the world holds every shot played, or `--stand` seconds; then Play draws what came since out of sight, as the
		// studio's does
		const played = list.filter((c) => c.start + c.dur > from && c.start < to).map((c) => c.spec);
		if (o.ready === 'stand') {
			for (const s0 = performance.now(); performance.now() - s0 < o.stand * 1000; ) {
				const held = (await viewer.film?.held?.(played)) ?? [];
				if (held.length && held.every(Boolean)) break;
				await new Promise((r) => setTimeout(r, 1000));
			}
			await viewer.dress?.(list.map((c) => c.spec), { again: true });
		} else {
			// as Play readies it: the sets, then every shot played in turn, each staged until the world holds it
			const r0 = performance.now();
			await viewer.dress?.(list.map((c) => c.spec), { again: true });
			for (const spec of played) await viewer.readyShot(spec);
			log(`readied the world for ${played.length} shot(s) as Play does in ${Math.round(performance.now() - r0)} ms`);
		}
		await viewer.meterAhead((o.meter === 'all' ? first : first.slice(0, 3)).map((c) => c.spec), () => true);
		await viewer.standAt(first[0].spec);
		// and the views they are drawn through sent, as the stopped studio sends them
		viewer.look?.(first.slice(0, 3).map(viewOf));
		// and the frame at the playhead drawn, as the stopped studio draws it (its first frame is never the play's)
		const shown0 = viewer.drawnAt;
		viewer.show({ spec: first[0].spec, t: first[0].in + Math.max(0, from - first[0].start), shape: '16:9', width: o.size[0], height: o.size[1], view: viewOf(first[0]), meter: true });
		for (const s0 = performance.now(); viewer.drawnAt === shown0 && performance.now() - s0 < 60000; ) await new Promise((r) => setTimeout(r, 50));
		log(`${first.length} shots from ${from} s; the first prepared and metered in ${Math.round(performance.now() - p0)} ms; playing ${from}–${to.toFixed(1)} s`);
		// play: the timeline's clock is the page's own (the audio clock in the studio), the world driven every frame as
		// the studio's driveWorld does; the trace kept here (a world that loses its GPU is loaded again, in a new window)
		/** @type {any[]} */
		const traced = [];
		let reloads = 0, page = win;
		const traceOn = () => {
			const now = /** @type {any} */ (iframe.contentWindow);
			if (now && now !== page) (page = now), reloads++;
			if (now && now.__filmTrace !== traced) now.__filmTrace = traced;
		};
		traceOn();
		/** @type {{ now: number, gap: number, t: number, clip: number, drawnAt: number, live: boolean }[]} */
		const frames = [];
		// the page's long frames, and what ran in them (Chrome's long animation frames: the scripts, by function and file;
		// what is left of a long frame ran outside any script — a garbage collection, the GPU waited on)
		/** @type {{ at: number, ms: number, scripts: number, top: string[] }[]} */
		const longFrames = [];
		for (const wnd of [window, win]) {
			try {
				new wnd.PerformanceObserver((/** @type {any} */ list) => {
					for (const e of list.getEntries()) {
						if (e.duration < o.hitch) continue;
						const scripts = [...(e.scripts ?? [])].sort((x, y) => y.duration - x.duration);
						longFrames.push({
							at: e.startTime + wnd.performance.timeOrigin - performance.timeOrigin,
							ms: Math.round(e.duration),
							scripts: Math.round(scripts.reduce((a, x) => a + x.duration, 0)),
							top: scripts.slice(0, 4).map((x) => `${Math.round(x.duration)} ms ${x.invokerType ?? ''} ${x.sourceFunctionName || x.invoker || '?'} ${String(x.sourceURL ?? '').replace(/^.*\/(src|node_modules)\//, '$1/').replace(/\?.*$/, '')}:${x.sourceCharPosition ?? ''}`)
						});
					}
				}).observe({ type: 'long-animation-frame', buffered: false });
			} catch {
				/* not Chrome */
			}
		}
		// the page's JS heap (MB; Chrome only), as it starts to play and as it ends
		const heapNow = () => {
			const m = /** @type {any} */ (performance).memory;
			return m ? Math.round(m.usedJSHeapSize / 1e6) : null;
		};
		const heapAtPlay = heapNow();
		if (o.record) await /** @type {any} */ (window).__probeRecord('start');
		console.timeStamp('probe: play');
		viewer.plays(true);
		const play0 = performance.now();
		let prev = play0;
		firsts.on = true;
		await new Promise((done) => {
			const tick = () => {
				const now = performance.now();
				const t = from + (now - play0) / 1000;
				if (t >= to) return done(null);
				const c = under(t), specs = ahead(t);
				traceOn();
				viewer.keep(kept(t));
				viewer.markHeld(specs);
				viewer.look?.(list.filter((x) => x.start + x.dur > t).slice(0, 3).map(viewOf));
				if (c) viewer.show({ spec: c.spec, t: c.in + (t - c.start), shape: '16:9', width: o.size[0], height: o.size[1], view: viewOf(c), meter: false, wait: 50 });
				frames.push({ now: now - play0, gap: now - prev, t, clip: c?.i ?? -1, drawnAt: viewer.drawnAt - play0, live: !!c && viewer.isLive(c.spec) });
				prev = now;
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});
		firsts.on = false;
		if (o.record) await /** @type {any} */ (window).__probeRecord('stop');
		const heapAtEnd = heapNow();
		const trace = traced.map((f) => ({ ...f, at: f.at - play0 }));
		const long = longFrames.map((f) => ({ ...f, at: Math.round(f.at - play0) })).filter((f) => f.at >= 0);
		/** @type {any} */ (iframe.contentWindow).__filmTrace = undefined;
		/** the frames from a to b (ms of the play) and what they cost */
		const costs = (/** @type {number} */ a, /** @type {number} */ b) => trace.filter((f) => f.at >= a && f.at < b);
		const top = (/** @type {any[]} */ fs) => {
			const worst = fs.reduce((m, f) => (!m || f.total + f.loop > m.total + m.loop ? f : m), null);
			return worst && { ...Object.fromEntries(['total', 'exposure', 'staging', 'set', 'render', 'shadow', 'dearest', 'firsts', 'view', 'compiled', 'buffers', 'textures', 'warm', 'warmed', 'loop', 'worst'].map((k) => [k, Math.round(worst[k] ?? 0)])), drew: worst.drew };
		};
		const cuts = list
			.filter((c) => c.start > from && c.start < to)
			.map((c) => {
				const a = (c.start - from) * 1000 - 200, b = (c.start - from) * 1000 + 1500;
				const near = frames.filter((f) => f.now >= a && f.now < b);
				// the longest the picture stood still: between two new frames drawn
				let still = 0, last = null, lastAt = a;
				for (const f of near) if (f.drawnAt !== last) (still = Math.max(still, f.now - lastAt)), (last = f.drawnAt), (lastAt = f.now);
				return {
					at: +c.start.toFixed(2),
					to: c.name,
					from: list[c.i - 1]?.name ?? '',
					longest: Math.round(Math.max(0, ...near.map((f) => f.gap))),
					still: Math.round(still),
					hitches: near.filter((f) => f.gap > o.hitch).length,
					notLive: near.filter((f) => f.clip === c.i && !f.live).length,
					dearest: top(costs(a, b)),
					// the longest frame of the page there, and what ran in it
					longFrame: long.filter((f) => f.at >= a && f.at < b).sort((x, y) => y.ms - x.ms)[0] ?? null,
					// a garbage collection there: the most the page's heap shrank between two frames drawn (MB)
					heapFreed: Math.round(costs(a, b).reduce((m, f, i, fs) => (i && fs[i - 1].heap && f.heap ? Math.max(m, fs[i - 1].heap - f.heap) : m), 0)),
					// what the GPU drew there for the first time (`--firsts`), the largest first
					...(o.firsts ? drawnFirst(a, b) : {})
				};
			});
		/** what was drawn for the first time from a to b (ms of the play): its KB, and the largest ones */
		function drawnFirst(/** @type {number} */ a, /** @type {number} */ b) {
			const got = firsts.list.filter((f) => f.at - play0 >= a && f.at - play0 < b && f.into !== 'warming').sort((x, y) => y.kb - x.kb);
			return { firstKB: got.reduce((n, f) => n + f.kb, 0), firstDrawn: got.slice(0, 10).map((f) => `${f.kb} KB ${f.what} (${f.into})`) };
		}
		const gaps = frames.map((f) => f.gap).sort((x, y) => x - y);
		const pct = (/** @type {number} */ p) => +gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))].toFixed(1);
		const outside = frames.filter((f) => !cuts.some((c) => f.t >= c.at - 0.2 && f.t < c.at + 1.5));
		return {
			frames: frames.length,
			median: pct(0.5),
			p95: pct(0.95),
			worst: Math.round(gaps.at(-1) ?? 0),
			hitches: frames.filter((f) => f.gap > o.hitch).length,
			hitchesAwayFromCuts: outside.filter((f) => f.gap > o.hitch).length,
			reloads,
			heapAtPlay,
			heapAtEnd,
			previewFps: viewer.previewFps,
			drawnFps: Math.round(new Set(frames.map(f => f.drawnAt)).size / (to - from) * 10) / 10,
			// the cuts whose picture stood still longer than a hitch, and the frames that waited on a staging while it played
			stalledCuts: cuts.filter((c) => c.still > o.hitch).length,
			stagedWhilePlaying: trace.filter((f) => f.staging > 1).length,
			compiledWhilePlaying: trace.reduce((a, f) => a + (f.compiled ?? 0), 0),
			firstShaderDraws: trace.reduce((a, f) => a + (f.firsts ?? 0), 0),
			warmedWhilePlaying: trace.reduce((a, f) => a + (f.warmed ?? 0), 0),
			warmTime: Math.round(trace.reduce((a, f) => a + (f.warm ?? 0), 0)),
			scale: viewer.scale,
			...(o.firsts ? { firstsWhilePlaying: drawnFirst(0, Infinity) } : {}),
			cuts,
			longFrames: [...long].sort((x, y) => y.ms - x.ms).slice(0, 15),
			dearestFrames: [...trace].sort((x, y) => y.total + y.loop - (x.total + x.loop)).slice(0, 12).map((f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 10) / 10 : v])))
		};
	},
	{ path, clips, from: Number(args.from ?? 0), seconds: Number(args.seconds ?? 60), px: Number(args.px ?? 1280), meter: args.meter ?? 'ahead', grade: args.grade ?? 'clip', warm: args.warm, ready: args.ready ?? 'play', stand: Number(args.stand ?? 180), size: (args.size ?? '1920x1080').split('x').map(Number), record: recording, hitch: HITCH, firsts: !!args.firsts }
);
await browser.close();
// a shot that waited for parts of the world while it played (the village's domes: "waits N s for domes …")
const waits = warnings.filter((w) => /^film: .* waits .* for /.test(w)).length;
const out = { timeline: which, engine, site, warm: args.warm ?? 'all', at: new Date().toISOString(), ...report, waits, heap, trace: chromeTrace, warnings };
if (args.out) writeFileSync(args.out, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
