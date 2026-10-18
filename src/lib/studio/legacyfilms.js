/*
 * The two films that come over from the legacy studio (Samuel 2026-10-18), and nothing else of it: each legacy
 * timeline copied into the Maia City COOP vault as a cut by ./importer.js, with exactly the footage it plays, under its
 * new name, and a story of its own there that the cut belongs to (its `story` link, so the story's Movie tab lists it,
 * its renders go out as its film posts). Never into a person's own vault.
 *
 * The studio brings them whenever it opens on the Mac and the Maia City vault lacks one (`bringFilms`), so after a reset
 * of avenDB they come back by themselves; a film already there (its story and its cut carry the film's tag) costs no
 * call to the legacy API. The legacy timelines, their vault and Postgres stay as they are until J15.
 */

import { answer } from '$lib/avendb/ops.js';
import { CUT, device, worldOf } from './cuts.js';

/**
 * Each film: its legacy timeline, by its story (`project`) and its name, and what it is called now.
 * @typedef {{ key: string, project: string, timeline: string, name: string }} Film
 * @type {Film[]}
 */
export const FILMS = [
	{ key: '1-million-decision', project: 'The 1 million decision', timeline: 'Day 01 · Opening', name: '1 million decision' },
	{ key: 'the-first-village', project: '233 settlers, how it starts', timeline: 'World', name: 'The first village' }
];

/** The story flow's Movie stage, as $lib/avendb/flows.js `stageTag('story', 'movie')` names it. */
const MOVIE = 'story:movie';

/** The tag film `f`'s story and cut carry. @param {Film} f */
export const filmTag = (f) => `film:${f.key}`;

/** @param {unknown} s */
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The legacy timeline of film `f` among `all`: of its story, by its name, else its only one there.
 * @param {Film} f @param {{ id: string, name: string, project: string | null, description?: string | null }[]} all
 */
export function legacyOf(f, all) {
	const mine = all.filter((t) => norm(t.project) === norm(f.project));
	return mine.find((t) => norm(t.name) === norm(f.timeline)) ?? (mine.length === 1 ? mine[0] : null);
}

/**
 * The Maia City COOP vault, as this device reaches it, and who acts there; `null` where it doesn't.
 * @param {import('../avendb/vaults.js').WorldView} world
 */
export function cityOf(world) {
	const v = (world.vaults ?? []).find((x) => x.kind !== 'device' && x.acting?.reaches && /maia city/i.test(x.name ?? ''));
	return v ? { vault: v.id, as: v.acting.as } : null;
}

/**
 * What vault `vault` holds of film `f`: its story and its cut, each by its tag.
 * @param {import('../avendb/vaults.js').WorldView} world @param {string} vault @param {Film} f
 */
export function heldOf(world, vault, f) {
	const tag = filmTag(f);
	const live = (/** @type {any} */ e) => e.vault === vault && !e.deleted && !(e.tags ?? []).includes('avendb:deleted') && (e.tags ?? []).includes(tag);
	return {
		story: world.entries.find((e) => live(e) && e.type === 'story') ?? null,
		cut: world.entries.find((e) => live(e) && e.type === CUT) ?? null
	};
}

/**
 * Every film the Maia City vault lacks, brought into it, `tell` hearing how far; the names of those brought.
 * Nothing where this isn't the Mac app with avenDB open, or the Maia City vault isn't reached here.
 * @param {(line: string) => void} [tell] @returns {Promise<string[]>}
 */
export async function bringFilms(tell = () => {}) {
	const call = await device();
	if (!call) return [];
	let world = await worldOf(call);
	const city = cityOf(world);
	if (!city) return [];
	const wanted = FILMS.filter((f) => !heldOf(world, city.vault, f).cut);
	if (!wanted.length) return [];
	const { listTimelines } = await import('$lib/auth/client');
	const legacy = /** @type {any[]} */ (await listTimelines());
	const { importTimeline } = await import('./importer.js');
	const brought = [];
	for (const f of wanted) {
		const t = legacyOf(f, legacy);
		if (!t) continue;
		tell(`Bringing “${f.name}”…`);
		world = await worldOf(call);
		let story = heldOf(world, city.vault, f).story?.entry;
		if (!story) {
			const value = { kind: 'story', title: f.name, text: '', description: t.description ?? '', series: 'Films', sparks: [], tags: [] };
			story = answer(await call('run', { op: 'create', vault: city.vault, type: 'story', tags: [MOVIE, filmTag(f)], value, as: city.as })).entry;
		}
		await importTimeline(t.id, tell, { ...city, name: f.name, project: f.name, story: { vault: city.vault, entry: /** @type {string} */ (story) }, tags: [filmTag(f)] });
		brought.push(f.name);
	}
	return brought;
}
