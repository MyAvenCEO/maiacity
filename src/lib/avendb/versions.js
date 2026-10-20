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

/** A line of an entry as words name it: `line` null for main, else its first edit's id, and its name.
 *  @typedef {{ line: string | null, name: string | null, variant?: boolean }} Named */

/** A line's name, as a person reads it. @param {{ line: string | null, name: string | null } | null | undefined} l */
export const lineName = (l) => (!l ? 'a line' : l.line === null ? 'main' : (l.name ?? 'a line this browser can’t name'));

/**
 * What an edit did, in avenDB's words, as the history of line `shown` of an entry whose lines are `lines` says it
 * (./Lines.svelte, and a note's banner over the version it shows): "Proposed “Warmer” from “main”", "Merged “Warmer”
 * into main", "Edited on “Silkie”"; the first of all, "Wrote `thing`".
 * @param {{ kind: string, line: string | null, deps: string[], name: string | null,
 *   from: { line: string | null } | null }} e
 * @param {Named[]} lines @param {string | null | undefined} shown @param {string} [thing]
 */
export function editWords(e, lines, shown, thing = 'it') {
	/** @param {string | null} l @returns {Named} */
	const lineOf = (l) => lines.find((x) => x.line === l) ?? { line: l, name: null };
	/** @param {string | null} l */
	const quoted = (l) => `“${lineName(lineOf(l))}”`;
	const elsewhere = e.line !== shown ? ` on ${quoted(e.line)}` : '';
	const from = e.from?.line ?? null;
	switch (e.kind) {
		case 'propose':
			return `Proposed “${e.name ?? '…'}”${e.from ? ` from ${quoted(from)}` : ''}`;
		case 'variant':
			return `Started the variant “${e.name ?? '…'}”${e.from ? ` from ${quoted(from)}` : ''}`;
		case 'merge':
			if (e.line === null) return `Merged ${quoted(from)} into main`;
			if (from === null && lineOf(e.line).variant) return `Brought main into ${quoted(e.line)}`;
			if (from === null) return `Updated ${quoted(e.line)} from main`;
			return `Merged ${quoted(from)} into ${quoted(e.line)}`;
		case 'accept':
			return `Accepted ${quoted(e.line)} as it stood`;
		case 'sealed':
			return `An edit this browser can’t open${elsewhere}`;
		default:
			return e.deps.length ? `Edited${elsewhere}` : `Wrote ${thing}${elsewhere}`;
	}
}
