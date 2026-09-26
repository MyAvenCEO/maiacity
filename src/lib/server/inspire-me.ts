import { asset } from '$lib/media/url';
import { base } from '$app/paths';
import { marked } from 'marked';
import { parse as parseYaml } from 'yaml';
import type {
	Author,
	InspirationEntry,
	InspirationMeta,
	InspirationSection,
	SourceType
} from '$lib/inspire-me/types';

// Content lives in /inspiration/<slug>/README.md (report card) and /inspiration/<slug>/source.md (raw source).
const reports = import.meta.glob('/inspire-me/*/README.md', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

const sources = import.meta.glob('/inspire-me/*/source.md', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

// Author portraits live in static/authors/<slug>.jpg and are optional.
const portraits = new Set(
	Object.keys(import.meta.glob('/static/authors/*.jpg')).map((path) =>
		path.split('/').at(-1)!.replace(/\.jpg$/, '')
	)
);

const portraitFor = (slug?: string) =>
	slug && portraits.has(slug) ? asset(`/authors/${slug}.jpg`) : undefined;

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

const slugOf = (path: string) => path.split('/').at(-2)!;

// Report cards link to each other with absolute paths; GitHub Pages serves them under a base.
const toHtml = (md: string) =>
	marked.parse(md, { async: false }).replace(/href="\//g, `href="${base}/`);

const optional = (value: unknown) => (value == null || value === '' ? undefined : String(value));

function youtubeId(url: string): string | undefined {
	try {
		const u = new URL(url);
		if (u.hostname === 'youtu.be') return u.pathname.slice(1) || undefined;
		if (u.hostname.endsWith('youtube.com')) {
			if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2];
			return u.searchParams.get('v') ?? undefined;
		}
	} catch {
		// not a URL
	}
	return undefined;
}

function slugify(text: string) {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

function parseReport(slug: string, raw: string): { meta: InspirationMeta; body: string } {
	const match = raw.match(FRONTMATTER);
	const fm = (match ? parseYaml(match[1]) : null) ?? {};
	const source = String(fm.source ?? '');

	return {
		meta: {
			slug,
			title: String(fm.title ?? slug),
			originalTitle: optional(fm.originalTitle),
			source,
			type: (fm.type ?? 'article') as SourceType,
			author: optional(fm.author),
			authorSlug: fm.author ? slugify(String(fm.author)) : undefined,
			authorImage: fm.author ? portraitFor(slugify(String(fm.author))) : undefined,
			authorUrl: optional(fm.authorUrl),
			via: optional(fm.via),
			published: optional(fm.published),
			added: String(fm.added ?? ''),
			categories: Array.isArray(fm.categories) ? fm.categories.map(String) : [],
			hook: String(fm.hook ?? '').trim(),
			shift:
				fm.shift?.from && fm.shift?.to
					? { from: String(fm.shift.from), to: String(fm.shift.to) }
					: undefined,
			quote: optional(fm.quote),
			quoteBy: optional(fm.quoteBy),
			language: optional(fm.language),
			youtubeId: youtubeId(source)
		},
		body: match ? match[2] : raw
	};
}

// "Beliefs that shift" bullets read `*old belief.* → new understanding.` — split them at the
// arrow so the page can lay the two halves out side by side.
const SHIFT_SECTION = 'beliefs-that-shift';

function splitShiftItems(html: string): string {
	return html.replace(/<li>([\s\S]*?)<\/li>/g, (item, inner: string) => {
		const arrow = inner.indexOf('→');
		if (arrow === -1) return item;
		const before = inner.slice(0, arrow).trim();
		const after = inner.slice(arrow + 1).trim();
		return `<li><span class="was">${before}</span><span class="becomes" aria-hidden="true">→</span><span class="now">${after}</span></li>`;
	});
}

// Each `## Heading` becomes one report-card section; text before the first heading is an intro.
function splitSections(body: string): InspirationSection[] {
	const [intro, ...parts] = body.split(/^## +/m);
	const sections: InspirationSection[] = [];

	if (intro.trim()) sections.push({ id: 'intro', title: '', html: toHtml(intro.trim()) });

	for (const part of parts) {
		const newline = part.indexOf('\n');
		const title = (newline === -1 ? part : part.slice(0, newline)).trim();
		const content = newline === -1 ? '' : part.slice(newline + 1).trim();
		const id = slugify(title);
		const html = toHtml(content);
		sections.push({ id, title, html: id === SHIFT_SECTION ? splitShiftItems(html) : html });
	}

	return sections;
}

export function listEntries(): InspirationMeta[] {
	return Object.entries(reports)
		.map(([path, raw]) => parseReport(slugOf(path), raw).meta)
		.sort((a, b) => b.added.localeCompare(a.added) || a.title.localeCompare(b.title));
}

export function getEntry(slug: string): InspirationEntry | undefined {
	const raw = reports[`/inspire-me/${slug}/README.md`];
	if (raw === undefined) return undefined;

	const { meta, body } = parseReport(slug, raw);
	const source = sources[`/inspire-me/${slug}/source.md`]?.trim();

	return {
		...meta,
		sections: splitSections(body),
		sourceHtml: source ? toHtml(source) : null,
		sourceWords: source ? source.split(/\s+/).length : 0
	};
}

// Every author gets their own page collecting what they made, across platforms.
export function listAuthors(): Author[] {
	const authors = new Map<string, Author>();

	for (const entry of listEntries()) {
		if (!entry.authorSlug || !entry.author) continue;

		const author = authors.get(entry.authorSlug) ?? {
			slug: entry.authorSlug,
			name: entry.author,
			image: entry.authorImage,
			urls: [],
			entries: []
		};

		if (entry.authorUrl && !author.urls.includes(entry.authorUrl)) author.urls.push(entry.authorUrl);
		author.entries.push(entry);
		authors.set(author.slug, author);
	}

	return [...authors.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getAuthor(slug: string): Author | undefined {
	return listAuthors().find((author) => author.slug === slug);
}
