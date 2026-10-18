/*
 * The two films that come over from the legacy studio (Samuel 2026-10-18), and nothing else of it: each legacy
 * timeline copied into the Maia City COOP vault as a cut by ./importer.js, with exactly the footage it plays, under its
 * new name, and a story of its own there that the cut belongs to (its `story` link, so the story's Movie tab lists it,
 * its renders go out as its film posts). Never into a person's own vault.
 *
 * They are part of Maia City's seed (Samuel 2026-10-18): the account page brings them in the background right after
 * the repo seed, on the Mac, as it writes the rest ($lib/avendb/Account.svelte), and the studio brings them too
 * whenever it opens there and the Maia City vault lacks one (`bringFilms`), one run for both, so after a reset of
 * avenDB they come back by themselves; a film already there (its story and its cut carry the film's tag) costs no
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
 * Every film the Maia City vault lacks, brought into it one after another: `tell` hearing how far each is (its story
 * made first, so the studio shows it as it comes), `arrived` each as its cut is made, with the files that could not
 * come (./importer.js), or why it can't be (`missing`: the old studio has no such timeline). The films brought, each with those. Nothing where this isn't the Mac app with avenDB open, or
 * the Maia City vault isn't reached here.
 * @param {{ tell?: (f: Film, line: string, at?: import('./importer.js').Progress) => void,
 *   arrived?: (f: Film, failed: { hash: string, error: string }[], missing?: string) => void | Promise<void> }} [on]
 * @returns {Promise<{ film: Film, failed: { hash: string, error: string }[] }[]>}
 */
export function bringFilms(on = {}) {
	listening.add(on);
	going ??= bringing().finally(() => {
		going = null;
		listening.clear();
	});
	return going;
}

/** Who hears the run going now (`bringFilms`): one that asks while it runs joins it, from where it is. */
const listening = /** @type {Set<Parameters<typeof bringFilms>[0] & {}>} */ (new Set());
/** @type {ReturnType<typeof bringing> | null} the run going now */
let going = null;

/** The one run `bringFilms` shares, telling everyone who listens. */
async function bringing() {
	/** @type {(f: Film, line: string, at?: import('./importer.js').Progress) => void} */
	const tell = (...a) => listening.forEach((l) => l.tell?.(...a));
	/** @type {(f: Film, failed: { hash: string, error: string }[], missing?: string) => Promise<void>} */
	const arrived = async (...a) => {
		for (const l of [...listening]) await l.arrived?.(...a);
	};
	const call = await device();
	if (!call) return [];
	let world = await worldOf(call);
	const city = cityOf(world);
	if (!city) return [];
	const wanted = FILMS.filter((f) => !heldOf(world, city.vault, f).cut);
	// a film that came before the world proxies did: its world shots' proxies from the legacy vault now
	if (FILMS.some((f) => heldOf(world, city.vault, f).cut)) {
		const { bringProxies } = await import('./importer.js');
		await bringProxies(city.vault, city.as).catch((e) => console.warn('world proxies:', e));
	}
	if (!wanted.length) return [];
	// each shows in the aside at once, while the old studio is asked for them
	for (const f of wanted) tell(f, 'Asking the old studio…');
	const { listTimelines } = await import('$lib/auth/client');
	const { importTimeline, legacyCall } = await import('./importer.js');
	const legacy = /** @type {any[]} */ (await legacyCall(listTimelines()));
	const brought = [];
	for (const f of wanted) {
		const t = legacyOf(f, legacy);
		if (!t) {
			await arrived(f, [], `no timeline "${f.timeline}" of "${f.project}" in the old studio`);
			continue;
		}
		tell(f, 'Starting…');
		world = await worldOf(call);
		let story = heldOf(world, city.vault, f).story?.entry;
		if (!story) {
			const value = { kind: 'story', title: f.name, text: '', description: t.description ?? '', series: 'Films', sparks: [], tags: [] };
			story = answer(await call('run', { op: 'create', vault: city.vault, type: 'story', tags: [MOVIE, filmTag(f)], value, as: city.as })).entry;
		}
		const cut = await importTimeline(t.id, (line, at) => tell(f, line, at), { ...city, name: f.name, project: f.name, story: { vault: city.vault, entry: /** @type {string} */ (story) }, tags: [filmTag(f)] });
		const failed = cut.failed ?? [];
		await arrived(f, failed);
		brought.push({ film: f, failed });
	}
	return brought;
}
