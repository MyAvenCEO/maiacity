/*
 * AVENDB'S LAB WORKER — the avenDB tile's world (avendb/crates/avendb-web, as WebAssembly), off the page: it makes the
 * world a step at a time, answers the page's views and actions, and plays the plan's scenarios. The pair workers
 * (./pair.worker.js) make the McEliece pairs its keys want beside it, each over a port of its own, and the Lab keeps
 * spare keys whose pairs are made ahead, so that a step or an action rarely makes one itself.
 */
import init, { Tile, hand_in_pair, make_pair, run_scenario, scenarios, set_spare_keys, wanted_pairs } from './pkg/avendb_web.js';
import wasmUrl from './pkg/avendb_web_bg.wasm?url';

/** the spare vault and space keys each Lab keeps: an action founds a vault or a space at a time */
const SPARES = 4;

/**
 * What the page asks: start (with the pair workers' ports), make the world, a view or an action as JSON text, the
 * scenarios, one scenario's run, or the world made again from the start.
 * @typedef {{ id: number, call: 'start' | 'build' | 'view' | 'act' | 'scenarios' | 'run' | 'reset', query?: string, action?: string, number?: string, ports?: MessagePort[] }} Ask
 */

/** @type {Tile | null} */
let tile = null;
/** why the tile stopped: after a panic nothing in the module can be trusted, and the page starts over */
let dead = '';
/** the last panic the module reported: its hook writes it to the console */
let panic = '';
/** @type {{ port: MessagePort, busy: number }[]} */
const pool = [];
/** @type {Map<string, (pair: Uint8Array | null) => void>} */
const making = new Map();
/** the pairs being made for what the last step or action made */
let pending = Promise.resolve();
const pairs = { made: 0, wanted: 0 };

const consoleError = console.error;
console.error = (/** @type {unknown[]} */ ...args) => {
	if (typeof args[0] === 'string' && args[0].startsWith('avenDB: ')) panic = args[0].slice(8);
	consoleError(...args);
};

const post = (/** @type {unknown} */ message) => self.postMessage(message);

self.onmessage = async (/** @type {MessageEvent<Ask>} */ e) => {
	const { id } = e.data;
	try {
		if (dead) throw new Error(dead);
		post({ id, ok: await answer(e.data) });
	} catch (err) {
		if (panic || err instanceof WebAssembly.RuntimeError) dead = panic || String(err);
		post({ id, error: dead || (err instanceof Error ? err.message : String(err)), dead: !!dead });
	}
};

/** @param {Ask} a */
async function answer(a) {
	switch (a.call) {
		case 'start':
			return start(a.ports ?? []);
		case 'build':
			return build();
		case 'reset':
			tile?.free();
			tile = new Tile();
			return build();
		case 'view':
			return JSON.parse(need().view(a.query ?? ''));
		case 'act': {
			// what the last action made has its pairs first
			await pending;
			const done = JSON.parse(need().act(a.action ?? '', Date.now()));
			pending = handIn();
			return done;
		}
		case 'scenarios':
			return JSON.parse(scenarios());
		case 'run': {
			await pending;
			const t = performance.now();
			const run = JSON.parse(run_scenario(a.number ?? ''));
			run.ms = Math.round(performance.now() - t);
			pending = handIn();
			return run;
		}
	}
	throw new Error(`There is no call ${a.call}.`);
}

function need() {
	if (!tile) throw new Error('The tile is not started.');
	return tile;
}

/** Compile the module once, for this worker and every pair worker, and start the tile. @param {MessagePort[]} ports */
async function start(ports) {
	const module = await compile();
	await init({ module_or_path: module });
	set_spare_keys(SPARES);
	for (const port of ports) {
		const w = { port, busy: 0 };
		port.onmessage = (/** @type {MessageEvent<{ seed: string, pair?: Uint8Array }>} */ m) => {
			const done = making.get(m.data.seed);
			making.delete(m.data.seed);
			w.busy--;
			done?.(m.data.pair ?? null);
		};
		try {
			port.postMessage({ module });
		} catch {
			// a browser that can't pass a compiled module on: the worker fetches it itself
			port.postMessage({ url: wasmUrl });
		}
		pool.push(w);
	}
	tile = new Tile();
	return { steps: Tile.steps(), workers: pool.length };
}

async function compile() {
	try {
		return await WebAssembly.compileStreaming(fetch(wasmUrl));
	} catch {
		// served without the application/wasm type
		return WebAssembly.compile(await (await fetch(wasmUrl)).arrayBuffer());
	}
}

/** Make the world, a step at a time, each step's pairs made before the next. */
async function build() {
	const t = performance.now();
	for (let step = 1; ; step++) {
		await pending;
		const made = need().build_step(Date.now());
		if (made === undefined) break;
		post({ step: { step, made } });
		pending = handIn();
	}
	return { ms: Math.round(performance.now() - t) };
}

/** The pairs the keys want, made in the pair workers and handed in as each comes back. */
function handIn() {
	/** @type {string[]} */
	const seeds = JSON.parse(wanted_pairs());
	if (!seeds.length) return Promise.resolve();
	pairs.wanted += seeds.length;
	post({ pairs });
	const each = seeds.map(async (seed) => {
		const pair = (await make(seed)) ?? make_pair(seed);
		hand_in_pair(seed, pair);
		pairs.made++;
		post({ pairs });
	});
	return Promise.all(each).then(() => {});
}

/** One pair, by the least busy pair worker; null if it couldn't. @param {string} seed @returns {Promise<Uint8Array | null>} */
function make(seed) {
	if (!pool.length) return Promise.resolve(null);
	const w = pool.reduce((a, b) => (b.busy < a.busy ? b : a));
	w.busy++;
	return new Promise((resolve) => {
		making.set(seed, resolve);
		w.port.postMessage({ seed });
	});
}
