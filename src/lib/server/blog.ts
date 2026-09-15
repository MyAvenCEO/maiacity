import { dev } from '$app/environment';
import { base } from '$app/paths';
import { marked } from 'marked';
import { parse as parseYaml } from 'yaml';
import type { Post, PostMeta } from '$lib/blog/types';

// Hand-written articles live in /blog/<slug>/post.md.
const posts = import.meta.glob('/blog/*/post.md', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

const slugOf = (path: string) => path.split('/').at(-2)!;

const optional = (value: unknown) => (value == null || value === '' ? undefined : String(value));

const withBase = (html: string) =>
	html.replace(/src="\//g, `src="${base}/`).replace(/href="\//g, `href="${base}/`);

// A standalone image becomes a figure; its alt text becomes the caption.
const asFigures = (html: string) =>
	html.replace(
		/<p><img src="([^"]*)" alt="([^"]*)"[^>]*><\/p>/g,
		(_, src: string, alt: string) =>
			`<figure><img src="${src}" alt="${alt}" loading="lazy" />${alt ? `<figcaption>${alt}</figcaption>` : ''}</figure>`
	);

function parsePost(slug: string, raw: string): { meta: PostMeta; body: string } {
	const match = raw.match(FRONTMATTER);
	const fm = (match ? parseYaml(match[1]) : null) ?? {};
	const body = match ? match[2] : raw;

	return {
		meta: {
			slug,
			title: String(fm.title ?? slug),
			subtitle: optional(fm.subtitle),
			day: fm.day == null ? undefined : Number(fm.day),
			author: String(fm.author ?? 'avenSamuel'),
			authorImage: optional(fm.authorImage),
			authorRole: optional(fm.authorRole),
			date: String(fm.date ?? ''),
			cover: optional(fm.cover),
			video: optional(fm.video),
			videoLibrary: optional(fm.videoLibrary),
			coverAlt: optional(fm.coverAlt),
			excerpt: String(fm.excerpt ?? '').trim(),
			categories: Array.isArray(fm.categories) ? fm.categories.map(String) : [],
			draft: fm.draft === true,
			readingMinutes: Math.max(1, Math.round(body.split(/\s+/).length / 200))
		},
		body
	};
}

// Drafts are visible while developing and never published.
export function listPosts(): PostMeta[] {
	return Object.entries(posts)
		.map(([path, raw]) => parsePost(slugOf(path), raw).meta)
		.filter((post) => dev || !post.draft)
		.sort((a, b) => (b.day ?? 0) - (a.day ?? 0) || b.date.localeCompare(a.date));
}

export function getPost(slug: string): Post | undefined {
	const raw = posts[`/blog/${slug}/post.md`];
	if (raw === undefined) return undefined;

	const { meta, body } = parsePost(slug, raw);
	if (meta.draft && !dev) return undefined;
	return { ...meta, html: asFigures(withBase(marked.parse(body, { async: false }))) };
}
