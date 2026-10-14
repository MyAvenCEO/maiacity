/*
 * VERSIONS — every asset the explorers show (the plants, the actors, the machines, the things, the buildings, the worlds and sandboxes) carries a
 * version number and its history, so a world can be anchored to the asset as it was when the world was made: Sandbox 5
 * plants `apple@1`, and an apple changed later is `apple@2` in the explorer while Sandbox 5 still grows `apple@1`.
 *
 * Everything began at v1 (5 October 2026). To change an asset: keep its builder as it is now in the history (copy the
 * old function into a `*.v<n>.js` file beside it, frozen, and name it in the asset's `HISTORY` entry with the date and
 * what it was), then change the builder and add the new version to the history — the latest version is the asset's
 * own builder. The explorer lists every version, newest first, and shows any of them; a world asks for the version it
 * was built on (`at`).
 *
 * One way for every group (the things, the machines, the actors, the plants, the biomes, the buildings, the worlds):
 * the same history, the same frozen builders, the same list in every explorer, and one way to name an asset at a
 * version, `group/id@v` (`machines/powercube@3`, `plants/apple@1`), which `$lib/assets` turns back into its builder
 * (`assetAt`). A version whose builder was not kept says so (`kept: false`): it is listed for its note, never shown as
 * something it was not. Every older version of an asset keeps its builder (src/lib/assets/versions.test.js); only a
 * world's older versions are notes alone, since a world is a page.
 */

/** @typedef {{ v: number, date: string, note: string }} Change one version: its number, when, what changed */
/**
 * @template B
 * @typedef {Change & { build: B, kept: boolean }} Version a version and what builds it; `kept`: its own builder (the
 *   latest's, or a frozen one), not the latest's standing in for one that was not kept
 */

/** The first version of everything: what every asset was when versions began. */
export const FIRST = /** @type {Change} */ ({ v: 1, date: '2026-10-05', note: 'First version' });

/**
 * An asset's versions, oldest first: its history, the latest built by `current`. A history lists every version; the
 * ones before the latest bring their own (frozen) builders. With no history the asset is at v1.
 * @template B
 * @param {B} current the asset's builder today
 * @param {(Change & { build?: B })[]} [history]
 * @returns {Version<B>[]}
 */
export function versionsOf(current, history = [FIRST]) {
	const sorted = [...history].sort((a, b) => a.v - b.v);
	return sorted.map((c, i) => {
		const latest = i === sorted.length - 1;
		return { v: c.v, date: c.date, note: c.note, build: latest ? current : /** @type {B} */ (c.build ?? current), kept: latest || c.build !== undefined };
	});
}

/**
 * The version `v` of an asset's versions, or its latest when `v` is not given; undefined when it has no such version.
 * @template B
 * @param {Version<B>[]} versions @param {number} [v]
 */
export const at = (versions, v) => (v === undefined ? versions[versions.length - 1] : versions.find((x) => x.v === v));

/** The latest version number. @param {{ v: number }[]} versions */
export const latestOf = (versions) => versions[versions.length - 1]?.v ?? 1;

/** A version as the explorers write it: v1. @param {number} v */
export const tag = (v) => `v${v}`;

/** A version's date as the explorers write it: 5 Oct 2026. @param {string} date */
export const day = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Every item of a list with its versions: `versions` from its `HISTORY` entry (by id) and its builder (`key`), and
 * `version` its latest number.
 * @template {{ id: string }} T
 * @param {T[]} items @param {keyof T} key @param {Record<string, (Change & { build?: any })[]>} [history]
 * @returns {(T & { versions: Version<any>[], version: number })[]}
 */
export function versioned(items, key, history = {}) {
	return items.map((it) => {
		const versions = versionsOf(it[key], history[it.id]);
		return { ...it, versions, version: latestOf(versions) };
	});
}

/**
 * The version `v` of an asset's versions, or its latest when it has no such version (or `v` is not given).
 * @template B
 * @param {Version<B>[]} versions @param {number} [v]
 * @returns {Version<B>}
 */
export const atOrLatest = (versions, v) => at(versions, v) ?? versions[versions.length - 1];
