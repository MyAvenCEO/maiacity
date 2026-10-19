// @ts-nocheck
import { expect, test } from 'bun:test';
import { FILMS, cityOf, filmTag, heldOf, legacyOf } from './legacyfilms.js';

const legacy = [
	{ id: 'a', name: 'Day 01 · Opening', project: 'The 1 million decision', variant: 'opening' },
	{ id: 'b', name: 'Day 01 · Rough', project: 'The 1 million decision', variant: 'rough' },
	{ id: 'c', name: 'World', project: '233 settlers, how it starts', variant: 'W' },
	{ id: 'd', name: 'Trailer', project: 'Trailer', variant: null }
];

test('each film finds its one legacy timeline, by its story and its name', () => {
	expect(legacyOf(FILMS[0], legacy)?.id).toBe('a');
	expect(legacyOf(FILMS[1], legacy)?.id).toBe('c');
	expect(legacyOf(FILMS[1], [{ id: 'x', name: 'World v2', project: '233 Settlers, how it starts' }])?.id).toBe('x');
	expect(legacyOf(FILMS[0], [{ id: 'y', name: 'Other', project: 'The 1 million decision' }, { id: 'z', name: 'More', project: 'The 1 million decision' }])).toBe(null);
});

test('only the Maia City vault takes them, and a film there is found by its tag', () => {
	const world = {
		vaults: [
			{ id: 'me', name: 'Samuel', kind: 'human', acting: { reaches: true, as: 'me' } },
			{ id: 'city', name: 'Maia City', kind: 'coop', acting: { reaches: true, as: 'city' } }
		],
		entries: [
			{ entry: 's', vault: 'city', type: 'story', tags: [filmTag(FILMS[0])] },
			{ entry: 'k', vault: 'me', type: 'cut', tags: [filmTag(FILMS[0])] }
		]
	};
	expect(cityOf(world)).toEqual({ vault: 'city', as: 'city' });
	expect(cityOf({ vaults: [world.vaults[0]], entries: [] })).toBe(null);
	const held = heldOf(world, 'city', FILMS[0]);
	expect(held.story?.entry).toBe('s');
	expect(held.cut).toBe(null);
});

test('a frozen film holds every world shot its timeline plays, and its files by BLAKE3 hash', async () => {
	const { badFrozen } = await import('./filmlist.js');
	const h = 'a'.repeat(64);
	const film = { key: 'x', timeline: { id: 't', clips: [{ kind: 'world', shot: 's1', shotVersion: 2 }, { kind: 'video', hash: h }] }, shots: { 's1@2': { name: 'S', project: null, spec: {} } }, files: [h] };
	expect(badFrozen(film)).toBeNull();
	expect(badFrozen({ ...film, shots: {} })).toBe('the shot s1@2 is missing');
	expect(badFrozen({ ...film, files: ['nope'] })).toBe('files are BLAKE3 hashes');
	expect(badFrozen({ ...film, proxies: { 's1@2': h } })).toBeNull();
	expect(badFrozen({ ...film, proxies: { 's1@2': 'nope' } })).toBe('proxies are BLAKE3 hashes');
});

test("only a shot whose world the camera has gets its proxy rendered; the room's comes from the film seed", async () => {
	const { shootable } = await import('./cuts.js');
	expect(shootable({ world: { sandbox: 'sandbox-4' } })).toBe(true);
	expect(shootable({ world: { sandbox: 'maiacity-v1', area: 'A' } })).toBe(true);
	expect(shootable({ world: {} })).toBe(true);
	expect(shootable({ world: { sandbox: 'room' } })).toBe(false);
});

test("a shot the repo's frozen copy changed comes as its next version, unless it was tuned in the studio since", async () => {
	const { retunedOf } = await import('./legacyfilms.js');
	const old = { time: { hour: 5 }, exposure: { ev: 0.8, meter: 'fixed', stops: 0 } };
	const lit = { time: { hour: 5 }, exposure: { ev: 1.2, meter: 'fixed', stops: 0 } };
	const frozen = { shots: { 'u1@2': { name: 'A', spec: lit }, 'u2@1': { name: 'B', spec: old }, 'u3@1': { name: 'C', spec: lit }, 'u4@1': { name: 'D', spec: lit } } };
	const v = (entry, shot, version, spec, legacy = '') => ({ entry, vault: 'city', type: 'shot', record: { kind: 'shot', shot, version, spec: JSON.stringify(spec), legacy } });
	const world = {
		entries: [
			v('a', '', 1, old, 'u1@2'), // brought, changed in the repo since
			v('b', '', 1, old, 'u2@1'), // brought, the repo's copy the same
			v('c', '', 1, old, 'u3@1'), // brought, then tuned in the studio
			v('c2', 'c', 2, { ...old, exposure: { ev: 2, meter: 'fixed', stops: 0 } }),
			v('d', '', 1, old, 'u4@1'), // its new version made, the cut not saved yet
			v('d2', 'd', 2, lit)
		]
	};
	const cut = { clips: ['a', 'b', 'c', 'd'].map((e) => ({ kind: 'world', shot: `shot:${e}`, shotVersion: 1 })).concat([{ kind: 'video', hash: 'x' }]) };
	const out = retunedOf(world, cut, frozen);
	expect([...out.keys()]).toEqual(['shot:a@1', 'shot:d@1']);
	expect(out.get('shot:a@1')).toEqual({ shot: 'shot:a', spec: lit });
	expect(out.get('shot:d@1')).toEqual({ shot: 'shot:d', spec: lit, at: 2 });
	// once the cut plays the new version, nothing is left to do
	expect(retunedOf(world, { clips: [{ kind: 'world', shot: 'shot:d', shotVersion: 2 }] }, frozen).size).toBe(0);
});

test("the first village's dawn shots are lit softer in the repo's frozen copy", async () => {
	const film = (await import('../../../films/legacy/the-first-village.json')).default;
	const first = film.timeline.clips.filter((c) => c.kind === 'world').sort((a, b) => a.start - b.start).slice(0, 3);
	for (const c of first) {
		const { spec } = film.shots[`${c.shot}@${c.shotVersion}`];
		expect(spec.exposure.ev).toBe(1.2);
		expect(spec.lights.filter((l) => l.id === 'fill' || l.id === 'sky').map((l) => l.intensity)).toEqual([3, 1.8]);
	}
});
