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
 * call to the legacy API. A film frozen (into the repo, or the Mac's film seed ~/maiaCITY-seed/films, ./frozen.js) comes
 * from there alone (Samuel 2026-10-18 13:29: both must come back after the old studio is gone); the old studio is
 * asked only for one not frozen yet. The legacy timelines and Postgres stay as they are until J15.
 *
 * The same run brings MaiaCity V1's two first-run intros (./intros.js): a story, a script and a cut of world shots
 * each, made from the game itself rather than the old studio, after the films (and whether or not any film is wanted).
 */

import { answer, DELETED } from '$lib/avendb/ops.js';
import { CUT, device, worldOf } from './cuts.js';
import { FILMS, legacyOf } from './filmlist.js';

export { FILMS, legacyOf } from './filmlist.js';
/** @typedef {import('./filmlist.js').Film} Film */

/** The story flow's Movie stage, as $lib/avendb/flows.js `stageTag('story', 'movie')` names it. */
const MOVIE = 'story:movie';

/** The tag film `f`'s story and cut carry. @param {Film} f */
export const filmTag = (f) => `film:${f.key}`;

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
 * A file copy that came in without its type (before #969: Day 1's camera files as nameless `.bin`), which no player
 * opens and no rule takes. @param {import('../avendb/vaults.js').EntryView} e
 */
export const untyped = (e) => {
	const media = /** @type {any} */ (e).media ?? /** @type {any} */ (e.record)?.media ?? '';
	return !media || media === 'application/octet-stream';
};

/**
 * Each film the Maia City vault holds with untyped copies of its files (`untyped`), brought again (Samuel
 * 2026-10-18, "Replace films"): its cut and those copies tagged deleted, so the run imports it once more with its
 * files named and typed; its story stays, and so does every typed file (found again by its `legacy:` tag). And the
 * world-proxy tasks still waiting there, which ran a second world beside the live one (#969). Whether it changed
 * anything.
 * @param {(c: string, ...a: any[]) => Promise<any>} call @param {import('../avendb/vaults.js').WorldView} world
 * @param {{ vault: string, as: string }} city @param {Map<string, import('./frozen.js').Frozen | null>} frozenOf
 */
async function repairFilms(call, world, city, frozenOf) {
	const live = (/** @type {any} */ e) => e.vault === city.vault && !e.deleted && !(e.tags ?? []).includes(DELETED);
	const drop = (/** @type {string} */ entry) => call('run', { op: 'insert', entry, path: ['tags'], value: DELETED, as: city.as }).catch((e) => console.warn('films: could not set aside', entry, e));
	let changed = false;
	const { tasksOf } = await import('./jobs/tasks.js');
	for (const t of tasksOf(world).filter((t) => t.vault === city.vault && t.rule === 'world-proxy' && t.status === 'queued')) {
		await drop(t.entry);
		changed = true;
	}
	for (const f of FILMS) {
		const cut = heldOf(world, city.vault, f).cut;
		const marks = new Set((frozenOf.get(f.key)?.files ?? []).map((h) => `legacy:${h}`));
		if (!cut || !marks.size) continue;
		const copies = world.entries.filter((e) => live(e) && e.type === 'file' && untyped(e) && (e.tags ?? []).some((t) => marks.has(t)));
		if (!copies.length) continue;
		console.warn(`films: ${f.name} holds ${copies.length} untyped copies: brought again`);
		for (const e of copies) await drop(e.entry);
		await drop(cut.entry);
		changed = true;
	}
	return changed;
}

/** What the run brings, as its callers name it: a film, or an intro (./intros.js). @typedef {{ key: string, name: string }} Brought */

/**
 * Every film the Maia City vault lacks, brought into it one after another: `tell` hearing how far each is (its story
 * made first, so the studio shows it as it comes), `arrived` each as its cut is made, with the files that could not
 * come (./importer.js), or why it can't be (`missing`: the old studio has no such timeline). The films brought, each with those. Nothing where this isn't the Mac app with avenDB open, or
 * the Maia City vault isn't reached here.
 * Then every intro of MaiaCity V1 it lacks (./intros.js), heard the same way.
 * @param {{ tell?: (f: Brought, line: string, at?: import('./importer.js').Progress) => void,
 *   arrived?: (f: Brought, failed: { hash: string, error: string }[], missing?: string) => void | Promise<void> }} [on]
 * @returns {Promise<{ film: Brought, failed: { hash: string, error: string }[] }[]>}
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
	/** @type {(f: Brought, line: string, at?: import('./importer.js').Progress) => void} */
	const tell = (...a) => listening.forEach((l) => l.tell?.(...a));
	/** @type {(f: Brought, failed: { hash: string, error: string }[], missing?: string) => Promise<void>} */
	const arrived = async (...a) => {
		for (const l of [...listening]) await l.arrived?.(...a);
	};
	const call = await device();
	if (!call) return [];
	let world = await worldOf(call);
	const city = cityOf(world);
	if (!city) return [];
	const { frozenFilm } = await import('./frozen.js');
	// the repo's frozen copy first, with the Mac's film seed (./frozen.js), the old studio only for one it lacks
	const frozenOf = new Map(await Promise.all(FILMS.map(async (f) => /** @type {const} */ ([f.key, await frozenFilm(f)]))));
	if (await repairFilms(call, world, city, frozenOf)) world = await worldOf(call);
	const wanted = FILMS.filter((f) => !heldOf(world, city.vault, f).cut);
	// a film that came before its world proxies did: the proxies of its shots whose world is gone, from the film seed now
	if (FILMS.some((f) => heldOf(world, city.vault, f).cut)) {
		const { bringProxies } = await import('./importer.js');
		const frozen = /** @type {import('./frozen.js').Frozen[]} */ ([...frozenOf.values()].filter(Boolean));
		await bringProxies(city.vault, city.as, frozen).catch((e) => console.warn('world proxies:', e));
	}
	// MaiaCity V1's intros, after the films: made here, from the game, with no call to the old studio
	const intros = async () => (await import('./intros.js')).bringIntros(call, city, { tell, arrived });
	if (!wanted.length) return intros();
	// each shows in the aside at once
	for (const f of wanted) tell(f, frozenOf.get(f.key) ? 'Starting…' : 'Asking the old studio…');
	const { listTimelines } = await import('$lib/auth/client');
	const { importTimeline, legacyCall } = await import('./importer.js');
	const legacy = wanted.every((f) => frozenOf.get(f.key)) ? [] : /** @type {any[]} */ (await legacyCall(listTimelines()));
	const brought = [];
	for (const f of wanted) {
		const frozen = frozenOf.get(f.key);
		const t = frozen ? { id: frozen.timeline.id, description: frozen.story.description } : legacyOf(f, legacy);
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
		const cut = await importTimeline(t.id, (line, at) => tell(f, line, at), { ...city, name: f.name, project: f.name, story: { vault: city.vault, entry: /** @type {string} */ (story) }, tags: [filmTag(f)], ...(frozen ? { frozen } : {}) });
		const failed = cut.failed ?? [];
		await arrived(f, failed);
		brought.push({ film: f, failed });
	}
	return [...brought, ...(await intros())];
}
