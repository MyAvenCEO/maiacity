// The base article, read the way the journal renders it: its front matter apart, the Markdown as HTML by the one
// Markdown engine ($lib/markdown: raw HTML shown as text, only safe links), a standalone image as a figure with its alt
// text as caption, every site path through the CDN (see $lib/media/url). Agents write these too, so nothing in them
// runs.
import { base } from '$app/paths';
import { journalHtml } from '$lib/markdown/journal.js';
import { parse as parseYaml } from 'yaml';
import { asset } from '$lib/media/url';

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export type Article = { title?: string; subtitle?: string; cover?: string; coverPosition?: string; excerpt?: string; body: string };

/** The front matter's title, subtitle, cover (and where it is cropped from) and excerpt, and the Markdown after it. */
export function splitArticle(md: string): Article {
	const m = md.match(FRONTMATTER);
	let fm: Record<string, unknown> = {};
	try {
		fm = (m ? parseYaml(m[1]) : null) ?? {};
	} catch {
		// a front matter that does not parse is shown as it is, below
		return { body: md };
	}
	const str = (v: unknown) => (v == null || v === '' ? undefined : String(v).trim());
	return { title: str(fm.title), subtitle: str(fm.subtitle), cover: asset(str(fm.cover)), coverPosition: str(fm.coverPosition), excerpt: str(fm.excerpt), body: m ? m[2] : md };
}

/** Markdown as the journal's HTML. `blocks` keeps only the first few paragraphs (headings and figures skipped). */
export function renderMarkdown(md: string, blocks?: number): string {
	let src = md;
	if (blocks) {
		const paras = md
			.split(/\n\s*\n/)
			.map((b) => b.trim())
			.filter((b) => b && !/^(#|!\[|<|---|\|)/.test(b));
		src = paras.slice(0, blocks).join('\n\n');
	}
	return journalHtml(src, base);
}

/** About how long it reads, at 200 words a minute. */
export const readingMinutes = (md: string) => Math.max(1, Math.round(md.split(/\s+/).length / 200));
