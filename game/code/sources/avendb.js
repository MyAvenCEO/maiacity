// @ts-nocheck — plain JS, kept loose on purpose
/**
 * avenDB AS A SOURCE OF CODE ENTRIES — written, and switched off (Samuel 2026-10-16: prepare avenDB loading, don't do
 * it yet). A ref `vault:<vault id>/<entry id>@<heads>` names an entry at a version (its heads, as avenDB pins one); the
 * loader (../index.js) reads such refs today and this source refuses them. Turning it on (C10, the Maia City COOP's
 * vault) is the one change: `at` reads the entry with run(op) and its files with read_file, checks them with the one
 * checker, and hands back the same shape the repo source does.
 */
export const AVENDB_REF = /^vault:([A-Za-z0-9_-]{8,128})\/([A-Za-z0-9_-]{8,128})@([0-9a-f]{8,128}(?:,[0-9a-f]{8,128})*)$/;

export const avendb = {
	on: false,
	/** @param {{ vault: string, entry: string, heads: string }} ref */
	at(ref) {
		throw new Error(`code from avenDB (${ref.vault.slice(0, 12)}…/${ref.entry.slice(0, 12)}…) is not switched on yet: until then code comes from the repo (code/)`);
	}
};
