// @ts-nocheck — plain JS
import { base } from '$app/paths';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { DENY, SANDBOX, SHELL_SCRIPT } from './policy.js';
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
 * - The frame does nothing but start workers and pass messages, so code that never stops cannot freeze the page, not
 *   even in Safari, where a sandboxed frame shares the page's thread.
 * - Rooms keep code apart inside one shell (the asset box gives each recipe its own). A room is a worker of its own
 *   that no other room's job ever reaches, and the frame names each message by the room of the worker that sent it,
 *   so a job is answered only from the room it was asked in: code in one room can neither see another's jobs nor
 *   answer them. A host may ask for a spare, a worker made ahead with nothing run in it, which the next new room
 *   takes while the frame makes the next one.
 * - Out comes plain data only, which the page checks before it uses it. A job that runs too long is ended by removing
 *   the frame (the worker goes with it); the next job starts a new shell.
 */

/** The frame's policy: nothing in or out but its own script, its worker's blob and, if `wasm`, WebAssembly. */
export const csp = ({ wasm = false } = {}) =>
	["default-src 'none'", `script-src 'unsafe-inline' blob:${wasm ? " 'wasm-unsafe-eval'" : ''}`, 'worker-src blob:', "connect-src 'none'", "img-src 'none'", "style-src 'none'", "font-src 'none'", "media-src 'none'", "frame-src 'none'", "object-src 'none'", "form-action 'none'", "base-uri 'none'"].join('; ');

// the frame: its policy, and its one script (./policy.js SHELL_SCRIPT), which the page's own policy names by its hash
const frameOf = (policy) => `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><script>${SHELL_SCRIPT}<\/script>`;

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
	 * @param {{ code: () => Promise<string>, wasm?: boolean, timeout?: number, spare?: boolean }} o `code`: the engine
	 *   the workers run, checked (`frozen`); `wasm`: whether that engine compiles WebAssembly; `spare`: a worker kept
	 *   made ahead for the next new room (a host of many rooms)
	 */
	constructor({ code, wasm = false, timeout = TIMEOUT, spare = false }) {
		this.code = code;
		this.policy = csp({ wasm });
		this.timeout = timeout;
		this.spare = spare;
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
			frame.contentWindow.postMessage({ op: 'boot', code, spare: this.spare }, '*');
			await up;
		})();
		this.ready.catch(() => this.stop('the box did not start'));
		return this.ready;
	}

	#message(e) {
		if (!this.frame || e.source !== this.frame.contentWindow) return;
		// [what a worker said, the room of that worker], the room named by the frame
		const [msg, room] = Array.isArray(e.data) ? e.data : [];
		if (!msg || typeof msg !== 'object') return;
		if (msg.op === 'ready') return this.started?.();
		if (msg.op === 'crash') return this.stop(`the box crashed: ${msg.error}`);
		const job = this.jobs.get(msg.id);
		// a job is answered only from the room it was asked in, whatever number another room's code guesses
		if (!job || job.room !== room) return;
		this.jobs.delete(msg.id);
		clearInterval(job.timer);
		if (msg.ok === true) job.ok(msg);
		else job.no(new Error(String(msg.error ?? 'the box failed')));
	}

	/**
	 * one job: { op, …args } answered with the engine's answer, in `room` (its worker; a host of one room leaves it),
	 * or in the room a function names once the job's turn comes (a host that keeps few rooms names it then). One that
	 * runs longer than `timeout` tears the shell down, unless it is `soft`: a step waiting behind a build is late, not
	 * lost, so only it fails and the shell goes on. The jobs that are not soft go in one at a time, whatever their
	 * room, so each one's time is its own and not the jobs' asked before it.
	 */
	ask(op, payload = {}, { timeout = this.timeout, soft = false, room = 0 } = {}) {
		if (soft) return this.#post(op, payload, timeout, soft, room);
		const turn = (this.queue ?? Promise.resolve()).then(() => this.#post(op, payload, timeout, soft, room));
		this.queue = turn.catch(() => {});
		return turn;
	}

	async #post(op, payload, timeout, soft, room) {
		await this.start();
		if (typeof room === 'function') room = room();
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
			this.jobs.set(id, { ok, no, timer, room });
			this.frame.contentWindow.postMessage({ op: 'job', room, job: { id, op, ...payload } }, '*');
		});
	}

	/** a room let go: its worker ended, any job open in it failed; a job asked in it again starts in a fresh worker */
	leave(room) {
		for (const [id, job] of this.jobs) {
			if (job.room !== room) continue;
			clearInterval(job.timer);
			this.jobs.delete(id);
			job.no(new Error('its room was let go'));
		}
		this.frame?.contentWindow?.postMessage({ op: 'leave', room }, '*');
	}

	/** tears the shell down: the frame and its workers are gone, every job open fails with `why` */
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
