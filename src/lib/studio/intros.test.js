// @ts-nocheck — plain JS
// MaiaCity V1's intros in the studio (./intros.js): what the Maia City vault holds of each, and the script and the cut
// made from an intro's baked times.
// Run: bun test src/lib/studio/intros.test.js
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INTROS, chaptersOf, cutOf, heldIntro, introTag, scriptOf } from './intros.js';
import { normalize } from '../../../game/film/shot.js';
import { shotSpec } from '../maiacity-v1/intro.js';

const baked = (seat) => JSON.parse(readFileSync(join(import.meta.dir, `../maiacity-v1/intro/${seat}.json`), 'utf8'));
/** every world shot of an intro, by its name in the vault, as if made: shot:1, shot:2, … */
const made = (i, data) => new Map(data.steps.flatMap((s) => s.shots).map((s, k) => [`${i.name} · ${s.name}`, `shot:${k + 1}`]));

test('two intros, one a seat, each with its tag', () => {
	expect(INTROS.map((i) => [i.key, i.seat, i.name])).toEqual([['v1-A', 'A', 'Intro · Player 1'], ['v1-B', 'B', 'Intro · Player 2']]);
	expect(introTag(INTROS[1])).toBe('intro:v1-B');
});

test("what the Maia City vault holds of an intro: by its tag, never another vault's, never a deleted one", () => {
	const tag = introTag(INTROS[0]);
	const world = {
		entries: [
			{ entry: 's', vault: 'city', type: 'story', tags: ['story:movie', tag] },
			{ entry: 'p', vault: 'city', type: 'script', tags: ['delivery:script', tag] },
			{ entry: 'k', vault: 'me', type: 'cut', tags: [tag] },
			{ entry: 'k2', vault: 'city', type: 'cut', tags: [tag, 'avendb:deleted'] },
			{ entry: 'h1', vault: 'city', type: 'shot', tags: [tag], record: { kind: 'shot', name: 'Intro · Player 1 · On the road · 1', version: 1 } },
			{ entry: 'h2', vault: 'city', type: 'shot', tags: [], record: { kind: 'shot', name: 'Intro · Player 1 · On the road · 2', version: 1 } }
		]
	};
	const held = heldIntro(world, 'city', INTROS[0]);
	expect(held.story?.entry).toBe('s');
	expect(held.script?.entry).toBe('p');
	expect(held.cut).toBe(null);
	expect([...held.shots]).toEqual([['Intro · Player 1 · On the road · 1', 'shot:h1']]);
});

for (const i of INTROS) {
	const data = baked(i.seat);
	const shots = made(i, data);
	test(`${i.name}: a scene a step, its lines the voice-over, a planned shot a line naming its world shot`, () => {
		const s = scriptOf(i, data, { vault: 'city', entry: 'st' }, shots, 1);
		expect(s.kind).toBe('script');
		expect(s.story).toEqual({ vault: 'city', entry: 'st' });
		expect(s.scenes.map((x) => x.name)).toEqual(data.steps.map((x) => x.title));
		for (const [k, sc] of s.scenes.entries()) {
			expect(sc.lines.map((l) => l.text)).toEqual(data.steps[k].text);
			expect(sc.lines.every((l) => l.who === 'voice')).toBe(true);
			expect(sc.shots.map((x) => x.line)).toEqual(sc.lines.map((l) => l.id));
			for (const sh of sc.shots) expect([...shots.values()]).toContain(sh.shot);
		}
	});
	test(`${i.name}: a cut of world shots end to end at the intro's seconds, its lines when they are told, its chapters`, () => {
		const cut = cutOf(i, data, shots, { vault: 'city', entry: 'sc' }, { vault: 'city', entry: 'st' });
		const world = cut.clips.filter((c) => c.kind === 'world');
		expect(world.length).toBe(shots.size);
		let t = 0;
		for (const c of world) {
			expect(c.start).toBeCloseTo(t, 2);
			t = c.start + c.dur;
			expect(c.track).toBe('V1');
			expect(c.shotVersion).toBe(1);
		}
		expect(t).toBeCloseTo(data.seconds, 2);
		// each clip's shot starts at the second of the intro the clip stands at: the cut plays the intro as it runs
		const specs = data.steps.flatMap((s) => s.shots.map((x) => normalize(shotSpec(i.seat, s, x))));
		world.forEach((c, k) => expect(specs[k].world.clock).toBeCloseTo(c.start, 2));
		const lines = cut.clips.filter((c) => c.kind === 'line');
		expect(lines.length).toBe(data.steps.reduce((a, s) => a + s.lines.length, 0));
		expect(lines.every((l) => l.track === 'A1' && l.text)).toBe(true);
		expect(cut.chapters).toEqual(chaptersOf(data));
		expect(cut.chapters.map((c) => c.name)).toEqual(['The road', 'The end of the road', 'Home']);
		expect(cut.chapters[0].at).toBe(0);
		expect(cut.script).toEqual({ vault: 'city', entry: 'sc' });
		expect(cut.story).toEqual({ vault: 'city', entry: 'st' });
	});
}
