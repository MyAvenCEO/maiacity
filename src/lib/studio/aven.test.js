// @ts-nocheck — plain JS
// The studio's avenDB footage (./aven.js): originals with what the rules made of them, as library items.
// Run: bun test src/lib/studio/aven.test.js
import { expect, test } from 'bun:test';
import { avenUrl, isAven, libraryOf, libraryFromDevice, withGraded } from './aven.js';

const V = 'aa'.repeat(32);
const f = (id, media, tags, root, len = 100) => ({ entry: id, vault: V, type: 'file', title: `${id}.mov`, media, tags, created: 1, deleted: false, record: { media }, files: [{ root, size: len + 16, len }] });
const task = (id, rule, from, result, outputs = []) => ({ entry: id, vault: V, type: 'task', tags: [], deleted: false, files: [], record: { kind: 'task', rule, version: 1, key: id, lane: 'io', inputs: [{ id: 1, name: 'original', entry: from, at: [] }], params: '{}', status: 'done', worker: 'w', lease_until: 0, attempts: 1, error: '', outputs, result: JSON.stringify(result), by: 'w', at: 1 } });

test('an original comes with its probe, proxy, still, words and analysis; what was made stands in for it', () => {
	const world = {
		entries: [
			f('o1', 'video/quicktime', ['media:original', 'day:1'], 'a'.repeat(64)),
			f('p1', 'video/mp4', ['media:proxy'], 'b'.repeat(64)),
			f('s1', 'image/png', ['media:still'], 'c'.repeat(64)),
			f('v1', 'image/jpeg', ['media:preview'], 'd'.repeat(64)),
			task('t1', 'probe', 'o1', { journey: { profile: 'apple-log', from: 'its camera tag' }, seconds: 12, fps: 25, audio: true }),
			task('t2', 'proxy', 'o1', { profile: 'apple-log' }, ['p1']),
			task('t3', 'still', 'o1', { t: 6 }, ['s1', 'v1']),
			task('t4', 'transcript', 'o1', { state: 'done', words: [{ w: 'hi', s: 0, e: 1 }] })
		]
	};
	const lib = libraryOf(world);
	const o = lib.find((m) => m.class === 'original');
	expect(isAven(o.hash)).toBe(true);
	expect(o.kind).toBe('video');
	expect(o.tags).toEqual(['day:1']);
	expect(o.meta.color.profile).toBe('apple-log');
	expect(o.meta.duration).toBe(12);
	expect(o.meta.transcript_state).toBe('done');
	expect(o.meta.proxy).toBe(lib.find((m) => m.meta.role === 'proxy').hash);
	expect(lib.find((m) => m.meta.role === 'proxy').meta.proxy_of).toBe(o.hash);
	expect(lib.filter((m) => m.class === 'proxy')).toHaveLength(3);
	expect(avenUrl(o.hash)).toBe(`aven://localhost/${'a'.repeat(64)}?size=116&len=100&media=video%2Fquicktime`);
});

test('a file this device cannot open is left out', () => {
	const o = f('o1', 'video/quicktime', ['media:original'], 'a'.repeat(64));
	o.files[0].len = null;
	expect(libraryOf({ entries: [o] })).toHaveLength(0);
});

test("a cut's graded still is its file's preview; its renders' films and hero frames are in the library", () => {
	const o1 = f('o1', 'video/quicktime', ['media:original'], 'a'.repeat(64));
	const ref = `aven:${'a'.repeat(64)}:116:100:video%2Fquicktime`;
	const cutTask = (id, rule, result, outputs, at) => {
		const t = task(id, rule, 'cut1', result, outputs);
		t.record.inputs[0].name = 'cut';
		t.record.at = at;
		return t;
	};
	const world = {
		entries: [
			o1,
			f('v1', 'image/jpeg', ['media:preview'], 'd'.repeat(64)),
			f('g1', 'image/jpeg', ['media:preview'], 'e'.repeat(64)),
			f('g2', 'image/jpeg', ['media:preview'], '1'.repeat(64)),
			f('gl', 'image/jpeg', ['media:preview'], '2'.repeat(64)),
			f('d1', 'video/mp4', ['media:delivery'], '3'.repeat(64)),
			f('h1', 'image/png', ['media:frame'], '4'.repeat(64)),
			task('t3', 'still', 'o1', { t: 6 }, ['v1']),
			cutTask('f1', 'frame', { kind: 'graded', of: ref, cut: 'cut:cut1', clip: 'c1' }, ['g1'], 5),
			cutTask('f2', 'frame', { kind: 'graded', of: ref, cut: 'cut:cut1', clip: 'c1' }, ['g2'], 7),
			cutTask('f3', 'frame', { kind: 'graded', of: 'ff'.repeat(32), cut: 'cut:cut1', clip: 'c2' }, ['gl'], 7),
			cutTask('r1', 'render', { output_hash: 'x', deliveries: [] }, ['d1'], 8),
			cutTask('h', 'frame', { kind: 'hero', cut: 'cut:cut1', t: 2, shape: '16:9', clip: null }, ['h1'], 9)
		]
	};
	const lib = withGraded([{ hash: 'ff'.repeat(32), meta: {}, class: 'original' }, ...libraryOf(world)]);
	const o = lib.find((m) => m.hash === ref);
	expect(o.meta.preview).toBe(lib.find((m) => m.meta.aven?.entry === 'g2').hash);
	expect(lib.find((m) => m.hash === 'ff'.repeat(32)).meta.preview).toBe(lib.find((m) => m.meta.aven?.entry === 'gl').hash);
	expect(lib.find((m) => m.class === 'delivery').meta.timeline).toBe('cut:cut1');
	expect(lib.find((m) => m.meta.role === 'frame').meta.shape).toBe('16:9');
});


test('device library uses bounded file/task collections with the same derived outputs', async () => {
 const entries = [
  f('original', 'video/mp4', ['media:original'], 'a'.repeat(64)),
  f('proxy', 'video/mp4', ['media:proxy'], 'b'.repeat(64)),
  task('probe', 'probe', 'original', {seconds: 12}),
  task('proxy-task', 'proxy', 'original', {}, ['proxy']),
  {entry:'unrelated-room', type:'room', record:{}}
 ];
 const calls = [];
 const call = async (_, op) => {
  calls.push(op);
  if (op.op === 'query') {
   const rows = entries.filter(e => op.where.type.includes(e.type));
   return {ok:{count:rows.length, rows:rows.slice(op.offset, op.offset + op.limit)}};
  }
  if (op.op === 'entry_views') return {ok:{rows:entries.filter(e => op.entries.includes(e.entry))}};
  throw Error('Unrelated world materialization must not run');
 };
 expect(await libraryFromDevice(call)).toEqual(libraryOf({entries}));
 expect(calls.filter(op => op.op === 'query').map(op => op.where.type)).toEqual([['file'], ['task']]);
 expect(calls.every(op => op.op !== 'entry_views' || !op.entries.includes('unrelated-room'))).toBe(true);
});
