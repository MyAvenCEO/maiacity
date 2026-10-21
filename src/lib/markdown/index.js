// @ts-nocheck — plain JS
/*
 * THE MARKDOWN ENGINE — the one way Markdown becomes HTML anywhere on our pages, whoever wrote it: a person, an
 * agent, an aven, a vault we follow, a web page copied into the repo. Its output goes into `{@html}`, so it is part of
 * the kernel: nothing it hands back can run, load or lead anywhere we did not allow.
 *
 * - Only marked's tokenizer is used; every token is written by our own renderer below, never by marked's.
 * - Text is always escaped. Raw HTML in the Markdown (a block or inline) never becomes markup: its tags and comments
 *   are dropped and the words between them shown as text.
 * - A link goes only to the web (http, https), mail, this site (a path, from the root or relative) or a place on the
 *   page (#): anything naming another scheme is refused.
 *   Its address is decoded the way a browser would read it (entities, hidden spaces) before it is judged, so
 *   `&#106;avascript:` or `java\tscript:` is refused. Links to the web open in a new tab, without a referrer.
 * - A picture is shown only where the caller's `picture(name, alt)` gives it an address; otherwise its words are.
 * - Maths, only where a caller asks for it (`math`): `$$…$$` and `$…$` are found as pandoc finds them, before any other
 *   rule reads them, and each is written as a placeholder holding its LaTeX source as text (`MATH`). This engine never
 *   typesets it: the math host does, off the page ($lib/sandbox/math-host.js), and until it has, or where it can't, the
 *   source is what a reader sees.
 * - Every tag and attribute that can come out is in `TAGS` (markdown.test.js checks hostile Markdown against it).
 */

import { Lexer } from 'marked';

/** Every tag this engine writes, and the attributes each may carry. */
export const TAGS = {
	p: [], br: [], hr: [], h1: ['id'], h2: ['id'], h3: ['id'], h4: ['id'], h5: ['id'], h6: ['id'],
	strong: [], em: [], del: [], code: ['class'], pre: [], blockquote: [],
	ul: [], ol: ['start'], li: [], input: ['type', 'checked', 'disabled'],
	table: [], thead: [], tbody: [], tr: [], th: ['align'], td: ['align'],
	a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'title', 'loading', 'data-picture'],
	figure: [], figcaption: [], span: ['class', 'data-math']
};

const ESCAPED = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Text as HTML text or an attribute's value. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPED[c]);

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", colon: ':', tab: '\t', newline: '\n', sol: '/', lpar: '(', rpar: ')' };
/** The controls, spaces and invisible marks a browser skips inside an address. */
const hidden = (n) => n <= 0x20 || (n >= 0x7f && n <= 0x9f) || n === 0xad || (n >= 0x200b && n <= 0x200f) || n === 0x2028 || n === 0x2029 || n === 0xfeff;
/** An address as a browser reads it: entities decoded, the controls and spaces it ignores taken out. */
export function decoded(href) {
	return String(href ?? '')
		.replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
		.replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Math.min(parseInt(d, 10), 0x10ffff)))
		.replace(/&([a-z]+);?/gi, (m, n) => NAMED[n.toLowerCase()] ?? m)
		.split('')
		.filter((c) => !hidden(c.charCodeAt(0)))
		.join('');
}

/** Raw HTML's words: its comments and tags dropped (shown escaped, as text). */
const words = (html) => String(html ?? '').replace(/<!--[\s\S]*?(-->|$)/g, '').replace(/<\/?[a-zA-Z][^>]*>?/g, '');

/** Where a link may go, judged on the decoded address. */
const SAFE = /^(https?:\/\/|mailto:|\/(?![/\\])|#|\?|[^:/?#\\]*(?:[/?#]|$))/i;
/** Whether `href` is an address a link may lead to. */
export const safeHref = (href) => SAFE.test(decoded(href));
/** An address from a record or a vault, as a link's href: itself when a link may lead there, else none (no link). */
export const linkHref = (href) => (href && safeHref(href) ? href : undefined);
/** Where a picture may be shown from: the web over https, this site, a page-made blob or an
 * inline picture, an SVG among them (in an image a browser runs none of its scripts and loads nothing for it, and a
 * data URL never opens as a page of this site). */
const PICTURE_SRC = /^(https:\/\/|\/(?![/\\])|blob:|data:image\/(png|jpe?g|gif|webp|avif|svg\+xml);)/i;
/** Whether `href` leads off this site. */
const away = (href) => /^https?:/i.test(decoded(href));

/**
 * MATHS, AS PANDOC FINDS IT (its tex_math_dollars), read from the Markdown as written, before marked's own rules (so
 * `\,` stays a thin space and `m^{*}` no emphasis):
 * - `$$…$$` is display maths: anything up to the next `$$`, but no blank line. Standing alone at a block's start (the
 *   closing `$$` ending its line) it is a block of its own; within a paragraph it is display maths in it.
 * - `$…$` is inline maths: the opening `$` is followed by a non-space, the closing `$` is preceded by a non-space and
 *   not followed by a digit, and `\` takes the character after it with it (`\$` closes nothing; `\text{…}` may hold a
 *   `$`). The first `$` that may close it does, or nothing does: so "$5 and $10" stays words.
 * - A `\$` outside maths is a dollar, as always; maths never pairs across a paragraph or a table cell, nor reaches
 *   into code.
 */
const BLANK = /\n[ \t]*\n/;
const SPACE = /\s/;
/** the most characters inline maths is looked for over: past it, its `$` is a dollar */
const LONGEST = 10000;

/** Display maths, `$$…$$`, at `src[at]`: where it ends and its LaTeX, or null. @param {string} src @param {number} at */
function displayAt(src, at) {
	if (!src.startsWith('$$', at)) return null;
	const end = src.indexOf('$$', at + 2);
	const tex = end < 0 ? '' : src.slice(at + 2, end);
	return tex.trim() && !BLANK.test(tex) ? { end: end + 2, tex: tex.trim(), display: true } : null;
}

/** Inline maths, `$…$`, at `src[at]`: where it ends and its LaTeX, or null. @param {string} src @param {number} at */
function inlineAt(src, at) {
	if (src[at] !== '$' || src[at + 1] === '$' || !src[at + 1] || SPACE.test(src[at + 1])) return null;
	const stop = Math.min(src.length, at + LONGEST);
	for (let i = at + 1; i < stop; ) {
		const c = src[i];
		if (c === '$') return /[0-9]/.test(src[i + 1] ?? '') ? null : { end: i + 1, tex: src.slice(at + 1, i), display: false };
		if (c === '\\') {
			// \text{…}, its braces balanced, whatever it holds; else the character after the backslash
			const past = src.startsWith('\\text{', i) ? balanced(src, i + 5, stop) : -1;
			i = past > 0 ? past : i + 2;
			continue;
		}
		if (SPACE.test(c)) {
			let j = i;
			while (j < stop && SPACE.test(src[j])) j++;
			if (src[j] === '$' || BLANK.test(src.slice(i, j))) return null;
			i = j;
			continue;
		}
		i++;
	}
	return null;
}

/** just past where the braces opening at `src[at]` close, before `stop`; or -1 */
function balanced(src, at, stop) {
	let depth = 0;
	for (let i = at; i < stop; i++) {
		if (src[i] === '\\') i++;
		else if (src[i] === '{') depth++;
		else if (src[i] === '}' && --depth === 0) return i + 1;
	}
	return -1;
}

/** Maths at `src[at]`, display or inline. @param {string} src @param {number} [at] */
const mathAt = (src, at = 0) => displayAt(src, at) ?? inlineAt(src, at);

/** Display maths standing alone at a block's start (`src[at]`): `$$…$$`, nothing after it on its line. */
function mathBlock(src, at = 0) {
	let i = at;
	while (i < at + 3 && src[i] === ' ') i++;
	const d = displayAt(src, i);
	if (!d) return undefined;
	const tail = /[ \t]*(?:\n+|$)/y;
	tail.lastIndex = d.end;
	const t = tail.exec(src);
	return t ? { type: 'math', display: true, raw: src.slice(at, d.end + t[0].length), text: d.tex } : undefined;
}

/**
 * marked's way in for maths (its Lexer's extensions and hooks): a block; inline maths; where each may start, so a
 * paragraph ends before a block (looked for only up to the paragraph's first blank line) and a run of text before a
 * `$`; and a run of text's maths masked for marked's emphasis, so a `*` or `_` in maths ends no emphasis. A math
 * token is `{ type: 'math', display, text }`, its text the LaTeX.
 */
const MATH = {
	extensions: {
		block: [(src) => mathBlock(src)],
		inline: [
			(src) => {
				const m = mathAt(src);
				return m ? { type: 'math', display: m.display, raw: src.slice(0, m.end), text: m.tex } : undefined;
			}
		],
		startBlock: [
			(src) => {
				// the nearest line that opens display maths, or the paragraph's end, whichever comes first
				for (const m of src.matchAll(/\n[ \t]*\n|\n {0,3}\$\$/g)) {
					if (!m[0].endsWith('$$')) return undefined;
					if (mathBlock(src, m.index + 1)) return m.index + 1;
				}
			}
		],
		startInline: [
			(src) => {
				const i = src.indexOf('$');
				return i < 0 ? undefined : i;
			}
		],
		renderers: {},
		childTokens: {}
	},
	hooks: {
		emStrongMask: (src) => {
			let [out, from] = ['', 0];
			for (let i = src.indexOf('$'); i >= 0; i = src.indexOf('$', i)) {
				const m = mathAt(src, i);
				if (!m) {
					i += 1;
					continue;
				}
				const fence = m.display ? 2 : 1;
				out += src.slice(from, i + fence) + 'a'.repeat(m.end - i - 2 * fence);
				[from, i] = [m.end - fence, m.end];
			}
			return out + src.slice(from);
		}
	}
};

/** A formula as this engine leaves it: its LaTeX as text, in a span the math host knows (`data-math`). */
const placeholder = (t) => `<span class="math" data-math="${t.display ? 'display' : 'inline'}">${esc(t.text)}</span>`;

/** A heading's words as an id: lower case, letters and digits joined by dashes. */
export const slug = (s) =>
	String(s ?? '')
		.toLowerCase()
		.replace(/<[^>]*>/g, '')
		.replace(/&[a-z#0-9]+;/g, '')
		.replace(/[^\p{L}\p{N}]+/gu, '-')
		.replace(/^-+|-+$/g, '');

/**
 * Markdown `md` as HTML that is safe to show whoever wrote it.
 * @param {string} md
 * @param {{
 *   picture?: (name: string, alt: string) => string | { src: string, name?: string } | null | undefined,
 *   link?: (href: string) => string,
 *   ids?: boolean | ((text: string) => string),
 *   figures?: boolean,
 *   math?: boolean
 * }} [o]
 *   picture: the address a picture is shown from (none = its words are shown instead); `name` adds data-picture,
 *     and `{ src: '', name }` draws a named picture whose address isn't known yet.
 *   link: rewrites a safe address (this site's base path, say); never called for a refused one.
 *   ids: headings get ids from their words (or from `ids(text)`). figures: a picture alone in its paragraph is a figure with a caption.
 *   math: `$$…$$` and `$…$` are maths, each left as a placeholder holding its source (`placeholder`), a figure's
 *     caption's among them; off (as for every caller but the docs), a `$` is only a dollar.
 */
export function markdown(md, o = {}) {
	const { picture = () => null, link = (h) => h, ids = false, figures = true, math = false } = o;
	const tokens = new Lexer({ gfm: true, breaks: false, ...(math ? MATH : {}) }).lex(String(md ?? ''));

	const image = (t) => {
		const got = t.href ? picture(String(t.href), t.text ?? '') : null;
		const src = typeof got === 'string' ? got : got?.src;
		const named = typeof got === 'object' && got?.name ? ` data-picture="${esc(got.name)}"` : '';
		const title = t.title ? ` title="${esc(t.title)}"` : '';
		// a named picture whose address isn't known yet (still being read) is drawn without one
		if (named && src === '') return `<img alt="${esc(t.text)}"${title}${named} loading="lazy" />`;
		if (!src || !PICTURE_SRC.test(decoded(src))) return `<span class="unshown">${esc(t.text)}</span>`;
		return `<img src="${esc(src)}" alt="${esc(t.text)}"${title}${named} loading="lazy" />`;
	};

	const inline = (list = []) => list.map(one).join('');
	function one(t) {
		switch (t.type) {
			case 'text':
				return t.tokens ? inline(t.tokens) : esc(t.text);
			case 'escape':
				return esc(t.text);
			case 'strong':
				return `<strong>${inline(t.tokens)}</strong>`;
			case 'em':
				return `<em>${inline(t.tokens)}</em>`;
			case 'del':
				return `<del>${inline(t.tokens)}</del>`;
			case 'codespan':
				return `<code>${esc(t.text)}</code>`;
			case 'br':
				return '<br />';
			case 'link': {
				const words = inline(t.tokens);
				if (!safeHref(t.href)) return words;
				const href = decoded(t.href);
				const title = t.title ? ` title="${esc(t.title)}"` : '';
				const out = away(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
				return `<a href="${esc(link(href))}"${title}${out}>${words}</a>`;
			}
			case 'image':
				return image(t);
			case 'html':
				return esc(words(t.text ?? t.raw));
			case 'checkbox':
				return `<input type="checkbox" disabled${t.checked ? ' checked' : ''} /> `;
			case 'math':
				return placeholder(t);
			default:
				return esc(t.raw ?? '');
		}
	}

	/** a figure's caption, its picture's words: as written, but for its maths, each a placeholder */
	const caption = (t) => (math && t.tokens?.some((x) => x.type === 'math') ? t.tokens.map((x) => (x.type === 'math' ? placeholder(x) : esc(x.raw))).join('') : esc(t.text));

	const block = (list = []) => list.map(part).join('');
	function part(t) {
		switch (t.type) {
			case 'space':
				return '';
			case 'paragraph': {
				const only = t.tokens?.length === 1 && t.tokens[0].type === 'image' ? t.tokens[0] : null;
				if (only && figures) {
					const words = only.text ? `<figcaption>${caption(only)}</figcaption>` : '';
					return `<figure>${image(only)}${words}</figure>\n`;
				}
				return `<p>${inline(t.tokens)}</p>\n`;
			}
			case 'heading': {
				const d = Math.min(6, Math.max(1, Number(t.depth) || 1));
				const id = ids ? ` id="${esc(typeof ids === 'function' ? ids(t.text) : slug(t.text))}"` : '';
				return `<h${d}${id}>${inline(t.tokens)}</h${d}>\n`;
			}
			case 'code': {
				const lang = /^[\w+-]{1,30}$/.test(t.lang ?? '') ? ` class="language-${t.lang}"` : '';
				return `<pre><code${lang}>${esc(t.text)}</code></pre>\n`;
			}
			case 'blockquote':
				return `<blockquote>\n${block(t.tokens)}</blockquote>\n`;
			case 'hr':
				return '<hr />\n';
			case 'list': {
				const tag = t.ordered ? 'ol' : 'ul';
				const start = t.ordered && Number.isInteger(t.start) && t.start !== 1 ? ` start="${t.start}"` : '';
				const items = t.items
					.map((it) => {
						const box = it.task ? `<input type="checkbox" disabled${it.checked ? ' checked' : ''} /> ` : '';
						const inner = it.tokens.map((x) => (x.type === 'text' ? (x.tokens ? inline(x.tokens) : esc(x.text)) : x.type === 'checkbox' ? '' : part(x))).join('');
						return `<li>${box}${inner}</li>\n`;
					})
					.join('');
				return `<${tag}${start}>\n${items}</${tag}>\n`;
			}
			case 'table': {
				const align = (a) => (a === 'left' || a === 'right' || a === 'center' ? ` align="${a}"` : '');
				const head = t.header.map((c, i) => `<th${align(t.align[i])}>${inline(c.tokens)}</th>`).join('');
				const rows = t.rows.map((r) => `<tr>${r.map((c, i) => `<td${align(t.align[i])}>${inline(c.tokens)}</td>`).join('')}</tr>\n`).join('');
				return `<table>\n<thead>\n<tr>${head}</tr>\n</thead>\n${rows ? `<tbody>\n${rows}</tbody>\n` : ''}</table>\n`;
			}
			case 'html': {
				const said = words(t.text ?? t.raw).trim();
				return said ? `<p>${esc(said)}</p>\n` : '';
			}
			case 'text':
				return `<p>${t.tokens ? inline(t.tokens) : esc(t.text)}</p>\n`;
			case 'math':
				return `<p>${placeholder(t)}</p>\n`;
			default:
				return t.tokens ? block(t.tokens) : `<p>${esc(t.raw ?? '')}</p>\n`;
		}
	}

	return block(tokens);
}
