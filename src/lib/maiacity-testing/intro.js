// @ts-nocheck — common baked journey and camera contract.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalize } from '../../../game/film/shot.js';
export function introContract(version, folder, { COLD, PLAN_VERSION, freshStep, introPlan, linesKey, segsOf, shotSpec }, { plants, moves }) {
const baked = seat => JSON.parse(readFileSync(join(folder, `intro/${seat}.json`), 'utf8'));
describe(version, () => {
	for (const seat of Object.keys(plants)) {
		test(`${seat}: the whole journey, from the road to the next settlers, the same every time`, () => {
			const plan = introPlan(seat);
			expect(plan.steps[0].step.id).toBe('arrive');
			expect(plan.steps.at(-1).step.id).toBe('done');
			expect(new Set(plan.steps.map((p) => p.step.id)).size).toBe(plan.steps.length);
			expect(introPlan(seat).steps.map((p) => p.key)).toEqual(plan.steps.map((p) => p.key));
			// Every move required by this version and seat occurs, in order.
			expect(plan.steps.filter((p) => p.move).map((p) => p.move.type)).toEqual(moves(seat));
			const last = plan.steps.at(-1).view.players[seat];
			expect(last.tree?.plant).toBe(plants[seat]);
		});
		test(`${seat}: its baked times are still the plan's`, () => {
			const data = baked(seat);
			expect(data.version).toBe(PLAN_VERSION);
			const plan = introPlan(seat);
			const stale = plan.steps.filter((p) => !freshStep(data, p)).map((p) => p.step.id);
			expect(stale).toEqual([]);
			let t = 0;
			for (const [i, s] of data.steps.entries()) {
				expect(s.id).toBe(plan.steps[i].step.id);
				expect(s.lineKey).toBe(linesKey(plan.steps[i].step));
				expect(s.segs.map((g) => g.kind)).toEqual(segsOf(plan.steps[i].step));
				expect(s.t).toBeCloseTo(t, 3);
				t += s.dur;
				// its shots cover it end to end, every one a world shot ./shot.js takes
				expect(s.shots[0].t).toBe(0);
				expect(s.shots.reduce((a, x) => a + x.dur, 0)).toBeCloseTo(s.dur, 3);
				for (const x of s.shots) expect(() => normalize(shotSpec(seat, s, x))).not.toThrow();
				// every line it tells is told
				for (const line of s.text) expect(s.lines.some((l) => l.text.includes(line))).toBe(true);
			}
			expect(data.seconds).toBeCloseTo(t, 3);
		});
	}
	test("a shot of the intro: the world's own camera at its second of the seat's intro, the story's hour, the low cut cold", () => {
		const step = { id: 'tribe', t: 100, chapter: 'Home', title: 'Invest into the Tribe COOP' };
		const s = normalize(shotSpec('B', step, { t: 8.6, dur: 6.2, hour: 16.7, cold: true, name: 'x · 2', line: 'Where you come from…' }));
		expect(s.world).toMatchObject({ sandbox: version, area: 'B', clock: 108.6 });
		expect(s.camera).toEqual({ kind: 'world' });
		expect(s.seconds).toBe(6.2);
		expect(s.time).toEqual({ hour: 16.7 });
		expect(s.lights).toEqual(COLD);
	});
});

}
