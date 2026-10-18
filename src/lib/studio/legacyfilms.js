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
 * Each film's published files come along from the film seed too (`bringPublished`): the film as it went out, as a
 * draft film post of its story, and the stills its post used.
 *
 * The same run brings MaiaCity V1's two first-run intros (./intros.js): a story, a script and a cut of world shots
 * each, made from the game itself rather than the old studio, after the films (and whether or not any film is wanted).
 */

import { answer } from '$lib/avendb/ops.js';
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
	const wanted = FILMS.filter((f) => !heldOf(world, city.vault, f).cut);
	const { frozenFilm } = await import('./frozen.js');
	// the repo's frozen copy first, with the Mac's film seed (./frozen.js), the old studio only for one it lacks
	const frozenOf = new Map(await Promise.all(FILMS.map(async (f) => /** @type {const} */ ([f.key, await frozenFilm(f)]))));
	// a film that came before its world proxies did: the proxies of its shots whose world is gone, from the film seed now
	if (FILMS.some((f) => heldOf(world, city.vault, f).cut)) {
		const { bringProxies } = await import('./importer.js');
		const frozen = /** @type {import('./frozen.js').Frozen[]} */ ([...frozenOf.values()].filter(Boolean));
		await bringProxies(city.vault, city.as, frozen).catch((e) => console.warn('world proxies:', e));
	}
	// MaiaCity V1's intros, after the films: made here, from the game, with no call to the old studio
	const intros = async () => (await import('./intros.js')).bringIntros(call, city, { tell, arrived });
	const published = () => bringPublished(call, city, frozenOf).catch((e) => console.warn('published films:', e));
	if (!wanted.length) return (await published(), intros());
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
	await published();
	return [...brought, ...(await intros())];
}

/** A film's shape, from its width and height where its record says them. @param {Record<string, any> | undefined} m */
const shapeOf = (m) => {
	const r = Number(m?.width) / Number(m?.height);
	return !Number.isFinite(r) || r > 1.2 ? '16:9' : r < 0.8 ? '9:16' : '1:1';
};

/**
 * Each film's published files (the film as it went out, its stills: ./filmlist.js `Published`), from the Mac's film
 * seed into the Maia City vault beside its story, each copied and checked by its hash as `studio_import` brings every
 * file: a film tagged `media:delivery`, a still `media:published`, both with the film's tag; the biggest film a film
 * post of the story ($lib/avendb/posttypes.js), its `media` that file, as a draft. One already there is found, not
 * brought or posted again.
 * @param {(c: string, ...a: any[]) => Promise<any>} call @param {{ vault: string, as: string }} city
 * @param {Map<string, import('./frozen.js').Frozen | null>} frozenOf
 */
async function bringPublished(call, city, frozenOf) {
	const { command } = await import('$lib/native');
	const { postTag } = await import('../avendb/posttypes.js');
	const { postsOfFilm } = await import('./films.js');
	for (const f of FILMS) {
		const list = frozenOf.get(f.key)?.published ?? [];
		const world = await worldOf(call);
		const story = heldOf(world, city.vault, f).story;
		if (!list.length || !story) continue;
		const isFilm = (/** @type {import('./filmlist.js').Published} */ p) => /^video\//.test(p.record?.mime ?? '');
		const master = list.filter(isFilm).sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0))[0];
		/** whether file `p` is in the vault already, as `studio_import` marks what it brought */
		const there = (/** @type {import('./filmlist.js').Published} */ p) => world.entries.some((e) => e.vault === city.vault && !e.deleted && (e.tags ?? []).includes(`legacy:${p.hash.toLowerCase()}`) && (e.tags ?? []).includes(filmTag(f)));
		for (const p of list) {
			if (p !== master && there(p)) continue;
			const tags = [isFilm(p) ? 'media:delivery' : 'media:published', filmTag(f)];
			const [b] = /** @type {{ entry: string | null, error: string | null }[]} */ (await command('studio_import', { vault: city.vault, hashes: [p.hash], actor: city.as, tags }).catch((e) => [{ entry: null, error: String(e?.message ?? e) }]));
			if (!b?.entry) {
				console.warn(`${f.name}, published ${p.record?.title || p.hash.slice(0, 12)}:`, b?.error);
				continue;
			}
			if (p !== master || postsOfFilm(await worldOf(call), b.entry).length) continue;
			const seconds = Number(p.record?.meta?.duration_s ?? p.record?.meta?.duration);
			const value = {
				kind: postTag('film'),
				title: story.title || f.name,
				text: '',
				story: { vault: city.vault, entry: story.entry },
				channel: 'Film',
				media: { vault: city.vault, entry: b.entry },
				shape: shapeOf(p.record?.meta),
				...(Number.isFinite(seconds) && seconds > 0 ? { seconds } : {}),
				tags: []
			};
			answer(await call('run', { op: 'create', vault: city.vault, type: 'post', tags: [postTag('film'), filmTag(f)], value, as: city.as }));
		}
	}
}
