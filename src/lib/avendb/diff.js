/*
 * What a write changed in a note's text, word by word, as the note viewer shows it: the words it kept, took out and
 * put in, by the longest run of words the two texts share (their LCS). Spaces and punctuation are words of their own,
 * so "beans." to "beans and peas." puts in " and peas" and keeps the rest.
 */

/** @typedef {{ kind: 'same' | 'out' | 'in', text: string }} Piece */

/** The words of `text`: runs of letters and digits, of spaces, and of anything else. @param {string} text */
const words = (text) => text.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]+/gu) ?? [];

/** The most pairs of words a diff weighs; past it, the middle the texts don't share shows as replaced whole. */
const MOST = 4_000_000;

/**
 * What changed from `before` to `after`, word by word, the pieces of a kind run together.
 * @param {string} before @param {string} after
 * @returns {Piece[]}
 */
export function diff(before, after) {
	const a = words(before);
	const b = words(after);
	/** @type {Piece[]} */
	const out = [];
	/** @param {Piece['kind']} kind @param {string} text */
	const put = (kind, text) => {
		const last = out.at(-1);
		if (last?.kind === kind) last.text += text;
		else out.push({ kind, text });
	};
	// the words they share at either end need no table
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) put('same', a[start++]);
	let end = 0;
	while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
	const x = a.slice(start, a.length - end);
	const y = b.slice(start, b.length - end);
	const [n, m] = [x.length, y.length];
	if (n * m > MOST) {
		if (n) put('out', x.join(''));
		if (m) put('in', y.join(''));
	} else {
		// t[i][j]: how many words x from i and y from j share, in order
		const w = m + 1;
		const t = new Uint32Array((n + 1) * w);
		for (let i = n - 1; i >= 0; i--) {
			for (let j = m - 1; j >= 0; j--) {
				t[i * w + j] = x[i] === y[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
			}
		}
		let [i, j] = [0, 0];
		while (i < n && j < m) {
			if (x[i] === y[j]) {
				put('same', x[i]);
				[i, j] = [i + 1, j + 1];
			} else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) put('out', x[i++]);
			else put('in', y[j++]);
		}
		while (i < n) put('out', x[i++]);
		while (j < m) put('in', y[j++]);
	}
	for (const word of a.slice(a.length - end)) put('same', word);
	return joined(out);
}

/**
 * Runs of changes with only spaces kept between them, as one change: what they took out, then what they put in, so
 * "Corn first." to "Plant beans." reads as one swap. Spaces alone a run took out don't show; spaces alone it put in
 * show as kept.
 * @param {Piece[]} pieces
 */
function joined(pieces) {
	/** @type {Piece[]} */
	const out = [];
	let i = 0;
	while (i < pieces.length) {
		if (pieces[i].kind === 'same') {
			out.push(pieces[i++]);
			continue;
		}
		let [gone, come] = ['', ''];
		for (; i < pieces.length; i++) {
			const p = pieces[i];
			if (p.kind === 'out') gone += p.text;
			else if (p.kind === 'in') come += p.text;
			else if (/^\s+$/.test(p.text) && pieces[i + 1]) [gone, come] = [gone + p.text, come + p.text];
			else break;
		}
		if (gone.trim()) out.push({ kind: 'out', text: gone });
		if (come.trim()) out.push({ kind: 'in', text: come });
		else if (come) out.push({ kind: 'same', text: come });
	}
	return out;
}
