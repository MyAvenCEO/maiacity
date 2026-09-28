// The days not published yet, for an admin's eyes only. The static site never carries them: they come from the
// content board, in the browser, and only in a browser that has been seen as admin before (the layout's hint) —
// everyone else gets no request at all out of this, and nothing to see.
import { base } from '$app/paths';
import { listContent, may, me, type ContentItem } from '$lib/auth/client';
import type { BoardState, PostMeta } from './types';

const HINT = 'maia:admin';

const hinted = () => {
	try {
		return localStorage.getItem(HINT) === '1';
	} catch {
		return false;
	}
};

/** Where a post is read: its own page, or the preview of an unpublished day. */
export const postHref = (post: PostMeta) => post.href ?? `${base}/blog/${post.slug}`;

export const previewHref = (day: number) => `${base}/blog/preview/?day=${day}`;

// one answer shared by everything on the page (the list, the door, the latest rows), asked again after a while
let asked: { at: number; items: Promise<ContentItem[] | null> } | null = null;

/** The content board's items — for someone holding content:admin; null for everyone else. */
export function boardItems(): Promise<ContentItem[] | null> {
	if (typeof window === 'undefined' || !hinted()) return Promise.resolve(null);
	if (asked && Date.now() - asked.at < 30_000) return asked.items;
	const items = me()
		.then((f) => (may(f, 'content:admin') ? listContent().then((r) => r.items) : null))
		.catch(() => null);
	asked = { at: Date.now(), items };
	return items;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const optional = (value: unknown) => (value == null || value === '' ? undefined : String(value));

/** The day a card is about: its project ("Day 19"), else the day in its source path. */
export function dayOf(item: ContentItem): number | undefined {
	const m = item.project?.match(/^day\s*0*(\d+)$/i) ?? item.source?.match(/(?:^|\/)day-0*(\d+)-/);
	return m ? Number(m[1]) : undefined;
}

/** A day's card on the board is one with a base article: a project "Day N" (or a journal source) and a body. */
const isDay = (item: ContentItem) => dayOf(item) != null && !!item.body?.trim();

/** When the journal post goes out: its own date on the board, else the card's. */
function boardState(item: ContentItem): BoardState {
	const journal = item.posts?.find((p) => p.platform === 'journal');
	return { status: item.status, goesOut: journal?.scheduled_at ?? item.scheduled_at ?? null };
}

/**
 * A card's base article, read the way the journal reads a post.md: the front matter as the post's meta (the same
 * fields, the same defaults as $lib/server/blog), and the Markdown after it.
 */
export async function draftOf(item: ContentItem): Promise<{ meta: PostMeta; body: string }> {
	const { parse } = await import('yaml');
	const match = item.body.match(FRONTMATTER);
	let fm: Record<string, any> = {};
	try {
		fm = (match ? parse(match[1]) : null) ?? {};
	} catch {
		// a front matter that doesn't parse still leaves the card's own title and the words
	}
	const body = match ? match[2] : item.body;
	const day = fm.day == null ? dayOf(item) : Number(fm.day);
	const slug = item.source?.match(/(?:^|\/)blog\/([^/]+)\/post\.md$/)?.[1] ?? `day-${String(day ?? 0).padStart(2, '0')}`;
	const board = boardState(item);

	return {
		meta: {
			slug,
			title: String(fm.title ?? item.title ?? slug),
			subtitle: optional(fm.subtitle),
			day,
			author: String(fm.author ?? 'avenSAMUEL'),
			authorImage: optional(fm.authorImage),
			authorRole: optional(fm.authorRole),
			date: String(fm.date ?? board.goesOut ?? ''),
			cover: optional(fm.cover),
			video: optional(fm.video),
			videoLocal: optional(fm.videoLocal),
			poster: optional(fm.poster),
			videoAspect: optional(fm.videoAspect),
			videoLibrary: optional(fm.videoLibrary),
			coverAlt: optional(fm.coverAlt),
			coverPosition: optional(fm.coverPosition),
			excerpt: String(fm.excerpt ?? '').trim(),
			categories: Array.isArray(fm.categories) ? fm.categories.map(String) : [],
			draft: true,
			readingMinutes: Math.max(1, Math.round(body.split(/\s+/).length / 200)),
			href: day != null ? previewHref(day) : undefined,
			board
		},
		body
	};
}

/** Every day on the board, as posts — for an admin; null for everyone else. */
export async function boardDays(): Promise<PostMeta[] | null> {
	const items = await boardItems();
	if (!items) return null;
	return Promise.all(items.filter(isDay).map(async (item) => (await draftOf(item)).meta));
}

/** Newest day first, the order of the journal (as $lib/server/blog sorts it). */
export const byDay = (a: PostMeta, b: PostMeta) => (b.day ?? 0) - (a.day ?? 0) || b.date.localeCompare(a.date);

/**
 * The static list with the board's days mixed in: every day the site doesn't carry yet (not published) joins it in
 * its day order, marked with where it stands; a draft the site does carry (only while developing) is marked too.
 */
export function mergeDays(posts: PostMeta[], days: PostMeta[] | null): PostMeta[] {
	if (!days?.length) return posts;
	const board = new Map(days.map((d) => [d.day, d]));
	const have = new Set(posts.map((p) => p.day));
	const marked = posts.map((p) => {
		const d = p.day != null ? board.get(p.day) : undefined;
		return p.draft && d?.board ? { ...p, board: d.board } : p;
	});
	return [...marked, ...days.filter((d) => d.day != null && !have.has(d.day))].sort(byDay);
}
