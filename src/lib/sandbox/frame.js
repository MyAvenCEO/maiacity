// @ts-nocheck — plain JS
import { base } from '$app/paths';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { DENY, SANDBOX } from './policy.js';
/*
 * THE SHELL — where code we cannot trust runs in a page: a worker inside a frame with no origin. One shell for every
 * host: the asset box (recipes, ../assets/box/host.js), the logic host (rules, view logic, functions, ./logic-host.js)
 * and the view host. Each runs a frozen engine of ours in the worker, and nothing else ever starts there.
 *
 * - The frame: sandbox="allow-scripts" and NOT allow-same-origin, so its origin is opaque ("null"): it reaches no
 *   cookie, storage, OPFS (avenDB), passkey or page of ours. A Permissions Policy turns every device feature off
 *   (./policy.js, the one deny list).
 * - Its Content Security Policy, which the worker inherits (a worker from a blob: URL takes its maker's policy): no
 *   connection of any kind, no script but the frame's own and the worker's blob (and WebAssembly, for a host whose
 *   engine is one), no images, styles, frames or forms.
 * - The worker is a frozen engine, its bytes checked against its BLAKE3 hash before it starts, and handed in whole:
 *   the shell can load nothing. Its first act is the second lock (./lockdown.js): every way out a worker has is
 *   taken off its global scope.
 * - The frame does nothing but start the worker and pass messages, so code that never stops cannot freeze the page,
 *   not even in Safari, where a sandboxed frame shares the page's thread.
 * - Out comes plain data only, which the page checks before it uses it. A job that runs too long is ended by removing
 *   the frame (the worker goes with it); the next job starts a new shell.
 */

/** The frame's policy: nothing in or out but its own script, its worker's blob and, if `wasm`, WebAssembly. */
export const csp = ({ wasm = false } = {}) =>
	["default-src 'none'", `script-src 'unsafe-inline' blob:${wasm ? " 'wasm-unsafe-eval'" : ''}`, 'worker-src blob:', "connect-src 'none'", "img-src 'none'", "style-src 'none'", "font-src 'none'", "media-src 'none'", "frame-src 'none'", "object-src 'none'", "form-action 'none'", "base-uri 'none'"].join('; ');

// the frame: starts the worker from the code it is handed, then passes messages both ways, the arrays moved
const frameOf = (policy) => `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><script>
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

/**
 * A frozen engine's code, fetched from `path` (under the site's base path) and its bytes checked against `hash`.
 * @param {string} path @param {string} hash @param {string} what what it is called in an error
 * @returns {Promise<string>}
 */
export async function frozen(path, hash, what) {
	const res = await fetch(`${base}${path}`);
	if (!res.ok) throw new Error(`${what}: ${res.status}`);
	const bytes = new Uint8Array(await res.arrayBuffer());
	const named = bytesToHex(blake3(bytes));
	if (named !== hash) throw new Error(`refused: ${what} hashes to ${named.slice(0, 12)}…, not ${hash.slice(0, 12)}…`);
	return new TextDecoder().decode(bytes);
}

/** how long a job may take before the shell is torn down (ms) */
export const TIMEOUT = 20000;

export class Shell {
	/**
	 * @param {{ code: () => Promise<string>, wasm?: boolean, timeout?: number }} o `code`: the engine the worker runs,
	 *   checked (`frozen`); `wasm`: whether that engine compiles WebAssembly
	 */
	constructor({ code, wasm = false, timeout = TIMEOUT }) {
		this.code = code;
		this.policy = csp({ wasm });
		this.timeout = timeout;
		this.frame = null;
		this.ready = null;
		this.jobs = new Map();
		this.next = 1;
		this.onmessage = (e) => this.#message(e);
	}

	/** starts the shell (once; again after it was torn down) */
	start() {
		if (this.ready) return this.ready;
		this.ready = (async () => {
			const code = await this.code();
			const frame = document.createElement('iframe');
			frame.setAttribute('sandbox', SANDBOX);
			frame.setAttribute('allow', DENY);
			frame.setAttribute('referrerpolicy', 'no-referrer');
			frame.setAttribute('aria-hidden', 'true');
			frame.tabIndex = -1;
			frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden;pointer-events:none';
			frame.srcdoc = frameOf(this.policy);
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
	 * one job: { op, …args } answered with the engine's answer. One that runs longer than `timeout` tears the shell
	 * down, unless it is `soft`: a step waiting behind a build is late, not lost, so only it fails and the shell goes on.
	 * The jobs that are not soft go in one at a time, so each one's time is its own and not the jobs' asked before it.
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
			// (compiling a world's shaders on a slow machine) does not use up the shell's time, only the shell itself does
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

	/** tears the shell down: the frame and its worker are gone, every job open fails with `why` */
	stop(why = 'the box was stopped') {
		removeEventListener('message', this.onmessage);
		this.frame?.remove();
		this.frame = null;
		this.ready = null;
		// what ran in it went with it
		this.generation = (this.generation ?? 0) + 1;
		for (const job of this.jobs.values()) {
			clearInterval(job.timer);
			job.no(new Error(why));
		}
		this.jobs.clear();
	}
}
