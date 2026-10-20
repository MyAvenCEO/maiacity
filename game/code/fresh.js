// @ts-nocheck — plain JS, kept loose on purpose
/**
 * THE FRESHNESS FRONTIER — a device never takes code for an entry older than the newest version of that entry it has
 * already proven. Maia City's signatures (H2, ./sources/feed.js `provenRows`) prove who wrote a version, not that it is
 * the newest: whoever serves the code, avenDB's server or the network between, may leave an entry's newest writes out
 * and hand out an older version, every write of it validly signed (a rollback, or a freeze at one version).
 *
 * What tells them apart is avenDB's own count of a version (`version` on each row, avendb's `world::public_row`):
 * which release of the entry's main line it is and how many edits since (`version`, `edits`, as "v3 + 2 edits"), and
 * how many writes it holds, its heads and every write before them (`writes`). A version that comes after another holds
 * every write that one holds and more, so its count of writes is higher; a server that leaves writes out can only hand
 * out fewer, never more, since it can't sign any (T10l of avenDB's Lean spec, avendb/spec/AvenDB/Writes.lean:
 * `T10_writes_grow`, `T10_writes_left_out`). So per vault and entry this device keeps the newest version it
 * proved (`KEPT_NEWEST`: the page's storage, else memory alone, as the API has none), and a row whose version holds
 * fewer writes than that one is refused, naming the entry and both versions (`fresh`), never loaded in silence.
 *
 * Only what was proven is kept: a row the device read off its own avenDB, which checked every edit as it took it, or
 * one a proof proved. A row the server lists on its word alone (./sources/feed.js `listedRows`) is held to what was
 * kept, but never kept, since a count it made up would refuse every true version after it.
 *
 * This holds for "the current version" of an entry alone (a code path, an asset named without its version). A pin
 * by heads (./ref.js) names one exact version whatever is newer, and a world pinned to an old version on purpose loads
 * that version: its reader never asks this module.
 *
 * What it can't tell: two versions made apart, neither after the other, may hold as many writes, and both are taken;
 * a row without a count (a server or device older than the count) is taken as before; and a device whose storage was
 * cleared starts again from the first version it proves.
 */

/** what the page's storage holds under `name`, as JSON; undefined where it holds nothing or there is none */
function stored(name) {
	try {
		return JSON.parse(globalThis.localStorage?.getItem(name) ?? 'null') ?? undefined;
	} catch {
		return undefined;
	}
}

/** `value` kept in the page's storage under `name`, as JSON; nothing where it is full, or there is none */
function store(name, value) {
	try {
		globalThis.localStorage?.setItem(name, JSON.stringify(value));
	} catch {
		// memory alone, then
	}
}

/**
 * A keeper of the newest version proved of each entry, by `<vault>/<entry>`: in memory, and in the page's storage
 * where there is one (`storage` false: memory alone, as a test's).
 * @param {{ storage?: boolean }} [o]
 */
export function newestKeeper({ storage = true } = {}) {
	const memory = new Map();
	return {
		/** @param {string} key */
		get(key) {
			if (!memory.has(key) && storage) {
				const kept = stored(`avendb-newest:${key}`);
				if (kept) memory.set(key, kept);
			}
			return memory.get(key);
		},
		/** @param {string} key */
		put(key, value) {
			memory.set(key, value);
			if (storage) store(`avendb-newest:${key}`, value);
		}
	};
}

/** the newest version this device proved of each entry it ran code of: the page's storage, else memory */
export const KEPT_NEWEST = newestKeeper();

/**
 * The version a row is, as avenDB counts it (`version` on the row): `{ heads, writes, version, edits }`, `writes`
 * null where the row says none.
 * @param {any} row
 */
export function versionOf(row) {
	const v = row?.version && typeof row.version === 'object' ? row.version : {};
	const heads = (Array.isArray(row?.heads) ? row.heads : []).map(String).sort();
	return {
		heads,
		writes: Number.isInteger(v.writes) && v.writes >= 0 ? v.writes : null,
		version: Number.isInteger(v.version) ? v.version : null,
		edits: Number.isInteger(v.edits) ? v.edits : 0
	};
}

/** a version in words, as avenDB names one, with its writes and its first head: "v3 + 2 edits, 14 writes, at 1a2b3c4d…" */
export function versionWords(v) {
	const release = v.version == null ? 'draft' : `v${v.version}`;
	const edits = v.edits ? ` + ${v.edits} edit${v.edits === 1 ? '' : 's'}` : '';
	const writes = v.writes == null ? '' : `, ${v.writes} write${v.writes === 1 ? '' : 's'}`;
	return `${release}${edits}${writes}, at ${String(v.heads[0] ?? '?').slice(0, 8)}…`;
}

/** whether version `v` is older than `kept`: it holds fewer writes. Without both counts no reader can say, so not. */
export const isOlder = (v, kept) => kept != null && v.writes != null && kept.writes != null && v.writes < kept.writes;

/** the ref a code row names itself by (`ref:views/…`), or the empty string */
const refOf = (row) => (Array.isArray(row?.tags) ? row.tags : []).find((t) => typeof t === 'string' && t.startsWith('ref:'))?.slice(4) ?? '';

/**
 * Rows a source handed out, held to the newest version this device proved of each entry: `{ rows, stale }`, `rows`
 * those not older, `stale` each older one as `{ row, error }`, the error naming the entry and both versions. With
 * `proven` (rows read off this device's avenDB, or proved), each row newer than what was kept is kept as the entry's
 * newest; without it (a listing on the server's word) nothing is. `keep` where they are kept (`KEPT_NEWEST`).
 * @param {any[]} rows @param {{ proven?: boolean, keep?: { get: (key: string) => any, put: (key: string, value: any) => void } }} [o]
 * @returns {{ rows: any[], stale: { row: any, error: string }[] }}
 */
export function fresh(rows, { proven = false, keep = KEPT_NEWEST } = {}) {
	const out = { rows: [], stale: [] };
	for (const row of Array.isArray(rows) ? rows : []) {
		const key = `${row?.vault}/${row?.entry}`;
		const v = versionOf(row);
		const kept = keep.get(key);
		if (isOlder(v, kept)) {
			const ref = refOf(row);
			const named = `${ref ? `${ref} (entry ${String(row?.entry).slice(0, 8)}…)` : `entry ${String(row?.entry).slice(0, 8)}…`} of vault ${String(row?.vault).slice(0, 8)}…`;
			out.stale.push({
				row,
				error: `${named}: refused, the version handed out (${versionWords(v)}) is older than the newest this device already proved (${versionWords(kept)}); whoever served it may be holding the newer one back`
			});
			continue;
		}
		out.rows.push(row);
		// the newest proven is kept; one as old, or made apart with as many writes, leaves it as it is
		if (proven && v.writes != null && (kept?.writes == null || v.writes > kept.writes)) keep.put(key, v);
	}
	return out;
}
