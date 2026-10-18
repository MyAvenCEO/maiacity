// @ts-nocheck — plain JS
// The one world registry (game/film/worlds.js), what a shot may say of a world's own camera, its frames and its
// moving parts (game/film/shot.js, camera.js), the shot player's reel (game/film/reel.js) and the seekable film
// timeline ($lib/sandbox-kit/timeline.js).
// Run: bun test src/lib/film/worlds.test.js
import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { WORLDS, filmPath, isWorld, partsOf, worldOfPath } from '../../../game/film/worlds.js';
import { ShotError, evaluate, fingerprint, normalize } from '../../../game/film/shot.js';
import { frameAt, reelOf, shotAt } from '../../../game/film/reel.js';
import { createTimeline } from '../sandbox-kit/timeline.js';

const ROOT = join(import.meta.dir, '../../..');
const v1 = (o = {}) => ({ world: { sandbox: 'maiacity-v1', area: 'A', stand: [0, 0], clock: 10 }, seconds: 4, camera: { kind: 'world' }, time: { hour: 9 }, ...o });

describe('the one registry of worlds', () => {
	test('every world has its label, its page in the app, its film page and its parts', () => {
		for (const [id, w] of Object.entries(WORLDS)) {
			expect(isWorld(id)).toBe(true);
			expect(w.label.length).toBeGreaterThan(3);
			expect(w.route).toMatch(/^\/app\/.+\/$/);
			expect(existsSync(join(ROOT, `src/routes/games/${id}/+page.svelte`)), id).toBe(true);
			expect(Array.isArray(w.parts)).toBe(true);
			for (const p of w.parts) for (const ch of Object.values(p.channels)) expect(ch.range[0]).toBeLessThan(ch.range[1]);
		}
		expect(isWorld('constructor')).toBe(false);
		expect(isWorld('sandbox-9')).toBe(false);
	});
	test('MaiaCity V1 is a world of two seats, with its van, its pickup and its tent', () => {
		expect(WORLDS['maiacity-v1'].areas).toEqual(['A', 'B']);
		expect(partsOf('maiacity-v1').map((p) => p.id)).toEqual(['van', 'pickup', 'tent']);
		expect(filmPath({ sandbox: 'maiacity-v1', area: 'B' })).toBe('/games/maiacity-v1/?film&area=B');
		expect(worldOfPath('https://x.y/games/maiacity-v1/?film&area=B')).toEqual({ sandbox: 'maiacity-v1', area: 'B' });
		expect(partsOf('nowhere')).toEqual([]);
	});
});

describe("a shot of a world's own camera, its frames and its parts", () => {
	test("camera kind `world` is the world's own camera: no pose of the shot's", () => {
		const s = normalize(v1());
		expect(s.camera).toEqual({ kind: 'world' });
		expect(s.world.area).toBe('A');
		const e = evaluate(s, 1);
		expect(e.own).toBe(true);
		expect(e.clock).toBe(11);
		expect(e.parts).toEqual({});
	});
	test('a pose in one of the world’s frames, and the lens’s nearest distance', () => {
		const s = normalize(v1({ camera: { kind: 'move', frame: 'van', from: [0, 1.7, 0], to: [0, 1.7, 1], aimFrom: [0, 1.6, 5], aimTo: [0, 1.6, 6] }, lens: { fov: 70, near: 0.05 } }));
		const e = evaluate(s, 2);
		expect(e.own).toBe(false);
		expect(e.frame).toBe('van');
		expect(e.near).toBe(0.05);
		expect(() => normalize(v1({ camera: { kind: 'move', frame: 'Van!', from: [0, 0, 0], to: [0, 0, 1], aimFrom: [0, 0, 5], aimTo: [0, 0, 6] } }))).toThrow(ShotError);
		expect(() => normalize(v1({ lens: { fov: 40, near: 0 } }))).toThrow(ShotError);
	});
	test('parts: only the world’s, only their channels, values kept to the channel’s range, keys on the shot’s clock', () => {
		const s = normalize(v1({ parts: [{ id: 'van', along: [[0, -2], [4, 0.5]] }, { id: 'tent', pitch: 3 }] }));
		expect(s.parts).toEqual([{ id: 'van', along: [[0, 0], [4, 0.5]] }, { id: 'tent', pitch: 1 }]);
		expect(evaluate(s, 2).parts).toEqual({ van: { along: 0.25 }, tent: { pitch: 1 } });
		expect(() => normalize(v1({ parts: [{ id: 'boat', along: 1 }] }))).toThrow(/parts\[0\]\.id is one of van, pickup, tent/);
		expect(() => normalize(v1({ parts: [{ id: 'van', door: 1 }] }))).toThrow(/moves by along, not door/);
		expect(() => normalize(v1({ parts: [{ id: 'van', along: 1 }, { id: 'van', along: 0 }] }))).toThrow(/each part once/);
		expect(() => normalize({ ...v1(), world: { sandbox: 'sandbox-6', stand: [0, 0] }, parts: [{ id: 'van', along: 1 }] })).toThrow(/has no moving parts/);
	});
	test('a shot that moves no part keeps the fingerprint it had', () => {
		const a = normalize(v1());
		expect('parts' in a).toBe(false);
		expect(fingerprint(normalize(v1({ parts: [] })))).toBe(fingerprint(a));
		expect(fingerprint(normalize(v1({ parts: [{ id: 'tent', pitch: 0.5 }] })))).not.toBe(fingerprint(a));
	});
});

describe("the shot player's reel", () => {
	const reel = reelOf([v1({ seconds: 2 }), v1({ seconds: 3, camera: { kind: 'move', from: [0, 2, 0], to: [0, 2, 3], aimFrom: [0, 1, 9], aimTo: [0, 1, 9] } })]);
	test('shots one after another, each as long as it says', () => {
		expect(reel.seconds).toBe(5);
		expect(reel.shots.map((s) => [s.start, s.end])).toEqual([[0, 2], [2, 5]]);
	});
	test('the shot on screen at any time, held at the ends', () => {
		expect(shotAt(reel, -1)).toMatchObject({ index: 0, t: 0 });
		expect(shotAt(reel, 2.5)).toMatchObject({ index: 1, t: 0.5 });
		expect(shotAt(reel, 9)).toMatchObject({ index: 1, t: 3 });
		expect(frameAt(reel, 1).own).toBe(true);
		expect(frameAt(reel, 3).own).toBe(false);
		expect(shotAt(reelOf([]), 1)).toBe(null);
	});
});

describe('a world as a seekable film', () => {
	// a toy world: a value that moves on by a step that depends on how far it is, so only the same ticks give the same value
	function toy(known) {
		const w = { x: 0, last: 0, log: [] };
		const tl = createTimeline({
			rate: 10,
			parts: [{ segs: [{ n: known?.[0] }, { n: known?.[1] }] }, { segs: [{ n: known?.[2] }] }],
			enter: (i, t) => ((w.x = i * 100), (w.last = t)),
			start: (i, j) => (w.x += j * 10),
			tick: (t, drawn) => {
				w.x += (t - w.last) * (1 + w.x * 0.01);
				w.last = t;
				if (drawn) w.log.push(Math.round(w.x * 1e6) / 1e6);
			},
			done: (i, j, k) => k >= [12, 7, 20][i * 2 + j]
		});
		return { w, tl };
	}
	test('measured once, every segment’s ticks known', async () => {
		const { tl } = toy();
		expect(tl.known).toBe(false);
		await tl.measure();
		expect(tl.schedule().map((p) => p.segs.map((s) => s.n))).toEqual([[12, 7], [20]]);
		expect(tl.seconds).toBeCloseTo(3.9, 9);
	});
	test('any second, in any order, is the same world', async () => {
		const { w, tl } = toy([12, 7, 20]);
		const at = (t) => (tl.seek(t), w.log.at(-1));
		const ahead = [0, 0.35, 0.8, 1.2, 1.55, 1.9, 2.5, 3.85].map(at);
		const back = [3.85, 2.5, 1.9, 1.55, 1.2, 0.8, 0.35, 0].map(at).reverse();
		expect(back).toEqual(ahead);
		// played on frame by frame, the same as sought afresh
		const { w: w2, tl: tl2 } = toy([12, 7, 20]);
		for (let k = 0; k <= 32; k++) tl2.seek(k * 0.05);
		expect(w2.log.at(-1)).toBe(at(1.6));
	});
});
