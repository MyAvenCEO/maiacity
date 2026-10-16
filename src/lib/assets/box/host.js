// @ts-nocheck — plain JS
import { base } from '$app/paths';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { LATEST, engineAt, enginePath } from '../engines.js';
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
 * - The worker is a frozen engine (./engine.js, static/engines/engine-v<n>.js), its bytes checked against its BLAKE3
 *   hash (../engines.json) before it starts, and handed in whole: the box can load nothing. Each build hands it its
 *   recipe as code (../recipes.js), which the page checked against the recipe's hash as well.
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

/**
 * A frozen engine's code, its bytes checked against its hash. @param {number} v
 * @returns {Promise<string>}
 */
export async function engineCode(v) {
	const at = engineAt(v);
	if (!at) throw new Error(`no engine ${v}`);
	const res = await fetch(`${base}${enginePath(v)}`);
	if (!res.ok) throw new Error(`engine ${v}: ${res.status}`);
	const bytes = new Uint8Array(await res.arrayBuffer());
	const named = bytesToHex(blake3(bytes));
	if (named !== at.blake3) throw new Error(`refused: engine ${v} hashes to ${named.slice(0, 12)}…, not ${at.blake3.slice(0, 12)}…`);
	return new TextDecoder().decode(bytes);
}

export class AssetBox {
	/** @param {{ engine?: number, timeout?: number }} [o] the engine it runs (the latest) */
	constructor({ engine = LATEST.v, timeout = TIMEOUT } = {}) {
		this.engine = engine;
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
			const code = await engineCode(this.engine);
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
		clearInterval(job.timer);
		if (msg.ok === true) job.ok(msg);
		else job.no(new Error(String(msg.error ?? 'the box failed')));
	}

	/**
	 * one job: { op, …args } answered with { data, ms }. One that runs longer than `timeout` tears the box down, unless
	 * it is `soft`: a step waiting behind a build is late, not lost, so only it fails and the box goes on. The jobs that
	 * are not soft go into the box one at a time, so each one's time is its own and not the jobs' asked before it (a
	 * page that asks for seventy builds at once no longer tears the box down at the twentieth second).
	 */
	ask(op, payload = {}, { timeout = this.timeout, soft = false } = {}) {
		if (soft) return this.#post(op, payload, timeout, soft);
		const turn = (this.queue ?? Promise.resolve()).then(() => this.#post(op, payload, timeout, soft));
		this.queue = turn.catch(() => {});
		return turn;
	}

	async #post(op, payload, timeout, soft) {
		await this.start();
		const id = this.next++;
		return new Promise((ok, no) => {
			// its time counted a second at a time, and at most a second and a half for each: a page too busy to listen
			// (compiling a world's shaders on a slow machine) does not use up the box's time, only the box itself does
			let had = 0, last = performance.now();
			const timer = setInterval(() => {
				const t = performance.now();
				had += Math.min(t - last, 1500);
				last = t;
				if (had < timeout) return;
				clearInterval(timer);
				if (!soft) return this.stop(`${op} ran longer than ${timeout} ms`);
				this.jobs.delete(id);
				no(new Error(`${op} ran longer than ${timeout} ms`));
			}, Math.min(1000, timeout));
			this.jobs.set(id, { ok, no, timer });
			this.frame.contentWindow.postMessage({ id, op, ...payload }, '*');
		});
	}

	/**
	 * A recipe built in the box: `{ data, card, ms }`, its plain data (./serialize.js) and its card, unchecked.
	 * @param {{ hash: string, code: string }} recipe checked against its hash (../recipes.js)
	 * @param {Record<string, string>} [given] its parameters' values, as text
	 */
	build(recipe, given, o) {
		return this.ask('build', { recipe, given, engine: this.engine }, o);
	}

	/**
	 * A build kept running in the box (engine 4 on, ./live.js): `{ session, nodes }`. `nodes` is how many nodes the page
	 * built of it, which the box's build must have too.
	 * @param {{ hash: string, code: string }} recipe @param {Record<string, string> | undefined} given @param {number} nodes
	 */
	live(recipe, given, nodes, o) {
		return this.ask('live', { recipe, given, nodes }, o);
	}

	/** one step of a running build: what changed, as numbers, and what its solver reads (unchecked; ../hero.js checks it) */
	tick(session, ask, o = { timeout: 5000, soft: true }) {
		return this.ask('tick', { session, ask }, o);
	}

	/** a running machine broken its own way (`on`), or mended */
	breakIt(session, on) {
		return this.ask(on ? 'break' : 'mend', { session }, { timeout: 5000, soft: true });
	}

	/** a running build let go of (nothing to answer if the box is gone) */
	end(session) {
		if (!this.frame) return Promise.resolve();
		return this.ask('end', { session }, { timeout: 5000, soft: true }).catch(() => {});
	}

	/** tears the box down: the frame and its worker are gone, every job open fails with `why` */
	stop(why = 'the box was stopped') {
		removeEventListener('message', this.onmessage);
		this.frame?.remove();
		this.frame = null;
		this.ready = null;
		// its running builds went with it
		this.generation = (this.generation ?? 0) + 1;
		for (const job of this.jobs.values()) {
			clearInterval(job.timer);
			job.no(new Error(why));
		}
		this.jobs.clear();
	}
}
