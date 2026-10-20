// @ts-nocheck — plain JS
// The kit's seeded random numbers are the very numbers the worlds drew with their own copies before (so nothing they
// placed moves), and the universe's sun over the ground is the textbook one (so Sandbox 6's light is what it was).
// Run: bun test src/lib/sandbox-kit/random.test.js
import { expect, test } from 'bun:test';
import { seededLcg, seededMinStd, seededRandom } from './random.js';
import { sunOverGround } from './universe.js';

const take = (/** @type {() => number} */ r, n = 2000) => Array.from({ length: n }, r);

test('seededRandom is mulberry32, as MaiaCity V1, Sandbox 5 and the film drew it', () => {
	const was = (/** @type {number} */ seed) => {
		let a = seed >>> 0;
		return () => {
			a = (a + 0x6d2b79f5) >>> 0;
			let t = a;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	};
	for (const seed of [0, 1, 7, 42, 7919 * 3 + 13, 0xffffffff]) expect(take(seededRandom(seed))).toEqual(take(was(seed)));
});

test('seededLcg is the linear congruential one of the V1 van and Sandbox 6', () => {
	const was = (/** @type {number} */ seed) => {
		let s = seed >>> 0;
		return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
	};
	for (const seed of [1, 3, 11, 23, 0xffffffff]) expect(take(seededLcg(seed))).toEqual(take(was(seed)));
});

test('seededMinStd is the minimal standard one of the stars', () => {
	const was = (/** @type {number} */ seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
	expect(take(seededMinStd(19700101))).toEqual(take(was(19700101)));
});

test('the sun over the ground is where the textbook puts it, hour by hour', () => {
	const DEG = Math.PI / 180;
	for (const lat of [48.1, 45, -30])
		for (const decl of [-23.44, 0, 18])
			for (let h = 0; h < 24; h += 0.25) {
				// the textbook: hour angle from noon at half past twelve, height and azimuth from north, clockwise
				const phi = lat * DEG, d = decl * DEG, H = (h - 12.5) * 15 * DEG;
				const el = Math.asin(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H));
				const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(d) * Math.cos(phi)) + Math.PI;
				const s = sunOverGround(h, lat, decl);
				expect(s.x).toBeCloseTo(Math.cos(el) * Math.sin(az), 12);
				expect(s.y).toBeCloseTo(Math.sin(el), 12);
				expect(s.z).toBeCloseTo(-Math.cos(el) * Math.cos(az), 12);
			}
});
