/*
 * The worker (plan J0d): the loop that keeps every rule's work done, on a device that serves some lanes. Each round
 * it reads the device's world, adds the job schemas a vault lacks, queues what is wanted and missing (./tasks.js
 * `reconcile`), and, for each lane it serves that is free, claims the oldest task it can do and runs it, renewing the
 * lease while it runs. One task at a time in each lane, as vault/app/src/jobs.rs runs the legacy ones.
 *
 * Everything it does is one op through `send` (avendb/docs/ARCHITECTURE.md §8), so the same loop runs on the Mac's
 * device today (`call('run', op)`, src/lib/avendb/native.js) and, once the avenDB device hosts one, on the worker's own
 * device vault, whose Worker share lets it write only tasks, made files and machine places (plan J0c, law 2). Until
 * then it acts for the vault it works on.
 *
 * How a rule is done is an executor, by the rule's key: `(task, ctx) => { outputs, result }`. The page has the
 * checksum (./executors.js); the Rust lanes join as the sidecar's media channel lands (J0a).
 */

import { answer } from '../../avendb/ops.js';
import { lacking } from './schemas.js';
import { BUILT_IN, held, layered } from './rules.js';
import { claimable, claiming, failing, finishing, LEASE, reconcile, tasksOf } from './tasks.js';

/**
 * What an executor gets: the entry an input names, a range of a file's bytes, and a way to say how far it is.
 * @typedef {{ entry: (id: string) => import('../../avendb/vaults.js').EntryView | undefined,
 *   read: (root: string, size: number, from: number, to: number) => Promise<Uint8Array>,
 *   progress: (done: number) => void }} Ctx
 * @typedef {(task: import('./tasks.js').Task, ctx: Ctx) => Promise<{ outputs?: string[], result?: any }>} Executor
 */

export class Worker {
	/**
	 * @param {{ send: (op: any) => Promise<any>, executors: Record<string, Executor>,
	 *   lanes?: import('./schemas.js').Lane[], vaults?: (world: any) => string[], ceo?: string | null,
	 *   now?: () => number, log?: (line: string) => void }} o
	 */
	constructor(o) {
		this.send = o.send;
		this.executors = o.executors;
		this.lanes = new Set(o.lanes ?? ['gpu', 'speech', 'ai', 'io', 'net']);
		/** The vaults it works on: the person's own, unless named. */
		this.vaults = o.vaults ?? ((/** @type {any} */ w) => [w.mine]);
		this.ceo = o.ceo ?? null;
		this.now = o.now ?? (() => Math.floor(Date.now() / 1000));
		this.log = o.log ?? (() => {});
		/** @type {Map<string, { task: string, rule: string, done: number }>} the task each busy lane runs */
		this.busy = new Map();
		/** @type {ReturnType<typeof setInterval> | null} */
		this.timer = null;
		this.ticking = false;
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
			for (const vault of this.vaults(world)) {
				// only the rules some worker can do yet: a task nobody runs would only sit in every device's log
				const rules = layered(BUILT_IN, this.ceo ? held(world, this.ceo) : [], held(world, vault)).filter((r) => this.executors[r.key]);
				const ops = [...lacking(world, vault, vault), ...reconcile(rules, world, vault, vault, this.now())];
				for (const op of ops) answer(await this.send(op));
				if (ops.length) {
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
				if (this.busy.has(lane)) continue;
				const t = open.find((x) => x.lane === lane);
				if (!t) continue;
				answer(await this.send(claiming(t, me, now, t.vault)));
				this.busy.set(lane, { task: t.entry, rule: t.rule, done: 0 });
				started.push(t.entry);
				void this.run(t, world, me);
			}
			return started;
		} finally {
			this.ticking = false;
		}
	}

	/**
	 * Task `t`, run: the lease renewed while it runs, then done with what it made, or failed with why.
	 * @param {import('./tasks.js').Task} t @param {any} world @param {string} me
	 */
	async run(t, world, me) {
		const renew = setInterval(() => void this.send(claiming(t, me, this.now(), t.vault)).catch(() => {}), (LEASE / 3) * 1000);
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
			}
		};
		try {
			const made = await this.executors[t.rule](t, ctx);
			answer(await this.send(finishing(t, made.outputs ?? [], made.result ?? null, t.vault)));
			this.log(`${t.rule} done`);
		} catch (e) {
			const why = e instanceof Error ? e.message : String(e);
			this.log(`${t.rule} failed: ${why}`);
			await this.send(failing(t, why, t.vault)).catch(() => {});
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
