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
