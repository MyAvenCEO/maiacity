// @ts-nocheck — plain JS, kept loose on purpose
/**
 * THE ONE ENTRY REF — how anything we load names one avenDB entry at one version, read here alone, so a code entry's
 * ref (./index.js `codeAt`) and an asset's pin ($lib/assets/sources/avendb.js `parsePin`) can never be read two ways:
 *
 *   vault:<vault>/<entry>@<head>[,<head>…][?its=values]
 *
 * The vault, the entry and every head are avenDB ids, 32 bytes as 64 hex digits, never anything looser; a version is
 * at most 16 heads, and one version is one string (its heads sorted, `entryRef`). What follows `?` is left as text
 * for whoever reads it: a code entry takes none, an asset its parameters.
 */

/** an avenDB id: 32 bytes, as 64 lower-case hex digits */
export const ID = /^[0-9a-f]{64}$/;

/** the most heads a version may name */
export const MAX_HEADS = 16;

/** an entry ref as a string */
export const ENTRY_REF = /^vault:([0-9a-f]{64})\/([0-9a-f]{64})@([0-9a-f]{64}(?:,[0-9a-f]{64}){0,15})(?:\?([^#\s]*))?$/;

/** how long an entry ref may be, its heads and values with it */
export const MAX_REF = 2048;

/**
 * An entry ref as its parts, `{ vault, entry, heads, query? }` (`heads` sorted, `query` the text after `?`), from its
 * string (`ENTRY_REF`) or as data keeps it (`{ entry, at | heads, vault?, query? }`, `vault` then null when not named);
 * null for anything else.
 * @param {unknown} ref
 * @returns {{ vault: string | null, entry: string, heads: string[], query?: string } | null}
 */
export function parseEntryRef(ref) {
	if (ref && typeof ref === 'object') {
		const { entry, vault, query } = /** @type {any} */ (ref);
		const heads = /** @type {any} */ (ref).heads ?? /** @type {any} */ (ref).at;
		if (!ID.test(String(entry)) || !Array.isArray(heads) || !heads.length || heads.length > MAX_HEADS || !heads.every((h) => ID.test(String(h)))) return null;
		if (vault != null && !ID.test(String(vault))) return null;
		return { vault: vault ?? null, entry, heads: [...heads].sort(), ...(typeof query === 'string' && query ? { query } : {}) };
	}
	const m = typeof ref === 'string' && ref.length <= MAX_REF ? ENTRY_REF.exec(ref) : null;
	if (!m) return null;
	return { vault: m[1], entry: m[2], heads: m[3].split(',').sort(), ...(m[4] ? { query: m[4] } : {}) };
}

/**
 * An entry ref written as a string, its heads sorted, so one version is one string.
 * @param {{ vault: string, entry: string, heads?: string[], at?: string[] }} ref @param {string} [query]
 */
export const entryRef = ({ vault, entry, heads, at }, query = '') => `vault:${vault}/${entry}@${[...(heads ?? at)].sort().join(',')}${query ? `?${query}` : ''}`;
