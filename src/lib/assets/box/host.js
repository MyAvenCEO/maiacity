// @ts-nocheck — plain JS
import { LATEST, engineAt } from '../engines.js';
import { Shell, TIMEOUT, engineCode as frozenCode } from '../../sandbox/frame.js';
/*
 * THE ASSET BOX — where an asset's builder runs when we cannot trust it: the shell (../../sandbox/frame.js, a worker
 * inside a frame with no origin, the same for every host of code we cannot trust) running the asset engine.
 *
 * - The worker is a frozen engine (./engine.js, static/engines/engine-v<n>.js), its bytes checked against its BLAKE3
 *   hash (src/lib/sandbox/engines.json, kind box) before it starts, and handed in whole: the box can load nothing. Each build hands it its
 *   recipe as code (../recipes.js), which the page checked against the recipe's hash as well.
 * - Each recipe runs in a worker of its own (a room of the shell, ../../sandbox/frame.js), one that no other recipe's
 *   code ever ran in: a recipe sees only its own jobs, and the shell takes an answer only from the room its job was
 *   asked in, so no recipe can answer another's build with a model of its own (which the page would then keep under
 *   that recipe's name). A recipe is known by its code, the bytes it runs, so even a caller handing two recipes one
 *   hash keeps them apart. The box keeps the rooms of the last ROOMS recipes asked of it and of every build it keeps
 *   running, and one worker made ahead, nothing run in it, for the next: it loads three.js while the last builds.
 * - Out comes plain data only (./serialize.js), which the page checks and builds its own objects from (./rebuild.js).
 * - A recipe dies alone (the shell's `apart`): one whose build runs past its time, or whose worker crashes, has its
 *   room let go, its worker ended and the builds kept running in it gone with it, while every other recipe's room, and
 *   the machines running there, go on in the same box. Its next build starts in a fresh worker.
 */

export { TIMEOUT };

/** how many recipes' rooms a box keeps at once, the last asked of it (one with a job open, or a build kept running in
 *  it, is always kept) */
export const ROOMS = 4;

/**
 * A frozen box engine's code, its bytes checked against its hash (once a page: the boxes that run it share the checked
 * text, ../../sandbox/frame.js `engineCode`). @param {number} v
 * @returns {Promise<string>}
 */
export function engineCode(v) {
	if (!engineAt(v)) return Promise.reject(new Error(`no engine ${v}`));
	return frozenCode('box', v);
}

export class AssetBox extends Shell {
	/** @param {{ engine?: number, timeout?: number }} [o] the engine it runs (the latest) */
	constructor({ engine = LATEST.v, timeout = TIMEOUT } = {}) {
		super({ code: () => engineCode(engine), timeout, spare: true, apart: true });
		this.engine = engine;
		/** @type {{ room: number, code: string }[]} the recipes' rooms, the one asked of last at the end */
		this.rooms = [];
		/** @type {Map<number, { room: number, session: number }>} the builds kept running, by the page's handle on each */
		this.sessions = new Map();
		this.ids = 0;
	}

	/**
	 * The room a recipe runs in, by its code, named when its job's turn comes: its own, else a new one, the oldest past
	 * ROOMS let go (but one with a job open or a build kept running: a running machine is never stopped for another).
	 * @param {string} code
	 */
	#roomOf(code) {
		const i = this.rooms.findIndex((r) => r.code === code);
		const r = i >= 0 ? this.rooms.splice(i, 1)[0] : { room: ++this.ids, code };
		const busy = new Set([...this.jobs.values(), ...this.sessions.values()].map((j) => j.room));
		for (const old of this.rooms.slice()) {
			if (this.rooms.length < ROOMS) break;
			if (busy.has(old.room)) continue;
			this.rooms.splice(this.rooms.indexOf(old), 1);
			this.leave(old.room);
		}
		this.rooms.push(r);
		return r.room;
	}

	/** a job on a build kept running: in its room (now the one asked of last), on its session there */
	#onSession(session, op, payload, o) {
		const s = this.sessions.get(session);
		if (!s) return Promise.reject(new Error(`no session ${String(session).slice(0, 20)} (the box was started again)`));
		const i = this.rooms.findIndex((r) => r.room === s.room);
		if (i >= 0) this.rooms.push(...this.rooms.splice(i, 1));
		return this.ask(op, { ...payload, session: s.session }, { ...o, room: s.room });
	}

	/**
	 * A recipe built in the box: `{ data, card, ms }`, its plain data (./serialize.js) and its card, unchecked.
	 * @param {{ hash: string, code: string }} recipe checked against its hash (../recipes.js)
	 * @param {Record<string, string>} [given] its parameters' values, as text
	 */
	build(recipe, given, o) {
		return this.ask('build', { recipe, given, engine: this.engine }, { ...o, room: () => this.#roomOf(recipe.code) });
	}

	/**
	 * A build kept running in the box (engine 4 on, ./live.js): `{ session, nodes }`. `nodes` is how many nodes the page
	 * built of it, which the box's build must have too; `session` the page's handle on it, which knows its room.
	 * @param {{ hash: string, code: string }} recipe @param {Record<string, string> | undefined} given @param {number} nodes
	 */
	async live(recipe, given, nodes, o) {
		let room;
		const got = await this.ask('live', { recipe, given, nodes }, { ...o, room: () => (room = this.#roomOf(recipe.code)) });
		const session = ++this.ids;
		// (a box torn down meanwhile has no room for it: its steps fail, as a torn-down box's do)
		if (this.rooms.some((r) => r.room === room)) this.sessions.set(session, { room, session: got.session });
		return { ...got, session };
	}

	/** one step of a running build: what changed, as numbers, and what its solver reads (unchecked; ../hero.js checks it) */
	tick(session, ask, o = { timeout: 5000, soft: true }) {
		return this.#onSession(session, 'tick', { ask }, o);
	}

	/** a running machine broken its own way (`on`), or mended */
	breakIt(session, on) {
		return this.#onSession(session, on ? 'break' : 'mend', {}, { timeout: 5000, soft: true });
	}

	/** a running build let go of (nothing to answer if the box is gone) */
	end(session) {
		if (!this.frame || !this.sessions.has(session)) return Promise.resolve();
		const ended = this.#onSession(session, 'end', {}, { timeout: 5000, soft: true }).catch(() => {});
		this.sessions.delete(session);
		return ended;
	}

	/** a recipe's room let go (kept too many, or it crashed or ran too long): the builds kept running in it go with it */
	leave(room, why) {
		this.rooms = this.rooms.filter((r) => r.room !== room);
		for (const [session, s] of this.sessions) if (s.room === room) this.sessions.delete(session);
		super.leave(room, why);
	}

	/** tears the box down: its rooms, and the builds kept running in them, go with it */
	stop(why) {
		this.rooms = [];
		this.sessions.clear();
		super.stop(why);
	}
}
