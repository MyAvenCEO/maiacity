/*
 * The legacy films as the repo keeps them (films/legacy/<key>.json, written once by scripts/freeze-films.mjs): the
 * timeline as the old studio had it, its world shots' specs by `<shot>@<version>`, and the media vault files it plays,
 * by their BLAKE3 hash. ./legacyfilms.js brings a film from here when the repo has it, so neither an avenDB reset nor
 * the old studio's going loses it: the footage and the voice come from the media vault, which stays.
 */

import { badFrozen } from './filmlist.js';

/** @typedef {import('./filmlist.js').Frozen} Frozen */

/** Every frozen film in the repo, by its key. */
const ALL = /** @type {Record<string, { default: Frozen }>} */ (import.meta.glob('/films/legacy/*.json', { eager: true }));

/** Film `key` as the repo keeps it, or `null`. @param {string} key @returns {Frozen | null} */
export function frozenFilm(key) {
	const f = Object.values(ALL).map((m) => m.default).find((x) => x?.key === key) ?? null;
	return f && !badFrozen(f) ? f : null;
}
