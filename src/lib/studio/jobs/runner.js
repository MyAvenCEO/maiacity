/*
 * The Mac's job runner: the loop that keeps every rule's work done in the person's vaults. Each round it reads the
 * device's world, adds the job schemas a vault lacks, queues what is wanted and missing (./tasks.js `reconcile`), and,
 * for each lane that is free, claims the oldest task it can do and runs it, renewing the lease while it runs. One task
 * at a time in each lane.
 *
 * It works straight in each vault, through the Mac's own device acting as the vault's acting vault (Samuel 2026-10-19:
 * no worker of its own, no device vault for it): every op one `send` (avendb/docs/ARCHITECTURE.md §8).
 *
 * How a rule is done is an executor, by the rule's key: `(task, ctx) => { outputs, result }`. The page has the
 * checksum (./executors.js); the Mac's Rust does the rest (aven.rs `studio_job`).
 */

import { answer } from '../../avendb/ops.js';
import { lacking } from './schemas.js';
import { BUILT_IN, held, layered } from './rules.js';
import { claimable, claiming, failing, finishing, LEASE, reconcile, tasksOf } from './tasks.js';

/**
 * What an executor gets: the entry an input names, a range of a file's bytes, a way to say how far it is, the vault
 * the Mac acts as in the task's vault, and the world the task was claimed in.
 * @typedef {{ entry: (id: string) => import('../../avendb/vaults.js').EntryView | undefined,
 *   read: (root: string, size: number, from: number, to: number) => Promise<Uint8Array>,
 *   progress: (done: number) => void, as: string,
 *   world: import('../../avendb/vaults.js').WorldView }} Ctx
 * @typedef {(task: import('./tasks.js').Task, ctx: Ctx) => Promise<{ outputs?: string[], result?: any }>} Executor
 */

export class Runner {
	/**
	 * @param {{ send: (op: any) => Promise<any>, executors: Record<string, Executor>,
	 *   lanes?: import('./schemas.js').Lane[], vaults?: (world: any) => string[], ceo?: string | null,
	 *   now?: () => number, log?: (line: string) => void, max?: number, held?: (t: import('./tasks.js').Task) => boolean }} o
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
			this.acting = new Map((world.vaults ?? []).map((/** @type {any} */ v) => [v.id, v.acting?.as ?? v.id]));
			for (const vault of this.vaults(world)) {
				// only the rules this Mac can do: a task nobody runs would only sit in every device's log
				const rules = layered(BUILT_IN, this.ceo ? held(world, this.ceo) : [], held(world, vault)).filter((r) => this.executors[r.key]);
				const as = this.as(vault);
				// the job schemas are the vault's own, added as it
				const schemas = lacking(world, vault, as);
				const ops = reconcile(rules, world, vault, as, this.now());
				try {
					for (const op of schemas) answer(await this.send(op));
					for (const op of ops) answer(await this.send(op));
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
				try {
					answer(await this.send(claiming(t, me, now, this.as(t.vault))));
				} catch (e) {
					// one this Mac doesn't hold yet comes over in a moment: the next round claims it
					this.log(`${t.rule} not claimed: ${e instanceof Error ? e.message : e}`);
					continue;
				}
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
	 * @param {import('./tasks.js').Task} t @param {any} world @param {string} by the device that claimed it
	 */
	async run(t, world, by) {
		const renew = setInterval(() => void this.send(claiming(t, by, this.now(), this.as(t.vault))).catch(() => {}), (LEASE / 3) * 1000);
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
			world
		};
		try {
			const made = await this.executors[t.rule](t, ctx);
			answer(await this.send(finishing(t, made.outputs ?? [], made.result ?? null, this.as(t.vault))));
			this.log(`${t.rule} done`);
		} catch (e) {
			const why = e instanceof Error ? e.message : String(e);
			this.log(`${t.rule} failed: ${why}`);
			await this.send(failing(t, why, this.as(t.vault))).catch(() => {});
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
