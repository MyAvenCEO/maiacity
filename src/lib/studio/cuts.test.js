// @ts-nocheck — plain JS
// Cuts in avenDB (./cuts.js): a timeline kept as a record and read back the same.
// Run: bun test src/lib/studio/cuts.test.js
import { expect, test } from 'bun:test';
import { CUT_V1, fieldsOf, invalidateWorld, isCut, journeyWith, restill, timelineOf, worldOf } from './cuts.js';
import { withWords } from './transcript.js';
import { libraryOf } from './aven.js';

test('library, cut and task readers share one snapshot until a device change invalidates it', async () => {
	invalidateWorld();
	let reads = 0;
	const world = { entries: [], vaults: [] };
	const call = async () => { reads++; return { ok: world }; };
	const results = await Promise.all([worldOf(call), worldOf(call), worldOf(call)]);
	expect(reads).toBe(1);
	expect(results).toEqual([world, world, world]);
	invalidateWorld();
	await worldOf(call);
	expect(reads).toBe(2);
	invalidateWorld();
});

test('a failed retired snapshot cannot evict a newer successful one', async () => {
	invalidateWorld();
	let fail;
	const old = worldOf(() => new Promise((resolve, reject) => { fail = reject; }));
	const rejected = old.catch(() => null);
	invalidateWorld();
	let reads = 0;
	const call = async () => { reads++; return { ok: { entries: [], vaults: [] } }; };
	await worldOf(call);
	fail(new Error('old request failed'));
	await rejected;
	await worldOf(call);
	expect(reads).toBe(1);
	invalidateWorld();
});

test('a timeline goes into a cut record and comes back the same', () => {
	const t = { id: 'x', name: 'Trailer', project: 'trailer', variant: null, description: 'd', aspect: '9:16', tags: ['a'], stage: 'edit', version: 2, clips: [{ id: 'c1', track: 'V1', start: 0, in: 0, dur: 3, hash: 'aven:r:1:1:' }], color: { working: 'acescct', output: 'odt-rec709' }, grade: null, if_updated: '3' };
	const f = fieldsOf(t);
	expect(f.name).toBe('Trailer');
	expect(f.variant).toBe('');
	expect(JSON.parse(f.timeline).id).toBeUndefined();
	expect(JSON.parse(f.timeline).if_updated).toBeUndefined();
	const back = timelineOf({ entry: 'e1', vault: 'v', created: 10, heads: ['h1', 'h2'], record: { kind: 'cut', ...f } });
	expect(back.id).toBe('cut:e1');
	expect(isCut(back.id)).toBe(true);
	expect(back.updated).toBe('h1,h2');
	expect(timelineOf({ entry: 'e2', vault: 'v', record: { kind: 'cut', ...f } }).updated).toBe('');
	expect(back.clips).toEqual(t.clips);
	expect(back.aspect).toBe('9:16');
	expect(back.version).toBe(2);
	expect(JSON.parse(CUT_V1).title).toBe('Cut, v1');
});

test("a save remakes the graded still of each file whose look changed, as the API did", () => {
	const clip = (id, hash, more = {}) => ({ id, track: 'V1', kind: 'media', hash, ...more });
	const before = { clips: [clip('c1', 'h1'), clip('c2', 'h2', { stacks: { clip: [1] } }), clip('c3', 'h3')], grade: null, color: null };
	const after = { clips: [clip('c1', 'h1'), clip('c2', 'h2', { stacks: { clip: [2] } }), clip('c3', 'h3', { frame: { '16:9': { x: 0.1, y: 0, zoom: 1 } } }), clip('c4', 'h4')], grade: null, color: null };
	expect(restill(before, after)).toEqual(['c2', 'c3']);
	expect(restill(after, after)).toEqual([]);
});

test('a colour set by hand rides on the probe journey, and set back it is the journey the probe found', () => {
	const found = { profile: 'apple-log', from: 'its camera tag' };
	const set = journeyWith(found, 'rec709');
	expect(set).toEqual({ profile: 'rec709', from: 'its camera tag', override: 'rec709', detected: 'apple-log' });
	expect(journeyWith(set, null)).toEqual(found);
	expect(journeyWith(set, 'apple-log')).toEqual(found);
	expect(journeyWith(set, 'slog3').detected).toBe('apple-log');
	// the library shows the detected profile with the hand's beside it
	const V = 'aa'.repeat(32);
	const o = { entry: 'o1', vault: V, type: 'file', title: 'o.mov', media: 'video/quicktime', tags: ['media:original'], created: 1, deleted: false, record: {}, files: [{ root: 'a'.repeat(64), size: 116, len: 100 }] };
	const probe = { entry: 't1', vault: V, type: 'task', tags: [], deleted: false, files: [], record: { kind: 'task', rule: 'probe', version: 1, key: 't1', lane: 'io', inputs: [{ id: 1, name: 'original', entry: 'o1', at: [] }], params: '{}', status: 'done', outputs: [], result: JSON.stringify({ journey: set }), at: 1 } };
	const m = libraryOf({ entries: [o, probe] }).find((x) => x.class === 'original');
	expect(m.meta.color).toEqual({ profile: 'apple-log', from: 'its camera tag', override: 'rec709' });
});

test('words put right by hand: cleaned, in order, the text and sentences written again, marked as the hand’s', () => {
	const before = { model: 'phonon-2', language: 'en', state: 'done', progress: 1, utterances: [{ s: 0, e: 2, text: 'to morrow' }], words: [] };
	const r = withWords(before, [{ word: 'Tomorrow', start: 0.1, end: 0.9 }, { word: ' ', start: 1, end: 1.2 }, { w: 'it', s: 1.0004, e: 0.5 }], 'hand', '2026-10-18T10:00:00Z');
	expect(r.words).toEqual([{ w: 'Tomorrow', s: 0.1, e: 0.9 }, { w: 'it', s: 1, e: 1 }]);
	expect(r.text).toBe('Tomorrow it');
	expect(r.utterances[0].text).toBe('Tomorrow it');
	expect(r.edited).toEqual({ by: 'hand', at: '2026-10-18T10:00:00Z' });
	expect(r.state).toBe('done');
	expect('progress' in r).toBe(false);
	expect(r.model).toBe('phonon-2');
});
