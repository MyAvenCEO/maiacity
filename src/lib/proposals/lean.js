// @ts-nocheck — plain JS, kept loose on purpose, as the other logic of ours is ($lib/avendb/functions.js)
// Real Lean on an AIP's objective (avendb/docs/ARCHITECTURE.md §8, "AIPs", N3): in theOS on a Mac, whoever accepts an
// AIP checks its objective with the Lean release the spec pins, on their own Mac (avendb-device's `lean`: the archive's
// SHA-256 pinned, Lean run in a sandbox with no network, no files of theirs and nothing it may start, and only on a file
// avenDB's own engine reads). Lean comes only when they ask, behind a button that names its sizes (`leanGet`), and only
// from avenDB: Maia City keeps its archive as a code package (src/lib/code/packages.json, the Code app). What it
// found the device records on the AIP as their reading `lean:<key>`, 1 where Lean accepted the file and 0 where it
// didn't, the Lean and its first error in the note (`verdictOf`), written as the vault, never the AIP's author; every
// reader then sees the AIP's Lean verdict (the `aip` read's `objective.verdict`, avendb/spec/AvenDB/Measurers.lean
// `leanVerdict`). Browsers have no Lean: they read the verdict, and grade the metrics with avenDB's engine as before.

/** The name of Lean's verdict on the objective keyed `key`, as avenDB's engine reads it. @param {string} key */
export const verdictName = (key) => `lean:${key}`;

/** Bytes in megabytes, as a person reads a download. @param {number} bytes */
export const mb = (bytes) => `${Math.round(bytes / 1e6).toLocaleString('en')} MB`;

/**
 * What Lean found on an objective (`leanCheck`'s answer: `{ok, key, engine, error}`) as the write that records it on AIP
 * `entry`, written as `as`.
 * @param {string} entry
 * @param {{ ok: boolean, key: string, engine: string, error?: { line: number, column: number, message: string } | null }} found
 * @param {string} as
 */
export function verdictOf(entry, found, as) {
	const where = found.error ? `: ${found.error.line}:${found.error.column} ${found.error.message}` : '';
	return { op: 'aip_measure', entry, name: verdictName(found.key), value: found.ok ? 1 : 0, note: `${found.engine}${where}`, as };
}

/**
 * Whether `me` has yet to check objective `o` with Lean: it reads, and the verdict on it now isn't theirs.
 * @param {{ error?: string, verdict?: { by: string } | null } | null} o @param {string} me
 */
export const leanDue = (o, me) => !!o && !o.error && o.verdict?.by !== me;

/**
 * The line a person reads on Lean's verdict: whether Lean accepted the objective, and where it failed.
 * @param {{ ok: boolean, note: string | null }} v
 */
export function verdictLine(v) {
	if (v.ok) return 'Lean accepts it';
	const where = v.note?.split(': ').slice(1).join(': ');
	return where ? `Lean rejects it at ${where}` : 'Lean rejects it';
}
