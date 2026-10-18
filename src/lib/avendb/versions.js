/*
 * Versions in words, read off an entry's history alone (avenDB's `History::releases` and `describe`): each merge into
 * a line is its next version, "v3", and a version between them reads as "v3 + 2 edits". A pin stores only the entry
 * and the heads of the version it names; the page labels it with what the `pin` op reads there: the title at that
 * version, its number, the line's name where it isn't main, and the entry's short id. No slug or app id is ever part
 * of it.
 */
import { count } from './vaults.js';

/** @typedef {{ version: number | null, edits: number }} Described */
/** @typedef {{ entry: string, at: string[], line: string | null, name: string | null, version: Described,
 *   title: string | null, short: string }} Pin */

/** A version in words: "v3", "v3 + 2 edits", or for a line with no release yet (a draft) its edits alone.
 *  @param {Described | null | undefined} d */
export function versionWords(d) {
	if (!d) return '';
	if (d.version == null) return d.edits ? `draft, ${count(d.edits, 'edit')}` : 'draft';
	return d.edits ? `v${d.version} + ${count(d.edits, 'edit')}` : `v${d.version}`;
}

/** A pin's label, all of it avenDB's: "Crawler excavator v4 · 01627d33…", a variant's name after the number.
 *  @param {Pin} pin */
export function pinLabel(pin) {
	const title = pin.title || 'Untitled';
	const line = pin.line !== null && pin.name ? ` · ${pin.name}` : '';
	return `${title} ${versionWords(pin.version)}${line} · ${pin.short}…`;
}
