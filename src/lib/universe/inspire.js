// @ts-nocheck — plain JS, kept loose on purpose
// An inspire post's report card, as the Universe lays it out (./InspirePost.svelte), drawn from the entries everyone
// may read in its vault: the post (the report, of post type `inspire`: its text, its quote), the story it was drawn
// from (the shift, the hook, the categories) and the story's spark, whose source artifact is what inspired it (the
// link, whose words, its picture, its transcript). The story is the source of truth; the report card is how a post of
// type inspire is laid out (Samuel 2026-10-17: only stories and their posts, each post type its own layout).
import { base } from '$app/paths';
import { entryOf, youtubeId } from '$lib/avendb/artifacts.js';
import { journalHtml } from '$lib/markdown/journal.js';
import { asset } from '$lib/media/url';

/** The tag of an inspire post ($lib/avendb/posttypes.js `postTag('inspire')`). */
export const INSPIRE_POST = 'post:inspire';

// a report links its own sections with absolute paths, under the site's base
const toHtml = (md) => journalHtml(md, base);

const slugify = (text) =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');

// "Beliefs that shift" bullets read `*old belief.* → new understanding.`: split at the arrow, so the page lays the two
// halves out side by side
const SHIFTS = 'beliefs-that-shift';
const splitShifts = (html) =>
	html.replace(/<li>([\s\S]*?)<\/li>/g, (item, inner) => {
		const arrow = inner.indexOf('→');
		if (arrow === -1) return item;
		return `<li><span class="was">${inner.slice(0, arrow).trim()}</span><span class="becomes" aria-hidden="true">→</span><span class="now">${inner.slice(arrow + 1).trim()}</span></li>`;
	});

/** Each `## Heading` of a report one section of its card; what comes before the first, its intro. */
export function sectionsOf(md) {
	const [intro, ...parts] = md.split(/^## +/m);
	const sections = intro.trim() ? [{ id: 'intro', title: '', html: toHtml(intro.trim()) }] : [];
	for (const part of parts) {
		const nl = part.indexOf('\n');
		const title = (nl === -1 ? part : part.slice(0, nl)).trim();
		const id = slugify(title);
		const html = toHtml(nl === -1 ? '' : part.slice(nl + 1).trim());
		sections.push({ id, title, html: id === SHIFTS ? splitShifts(html) : html });
	}
	return sections;
}

/** The pictures YouTube shows of video `id`, the sharpest first, the one every video has after it. */
export const youtubePictures = (id) => [
	`https://i.ytimg.com/vi/${encodeURIComponent(id)}/maxresdefault.jpg`,
	`https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`
];

/**
 * Post `post`'s report card, where it is an inspire post and `entries` (the feed's public entries, by id) hold it
 * and its story; `null` for any other post. What its story or source doesn't give, it goes without.
 */
export function inspireOf(post, entries) {
	if (!post?.tags?.includes(INSPIRE_POST)) return null;
	const record = (id) => (id ? entries.get(entryOf(id))?.record : null) ?? null;
	const report = record(post.entry);
	const story = record(report?.story ?? post.about);
	if (!report || !story) return null;
	const spark = record(story.sparks?.[0]) ?? {};
	const source = record((spark.items ?? []).find((i) => i.what === 'artifact')?.ref) ?? {};
	const id = source.url ? youtubeId(source.url) : null;
	const by = source.by ?? {};
	const words = (source.transcript ?? []).map((r) => r.text).filter(Boolean);
	const named = source.title && source.title !== report.title && !source.title.startsWith('YouTube · ');
	return {
		title: report.title || post.title,
		originalTitle: named ? source.title : '',
		source: source.url ?? '',
		type: source.look === 'youtube' || source.look === 'video' ? 'video' : 'article',
		author: by.name ?? '',
		authorImage: by.image ? asset(by.image) : '',
		added: post.published || story.launch || '',
		published: source.taken ?? '',
		categories: story.categories ?? [],
		hook: story.description || report.excerpt || '',
		shift: story.from && story.to ? { from: story.from, to: story.to } : null,
		quote: report.quote?.text ?? '',
		quoteBy: report.quote?.by || by.name || '',
		language: report.language || source.language || '',
		thumbnails: id ? youtubePictures(id) : [],
		sections: sectionsOf(report.text || story.text || ''),
		sourceHtml: words.length ? toHtml(words.join('\n\n')) : null,
		sourceWords: words.join(' ').split(/\s+/).filter(Boolean).length
	};
}
