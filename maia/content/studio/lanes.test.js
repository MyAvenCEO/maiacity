// @ts-nocheck
import { expect, test } from 'bun:test';
import { lanesOf, movedKey, withKey, withoutKey } from './lanes.js';

const spec = (sandbox, extra = {}) => ({ world: { sandbox }, exposure: { meter: 'auto', stops: 0 }, lights: [], cues: [], camera: { kind: 'world' }, ...extra });

test("a world's lanes: camera, hour, exposure, every light, each declared part's channel, cues", () => {
	const v1 = lanesOf(spec('maiacity-v1')).map((l) => l.key);
	expect(v1.slice(0, 3)).toEqual(['camera', 'hour', 'exposure']);
	expect(v1).toContain('light:sun');
	expect(v1).toContain('part:van:along');
	expect(v1).toContain('part:tent:pitch');
	expect(v1.at(-1)).toBe('cues');
	expect(lanesOf(spec('sandbox-1')).some((l) => l.key.startsWith('part:'))).toBe(false);
});

test('a part lane writes its channel into the spec, and taking its last key away hands it back to the world', () => {
	const sp = spec('maiacity-v1');
	const tent = lanesOf(sp).find((l) => l.key === 'part:tent:pitch');
	tent.set(sp, withKey(tent.get(sp), 2, 0.5, tent.range));
	expect(sp.parts).toEqual([{ id: 'tent', pitch: [[2, 0.5]] }]);
	tent.set(sp, withKey(tent.get(sp), 4, 3, tent.range));
	expect(sp.parts[0].pitch).toEqual([[2, 0.5], [4, 1]]);
	tent.set(sp, withoutKey(tent.get(sp), 0));
	expect(sp.parts[0].pitch).toBe(1);
	tent.set(sp, undefined);
	expect(sp.parts).toEqual([]);
});

test('a light lane adds the light, and a key moves only between its neighbours', () => {
	const sp = spec('sandbox-4');
	const sun = lanesOf(sp).find((l) => l.key === 'light:sun');
	sun.set(sp, withKey(withKey(undefined, 0, 1, sun.range), 3, 2, sun.range));
	expect(sp.lights).toEqual([{ id: 'sun', intensity: [[0, 1], [3, 2]] }]);
	expect(movedKey(sun.get(sp), 0, 5, 9, sun.range)).toEqual([[3 - 1 / 30, 4], [3, 2]]);
});
