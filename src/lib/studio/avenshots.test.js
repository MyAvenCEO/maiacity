// @ts-nocheck — plain JS
// World shots in avenDB (./avenshots.js): each version an entry of its own, the first the shot.
// Run: bun test src/lib/studio/avenshots.test.js
import { expect, test } from 'bun:test';
import { SHOT_V1, shotFrom, versionEntry } from './avenshots.js';

const v = (entry, shot, version, spec) => ({ entry, vault: 'V', type: 'shot', tags: [], deleted: false, created: version, record: { kind: 'shot', shot, name: 'Dome dawn', project: '', version, spec: JSON.stringify(spec), at: version } });

test('a shot is its first version; a clip finds the version it pins, else the newest', () => {
	const world = { entries: [v('s1', '', 1, { seconds: 4 }), v('s2', 's1', 2, { seconds: 6 }), v('o1', '', 1, { seconds: 1 })] };
	expect(versionEntry(world, 'shot:s1', 1).entry).toBe('s1');
	expect(versionEntry(world, 'shot:s1').entry).toBe('s2');
	const s = shotFrom(versionEntry(world, 'shot:s1', 2));
	expect(s.id).toBe('shot:s1');
	expect(s.version).toBe(2);
	expect(s.spec.seconds).toBe(6);
	expect(s.project).toBeNull();
	expect(JSON.parse(SHOT_V1).title).toBe('World shot, v1');
});
