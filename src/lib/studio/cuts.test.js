// @ts-nocheck — plain JS
// Cuts in avenDB (./cuts.js): a timeline kept as a record and read back the same.
// Run: bun test src/lib/studio/cuts.test.js
import { expect, test } from 'bun:test';
import { CUT_V1, fieldsOf, isCut, restill, timelineOf } from './cuts.js';

test('a timeline goes into a cut record and comes back the same', () => {
	const t = { id: 'x', name: 'Trailer', project: 'trailer', variant: null, description: 'd', aspect: '9:16', tags: ['a'], stage: 'edit', version: 2, clips: [{ id: 'c1', track: 'V1', start: 0, in: 0, dur: 3, hash: 'aven:r:1:1:' }], color: { working: 'acescct', output: 'odt-rec709' }, grade: null, if_updated: '3' };
	const f = fieldsOf(t);
	expect(f.name).toBe('Trailer');
	expect(f.variant).toBe('');
	expect(JSON.parse(f.timeline).id).toBeUndefined();
	expect(JSON.parse(f.timeline).if_updated).toBeUndefined();
	const back = timelineOf({ entry: 'e1', vault: 'v', created: 10, edits: 4, record: { kind: 'cut', ...f } });
	expect(back.id).toBe('cut:e1');
	expect(isCut(back.id)).toBe(true);
	expect(back.updated).toBe('4');
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
