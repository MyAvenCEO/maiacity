/*
 * Tasks: one rule applied to pinned inputs (plan J0b-J0d, §1.3-1.5). Everything here is pure: it reads the device's
 * world and answers ops, so the Mac's runner, a button, an agent and the tests all share it.
 *
 * The key is the task's identity: BLAKE3 of the rule and its version, every input pinned at what was read, and the
 * params that change the result. Two devices that want the same work make the same key, a key already done is never
 * made again, and doing it twice gives the same answer, so a claim lost to a sync costs only time.
 *
 * The reconciler is the guarantee: for each rule with a `when`, what it wants, less what is done or open, becomes a
 * queued task. A task is claimed with a lease the device running it renews; three failures hold it for a person.
 *
 * Until artifact v2 carries the made stamp on its `files` rows (content-v2 §2.11), a done task stays as the record of
 * what it made: its key, its outputs and its value. Then done tasks go (plan default 2).
 */

import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { TASK } from './schemas.js';

/** The key's own context, so it never equals a hash of the same bytes made for anything else. */
const CONTEXT = 'maiacity studio jobs 2026-10-16 task key v1';

/** How long a claim holds without being renewed, in seconds. */
export const LEASE = 300;
/** How many failures before a task waits for a person. */
export const TRIES = 3;

/**
 * A task as the page reads it, beside its entry's id and vault.
 * @typedef {{ entry: string, vault: string, rule: string, version: number, key: string,
 *   lane: import('./schemas.js').Lane, inputs: Input[], params: string, status: import('./schemas.js').Status,
 *   worker: string, lease_until: number, attempts: number, error: string, outputs: string[], result: string,
 *   by: string, at: number }} Task
 */
/** An input, pinned: its name in the rule, its entry, and what it was read at. @typedef {{ id: number, name: string, entry: string, at: string[] }} Input */

/** The tasks the world holds, those deleted (or tagged deleted: a graded still a newer look replaced) left out. @param {import('../../avendb/vaults.js').WorldView} world */
export function tasksOf(world) {
	return world.entries
		.filter((e) => e.type === TASK && e.record?.kind === TASK && !e.deleted && !(e.tags ?? []).includes('avendb:deleted'))
		.map((e) => /** @type {Task} */ ({ ...e.record, entry: e.entry, vault: e.vault }));
}

/**
 * What an entry is read at, for its pin: a file by the roots of its bytes, which are its content; anything else by
 * how many edits the device holds of it.
 * @param {import('../../avendb/vaults.js').EntryView} e
 */
export const atOf = (e) => (e.files?.length ? e.files.map((f) => f.root).sort() : [`edits:${e.edits}`]);

/**
 * The key of rule `rule` over inputs `inputs` with param values `params`.
 * @param {{ key: string, version: number }} rule @param {Input[]} inputs @param {Record<string, any>} params
 */
export function keyOf(rule, inputs, params) {
	const pins = [...inputs].sort((a, b) => (a.name < b.name ? -1 : 1)).map((i) => [i.name, i.entry, [...i.at].sort()]);
	const vals = Object.keys(params)
		.sort()
		.map((k) => [k, params[k] ?? null]);
	return bytesToHex(blake3(utf8ToBytes(JSON.stringify([rule.key, rule.version, pins, vals])), { context: utf8ToBytes(CONTEXT) }));
}

/**
 * Whether entry `e` is picked by `when`: avenDB's selector words, plus `media`.
 * @param {any} when @param {import('../../avendb/vaults.js').EntryView} e
 * @returns {boolean}
 */
export function picks(when, e) {
	if (!when) return false;
	if (when.all) return when.all.every((/** @type {any} */ w) => picks(w, e));
	if (when.any) return when.any.some((/** @type {any} */ w) => picks(w, e));
	if (when.type) return when.type.includes(e.type);
	if (when.tag) return (e.tags ?? []).includes(when.tag);
	if (when.noTag) return !(e.tags ?? []).some((t) => when.noTag.includes(t));
	if (when.record) {
		const r = e.record ?? {};
		return Object.entries(when.record).every(([k, v]) => r[k] === v);
	}
	if (when.media) {
		const m = e.media ?? e.record?.media ?? '';
		return when.media.endsWith('*') ? m.startsWith(when.media.slice(0, -1)) : m === when.media;
	}
	return false;
}

/**
 * What each rule has made of each entry: the newest done task by rule and the entry it was made from.
 * @param {Task[]} tasks
 */
export function madeIndex(tasks) {
	/** @type {Map<string, Task>} */
	const out = new Map();
	for (const t of tasks) {
		if (t.status !== 'done') continue;
		const from = t.inputs[0]?.entry;
		const k = `${t.rule}:${from}`;
		if ((out.get(k)?.at ?? -1) < t.at) out.set(k, t);
	}
	return out;
}

/** The value at a dotted place of a value. @param {any} v @param {string[]} path */
const dig = (v, path) => path.reduce((o, p) => (o == null ? undefined : o[p]), v);

/**
 * Rule `rule` pinned on entry `e`: its inputs and its params' values; `null` while an input another rule makes is
 * not made yet, as the task waits for it.
 * @param {import('./rules.js').Rule} rule @param {import('../../avendb/vaults.js').EntryView} e
 * @param {Map<string, Task>} made
 * @returns {{ inputs: Input[], params: Record<string, any> } | null}
 */
export function pin(rule, e, made) {
	/** @type {Input[]} */
	const inputs = [];
	/** @type {Record<string, any>} */
	const values = {};
	let id = 1;
	for (const [name, from] of Object.entries(rule.inputs)) {
		if (from === '$entry') {
			inputs.push({ id: id++, name, entry: e.entry, at: atOf(e) });
			values[name] = e.record ?? {};
		} else {
			const t = made.get(`${from.made}:${e.entry}`);
			// an optional input not made yet: the task goes on without it, and is made again once it is (its key moves)
			if (!t && from.optional) {
				values[name] = null;
				continue;
			}
			if (!t) return null;
			inputs.push({ id: id++, name, entry: t.entry, at: [t.key] });
			values[name] = parse(t.result);
		}
	}
	const first = Object.keys(rule.inputs).find((n) => rule.inputs[n] === '$entry');
	/** @type {Record<string, any>} */
	const params = {};
	for (const p of rule.params) {
		const [head, ...rest] = p.split('.');
		params[p] = head in values ? dig(values[head], rest) : first ? dig(values[first], [head, ...rest]) : undefined;
	}
	return { inputs, params };
}

/** A task's value as JSON, `null` where it holds none. @param {string} s */
const parse = (s) => {
	try {
		return s ? JSON.parse(s) : null;
	} catch {
		return null;
	}
};

/**
 * A new task's record: rule `rule` on pinned inputs, queued, asked by `by` (a vault, or `""` for the reconciler).
 * @param {import('./rules.js').Rule} rule @param {{ inputs: Input[], params: Record<string, any> }} pinned
 * @param {string} by @param {number} now seconds since 1970
 */
export function newTask(rule, pinned, by, now) {
	return {
		kind: TASK,
		rule: rule.key,
		version: rule.version,
		key: keyOf(rule, pinned.inputs, pinned.params),
		lane: rule.lane,
		inputs: pinned.inputs,
		params: JSON.stringify(pinned.params),
		status: /** @type {import('./schemas.js').Status} */ ('queued'),
		worker: '',
		lease_until: 0,
		attempts: 0,
		error: '',
		outputs: [],
		result: '',
		by,
		at: now
	};
}

/**
 * The reconciler, once: for each rule with a `when`, the tasks wanted and missing among vault `vault`'s entries, as
 * create ops acting for `as`. Wanted, less done, less open (queued, claimed, failed or held), each key once.
 * @param {import('./rules.js').Rule[]} rules @param {import('../../avendb/vaults.js').WorldView} world
 * @param {string} vault @param {string} as @param {number} now
 */
export function reconcile(rules, world, vault, as, now) {
	const tasks = tasksOf(world).filter((t) => t.vault === vault);
	const known = new Set(tasks.map((t) => t.key));
	const made = madeIndex(tasks);
	const ops = [];
	for (const rule of rules) {
		if (!rule.when) continue;
		for (const e of world.entries) {
			if (e.vault !== vault || e.deleted || !picks(rule.when, e)) continue;
			const pinned = pin(rule, e, made);
			if (!pinned) continue;
			const value = newTask(rule, pinned, '', now);
			if (known.has(value.key)) continue;
			known.add(value.key);
			ops.push({ op: 'create', vault, type: TASK, value, as });
		}
	}
	return ops;
}

/** Whether a device may claim task `t` now. @param {Task} t @param {number} now */
export const claimable = (t, now) =>
	t.status === 'queued' || (t.status === 'failed' && t.attempts < TRIES) || (t.status === 'claimed' && t.lease_until < now);

/** Whether device `worker` holds task `t` now. @param {Task} t @param {string} worker @param {number} now */
export const holds = (t, worker, now) => t.status === 'claimed' && t.worker === worker && t.lease_until >= now;

/** One record write: a few fields of task `t`, acting for `as`. @param {Task} t @param {Record<string, any>} fields @param {string} as */
const writing = (t, fields, as) => ({
	op: 'batch',
	ops: Object.entries(fields).map(([k, value]) => ({ op: 'set', entry: t.entry, path: [k], value })),
	as
});

/** Claiming task `t` for device `worker` (its `worker` field: the device running it), or renewing its lease. @param {Task} t @param {string} worker @param {number} now @param {string} as */
export const claiming = (t, worker, now, as) => writing(t, { status: 'claimed', worker, lease_until: now + LEASE }, as);

/**
 * Task `t` done: the entries it made and its value, if any.
 * @param {Task} t @param {string[]} outputs @param {any} result @param {string} as
 */
export const finishing = (t, outputs, result, as) =>
	writing(t, { status: 'done', outputs, result: result == null ? '' : JSON.stringify(result), error: '', lease_until: 0 }, as);

/** Task `t` failed with `error`: tried again until the third failure holds it. @param {Task} t @param {string} error @param {string} as */
export const failing = (t, error, as) =>
	writing(t, { status: t.attempts + 1 >= TRIES ? 'held' : 'failed', attempts: t.attempts + 1, error: error.slice(0, 2000), lease_until: 0 }, as);

/** A held task, tried again from nothing, as a person asks. @param {Task} t @param {string} as */
export const retrying = (t, as) => writing(t, { status: 'queued', attempts: 0, error: '', worker: '', lease_until: 0 }, as);

/**
 * An explicit ask (a button, an agent, a function on a stage move): rule `rule` on entry `e`, now, unless the same
 * key is done or open already; `given` the values of params the asker names (a render's delivery, a clip). `null`
 * while an input it waits for isn't made yet, or when it is known.
 * @param {import('./rules.js').Rule} rule @param {import('../../avendb/vaults.js').EntryView} e
 * @param {import('../../avendb/vaults.js').WorldView} world @param {string} by @param {string} as @param {number} now
 * @param {Record<string, any>} [given]
 */
export function asking(rule, e, world, by, as, now, given = {}) {
	const tasks = tasksOf(world).filter((t) => t.vault === e.vault);
	const pinned = pin(rule, e, madeIndex(tasks));
	if (!pinned) return null;
	for (const p of rule.params) if (p in given) pinned.params[p] = given[p];
	const value = newTask(rule, pinned, by, now);
	if (tasks.some((t) => t.key === value.key)) return null;
	return { op: 'create', vault: e.vault, type: TASK, value, as };
}
