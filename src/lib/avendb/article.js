// Articles in avenDB: each an entry of type `article` in a vault, of avenDB's own article schema (./ops.js
// `articleRecord`): its title, and its text, one Markdown text. Its pictures are files of the vault's Library, each
// named by its content hash, its BLAKE3 hash in hex with its ending (`<hash>.jpg`), as the site's media vault names
// them, and the article names them so (`![what it shows](<hash>.jpg)`). Who wrote it is the vault its first edit acted
// for, and when, that edit's time (an entry's `by` and `created`): both come with every signed edit, so the record says
// neither. It is edited, proposed to, merged and made a variant of as a note is (./Note.svelte).

import { markdown } from '../markdown/index.js';

/** The type of an article's entry. */
export const ARTICLE = 'article';

/** A picture's name in an article: its content hash in hex and its ending. */
export const PICTURE = /^[0-9a-f]{64}\.(jpe?g|png|webp|gif|avif)$/;

/**
 * Article text `md` as HTML, safe to show whoever wrote it, by the one Markdown engine ($lib/markdown): its own HTML
 * shown as text, links only to the web, mail or this site, and pictures only the vault's own files, each shown from
 * `src(name)` (`''` while it isn't read yet); a picture alone in its paragraph is a figure, its words its caption.
 * @param {string} md @param {(name: string) => string} src
 */
export function render(md, src) {
	return markdown(md, {
		picture: (href) => {
			const name = href.trim();
			return PICTURE.test(name) ? { src: src(name) ?? '', name } : null;
		}
	});
}

/**
 * Article text `md` as its blocks, as Markdown parts them: each a paragraph, a heading, a list, a quote, a picture or a
 * fenced piece of code, with the blank lines after it (`gap`), and the blank lines before the first (`lead`). Put
 * back together (`joined`) they are `md` again to the letter, so changing one block leaves the rest as it was.
 * @param {string} md @returns {{ lead: string, blocks: { md: string, gap: string }[] }}
 */
export function blocks(md) {
	const text = md ?? '';
	/** @type {{ md: string, gap: string }[]} */
	const out = [];
	let [lead, start, after, fence] = ['', -1, 0, ''];
	for (let s = 0; s <= text.length; ) {
		const e = text.indexOf('\n', s) < 0 ? text.length : text.indexOf('\n', s);
		const line = text.slice(s, e);
		const opens = /^\s{0,3}(```|~~~)/.exec(line)?.[1] ?? '';
		if (start < 0) {
			if (line.trim()) {
				if (out.length) out[out.length - 1].gap = text.slice(after, s);
				else lead = text.slice(0, s);
				[start, fence] = [s, opens];
			}
		} else if (fence) {
			if (opens === fence) fence = '';
		} else if (!line.trim()) {
			out.push({ md: text.slice(start, s - 1), gap: '' });
			[start, after] = [-1, s - 1];
		} else if (opens) {
			fence = opens;
		}
		s = e + 1;
	}
	if (start >= 0) out.push({ md: text.slice(start), gap: '' });
	else if (out.length) out[out.length - 1].gap = text.slice(after);
	else lead = text;
	return { lead, blocks: out };
}

/** Blocks `b` put back together as text. @param {ReturnType<typeof blocks>} b */
export const joined = (b) => b.lead + b.blocks.map((x) => x.md + x.gap).join('');

/**
 * Article text `b`, parted into its blocks, with block `i` as `md`: taken out where `md` is blank, and added as the
 * last where `i` is past them.
 * @param {ReturnType<typeof blocks>} b @param {number} i @param {string} md
 */
export function withBlock(b, i, md) {
	const all = b.blocks.map((x) => ({ ...x }));
	const blank = !md.trim();
	if (i >= all.length) {
		if (blank) return joined(b);
		const end = all.length ? all[all.length - 1].gap : '';
		if (all.length) all[all.length - 1].gap = '\n\n';
		all.push({ md, gap: end });
	} else if (blank) {
		const [gone] = all.splice(i, 1);
		if (i === all.length && i > 0) all[i - 1].gap = gone.gap;
	} else {
		all[i].md = md;
	}
	return joined({ lead: b.lead, blocks: all });
}

/**
 * Article text `b`, parted into its blocks, with `md` as a new block before block `i` (or the first).
 * @param {ReturnType<typeof blocks>} b @param {number} i @param {string} md
 */
export function withNewBlock(b, i, md) {
	if (!md.trim()) return joined(b);
	if (i >= b.blocks.length) return withBlock(b, i, md);
	const all = b.blocks.map((x) => ({ ...x }));
	all.splice(Math.max(0, i), 0, { md, gap: '\n\n' });
	return joined({ lead: b.lead, blocks: all });
}

/** An emphasised paragraph alone: a subtitle. */
const SUBTITLE = /^(?:\*([^*\n][^*\n]*)\*|_([^_\n][^_\n]*)_)$/;
/** A picture alone in its paragraph: a figure, or the cover. */
const FIGURE = /^!\[([^\]]*)\]\(\s*([^)\s]+)\s*\)$/;

/**
 * Article text `md` as the journal lays an article out (src/lib/blog/PostLayout.svelte): the subtitle, the emphasised
 * paragraph it opens with; the cover, the picture alone in the paragraph it opens with, or that follows the subtitle;
 * and the rest, its body. Each named by its block (`blocks`), `-1` where it has none.
 * @param {string} md
 */
export function laidOut(md) {
	const b = blocks(md);
	const first = b.blocks[0]?.md.trim() ?? '';
	const sub = SUBTITLE.exec(first);
	const subtitle = sub ? 0 : -1;
	const c = subtitle + 1;
	const pic = FIGURE.exec(b.blocks[c]?.md.trim() ?? '');
	const cover = pic && PICTURE.test(pic[2]) ? c : -1;
	return {
		...b,
		subtitle,
		subtitleText: sub ? (sub[1] ?? sub[2]).trim() : '',
		cover,
		coverName: cover >= 0 && pic ? pic[2] : '',
		coverAlt: cover >= 0 && pic ? pic[1] : '',
		/** the first block of its body */
		body: Math.max(subtitle, cover) + 1
	};
}

/** Where a blog post was first published: the note its import once closed an article with, under a rule. */
const IMPORTED = /^First published on the maiaCITY blog\b/;
const RULE = /^(?:-{3,}|\*{3,}|_{3,})$/;

/**
 * The body of article `parts` (`laidOut`) as one text, as its readers see it: without the note on where a blog post
 * was first published, nor the rule above it, that an article imported from the blog was once closed with.
 * @param {ReturnType<typeof laidOut>} parts
 */
export function bodyText(parts) {
	const shown = parts.blocks.slice(parts.body);
	const i = shown.findLastIndex((b) => IMPORTED.test(b.md.trim()));
	if (i >= 0) {
		const ruled = i > 0 && RULE.test(shown[i - 1].md.trim());
		shown.splice(ruled ? i - 1 : i, ruled ? 2 : 1);
	}
	return shown.map((b) => b.md + b.gap).join('');
}

/** About how long text `md` takes to read, in minutes, as the journal counts: 200 words a minute. @param {string} md */
export const readingMinutes = (md) => Math.max(1, Math.round((md ?? '').split(/\s+/).filter(Boolean).length / 200));

/** The pictures article text `md` names, each once, in the order it shows them. @param {string} md */
export function pictures(md) {
	const names = [...(md ?? '').matchAll(/!\[[^\]]*\]\(\s*([^)\s]+)/g)].map((m) => m[1]);
	return names.filter((n, i) => PICTURE.test(n) && names.indexOf(n) === i);
}

/**
 * The file of vault `vault` named `name` that the device reads, as world `world` shows it: a picture an article
 * names, in its vault's Library.
 * @param {import('./vaults.js').WorldView} world @param {string} vault @param {string} name
 */
export const fileNamed = (world, vault, name) =>
	world.entries.find((e) => e.vault === vault && e.type === 'file' && !e.deleted && e.title === name && e.files?.[0]);

/** An article's opening words: its first paragraph of plain text, at most `n` letters. @param {string} md */
export function opening(md, n = 220) {
	const first = (md ?? '')
		.split(/\n\s*\n/)
		.map((b) => b.trim())
		.find((b) => b && !/^(#|!\[|<|---|\||>|\*[^*]|-\s)/.test(b));
	const plain = (first ?? '')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[*_`]/g, '');
	return plain.length > n ? `${plain.slice(0, n - 1).trimEnd()}…` : plain;
}
