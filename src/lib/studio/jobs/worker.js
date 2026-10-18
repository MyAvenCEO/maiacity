/*
 * The worker (plan J0d): the loop that keeps every rule's work done, on a device that serves some lanes. Each round
 * it reads the device's world, adds the job schemas a vault lacks, queues what is wanted and missing (./tasks.js
 * `reconcile`), and, for each lane it serves that is free, claims the oldest task it can do and runs it, renewing the
 * lease while it runs. One task at a time in each lane, as vault/app/src/jobs.rs runs the legacy ones.
 *
 * Everything it does is one op through `send` (avendb/docs/ARCHITECTURE.md §8). In a vault whose studio worker this
 * Mac hosts (plan J0c: a device vault of its own, owned by the vault, `WORKER_SHARES` its only rights), it claims,
 * queues and finishes tasks, and the Rust lanes put what they make, by the worker's own key (`run [op, node]`); in a
 * vault with none yet it acts for the vault through the Mac's own device, as before. What it reads, it reads through
 * the Mac's own device either way.
 *
 * How a rule is done is an executor, by the rule's key: `(task, ctx) => { outputs, result }`. The page has the
 * checksum (./executors.js); the Rust lanes join as the sidecar's media channel lands (J0a).
 */

import { answer } from '../../avendb/ops.js';
import { lacking } from './schemas.js';
import { BUILT_IN, held, layered } from './rules.js';
import { claimable, claiming, failing, finishing, LEASE, reconcile, tasksOf } from './tasks.js';

/** A studio worker's name, the same on each of the person's Macs: a second Mac adds its key to the same worker. */
export const WORKER_NAME = 'Studio worker';

/**
 * The studio's Worker group (avenDB composes none for it): the tasks of the vault, read, queued and written, and its
 * files, read, made and tagged (a replaced still deleted). Nothing else, and nothing shared on.
 */
export const WORKER_SHARES = [
	{ name: 'Worker', where: { type: ['task'] }, ops: [{ op: 'read' }, { op: 'create' }, { op: 'set', path: [] }] },
	{ name: 'Worker', where: { type: ['file'] }, ops: [{ op: 'read' }, { op: 'create' }, { op: 'tag' }, { op: 'insert', path: ['tags'] }] }
];

/** Op `op` as a worker sends it: as its own device vault, so with no `as`. @param {any} op */
const own = (op) => {
	const { as: _, ...rest } = op;
	return rest;
};

/**
 * What an executor gets: the entry an input names, a range of a file's bytes, a way to say how far it is, the
 * vault the worker acts as in the task's vault, the device of the vault's studio worker this Mac hosts (none where
 * it hosts none), and the world the task was claimed in.
 * @typedef {{ entry: (id: string) => import('../../avendb/vaults.js').EntryView | undefined,
 *   read: (root: string, size: number, from: number, to: number) => Promise<Uint8Array>,
 *   progress: (done: number) => void, as: string, worker: string | null,
 *   world: import('../../avendb/vaults.js').WorldView }} Ctx
 * @typedef {(task: import('./tasks.js').Task, ctx: Ctx) => Promise<{ outputs?: string[], result?: any }>} Executor
 */

export class Worker {
	/**
	 * @param {{ send: (op: any, node?: string) => Promise<any>, executors: Record<string, Executor>,
	 *   hosted?: () => Promise<{ device: string, vault: string, for?: string | null, hosted?: boolean }[]>,
	 *   lanes?: import('./schemas.js').Lane[], vaults?: (world: any) => string[], ceo?: string | null,
	 *   now?: () => number, log?: (line: string) => void, max?: number, held?: (t: import('./tasks.js').Task) => boolean }} o
	 */
	constructor(o) {
		this.send = o.send;
		/** The studio workers this device hosts, each a vault's (`workers`). */
		this.hosted = o.hosted ?? (async () => []);
		/** @type {Map<string, string>} the device of each vault's studio worker hosted here, from the last round */
		this.nodes = new Map();
		this.executors = o.executors;
		this.lanes = new Set(o.lanes ?? ['gpu', 'speech', 'ai', 'io', 'net']);
		/** The vaults it works on: the person's own, unless named. */
		this.vaults = o.vaults ?? ((/** @type {any} */ w) => [w.mine]);
		this.ceo = o.ceo ?? null;
		this.now = o.now ?? (() => Math.floor(Date.now() / 1000));
		this.log = o.log ?? (() => {});
		/** how many tasks may run at once (every lane its own, unless fewer are named) */
		this.max = o.max ?? Infinity;
		/** whether task `t` waits for something that comes first (the studio playing, its live world open) */
		this.held = o.held ?? (() => false);
		/** @type {Map<string, { task: string, rule: string, done: number }>} the task each busy lane runs */
		this.busy = new Map();
		/** @type {ReturnType<typeof setInterval> | null} */
		this.timer = null;
		this.ticking = false;
		/** @type {Map<string, string>} the vault it acts as in each vault it works on, from the last world */
		this.acting = new Map();
	}

	/** The vault it acts as in vault `v` (the vault itself where the person's owns it). @param {string} v */
	as(v) {
		return this.acting.get(v) ?? v;
	}

	/** Op `op` in vault `v`: by the vault's studio worker where this device hosts one. @param {string} v @param {any} op */
	sendIn(v, op) {
		const node = this.nodes.get(v);
		return node ? this.send(own(op), node) : this.send(op);
	}

	/** The device's world, now. */
	async world() {
		return answer(await this.send({ op: 'world' }));
	}

	/** One round: schemas, the reconciler, then a task for each free lane. Answers the tasks it started. */
	async tick() {
		if (this.ticking) return [];
		this.ticking = true;
		try {
			let world = await this.world();
			const me = world.me;
			const hosted = await this.hosted().catch(() => []);
			// each row names its own device vault (`vault`) and the vault it works for (`for`)
			this.nodes = new Map(hosted.filter((w) => w.hosted !== false).map((w) => [w.for ?? w.vault, w.device]));
			this.acting = new Map((world.vaults ?? []).map((/** @type {any} */ v) => [v.id, v.acting?.as ?? v.id]));
			for (const vault of this.vaults(world)) {
				// only the rules some worker can do yet: a task nobody runs would only sit in every device's log
				const rules = layered(BUILT_IN, this.ceo ? held(world, this.ceo) : [], held(world, vault)).filter((r) => this.executors[r.key]);
				const as = this.as(vault);
				// the job schemas are the vault's own, added as it: a worker makes only tasks and files
				const schemas = lacking(world, vault, as);
				const ops = reconcile(rules, world, vault, as, this.now());
				try {
					for (const op of schemas) answer(await this.send(op));
					for (const op of ops) answer(await this.sendIn(vault, op));
				} catch (e) {
					// a vault it may read but not write: the others go on
					this.log(`${vault.slice(0, 8)}: ${e instanceof Error ? e.message : e}`);
				}
				if (schemas.length || ops.length) {
					this.log(`queued ${ops.filter((o) => o.type === 'task').length} in ${vault.slice(0, 8)}`);
					world = await this.world();
				}
			}
			const started = [];
			const now = this.now();
			const open = tasksOf(world)
				.filter((t) => this.vaults(world).includes(t.vault) && this.executors[t.rule] && claimable(t, now))
				.sort((a, b) => a.at - b.at);
			for (const lane of this.lanes) {
				if (this.busy.size >= this.max) break;
				if (this.busy.has(lane)) continue;
				const t = open.find((x) => x.lane === lane && !this.held(x));
				if (!t) continue;
				const by = this.nodes.get(t.vault) ?? me;
				try {
					answer(await this.sendIn(t.vault, claiming(t, by, now, this.as(t.vault))));
				} catch (e) {
					// one its worker doesn't hold yet comes over in a moment: the next round claims it
					this.log(`${t.rule} not claimed: ${e instanceof Error ? e.message : e}`);
					continue;
				}
				this.busy.set(lane, { task: t.entry, rule: t.rule, done: 0 });
				started.push(t.entry);
				void this.run(t, world, by);
			}
			return started;
		} finally {
			this.ticking = false;
		}
	}

	/**
	 * Task `t`, run: the lease renewed while it runs, then done with what it made, or failed with why.
	 * @param {import('./tasks.js').Task} t @param {any} world @param {string} by the device that claimed it
	 */
	async run(t, world, by) {
		const renew = setInterval(() => void this.sendIn(t.vault, claiming(t, by, this.now(), this.as(t.vault))).catch(() => {}), (LEASE / 3) * 1000);
		/** @type {Ctx} */
		const ctx = {
			entry: (id) => world.entries.find((/** @type {any} */ e) => e.entry === id),
			read: async (root, size, from, to) => {
				const out = await this.send({ op: 'read_file', root, size, from, to });
				answer(out);
				return out.bytes;
			},
			progress: (done) => {
				const b = this.busy.get(t.lane);
				if (b) b.done = done;
			},
			as: this.as(t.vault),
			worker: this.nodes.get(t.vault) ?? null,
			world
		};
		try {
			const made = await this.executors[t.rule](t, ctx);
			answer(await this.sendIn(t.vault, finishing(t, made.outputs ?? [], made.result ?? null, this.as(t.vault))));
			this.log(`${t.rule} done`);
		} catch (e) {
			const why = e instanceof Error ? e.message : String(e);
			this.log(`${t.rule} failed: ${why}`);
			await this.sendIn(t.vault, failing(t, why, this.as(t.vault))).catch(() => {});
		} finally {
			clearInterval(renew);
			this.busy.delete(t.lane);
		}
	}

	/** Rounds every `ms`, the first now. @param {number} [ms] */
	start(ms = 60_000) {
		if (this.timer) return;
		const round = () => void this.tick().catch((e) => this.log(`round failed: ${e instanceof Error ? e.message : e}`));
		round();
		this.timer = setInterval(round, ms);
	}

	stop() {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}
}
