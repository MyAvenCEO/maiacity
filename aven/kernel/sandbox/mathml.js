// @ts-nocheck — plain JS, kept loose on purpose
/*
 * THE MATHML CHECKER — what the math engine (./math-engine.js) hands back is a string from a worker that read LaTeX we
 * cannot trust, so the page takes none of it on its word. Each formula's MathML is read here by a tokenizer of our own
 * (never a browser's parser, never innerHTML) and held to a strict allowlist; one thing outside it and the whole formula
 * is refused, and its source is shown as text instead. What passes is drawn by `draw`, element by element with
 * createElementNS, its words as text nodes: nothing of the string itself ever reaches the page. (`draw` adds one thing,
 * an allowed one: a numbered formula's cell is set in display style, as KaTeX's own HTML sets it.)
 *
 * - One `<math>`, its one child a `<semantics>` holding the presentation tree and an `<annotation>` whose encoding is
 *   application/x-tex and which holds only text. `math`, `semantics` and `annotation` stand nowhere else.
 * - Only the MathML Core elements KaTeX writes (`ELEMENTS`), and `menclose` (`\boxed`, `\cancel`), each with only its own
 *   attributes, each value by its own rule (`VALUES`): lengths in bounds, colours as `#hex` or a name, words from a list.
 *   No `href`, no `xlink:*` or any other namespace, no `style`, no `id`, no `on*`, no `src`, no `maction`, no `mglyph`;
 *   `class` only on a table cell, and only KaTeX's two (`mtr-glue`, `mml-eqn-num`).
 * - Words only inside the token elements (mi, mn, mo, mtext) and the annotation; entities only the five XML names and
 *   numbers that name a character. No comment, CDATA, doctype or processing instruction; every value in double quotes.
 * - Bounded: `MAX` characters, elements and depth a formula.
 */

/** MathML's namespace. */
export const MATHML = 'http://www.w3.org/1998/Math/MathML';

/** What one formula's MathML may come to: characters, elements, and how deep they nest. */
export const MAX = { chars: 200_000, nodes: 20_000, depth: 100 };

/** Every element that may come out, and the attributes each may carry. */
export const ELEMENTS = {
	math: ['xmlns', 'display'],
	semantics: [],
	annotation: ['encoding'],
	mrow: [],
	mi: ['mathvariant'],
	mn: ['mathvariant'],
	mo: ['mathvariant', 'mathcolor', 'fence', 'separator', 'stretchy', 'largeop', 'lspace', 'rspace', 'minsize', 'maxsize'],
	mtext: ['mathvariant'],
	mspace: ['width', 'height', 'depth', 'linebreak', 'mathbackground'],
	msub: [],
	msup: [],
	msubsup: [],
	munder: ['accentunder'],
	mover: ['accent'],
	munderover: ['accent', 'accentunder'],
	mfrac: ['linethickness'],
	msqrt: [],
	mroot: [],
	mstyle: ['displaystyle', 'scriptlevel', 'mathcolor', 'mathsize'],
	mpadded: ['width', 'height', 'depth', 'lspace', 'voffset', 'mathbackground'],
	mphantom: [],
	menclose: ['notation'],
	mtable: ['width', 'columnalign', 'columnlines', 'columnspacing', 'rowlines', 'rowspacing'],
	mtr: [],
	mtd: ['width', 'class']
};

/** The elements that hold words (and, as KaTeX writes `\overset` and `\pmod`, other elements too). */
const TOKENS = new Set(['mi', 'mn', 'mo', 'mtext']);
/** The elements of the frame round a formula, which stand only where `check` puts them. */
const FRAME = new Set(['math', 'semantics', 'annotation']);

// ---- values ----

/** A length: a number and its unit (none only for 0). */
const LENGTH = /^([+-]?)(\d{1,6}(?:\.\d{1,8})?|\.\d{1,8})(em|ex|px|pt|mu|width|height|depth)?$/;
const EMS = { em: 1, ex: 0.5, px: 1 / 16, pt: 0.1, mu: 1 / 18 };
/** a length in ems, about (`width`, `height` and `depth` are of the content: at most twice it, either way, counted as 0); null if it is none */
function ems(v) {
	const m = LENGTH.exec(v);
	if (!m) return null;
	const n = Number(m[2]) * (m[1] === '-' ? -1 : 1);
	if (!m[3]) return n === 0 ? 0 : null;
	if (m[3] in EMS) return n * EMS[m[3]];
	return Math.abs(n) <= 2 ? 0 : null;
}
/** a length between `lo` and `hi` ems: a formula moves nothing far off its own place */
const length = (lo, hi) => (v) => {
	const e = ems(v);
	return e !== null && e >= lo && e <= hi;
};
const SPACE = length(-3, 20);
const SIZE = length(0, 20);
/** a list of up to 100 words, each passing `one` */
const list = (one) => (v) => {
	const parts = v.split(' ');
	return parts.length <= 100 && parts.every((p) => one(p));
};
const word = (...words) => (v) => words.includes(v);
const BOOL = word('true', 'false');
const COLOR = (v) => /^(#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|[a-z]{1,30})$/i.test(v);
const PERCENT = (v) => /^\d{1,3}%$/.test(v) && Number(v.slice(0, -1)) <= 100;
const VARIANTS = word('normal', 'bold', 'italic', 'bold-italic', 'double-struck', 'bold-fraktur', 'script', 'bold-script', 'fraktur', 'sans-serif', 'bold-sans-serif', 'sans-serif-italic', 'sans-serif-bold-italic', 'monospace');
const NOTATIONS = word('box', 'roundedbox', 'circle', 'left', 'right', 'top', 'bottom', 'updiagonalstrike', 'downdiagonalstrike', 'verticalstrike', 'horizontalstrike', 'madruwb', 'actuarial', 'phasorangle', 'longdiv', 'radical', 'updiagonalarrow');

/** Each attribute's rule for its value, given its element. */
export const VALUES = {
	xmlns: (v) => v === MATHML,
	display: word('block', 'inline'),
	encoding: (v) => v === 'application/x-tex',
	mathvariant: VARIANTS,
	mathcolor: COLOR,
	mathbackground: COLOR,
	fence: BOOL,
	separator: BOOL,
	stretchy: BOOL,
	largeop: BOOL,
	accent: BOOL,
	accentunder: BOOL,
	displaystyle: BOOL,
	scriptlevel: (v) => /^[+-]?[0-7]$/.test(v),
	lspace: SPACE,
	rspace: SPACE,
	height: SPACE,
	depth: SPACE,
	voffset: SPACE,
	width: (v, el) => (el === 'mtable' || el === 'mtd' ? PERCENT(v) : SPACE(v)),
	minsize: SIZE,
	maxsize: SIZE,
	mathsize: length(0.25, 3),
	linethickness: length(0, 1),
	linebreak: word('newline'),
	notation: list(NOTATIONS),
	columnalign: list(word('left', 'center', 'right')),
	columnlines: list(word('none', 'solid', 'dashed')),
	rowlines: list(word('none', 'solid', 'dashed')),
	columnspacing: list(SIZE),
	rowspacing: list(SIZE),
	class: (v, el) => el === 'mtd' && (v === 'mtr-glue' || v === 'mml-eqn-num')
};

// ---- the tokenizer ----

const OPEN = /<([a-z][a-z0-9]{0,15})((?:\s+[a-z][a-z-]{0,20}\s*=\s*"[^"<]*")*)\s*(\/?)>/y;
const CLOSE = /<\/([a-z][a-z0-9]{0,15})\s*>/y;
const ATTRIBUTE = /\s+([a-z][a-z-]{0,20})\s*=\s*"([^"<]*)"/g;
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const ENTITY = /&(?:(amp|lt|gt|quot|apos)|#(\d{1,7})|#x([0-9a-f]{1,6}));/iy;

/** text `s` with its entities read, or null where one is not the five names or a number naming a character */
function decode(s) {
	let out = '';
	for (let i = 0; i < s.length; ) {
		const amp = s.indexOf('&', i);
		if (amp < 0) {
			out += s.slice(i);
			break;
		}
		out += s.slice(i, amp);
		ENTITY.lastIndex = amp;
		const m = ENTITY.exec(s);
		if (!m) return null;
		if (m[1]) out += NAMED[m[1].toLowerCase()];
		else {
			const cp = m[2] ? Number(m[2]) : parseInt(m[3], 16);
			if (!(cp > 0 && cp <= 0x10ffff) || (cp >= 0xd800 && cp <= 0xdfff)) return null;
			out += String.fromCodePoint(cp);
		}
		i = amp + m[0].length;
	}
	return out;
}

/** text `text` read as one element and all it holds, or null where it is anything else */
function parse(text) {
	const stack = [];
	let root = null;
	let nodes = 0;
	for (let i = 0; i < text.length; ) {
		if (text[i] !== '<') {
			const end = text.indexOf('<', i) < 0 ? text.length : text.indexOf('<', i);
			const words = decode(text.slice(i, end));
			const top = stack.at(-1);
			if (words === null || !top) return null;
			if (typeof top.children.at(-1) === 'string') top.children[top.children.length - 1] += words;
			else top.children.push(words);
			i = end;
			continue;
		}
		if (text[i + 1] === '/') {
			CLOSE.lastIndex = i;
			const m = CLOSE.exec(text);
			const top = stack.pop();
			if (!m || !top || m[1] !== top.name) return null;
			i += m[0].length;
			if (!stack.length && i !== text.length) return null;
			continue;
		}
		OPEN.lastIndex = i;
		const m = OPEN.exec(text);
		if (!m || !Object.hasOwn(ELEMENTS, m[1]) || (root && !stack.length)) return null;
		const name = m[1];
		const attrs = [];
		for (const a of m[2].matchAll(ATTRIBUTE)) {
			const [, key, raw] = a;
			const value = decode(raw);
			if (value === null || !ELEMENTS[name].includes(key) || attrs.some(([k]) => k === key) || !VALUES[key](value, name)) return null;
			attrs.push([key, value]);
		}
		const node = { name, attrs, children: [] };
		if (++nodes > MAX.nodes || stack.length >= MAX.depth) return null;
		if (stack.length) stack.at(-1).children.push(node);
		else root = node;
		if (!m[3]) stack.push(node);
		else if (!stack.length && i + m[0].length !== text.length) return null;
		i += m[0].length;
	}
	return stack.length ? null : root;
}

// ---- the shape ----

/** whether element `node` (of the presentation tree) and all it holds keep to the rules */
function presentation(node) {
	if (typeof node === 'string' || FRAME.has(node.name)) return false;
	if (node.name === 'mspace' && node.children.length) return false;
	// words only in a token element
	if (!TOKENS.has(node.name) && node.children.some((c) => typeof c === 'string')) return false;
	return node.children.every((c) => typeof c === 'string' || presentation(c));
}

/** the trees `check` handed out: `draw` draws no other */
const CHECKED = new WeakSet();

/**
 * MathML text `text`, as the math engine hands it back for one formula, checked: its tree (`{ name, attrs, children }`,
 * words as strings), or null where anything in it is outside the rules. `display`: whether it was asked for as a
 * display formula, which it must then be (and an inline one must not).
 * @param {unknown} text @param {{ display?: boolean }} [o]
 */
export function check(text, { display } = {}) {
	if (typeof text !== 'string' || text.length > MAX.chars) return null;
	const root = parse(text);
	if (!root || root.name !== 'math' || root.children.length !== 1) return null;
	const block = root.attrs.some(([k, v]) => k === 'display' && v === 'block');
	if (display !== undefined && block !== (display === true)) return null;
	const [semantics] = root.children;
	if (typeof semantics === 'string' || semantics.name !== 'semantics' || semantics.attrs.length || semantics.children.length !== 2) return null;
	const [tree, annotation] = semantics.children;
	if (typeof annotation === 'string' || annotation.name !== 'annotation') return null;
	if (!annotation.attrs.some(([k]) => k === 'encoding') || annotation.children.some((c) => typeof c !== 'string')) return null;
	if (!presentation(tree)) return null;
	CHECKED.add(root);
	return root;
}

const has = (node, key, value) => node.attrs.some(([k, v]) => k === key && v === value);

/**
 * The cell of a numbered formula (`\tag`) that holds the formula, or null: KaTeX sets one in a table the width of the
 * line, its four cells a pad, the formula, a pad and the number. MathML draws a table's cells in text style (small
 * fractions, limits beside a sum), where KaTeX's own HTML keeps the formula in display style; so `draw` sets that one
 * cell's formula in display style, in an `mstyle` as KaTeX writes one round each line of `gathered`.
 */
function numbered(tree) {
	const table = tree.children[0]?.children?.[0];
	if (table?.name !== 'mtable' || !has(table, 'width', '100%') || table.children.length !== 1) return null;
	const cells = table.children[0].children;
	if (cells.length !== 4 || ![0, 2].every((i) => has(cells[i], 'width', '50%') && !cells[i].children.length)) return null;
	return cells[1];
}

/**
 * Checked tree `tree` (`check`) as a `<math>` element of document `doc`, made element by element: only the elements and
 * attributes `check` let through, words as text nodes; a numbered formula's own cell in display style (`numbered`).
 * Throws for anything `check` did not hand out.
 * @param {ReturnType<typeof check>} tree @param {Document} [doc]
 * @returns {Element}
 */
export function draw(tree, doc = document) {
	if (!tree || !CHECKED.has(tree)) throw new Error('only a checked formula is drawn');
	const cell = numbered(tree);
	const make = (node) => {
		if (typeof node === 'string') return doc.createTextNode(node);
		const el = doc.createElementNS(MATHML, node.name);
		// the namespace is the element's own (createElementNS)
		for (const [k, v] of node.attrs) if (k !== 'xmlns') el.setAttribute(k, v);
		let into = el;
		if (node === cell) {
			into = el.appendChild(doc.createElementNS(MATHML, 'mstyle'));
			into.setAttribute('displaystyle', 'true');
			into.setAttribute('scriptlevel', '0');
		}
		for (const c of node.children) into.append(make(c));
		return el;
	};
	return make(tree);
}

const ESCAPED = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => s.replace(/[&<>"]/g, (c) => ESCAPED[c]);

/** Checked tree `tree` as MathML text again, every word and value escaped (what `draw` makes, as text: for tests). */
export function serialise(tree) {
	if (typeof tree === 'string') return esc(tree);
	const attrs = tree.attrs.map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
	return `<${tree.name}${attrs}>${tree.children.map(serialise).join('')}</${tree.name}>`;
}
