// @ts-nocheck — plain JS, kept loose on purpose
// The stream held in memory and shared by the feed and the post pages, so a post shared a moment ago opens on its
// own page too. A reload starts it over from the hardcoded posts, then takes in avenDB's feed (`loadFeed`): every post
// published in avenDB that everyone may read, its author the vault that published it.
import { AUTHORS, FEED, POSTS, fromFeed, voiceOf } from './posts.js';

export const stream = $state({
	posts: POSTS.map((p) => ({ ...p, liked: false })),
	authors: { ...AUTHORS },
	// avenDB's feed: 'idle', 'loading', 'done' or 'failed'
	feed: 'idle'
});

export const findPost = (doc) => stream.posts.find((p) => p.doc === doc);

export const authorOf = (p) => stream.authors[p.author];

export function like(p) {
	p.liked = !p.liked;
	p.likes += p.liked ? 1 : -1;
}

// The posts of avenDB's feed in the stream, in place of those it served before: one taken off since leaves, one liked
// here stays liked; then the whole stream newest first.
function take(posts) {
	const now = Date.now() / 1000;
	const before = new Map(stream.posts.filter((p) => p.entry).map((p) => [p.entry, p]));
	for (const p of posts) stream.authors[p.vault] ??= voiceOf(p.vault, p.name, p.kind);
	const fed = posts.map((p) => {
		const had = before.get(p.entry);
		return { ...fromFeed(p, now), ...(had && { liked: had.liked, likes: had.likes }) };
	});
	stream.posts = [...stream.posts.filter((p) => !p.entry), ...fed].sort((a, b) => a.ago - b.ago);
}

let loading = null;

// Takes in avenDB's feed, once at a time: what its server keeps that everyone may read. Where it can't be reached,
// the stream keeps what it has.
export function loadFeed() {
	loading ??= (async () => {
		if (stream.feed !== 'done') stream.feed = 'loading';
		try {
			const r = await fetch(FEED, { headers: { accept: 'application/json' } });
			if (!r.ok) throw new Error(`avenDB's feed answers ${r.status}`);
			const { posts } = await r.json();
			take(Array.isArray(posts) ? posts : []);
			stream.feed = 'done';
		} catch (e) {
			console.warn('Maia Universe:', e);
			if (stream.feed !== 'done') stream.feed = 'failed';
		} finally {
			loading = null;
		}
	})();
	return loading;
}
