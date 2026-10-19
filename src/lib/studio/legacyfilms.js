/*
 * The two films that come over from the legacy studio (Samuel 2026-10-18), and nothing else of it: each legacy
 * timeline copied into the Maia City COOP vault as a cut by ./importer.js, with exactly the footage it plays, under its
 * new name, and a story of its own there that the cut belongs to (its `story` link, so the story's Movie tab lists it,
 * its renders go out as its film posts). Never into a person's own vault.
 *
 * They are part of Maia City's seed (Samuel 2026-10-18): the account page brings them in the background right after
 * the repo seed, on the Mac, as it writes the rest ($lib/avendb/Account.svelte), and the studio brings them too
 * whenever it opens there and the Maia City vault lacks one (`bringFilms`), one run for both, so after a reset of
 * avenDB they come back by themselves; a film already there (its story and its cut carry the film's tag) is left as
 * it is. A film comes from its frozen copy alone (into the repo, or the Mac's film seed ~/maiaCITY-seed/films,
 * ./frozen.js; Samuel 2026-10-18 13:29: both must come back after the old studio is gone); the old studio's API is
 * never asked. The legacy timelines and Postgres stay as they are until J15.
 *
 * The repo's frozen copy is the films' seed, so a shot changed there comes to a film already brought too
 * (`retunedOf`): as the shot's next version, the cut playing it, unless the shot was tuned in the studio since.
 *
 * The same run brings MaiaCity V1's two first-run intros (./intros.js): a story, a script and a cut of world shots
 * each, made from the game itself rather than the old studio, after the films (and whether or not any film is wanted).
 */

import { answer } from '$lib/avendb/ops.js';
import { sameSpec } from '../../../game/film/shot.js';
import { saveAvenShot, versionEntry } from './avenshots.js';
import { CUT, device, getCut, saveCut, worldOf } from './cuts.js';
import { FILMS } from './filmlist.js';

export { FILMS } from './filmlist.js';
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
 * The world shots of cut `cut` (a film brought from `frozen`) that the repo's frozen copy has changed since: each clip's
 * shot at the version brought from it (its `legacy` key), whose spec the frozen one no longer is, by `<shot>@<version>`
 * with the spec it takes now (Samuel 2026-10-19: the first village's dawn lighter). One tuned in the studio since (a
 * newer version than that, not the frozen spec) is left as it is; one whose newest version is already the frozen
 * spec (made by a run that stopped before the cut was saved) is played at that version (`at`).
 * @param {import('../avendb/vaults.js').WorldView} world @param {{ clips?: any[] }} cut @param {import('./frozen.js').Frozen} frozen
 * @returns {Map<string, { shot: string, spec: any, at?: number }>}
 */
export function retunedOf(world, cut, frozen) {
	/** @type {Map<string, { shot: string, spec: any, at?: number }>} */
	const out = new Map();
	const specIn = (/** @type {any} */ e) => {
		try {
			return JSON.parse(e?.record?.spec);
		} catch {
			return null;
		}
	};
	for (const c of cut.clips ?? []) {
		if (c.kind !== 'world' || typeof c.shot !== 'string' || !c.shot.startsWith('shot:')) continue;
		const k = `${c.shot}@${c.shotVersion}`;
		const v = versionEntry(world, c.shot, c.shotVersion);
		const was = v?.record?.legacy ? frozen.shots[v.record.legacy] : null;
		if (out.has(k) || !v || !was) continue;
		const held = specIn(v);
		if (held && sameSpec(held, was.spec)) continue;
		const newest = versionEntry(world, c.shot);
		if (newest === v) out.set(k, { shot: c.shot, spec: was.spec });
		else if (newest && sameSpec(specIn(newest) ?? {}, was.spec)) out.set(k, { shot: c.shot, spec: was.spec, at: newest.record?.version });
	}
	return out;
}

/**
 * Film `f`'s cut in vault `city.vault` brought up to its frozen copy (`retunedOf`): each changed shot saved as its next
 * version (./avenshots.js), and the cut playing those. How many shots it changed.
 * @param {(c: string, ...a: any[]) => Promise<any>} call @param {{ vault: string, as: string }} city
 * @param {Film} f @param {import('./frozen.js').Frozen} frozen
 */
async function retune(call, city, f, frozen) {
	const held = heldOf(await worldOf(call), city.vault, f).cut;
	if (!held) return 0;
	const cut = await getCut(`cut:${held.entry}`);
	const changed = retunedOf(await worldOf(call), cut, frozen);
	if (!changed.size) return 0;
	/** @type {Map<string, number>} */
	const to = new Map();
	for (const [k, s] of changed) to.set(k, s.at ?? (await saveAvenShot(s.shot, { spec: s.spec })).version);
	const clips = cut.clips.map((c) => {
		const v = to.get(`${c.shot}@${c.shotVersion}`);
		return v ? { ...c, shotVersion: v } : c;
	});
	await saveCut(cut.id, { clips, if_updated: cut.updated });
	return to.size;
}

/** What the run brings, as its callers name it: a film, or an intro (./intros.js). @typedef {{ key: string, name: string }} Brought */

/**
 * Every film the Maia City vault lacks, brought into it one after another: `tell` hearing how far each is (its story
 * made first, so the studio shows it as it comes), `arrived` each as its cut is made, with the files that could not
 * come (./importer.js). The films brought, each with those. Nothing where this isn't the Mac app with avenDB open, or
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
	// the repo's frozen copy first, with the Mac's film seed (./frozen.js)
	const frozenOf = new Map(await Promise.all(FILMS.map(async (f) => /** @type {const} */ ([f.key, await frozenFilm(f)]))));
	// a film frozen in neither is simply not offered
	const wanted = FILMS.filter((f) => frozenOf.get(f.key) && !heldOf(world, city.vault, f).cut);
	// a film that came before its proxies did: its footage's (the old studio's HD proxies) and those of its shots whose
	// world is gone, from the film seed now
	if (FILMS.some((f) => heldOf(world, city.vault, f).cut)) {
		const { bringFootageProxies, bringProxies } = await import('./importer.js');
		const frozen = /** @type {import('./frozen.js').Frozen[]} */ ([...frozenOf.values()].filter(Boolean));
		await bringFootageProxies(city.vault, city.as, frozen).catch((e) => console.warn('footage proxies:', e));
		await bringProxies(city.vault, city.as, frozen).catch((e) => console.warn('world proxies:', e));
		// and its shots the repo's copy has changed since, brought as their next versions
		for (const f of FILMS) {
			const fz = frozenOf.get(f.key);
			if (fz && heldOf(world, city.vault, f).cut) await retune(call, city, f, fz).catch((e) => console.warn(`${f.name}: its shots from the repo:`, e));
		}
	}
	// MaiaCity V1's intros, after the films: made here, from the game, with no call to the old studio
	const intros = async () => (await import('./intros.js')).bringIntros(call, city, { tell, arrived });
	if (!wanted.length) return intros();
	// each shows in the aside at once
	for (const f of wanted) tell(f, 'Starting…');
	const { importTimeline } = await import('./importer.js');
	const brought = [];
	for (const f of wanted) {
		const frozen = /** @type {import('./frozen.js').Frozen} */ (frozenOf.get(f.key));
		tell(f, 'Starting…');
		world = await worldOf(call);
		let story = heldOf(world, city.vault, f).story?.entry;
		if (!story) {
			const value = { kind: 'story', title: f.name, text: '', description: frozen.story.description ?? '', series: 'Films', sparks: [], tags: [] };
			story = answer(await call('run', { op: 'create', vault: city.vault, type: 'story', tags: [MOVIE, filmTag(f)], value, as: city.as })).entry;
		}
		const cut = await importTimeline(frozen.timeline.id, (line, at) => tell(f, line, at), { ...city, name: f.name, project: f.name, story: { vault: city.vault, entry: /** @type {string} */ (story) }, tags: [filmTag(f)], frozen });
		const failed = cut.failed ?? [];
		await arrived(f, failed);
		brought.push({ film: f, failed });
	}
	return [...brought, ...(await intros())];
}
