// What the board and the calendar both know about a snippet: the names of its steps, how a move changes it, which
// channels its posts reach, what kind of thing each post is and when it goes out, the cuts it was delivered in, and
// the small picture a card shows.
import { STATUSES, type ContentItem, type Delivery, type Format, type Platform, type Post, type Status } from '$lib/auth/client';

export const STATUS_LABEL: Record<Status, string> = {
	idea: 'Idea',
	hook: 'Hook',
	draft: 'Draft',
	derivatives: 'Derivatives',
	scheduled: 'Scheduled',
	published: 'Published'
};

/** The platforms in the order they are always shown: our own journal first, where the base article goes out. */
export const PLATFORMS: Platform[] = ['journal', 'youtube', 'linkedin', 'x', 'instagram'];
export const PLATFORM_LABEL: Record<Platform, string> = {
	journal: 'Blog',
	youtube: 'YouTube',
	linkedin: 'LinkedIn',
	x: 'X',
	instagram: 'Instagram'
};

/** The kinds of thing a post is, in the order a day is read: the articles, the films, then the words. */
export const FORMATS: Format[] = ['article', 'video', 'short', 'reel', 'thread', 'post'];
export const FORMAT_LABEL: Record<Format, string> = {
	article: 'Article',
	video: 'Video',
	short: 'Short',
	reel: 'Reel',
	thread: 'Thread',
	post: 'Post'
};

/** A post's format, guessed from its shape when an older post does not say. */
export function formatOf(p: Post): Format {
	if (p.format) return p.format;
	if (p.platform === 'journal') return 'article';
	if (p.thread?.length) return 'thread';
	if (p.platform === 'instagram') return (p.placement ?? (p.aspect === '9:16' ? 'reel' : 'feed')) === 'reel' ? 'reel' : 'video';
	return p.codec ? 'video' : 'post';
}

/** "Instagram feed", "Instagram Reel", "YouTube", "YouTube Short", "X Article" */
export function placeLabel(p: Post) {
	if (p.platform === 'instagram') return `Instagram ${(p.placement ?? (p.aspect === '9:16' ? 'reel' : 'feed')) === 'reel' ? 'Reel' : 'feed'}`;
	const name = PLATFORM_LABEL[p.platform] ?? p.platform;
	if (p.platform === 'youtube' && p.format === 'short') return `${name} Short`;
	if (p.platform === 'x' && p.format === 'article') return `${name} Article`;
	return name;
}

/** Where it goes and what it is, said once: "YouTube · Video", "Blog · Article", but "YouTube Short", "X Article", "Instagram Reel". */
export function postLabel(p: Post) {
	const place = placeLabel(p);
	const kind = FORMAT_LABEL[formatOf(p)] ?? formatOf(p);
	return place.toLowerCase().endsWith(kind.toLowerCase()) ? place : `${place} · ${kind}`;
}

/** The first line a post says: its title, else the start of its words. */
export const firstLine = (p: Post) => (p.title || p.thread?.[0] || p.text || '').split('\n').find((l) => l.trim())?.trim() ?? '';

/** A step's name, also for one the API knows and this page does not yet. */
export const statusLabel = (s: string) => STATUS_LABEL[s as Status] ?? s.charAt(0).toUpperCase() + s.slice(1);

/** The step before or after in the API's order, or null at either end. */
export const step = (s: Status, by: -1 | 1, order: readonly Status[] = STATUSES): Status | null => order[order.indexOf(s) + by] ?? null;

/** Tomorrow, 09:00 local: when a snippet moved to Scheduled without a date goes out. */
export function nextMorning() {
	const d = new Date();
	return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 9, 0).toISOString();
}

/** What changes when a snippet moves to another step: the step, and a date if it is scheduled without one. */
export const movePatch = (i: ContentItem, status: Status): Partial<ContentItem> =>
	status === 'scheduled' && !i.scheduled_at ? { status, scheduled_at: nextMorning() } : { status };

/** That day, at the time of `was` (or 09:00). */
export function onDay(day: Date, was?: string | null) {
	const t = was ? new Date(was) : new Date(0, 0, 0, 9, 0);
	return new Date(day.getFullYear(), day.getMonth(), day.getDate(), t.getHours(), t.getMinutes()).toISOString();
}

/** A snippet put on a day: that day, at the time it had (or 09:00), and scheduled. */
export const dayPatch = (i: ContentItem, day: Date): Partial<ContentItem> => ({ scheduled_at: onDay(day, i.scheduled_at), status: 'scheduled' });

/** One thing going out: a post of an item (index into its posts), or the item itself when it has no posts (-1). */
export type Entry = { item: ContentItem; post: Post | null; index: number; when: string | null; format: Format };

const ITEM_FORMAT: Record<string, Format> = { film: 'video', short: 'short', reel: 'reel', thread: 'thread', article: 'article', newsletter: 'article' };

/** Everything an item puts out, each at its own time (a post without one goes out with the item). */
export function entriesOf(i: ContentItem): Entry[] {
	const posts = i.posts ?? [];
	if (!posts.length) return [{ item: i, post: null, index: -1, when: i.scheduled_at, format: ITEM_FORMAT[i.kind] ?? 'post' }];
	return posts.map((p, index) => ({ item: i, post: p, index, when: p.scheduled_at ?? i.scheduled_at, format: formatOf(p) }));
}

/** Entries colocated by what they are: one group per format, in format order, each group in time order. */
export function byFormat(entries: Entry[]) {
	const groups = FORMATS.map((format) => ({
		format,
		entries: entries
			.filter((e) => e.format === format)
			.sort((a, b) => (a.when ?? '').localeCompare(b.when ?? '') || PLATFORMS.indexOf(a.post?.platform ?? 'journal') - PLATFORMS.indexOf(b.post?.platform ?? 'journal'))
	}));
	return groups.filter((g) => g.entries.length);
}

/** The same moment, whatever way its time was written. */
const moment = (when: string | null) => (when ? Math.floor(new Date(when).getTime() / 60000) : null);

/** Entries going out at the same minute, together: one slot per time, in time order, its posts in platform order. */
export function slotsOf(entries: Entry[]) {
	const slots: { when: string | null; entries: Entry[] }[] = [];
	for (const e of entries) {
		const slot = slots.find((s) => moment(s.when) === moment(e.when));
		if (slot) slot.entries.push(e);
		else slots.push({ when: e.when, entries: [e] });
	}
	for (const s of slots) s.entries.sort((a, b) => PLATFORMS.indexOf(a.post?.platform ?? 'journal') - PLATFORMS.indexOf(b.post?.platform ?? 'journal'));
	return slots.sort((a, b) => (moment(a.when) ?? Infinity) - (moment(b.when) ?? Infinity));
}

/**
 * The launch: the first moment two or more platforms go out together, whatever each posts there, and what goes out
 * then. Null when every platform goes at its own time.
 */
export function launchOf(entries: Entry[]) {
	const slot = slotsOf(entries.filter((e) => e.when && e.post)).find((s) => new Set(s.entries.map((e) => e.post!.platform)).size > 1);
	return slot ? { when: slot.when!, entries: slot.entries } : null;
}

/** Whether an entry goes out at that moment. */
export const sameMoment = (a: string | null, b: string | null) => a != null && moment(a) === moment(b);

/** The channels its posts cover, in platform order. */
export const channelsOf = (i: ContentItem) => PLATFORMS.filter((p) => (i.posts ?? []).some((x) => x.platform === p));

/** The names of the cuts it was delivered in: "Full shots 2", "Reel 90s". */
export const cutsOf = (i: ContentItem) => [...new Set((i.deliveries ?? []).map((d) => d.cut).filter((c): c is string => !!c))];

/** The small picture a card shows: the 16:9 thumbnail, else the 1:1 one. */
export const thumbOf = (i: ContentItem): Delivery | undefined => {
	const thumbs = (i.deliveries ?? []).filter((d) => d.kind === 'thumbnail');
	return thumbs.find((d) => d.aspect === '16:9') ?? thumbs.find((d) => d.aspect === '1:1');
};

export const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** "Tue 29 Sep · 09:00" */
export const dateLabel = (iso: string) =>
	`${new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} · ${timeLabel(iso)}`;
