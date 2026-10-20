// @ts-nocheck — plain JS, kept loose on purpose
// The journal as the front page shows it, from the one stream (./stream.svelte.js): the posts of avenDB's feed on the
// Journal channel, the same posts /universe shows. A day of the journal from before avenDB says which day it was by the
// address it was brought in from (`legacy:blog/day-NN-…`); a journal post published since says none.
// (2026-10-20: every day the repository kept in blog/day-*/post.md was checked to be in the feed, so the site reads
// none of those files any more.)

export const JOURNAL = 'Journal';

const DAY = /^legacy:blog\/day-(\d+)\b/;

// the day of the journal post `p` was, by the address it was brought in from; null for none
export function dayOf(p) {
	for (const t of p.tags ?? []) {
		const m = DAY.exec(t);
		if (m) return Number(m[1]);
	}
	return null;
}

// when post `p` first went out, in milliseconds, for putting the days in order: the day it says, else its age
const when = (p) => {
	const day = Date.parse(p.published);
	return Number.isFinite(day) ? day : p.ago == null ? 0 : Date.now() - p.ago * 60_000;
};

// The front door of the journal among the stream's `posts`: where it starts (day 1, else its first post), the post
// after it (`next`), and the `n` newest of the rest (`latest`).
export function frontOf(posts, n = 3) {
	const days = posts.filter((p) => p.channel === JOURNAL);
	// oldest first: by the day where it says one, else by when it went out
	const first = [...days].sort((a, b) => (dayOf(a) ?? Infinity) - (dayOf(b) ?? Infinity) || when(a) - when(b));
	const pinned = first.find((p) => dayOf(p) === 1) ?? first[0] ?? null;
	const next = pinned ? (first[first.indexOf(pinned) + 1] ?? null) : null;
	const latest = [...days]
		.sort((a, b) => (dayOf(b) ?? Infinity) - (dayOf(a) ?? Infinity) || when(b) - when(a))
		.filter((p) => p !== pinned && p !== next)
		.slice(0, n);
	return { pinned, next, latest };
}
