// Articles in avenDB: each an entry of type `article` in a vault, a Markdown document as a note is (./ops.js
// `noteRecord`), its title, and its text, Markdown, in its first paragraph. Its pictures are files of the vault's
// Library, each named by its content hash, its BLAKE3 hash in hex with its ending (`<hash>.jpg`), as the site's media
// vault names them, and the article names them so (`![what it shows](<hash>.jpg)`). Who wrote it is the vault its first
// edit acted for, and when, that edit's time (an entry's `by` and `created`): both come with every signed edit, so the
// record says neither. It is edited, proposed to, merged and made a variant of as a note is (./Note.svelte).

import { Marked } from 'marked';

/** The type of an article's entry. */
export const ARTICLE = 'article';

/** A picture's name in an article: its content hash in hex and its ending. */
export const PICTURE = /^[0-9a-f]{64}\.(jpe?g|png|webp|gif|avif)$/;

/** What each letter HTML gives a meaning to is written as. */
const ESCAPED = /** @type {Record<string, string>} */ ({
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;'
});

/** Text as HTML text, or an attribute's value. @param {unknown} s */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPED[c]);

/** Where a link may go: the web, mail, and this site. */
const SAFE = /^(https?:|mailto:|\/(?!\/)|#)/i;

/**
 * Article text `md` as HTML, safe to show whoever wrote it: its own HTML shown as text, links only to the web, mail or
 * this site, and pictures only the vault's own files, each shown from `src(name)` (`''` while it isn't read yet); a
 * picture alone in its paragraph is a figure, its words its caption.
 * @param {string} md @param {(name: string) => string} src
 */
export function render(md, src) {
	/** @param {string} href @param {string} text */
	const picture = (href, text) => {
		const name = (href ?? '').trim();
		if (!PICTURE.test(name)) return `<span class="unshown">${esc(text)}</span>`;
		const url = src(name);
		return `<img${url ? ` src="${esc(url)}"` : ''} alt="${esc(text)}" data-picture="${name}" loading="lazy" />`;
	};
	const marked = new Marked({
		gfm: true,
		async: false,
		renderer: {
			html: ({ text }) => esc(text),
			link({ href, title, tokens }) {
				const text = this.parser.parseInline(tokens);
				if (!SAFE.test(href ?? '')) return text;
				const titled = title ? ` title="${esc(title)}"` : '';
				const away = /^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
				return `<a href="${esc(href)}"${titled}${away}>${text}</a>`;
			},
			image: ({ href, text }) => picture(href, text),
			paragraph({ tokens }) {
				const [only] = tokens;
				if (tokens.length === 1 && only.type === 'image') {
					const caption = only.text ? `<figcaption>${esc(only.text)}</figcaption>` : '';
					return `<figure>${picture(only.href, only.text)}${caption}</figure>\n`;
				}
				return `<p>${this.parser.parseInline(tokens)}</p>\n`;
			}
		}
	});
	return /** @type {string} */ (marked.parse(md ?? ''));
}

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

// The site's blog posts, /blog/<slug>/post.md, each read only once an article is made of it
const POSTS = /** @type {Record<string, () => Promise<string>>} */ (
	import.meta.glob('/blog/day-*/post.md', { query: '?raw', import: 'default' })
);

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** The blog's posts an article can be made of, by their slugs, the newest first, each with a name from its slug. */
export const blogPosts = () =>
	Object.keys(POSTS)
		.map((path) => path.split('/').at(-2) ?? '')
		.sort()
		.reverse()
		.map((slug) => {
			const [, day, words] = /^day-(\d+)-(.*)$/.exec(slug) ?? [];
			const name = words ? words.replaceAll('-', ' ') : slug;
			return { slug, name: day ? `Day ${Number(day)}: ${name}` : name };
		});

/** The post the example article is made of: HEARTS, the money avenCEO's vaults run on. */
export const EXAMPLE = 'day-10-a-heart-every-two-minutes';

/**
 * Blog post `slug` as an article: its title, and its text, its subtitle and cover first and where it was first
 * published last, with the pictures it names.
 * @param {string} slug
 * @returns {Promise<{ title: string, text: string, pictures: string[] }>}
 */
export async function fromBlog(slug) {
	const load = POSTS[`/blog/${slug}/post.md`];
	if (!load) throw new Error(`the blog has no post ${slug}`);
	const raw = await load();
	const m = FRONTMATTER.exec(raw);
	const { parse } = await import('yaml');
	const fm = /** @type {Record<string, unknown>} */ ((m ? parse(m[1]) : null) ?? {});
	const str = (/** @type {unknown} */ v) => (v == null ? '' : String(v).trim());
	const [title, subtitle, cover, alt] = [str(fm.title) || slug, str(fm.subtitle), str(fm.cover), str(fm.coverAlt)];
	const day = str(fm.day);
	const date = fm.date instanceof Date ? fm.date.toISOString().slice(0, 10) : str(fm.date);
	const where = `First published on the maiaCITY blog${day ? ` as Day ${day}` : ''}${date ? `, ${date}` : ''}`;
	const text = [
		subtitle && `*${subtitle}*`,
		PICTURE.test(cover) && `![${alt}](${cover})`,
		(m ? m[2] : raw).trim(),
		'---',
		`${where}: [read it there](/blog/${slug}/).`
	]
		.filter(Boolean)
		.join('\n\n');
	return { title, text, pictures: pictures(text) };
}
