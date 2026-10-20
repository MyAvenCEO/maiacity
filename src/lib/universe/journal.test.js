// @ts-nocheck
// The journal on the front page (./journal.js): the days of the one stream, avenDB's feed, where it starts, the day
// after it and the newest.
// Run: bun test src/lib/universe/journal.test.js
import { describe, expect, test } from 'bun:test';
import { dayOf, frontOf } from './journal.js';

const day = (n, published, channel = 'Journal') => ({
	id: `d${n}`,
	channel,
	published,
	ago: null,
	tags: ['content:published', 'post:journal', ...(n == null ? [] : [`legacy:blog/day-${String(n).padStart(2, '0')}-words`])]
});

describe('the journal from the stream', () => {
	test('a day says which it was by the address it was brought in from', () => {
		expect(dayOf(day(7, '2026-09-15'))).toBe(7);
		expect(dayOf(day(null, '2026-10-01'))).toBeNull();
		expect(dayOf({ tags: ['legacy:inspire-me/x'] })).toBeNull();
	});

	test('it starts at day 1, then day 2, and the newest come last', () => {
		const posts = [day(19, '2026-09-28'), day(2, '2026-09-10'), day(1, '2026-06-21'), day(4, '2026-09-12'), day(18, '2026-09-25'), day(null, '2026-10-19'), day(null, '2026-10-01', 'Devlog')];
		const { pinned, next, latest } = frontOf(posts);
		expect(pinned.id).toBe('d1');
		expect(next.id).toBe('d2');
		// a journal post published since avenDB, with no day, is the newest; another channel's is none of the journal's
		expect(latest.map((p) => p.id)).toEqual(['dnull', 'd19', 'd18']);
	});

	test('an empty stream has no front door', () => {
		expect(frontOf([])).toEqual({ pinned: null, next: null, latest: [] });
	});
});
