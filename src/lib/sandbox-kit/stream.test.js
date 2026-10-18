// @ts-nocheck — plain JS
// The stream (./stream.js): what a world builds, decided by what is seen.
// Run: bun test src/lib/sandbox-kit/stream.test.js
import { describe, expect, test } from 'bun:test';
import { createStream } from './stream.js';

/** a frustum that sees only what lies in front of x = 0 looking along +x (a half-space), as THREE.Frustum answers */
const lookingEast = { intersectsSphere: (/** @type {any} */ s) => s.center.x + s.radius > 0 };
const flush = () => new Promise((r) => setTimeout(r, 0));

/** a world of things in a row along x, each built when asked, its builds and disposals counted */
function row(n, o = {}) {
	const made = [], gone = [];
	/** @type {Map<number, () => void>} */
	const finish = new Map();
	const s = createStream({ budget: 3, ...o });
	for (let i = 0; i < n; i++)
		s.add({
			id: i,
			x: (i - n / 2) * 20,
			z: 0,
			r: 5,
			build: () => new Promise((resolve) => finish.set(i, () => (made.push(i), resolve(`dome ${i}`)))),
			dispose: () => gone.push(i)
		});
	return { s, made, gone, finish };
}

describe('the stream', () => {
	test('wants what a view sees, not what stands behind it', () => {
		const { s } = row(6);
		const ids = s.wanted([{ x: 0, y: 0, z: 0, frustum: lookingEast }]);
		expect(ids.every((id) => id >= 3)).toBe(true);
	});

	test('wants what stands within the view\'s near unseen, a player turning round', () => {
		const { s } = row(6, { budget: 4 });
		const ids = s.wanted([{ x: 0, y: 0, z: 0, frustum: lookingEast, near: 20 }]);
		// what is seen comes first; the one behind, within reach, after it
		expect(ids).toEqual([3, 4, 5, 2]);
	});

	test('the biggest on screen first, and never over the budget', () => {
		const { s } = row(10);
		const ids = s.wanted([{ x: 0, y: 0, z: 0 }]);
		expect(ids.length).toBe(3);
		expect(ids[0]).toBe(5);
	});

	test('one build at a time, the most wanted first', async () => {
		const { s, finish } = row(6);
		s.look([{ x: 0, y: 0, z: 0 }]);
		s.tick();
		expect(s.states().filter((e) => e.state === 'building').map((e) => e.id)).toEqual([3]);
		finish.get(3)?.();
		await flush();
		expect(s.built(3)).toBe(true);
		expect(s.states().filter((e) => e.state === 'building').length).toBe(1);
	});

	test('ready resolves once exactly what the views see is built', async () => {
		const { s, finish } = row(6);
		let done = false;
		const shot = [{ x: 30, y: 0, z: 0, frustum: lookingEast }];
		void s.ready(shot).then(() => (done = true));
		for (let k = 0; k < 6; k++) {
			for (const [i, f] of finish) if (s.building(i)) f();
			await flush();
		}
		expect(done).toBe(true);
		expect(s.built(0)).toBe(false);
	});

	test('lets go of the longest unseen when the budget needs room, never of what is pinned', async () => {
		const { s, finish, gone } = row(10, { budget: 2 });
		const build = async () => {
			for (let k = 0; k < 4; k++) {
				for (const [i, f] of finish) if (s.building(i)) f();
				await flush();
			}
		};
		const west = [{ x: -100, y: 0, z: 0, near: 1 }];
		s.pin([west]);
		s.look([{ x: 0, y: 0, z: 0 }]);
		s.tick();
		await build();
		const kept = s.wanted(west)[0];
		s.look([{ x: 80, y: 0, z: 0 }]);
		s.tick();
		await build();
		expect(gone).not.toContain(kept);
		expect(s.built(kept)).toBe(true);
	});

	test('a build nobody wants finishes, unless something wanted waits for its turn', async () => {
		const { s, finish } = row(6, { ahead: true });
		s.look([{ x: 0, y: 0, z: 0, near: 1 }]);
		s.tick();
		const first = s.states().find((e) => e.state === 'building')?.id;
		// nobody looks any more: it goes on building
		s.look([]);
		s.tick();
		expect(s.building(first)).toBe(true);
		// something else is wanted now: it gives way
		s.look([{ x: 60, y: 0, z: 0, frustum: { intersectsSphere: (/** @type {any} */ c) => c.center.x > 30 } }]);
		s.tick();
		expect(s.building(first)).toBe(false);
		expect(s.states().filter((e) => e.state === 'building').length).toBe(1);
		finish.clear();
	});

	test('builds the nearest ahead into spare room while nothing wanted waits', async () => {
		const { s, finish } = row(6, { ahead: true, budget: 6, far: 100 });
		s.look([{ x: 0, y: 0, z: 0, frustum: { intersectsSphere: () => false } }]);
		s.tick();
		expect(s.states().filter((e) => e.state === 'building').length).toBe(1);
		for (let k = 0; k < 8; k++) {
			for (const [i, f] of finish) if (s.building(i)) f();
			await flush();
		}
		expect(s.states().filter((e) => e.state === 'built').length).toBe(6);
	});

	test('a failed build holds nothing back', async () => {
		const s = createStream();
		s.add({ id: 'a', x: 0, z: 0, r: 1, build: () => Promise.reject(new Error('no')) });
		let done = false;
		void s.ready([{ x: 0, y: 0, z: 0 }]).then(() => (done = true));
		await flush();
		await flush();
		expect(done).toBe(true);
	});
});
