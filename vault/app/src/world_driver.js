// The world renderer's hand in the page — a shot's HD proxy, or a plate the final render cuts in: loaded before
// anything else into the app's own unseen world window (/games/sandbox-4/?film, the studio's own build — see
// world.rs). It waits for film mode (window.__film), then asks the app for a stretch of a shot to render (`from`
// seconds in, `frames` frames at `fps`, framed for `shape`, at a size), renders it frame by frame through
// `__film.capture` — ACEScct, 10-bit, x2bgr10le, the plate's own frames — and hands each frame to the app as raw bytes,
// waiting for the app to take it before rendering the next: one frame in flight, never a pile of them in memory.
(() => {
	if (window !== window.top || window.__worldProxy) return;
	window.__worldProxy = true;
	const invoke = (cmd, args, options) => window.__TAURI_INTERNALS__.invoke(cmd, args, options);
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	const text = (a) => (a instanceof Error ? (a.stack ?? a.message) : typeof a === 'string' ? a : JSON.stringify(a));

	// nobody reads this window's console: its warnings and errors go into the app's log
	const log = (level, message) => invoke('log_js', { level, from: 'world proxy', message: String(message).slice(0, 4000) }).catch(() => {});
	for (const level of ['warn', 'error']) {
		const was = console[level].bind(console);
		console[level] = (...args) => (was(...args), log(level, args.map(text).join(' ')));
	}
	addEventListener('error', (e) => log('error', `${e.message} (${e.filename}:${e.lineno})`));
	addEventListener('unhandledrejection', (e) => log('error', `unhandled: ${text(e.reason)}`));

	/** One shot, every frame of it, into the app. */
	async function render(job) {
		const film = window.__film;
		await film.ready(job.spec);
		const ev = await film.exposure(job.spec);
		const bytes = job.width * job.height * 4;
		for (let k = 0; k < job.frames; k++) {
			const ask = { spec: job.spec, t: (job.from ?? 0) + k / job.fps, shape: job.shape, width: job.width, height: job.height, oversample: job.oversample };
			let frame = await film.capture(ask);
			if (frame.byteLength !== bytes) frame = frame.slice(0, bytes);
			await invoke('world_proxy_frame', frame, { headers: { 'x-job': job.id, 'x-frame': String(k) } });
		}
		return { ev, build: film.build ?? null, film: film.FILM_VERSION ?? null };
	}

	(async () => {
		while (!(window.__TAURI_INTERNALS__ && window.__film && window.__village)) await sleep(250);
		for (;;) {
			let job = null;
			try {
				job = await invoke('world_proxy_next'); // waits a while for one; null: none yet
			} catch (e) {
				await sleep(5000);
				continue;
			}
			if (!job) continue;
			try {
				const info = await render(job);
				await invoke('world_proxy_end', { job: job.id, info, error: null });
			} catch (e) {
				await invoke('world_proxy_end', { job: job.id, info: null, error: String(e?.message ?? e) }).catch(() => {});
			}
		}
	})();
})();
