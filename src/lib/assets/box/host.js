// @ts-nocheck — plain JS
import { LATEST, engineAt, enginePath } from '../engines.js';
import { Shell, TIMEOUT, frozen } from '../../sandbox/frame.js';
/*
 * THE ASSET BOX — where an asset's builder runs when we cannot trust it: the shell (../../sandbox/frame.js, a worker
 * inside a frame with no origin, the same for every host of code we cannot trust) running the asset engine.
 *
 * - The worker is a frozen engine (./engine.js, static/engines/engine-v<n>.js), its bytes checked against its BLAKE3
 *   hash (../engines.json) before it starts, and handed in whole: the box can load nothing. Each build hands it its
 *   recipe as code (../recipes.js), which the page checked against the recipe's hash as well.
 * - Out comes plain data only (./serialize.js), which the page checks and builds its own objects from (./rebuild.js).
 * - A job that runs too long is ended by removing the frame (the worker goes with it); the next job starts a new box.
 */

export { TIMEOUT };

/**
 * A frozen engine's code, its bytes checked against its hash. @param {number} v
 * @returns {Promise<string>}
 */
export async function engineCode(v) {
	if (!engineAt(v)) throw new Error(`no engine ${v}`);
	return frozen(enginePath(v), engineAt(v).blake3, `engine ${v}`);
}

export class AssetBox extends Shell {
	/** @param {{ engine?: number, timeout?: number }} [o] the engine it runs (the latest) */
	constructor({ engine = LATEST.v, timeout = TIMEOUT } = {}) {
		super({ code: () => engineCode(engine), timeout });
		this.engine = engine;
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
}
