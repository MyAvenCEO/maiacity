// @ts-nocheck — plain JS
// Import from the legacy studio (./importer.js): exactly the files a timeline plays, renamed as avenDB names them.
// Run: bun test src/lib/studio/importer.test.js
import { expect, test } from 'bun:test';
import { filesOf, moved } from './importer.js';
import { legacyValue } from './jobs/executors.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

test('a timeline brings each file it plays once; world clips and avenDB files stay', () => {
	const t = {
		clips: [
			{ id: 'c1', track: 'V1', kind: 'media', hash: A },
			{ id: 'c2', track: 'A1', kind: 'media', hash: A },
			{ id: 'c3', track: 'A2', kind: 'media', hash: B },
			{ id: 'w1', track: 'V1', kind: 'world', shot: 'uuid-1', shotVersion: 3 },
			{ id: 'c4', track: 'V1', kind: 'media', hash: 'aven:r:1:1:' }
		]
	};
	expect(filesOf(t)).toEqual([A, B]);
	const out = moved(t, new Map([[A, 'aven:x:2:1:video%2Fmp4']]), new Map([['uuid-1@3', { shot: 'shot:e1', version: 1 }]]));
	expect(out.clips.map((c) => c.hash ?? `${c.shot}@${c.shotVersion}`)).toEqual(['aven:x:2:1:video%2Fmp4', 'aven:x:2:1:video%2Fmp4', B, 'shot:e1@1', 'aven:r:1:1:']);
});

test("a brought file's legacy words are found beside it, in its own vault only", () => {
	const o = { entry: 'o', vault: 'V', type: 'file', tags: ['media:original', `legacy:${A}`] };
	const w = { entry: 'w', vault: 'V', type: 'file', tags: ['media:transcript', `legacy:${A}`] };
	const other = { entry: 'x', vault: 'W', type: 'file', tags: ['media:analysis', `legacy:${A}`] };
	const world = { entries: [o, w, other] };
	expect(legacyValue('transcript', o, world)?.entry).toBe('w');
	expect(legacyValue('analysis', o, world)).toBeUndefined();
	expect(legacyValue('transcript', { ...o, tags: ['media:original'] }, world)).toBeUndefined();
});
