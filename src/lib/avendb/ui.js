/*
 * What the avenDB tile's screens share: ids as a person reads them, times and sizes, a line diff for comparing two
 * versions, safe inline markdown for a block's text, and a document's blocks as either app writes them (v1 names a
 * block by its kind, h1 to code; v2 by its type and level).
 */

/** An id's first four bytes, as a person reads it aloud. @param {string | null | undefined} id */
export const short = (id) => (id ?? '').slice(0, 8);

/** A time by the page's clock, as hours, minutes and seconds. @param {number | null | undefined} ms */
export const when = (ms) =>
	ms ? new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

/** A size in bytes, in words. @param {number | null | undefined} n */
export function size(n) {
	if (!n) return '0 bytes';
	if (n < 1024) return `${n} bytes`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** A value as indented JSON. @param {unknown} v */
export const pretty = (v) => JSON.stringify(v, null, 2) ?? 'null';

/** One, or many, of a thing. @param {number} n @param {string} one @param {string} [many] */
export const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The lines of `b` against those of `a`: each kept, added or taken out, by their longest common run.
 * @param {string} a @param {string} b
 * @returns {{ op: ' ' | '+' | '-', text: string }[]}
 */
export function diffLines(a, b) {
	const x = a.split('\n');
	const y = b.split('\n');
	const n = x.length;
	const m = y.length;
	// lcs[i][j]: the longest common run of x[i..] and y[j..]
	const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--)
		for (let j = m - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
	/** @type {{ op: ' ' | '+' | '-', text: string }[]} */
	const out = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (x[i] === y[j]) {
			out.push({ op: ' ', text: x[i] });
			i++;
			j++;
		} else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ op: '-', text: x[i++] });
		else out.push({ op: '+', text: y[j++] });
	}
	while (i < n) out.push({ op: '-', text: x[i++] });
	while (j < m) out.push({ op: '+', text: y[j++] });
	return out;
}

/** @param {string} s */
const escape = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A block's text as HTML: escaped, with **bold**, *emphasis* and `code`. @param {string | null | undefined} text */
export function inline(text) {
	return escape(text ?? '')
		.replace(/`([^`]+)`/g, '<code>$1</code>')
		.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
		.replace(/\*([^*]+)\*/g, '<i>$1</i>');
}

/** The kinds of block either app shows, as the page names them. */
export const KINDS = /** @type {const} */ (['h1', 'h2', 'h3', 'p', 'li', 'code']);
/** @typedef {typeof KINDS[number]} BlockKind */
export const KIND_NAMES = { h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', p: 'Paragraph', li: 'Item', code: 'Code' };

/**
 * A document's block, as either app has it.
 * @typedef {{ id: number, kind?: string, type?: string, level?: number, checked?: boolean, lang?: string, text?: string }} Block
 */

/** What kind of block it is, whichever app wrote it. @param {Block} b @returns {BlockKind} */
export function kindOf(b) {
	if (b.kind) return /** @type {BlockKind} */ (KINDS.includes(/** @type {BlockKind} */ (b.kind)) ? b.kind : 'p');
	if (b.type === 'heading') return b.level === 1 ? 'h1' : b.level === 2 ? 'h2' : 'h3';
	if (b.type === 'item') return 'li';
	if (b.type === 'code') return 'code';
	return 'p';
}

/**
 * The block made `kind`, as the app on `app` writes it.
 * @param {Block} b @param {BlockKind} kind @param {string} app
 * @returns {Block}
 */
export function withKind(b, kind, app) {
	if (app === 'v1') return { ...b, kind };
	/** @type {Block} */
	const out = { id: b.id, text: b.text ?? '' };
	if (kind.startsWith('h')) Object.assign(out, { type: 'heading', level: Number(kind.slice(1)) });
	else if (kind === 'li') Object.assign(out, { type: 'item', checked: b.checked ?? false });
	else if (kind === 'code') Object.assign(out, { type: 'code', lang: b.lang ?? '' });
	else out.type = 'paragraph';
	return out;
}

/** A new block's id: one no block of the document has, picked at random so two devices editing at once don't clash. */
export function newId(/** @type {Block[]} */ blocks) {
	const taken = new Set(blocks.map((b) => b.id));
	let id;
	do id = 1 + Math.floor(Math.random() * 2 ** 30);
	while (taken.has(id));
	return id;
}

/** A role's rank: relay, read, write, owner. @param {string | null | undefined} role */
export const rank = (role) => ['relay', 'read', 'write', 'owner'].indexOf(role ?? '') + 1;
