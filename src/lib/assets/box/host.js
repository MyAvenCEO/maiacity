// @ts-nocheck — plain JS
/*
 * THE ASSET BOX — where an asset's builder runs when we cannot trust it: a worker inside a frame with no origin. The
 * same boundary as a Generated UI code view ($lib/genui/Frame.svelte), one step further: the frame does nothing but
 * start the worker and pass messages, the builder runs in the worker (its own thread, so a builder that never stops
 * cannot freeze the page, not even in Safari, where a sandboxed frame shares the page's thread).
 *
 * - The frame: sandbox="allow-scripts" and NOT allow-same-origin, so its origin is opaque ("null"): it reaches no
 *   cookie, storage, OPFS (avenDB), passkey or page of ours. A Permissions Policy turns every device feature off.
 * - Its Content Security Policy, which the worker inherits (a worker from a blob: URL takes its maker's policy): no
 *   connection of any kind, no script but the frame's own and the worker's blob, no images, styles, frames or forms.
 * - The worker's code is the box bundle (`virtual:asset-box`, ./plugin.js), handed in whole: the box can load nothing.
 * - Out comes plain data only (./serialize.js), which the page checks and builds its own objects from (./rebuild.js).
 * - A job that runs too long is ended by removing the frame (the worker goes with it); the next job starts a new box.
 */

const CSP = ["default-src 'none'", "script-src 'unsafe-inline' blob:", 'worker-src blob:', "connect-src 'none'", "img-src 'none'", "style-src 'none'", "font-src 'none'", "media-src 'none'", "frame-src 'none'", "object-src 'none'", "form-action 'none'", "base-uri 'none'"].join('; ');
const DENY = ['camera', 'microphone', 'geolocation', 'display-capture', 'clipboard-read', 'clipboard-write', 'payment', 'usb', 'serial', 'hid', 'bluetooth', 'publickey-credentials-get', 'publickey-credentials-create', 'storage-access', 'fullscreen'].map((f) => `${f} 'none'`).join('; ');

// the frame: starts the worker from the code it is handed, then passes messages both ways, the arrays moved
const FRAME = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${CSP}"><script>
let w;
addEventListener('message', (e) => {
	if (e.source !== parent) return;
	const m = e.data;
	if (m && m.op === 'boot' && !w) {
		w = new Worker(URL.createObjectURL(new Blob([m.code], { type: 'text/javascript' })));
		w.onmessage = (x) => parent.postMessage(x.data, '*', x.data[1]);
		w.onerror = (x) => { x.preventDefault(); parent.postMessage([{ op: 'crash', error: String(x.message) }, []], '*'); };
		return;
	}
	if (w) w.postMessage(m);
});
<\/script>`;

/** how long a job may take before the box is torn down (ms) */
export const TIMEOUT = 20000;

export class AssetBox {
	constructor({ timeout = TIMEOUT } = {}) {
		this.timeout = timeout;
		this.frame = null;
		this.ready = null;
		this.jobs = new Map();
		this.next = 1;
		this.onmessage = (e) => this.#message(e);
	}

	/** starts the box (once; again after it was torn down) */
	start() {
		if (this.ready) return this.ready;
		this.ready = (async () => {
			const { default: code } = await import('virtual:asset-box');
			const frame = document.createElement('iframe');
			frame.setAttribute('sandbox', 'allow-scripts');
			frame.setAttribute('allow', DENY);
			frame.setAttribute('referrerpolicy', 'no-referrer');
			frame.setAttribute('aria-hidden', 'true');
			frame.tabIndex = -1;
			frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden;pointer-events:none';
			frame.srcdoc = FRAME;
			this.frame = frame;
			const up = new Promise((ok, no) => {
				this.started = ok;
				setTimeout(() => no(new Error('the box did not start')), this.timeout);
			});
			addEventListener('message', this.onmessage);
			const loaded = new Promise((ok) => frame.addEventListener('load', ok, { once: true }));
			document.body.append(frame);
			await loaded;
			frame.contentWindow.postMessage({ op: 'boot', code }, '*');
			await up;
		})();
		this.ready.catch(() => this.stop('the box did not start'));
		return this.ready;
	}

	#message(e) {
		if (!this.frame || e.source !== this.frame.contentWindow) return;
		const msg = Array.isArray(e.data) ? e.data[0] : null;
		if (!msg || typeof msg !== 'object') return;
		if (msg.op === 'ready') return this.started?.();
		if (msg.op === 'crash') return this.stop(`the box crashed: ${msg.error}`);
		const job = this.jobs.get(msg.id);
		if (!job) return;
		this.jobs.delete(msg.id);
		clearTimeout(job.timer);
		if (msg.ok === true) job.ok(msg);
		else job.no(new Error(String(msg.error ?? 'the box failed')));
	}

	/** one job: { op, …args } answered with { data, ms } */
	async ask(op, payload = {}, { timeout = this.timeout } = {}) {
		await this.start();
		const id = this.next++;
		return new Promise((ok, no) => {
			const timer = setTimeout(() => this.stop(`${op} ran longer than ${timeout} ms`), timeout);
			this.jobs.set(id, { ok, no, timer });
			this.frame.contentWindow.postMessage({ id, op, ...payload }, '*');
		});
	}

	/** an asset built in the box, as plain data (./serialize.js) */
	build(ref, args = [], o) {
		return this.ask('build', { ref, args }, o);
	}

	/** tears the box down: the frame and its worker are gone, every job open fails with `why` */
	stop(why = 'the box was stopped') {
		removeEventListener('message', this.onmessage);
		this.frame?.remove();
		this.frame = null;
		this.ready = null;
		for (const job of this.jobs.values()) {
			clearTimeout(job.timer);
			job.no(new Error(why));
		}
		this.jobs.clear();
	}
}
