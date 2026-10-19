// @ts-nocheck — plain JS
// Studio 2.0's jobs (./schemas.js, ./rules.js, ./tasks.js): the key, what a rule picks, the reconciler, claims and
// leases, three tries, explicit asks, and rules held in layers.
// Run: bun test src/lib/studio/jobs/jobs.test.js
import { expect, test } from 'bun:test';
import { lacking, RULE_V1, TASK_V1 } from './schemas.js';
import { BUILT_IN, fromRecord, layered, toRecord } from './rules.js';
import { asking, claimable, claiming, failing, finishing, holds, keyOf, LEASE, picks, reconcile, tasksOf } from './tasks.js';

const V = 'aa'.repeat(32);
const rule = (key) => BUILT_IN.find((r) => r.key === key);
const file = (n, media, tags, roots = [`r${n}`]) => ({
	entry: `f${n}`,
	vault: V,
	type: 'file',
	tags,
	media,
	deleted: false,
	edits: 1,
	record: { kind: 'file', media, tags },
	files: roots.map((root) => ({ root, size: 10 }))
});
const taskEntry = (id, value) => ({ entry: id, vault: V, type: 'task', tags: [], deleted: false, record: value, files: [] });
const world = (entries) => ({ entries });
const at = (op, i) => ({ ...op.value, entry: `t${i}`, vault: V });

test('the schemas parse as JSON and a vault lacking them gets both, once', () => {
	expect(JSON.parse(RULE_V1).properties.kind.const).toBe('rule');
	expect(JSON.parse(TASK_V1).properties.kind.const).toBe('task');
	expect(lacking(world([]), V, V).map((o) => o.type)).toEqual(['schema', 'schema']);
	const has = [{ vault: V, type: 'schema', title: 'Rule, v1', deleted: false }];
	expect(lacking(world(has), V, V)).toHaveLength(1);
});

test('the key changes with the rule version, an input or a param, never with their order', () => {
	const i = [
		{ id: 1, name: 'a', entry: 'x', at: ['1', '2'] },
		{ id: 2, name: 'b', entry: 'y', at: [] }
	];
	const k = keyOf({ key: 'proxy', version: 1 }, i, { j: 'acescct' });
	expect(k).toHaveLength(64);
	expect(keyOf({ key: 'proxy', version: 1 }, [i[1], { ...i[0], at: ['2', '1'] }], { j: 'acescct' })).toBe(k);
	expect(keyOf({ key: 'proxy', version: 2 }, i, { j: 'acescct' })).not.toBe(k);
	expect(keyOf({ key: 'proxy', version: 1 }, i, { j: 'rec709' })).not.toBe(k);
	expect(keyOf({ key: 'proxy', version: 1 }, [{ ...i[0], at: ['3'] }, i[1]], { j: 'acescct' })).not.toBe(k);
});

test('a when picks by type, tag and media type', () => {
	const v = file(1, 'video/quicktime', ['media:original']);
	expect(picks(rule('proxy').when, v)).toBe(true);
	expect(picks(rule('proxy').when, file(2, 'audio/wav', ['media:original']))).toBe(false);
	expect(picks(rule('transcript').when, file(2, 'audio/wav', ['media:original']))).toBe(true);
	expect(picks(rule('proxy').when, file(3, 'video/mp4', ['media:proxy']))).toBe(false);
	expect(picks(null, v)).toBe(false);
});

test('a when picks by the fields a record holds', () => {
	const yt = { entry: 'a1', type: 'artifact', tags: [], record: { look: 'youtube', url: 'https://youtu.be/x' } };
	const when = { all: [{ type: ['artifact'] }, { record: { look: 'youtube' } }] };
	expect(picks(when, yt)).toBe(true);
	expect(picks(when, { ...yt, record: { look: 'article' } })).toBe(false);
	expect(picks(when, { ...yt, record: null })).toBe(false);
});

test('the reconciler queues what is wanted and missing, waits for made inputs, and never twice', () => {
	const rules = layered(BUILT_IN);
	const v = file(1, 'video/quicktime', ['media:original']);
	const first = reconcile(rules, world([v]), V, V, 100);
	// probe and transcript at once; proxy and still wait for the probe, analysis for the proxy and the words
	expect(first.map((o) => o.value.rule).sort()).toEqual(['probe', 'transcript']);
	expect(first.every((o) => o.value.status === 'queued' && o.value.by === '')).toBe(true);
	// the same world with those tasks open: nothing new
	const open = first.map((o, i) => taskEntry(`t${i}`, o.value));
	expect(reconcile(rules, world([v, ...open]), V, V, 101)).toEqual([]);
	// the probe done: proxy and still now, keyed on the journey it found
	const probe = open.find((t) => t.record.rule === 'probe');
	probe.record = { ...probe.record, status: 'done', result: JSON.stringify({ journey: 'slog3' }) };
	const next = reconcile(rules, world([v, ...open]), V, V, 102);
	expect(next.map((o) => o.value.rule).sort()).toEqual(['proxy', 'still']);
	expect(JSON.parse(next.find((o) => o.value.rule === 'proxy').value.params)).toEqual({ 'probe.journey': 'slog3' });
	// a file with new bytes is a new key: wanted again
	const changed = file(1, 'video/quicktime', ['media:original'], ['r9']);
	expect(reconcile(rules, world([changed, ...open]), V, V, 103).map((o) => o.value.rule)).toContain('probe');
});

test('only the test rule picks a file tagged jobs:test, and a vault can turn a rule off', () => {
	const t = file(5, 'text/plain', ['jobs:test']);
	expect(reconcile(layered(BUILT_IN), world([t]), V, V, 1).map((o) => o.value.rule)).toEqual(['checksum']);
	const off = { ...rule('checksum'), off: true };
	expect(reconcile(layered(BUILT_IN, [], [off]), world([t]), V, V, 1)).toEqual([]);
});

test('rules: the nearest holder wins by key, the newest version within one, and a record reads back', () => {
	const ceo = [{ ...rule('proxy'), version: 2, about: 'ceo' }];
	const vault = [{ ...rule('proxy'), version: 1, about: 'vault' }, { ...rule('proxy'), version: 3, about: 'vault 3' }];
	expect(layered(BUILT_IN, ceo).find((r) => r.key === 'proxy').about).toBe('ceo');
	expect(layered(BUILT_IN, ceo, vault).find((r) => r.key === 'proxy').about).toBe('vault 3');
	expect(fromRecord(toRecord(rule('analysis')))).toEqual(rule('analysis'));
	expect(fromRecord({ kind: 'rule', key: 'x', version: 1, lane: 'io', inputs: '{nope' })).toBeNull();
});

test('a claim holds for its lease, then anyone may take it; three failures hold it for a person', () => {
	const op = reconcile(layered(BUILT_IN), world([file(5, 'text/plain', ['jobs:test'])]), V, V, 1)[0];
	let t = at(op, 0);
	expect(claimable(t, 10)).toBe(true);
	const c = claiming(t, 'w1', 10, V);
	expect(c.op).toBe('batch');
	expect(c.ops.map((o) => o.path[0])).toEqual(['status', 'worker', 'lease_until']);
	t = { ...t, status: 'claimed', worker: 'w1', lease_until: 10 + LEASE };
	expect(holds(t, 'w1', 20)).toBe(true);
	expect(claimable(t, 20)).toBe(false);
	expect(claimable(t, 11 + LEASE)).toBe(true);
	for (let n = 1; n <= 3; n++) {
		const f = failing(t, 'no bytes', V);
		const fields = Object.fromEntries(f.ops.map((o) => [o.path[0], o.value]));
		t = { ...t, ...fields };
	}
	expect(t.status).toBe('held');
	expect(claimable(t, 1e9)).toBe(false);
	const d = finishing({ ...t, status: 'claimed' }, [], { blake3: 'ab' }, V);
	expect(Object.fromEntries(d.ops.map((o) => [o.path[0], o.value])).result).toBe('{"blake3":"ab"}');
});

test('an explicit ask makes a task once, with the params the asker gives', () => {
	const cut = { entry: 'c1', vault: V, type: 'record', tags: [], deleted: false, edits: 4, record: { kind: 'cut' }, files: [] };
	const a = asking(rule('render'), cut, world([cut]), 'samuel', V, 5, { delivery: 'youtube-4k' });
	expect(a.value.by).toBe('samuel');
	expect(JSON.parse(a.value.params)).toEqual({ delivery: 'youtube-4k' });
	expect(asking(rule('render'), cut, world([cut, taskEntry('t1', a.value)]), 'samuel', V, 6, { delivery: 'youtube-4k' })).toBeNull();
	expect(asking(rule('render'), cut, world([cut, taskEntry('t1', a.value)]), 'samuel', V, 6, { delivery: 'reel' })).not.toBeNull();
	expect(tasksOf(world([taskEntry('t1', a.value)]))[0].entry).toBe('t1');
});

// A device in memory: the world, entries made by `create`, record fields set by `batch`, and file bytes by root.
function fakeDevice(entries, bytes) {
	let n = 0;
	const sent = [];
	const one = (op) => {
		if (op.op === 'create') {
			const entry = `e${++n}`;
			const value = op.type === 'schema' ? null : structuredClone(op.value);
			entries.push({ entry, vault: op.vault, type: op.type, title: op.type === 'schema' ? JSON.parse(op.value).title : null, tags: [], deleted: false, record: value, files: [] });
			return { ok: { entry } };
		}
		if (op.op === 'set') {
			const e = entries.find((x) => x.entry === op.entry);
			e.record[op.path[0]] = op.value;
			return { ok: {} };
		}
		throw new Error(`unknown op ${op.op}`);
	};
	return {
		sent,
		entries,
		async send(op) {
			sent.push(op);
			if (op.op === 'world') return { ok: { me: 'dev1', mine: V, entries } };
			if (op.op === 'read_file') return { ok: {}, bytes: bytes[op.root].subarray(op.from, op.to) };
			if (op.op === 'batch') return { ok: op.ops.map(one) };
			return one(op);
		}
	};
}

test('the runner adds the schemas, queues the checksum, claims it, reads the bytes and names their BLAKE3', async () => {
	const { Runner } = await import('./runner.js');
	const { EXECUTORS } = await import('./executors.js');
	const { blake3 } = await import('@noble/hashes/blake3.js');
	const { bytesToHex } = await import('@noble/hashes/utils.js');
	const data = new Uint8Array(3 << 20).map((_, i) => i % 251);
	const f = { ...file(7, 'text/plain', ['jobs:test']), files: [{ root: 'r7', size: data.length + 64, len: data.length }] };
	const d = fakeDevice([f], { r7: data });
	const w = new Runner({ send: (op) => d.send(op), executors: EXECUTORS, now: () => 1000 });
	const started = await w.tick();
	expect(started).toHaveLength(1);
	expect(d.entries.filter((e) => e.type === 'schema').map((e) => e.title).sort()).toEqual(['Rule, v1', 'Task, v1']);
	await new Promise((r) => setTimeout(r, 50));
	const t = d.entries.find((e) => e.type === 'task').record;
	expect(t.status).toBe('done');
	expect(t.worker).toBe('dev1');
	expect(JSON.parse(t.result).blake3.r7).toBe(bytesToHex(blake3(data)));
	expect(d.sent.filter((o) => o.op === 'read_file')).toHaveLength(3);
	// done: the next round queues nothing and claims nothing
	expect(await w.tick()).toEqual([]);
	expect(d.entries.filter((e) => e.type === 'task')).toHaveLength(1);
});

test('a runner whose executor fails marks the task failed, and it is tried again', async () => {
	const { Runner } = await import('./runner.js');
	const f = file(8, 'text/plain', ['jobs:test']);
	const d = fakeDevice([f], {});
	const w = new Runner({ send: (op) => d.send(op), executors: { checksum: async () => { throw new Error('boom'); } }, now: () => 1000 });
	await w.tick();
	await new Promise((r) => setTimeout(r, 20));
	const t = d.entries.find((e) => e.type === 'task').record;
	expect([t.status, t.attempts, t.error]).toEqual(['failed', 1, 'boom']);
	expect(await w.tick()).toHaveLength(1);
});

test('an optional input never holds a task back, and moves its key once it is made', () => {
	const still = layered(BUILT_IN).filter((r) => r.key === 'still');
	const v = file(1, 'video/quicktime', ['media:original']);
	const done = (id, rule, result) => taskEntry(id, { kind: 'task', rule, version: 1, key: id, lane: 'io', inputs: [{ id: 1, name: 'original', entry: 'f1', at: ['r1'] }], params: '{}', status: 'done', worker: 'w', lease_until: 0, attempts: 1, error: '', outputs: [], result: JSON.stringify(result), by: 'w', at: 1 });
	const probe = done('p1', 'probe', { journey: { profile: 'apple-log' }, seconds: 10 });
	const first = reconcile(still, world([v, probe]), V, V, 100).filter((o) => o.type === 'task');
	expect(first).toHaveLength(1);
	expect(first[0].value.inputs.map((i) => i.name)).toEqual(['original', 'probe']);
	const analysis = done('a1', 'analysis', { hero: { t: 7.5 } });
	const after = reconcile(still, world([v, probe, analysis, taskEntry('t0', { ...at(first[0], 0), status: 'done' })]), V, V, 200).filter((o) => o.type === 'task');
	expect(after).toHaveLength(1);
	expect(JSON.parse(after[0].value.params)['analysis.hero.t']).toBe(7.5);
	expect(after[0].value.key).not.toBe(first[0].value.key);
});

test('the youtube rule wants each YouTube artifact once, its url part of the key', () => {
	const rule = BUILT_IN.find((r) => r.key === 'youtube');
	const a = (entry, url) => ({ entry, vault: 'V', type: 'artifact', tags: [], deleted: false, edits: 1, files: [], record: { look: 'youtube', url } });
	const world = { entries: [a('a1', 'https://youtu.be/x'), { ...a('a2', 'https://x'), record: { look: 'web', url: 'https://x' } }] };
	const ops = reconcile([rule], world, 'V', 'V', 1);
	expect(ops).toHaveLength(1);
	expect(JSON.parse(ops[0].value.params).url).toBe('https://youtu.be/x');
	expect(ops[0].value.lane).toBe('net');
});

test('the runner queues, claims and finishes straight in the vault, as its acting vault, through the Mac', async () => {
	const { Runner } = await import('./runner.js');
	const { EXECUTORS } = await import('./executors.js');
	const data = new Uint8Array(1000).map((_, i) => i % 251);
	const f = { ...file(9, 'text/plain', ['jobs:test']), files: [{ root: 'r9', size: data.length + 64, len: data.length }] };
	const d = fakeDevice([f], { r9: data });
	/** @type {any[]} */
	const sent = [];
	const r = new Runner({ send: (/** @type {any} */ op) => (sent.push(op), d.send(op)), executors: EXECUTORS, now: () => 1000 });
	await r.tick();
	await new Promise((ok) => setTimeout(ok, 50));
	const t = d.entries.find((e) => e.type === 'task').record;
	expect(t.status).toBe('done');
	// the task is written as the vault's acting vault, by this Mac's own device: there is no worker of its own
	expect(sent.filter((o) => o.op === 'batch').every((o) => o.as === V)).toBe(true);
});
