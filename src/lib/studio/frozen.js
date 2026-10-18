/*
 * The legacy films frozen: the timeline as the old studio had it, its world shots' specs by `<shot>@<version>`, and
 * the files it plays, by their BLAKE3 hash. Kept in the repo (films/legacy/<key>.json, scripts/freeze-films.mjs) or,
 * as now, in the film seed on the Mac (~/maiaCITY-seed/films/<key>/, the app's `film_seed`, with the files' bytes
 * beside it, which `studio_import` reads first). ./legacyfilms.js brings a film from here when it is frozen, so
 * neither an avenDB reset nor the old studio's going loses it.
 */

import { badFrozen, filesIn } from './filmlist.js';

/** @typedef {import('./filmlist.js').Frozen} Frozen */

/** Every frozen film in the repo, by its key. */
const ALL = /** @type {Record<string, { default: Frozen }>} */ (import.meta.glob('/films/legacy/*.json', { eager: true }));

/**
 * Film `film` as this Mac's film seed has it (`{ timeline, shots, proxies }`), `null` off the Mac app or where it isn't.
 * @param {import('./filmlist.js').Film} film
 * @returns {Promise<{ timeline: any, shots: Frozen['shots'], proxies?: Record<string, string> } | null>}
 */
async function seedOf(film) {
	try {
		const { command, native } = await import('$lib/native');
		if (!native()) return null;
		return await command('film_seed', { key: film.key });
	} catch (e) {
		console.warn(`the film seed of ${film.name}:`, e);
		return null;
	}
}

/**
 * Film `key` frozen: as the repo keeps it, else as this Mac's film seed does, with the seed's world proxies either way
 * (the repo keeps no bytes); `null` where neither has it.
 * @param {import('./filmlist.js').Film} film @returns {Promise<Frozen | null>}
 */
export async function frozenFilm(film) {
	const found = Object.values(ALL).map((m) => m.default).find((x) => x?.key === film.key);
	const inRepo = found && !badFrozen(found) ? found : null;
	const v = await seedOf(film);
	const proxies = { ...(v?.proxies ?? {}), ...(inRepo?.proxies ?? {}) };
	if (inRepo) return { ...inRepo, proxies };
	if (!v) return null;
	const f = { key: film.key, name: film.name, frozen: '', story: { title: film.name, description: v.timeline?.description ?? '' }, timeline: v.timeline, shots: v.shots, files: filesIn(v.timeline), proxies };
	const bad = badFrozen(f);
	if (bad) console.warn(`the film seed of ${film.name}: ${bad}`);
	return bad ? null : f;
}
