// @ts-nocheck — plain JS
// Interests (./interest.js) against the laws of avendb/spec/AvenDB/Interest.lean.
import { expect, test } from 'bun:test';
import { TIERS, atMost, createInterest, normalizeWants, rank, schedule } from './interest.js';

const id = (i) => i.toString(16).padStart(64, '0');
const turn = () => new Promise((r) => setTimeout(r, 0));

// a seeded random list of works, for the laws over many cases
function works(seed, n = 40) {
	let x = seed;
	const next = () => (x = (x * 1103515245 + 12345) % 2147483648);
	return Array.from({ length: n }, () => ({ entry: id(next() % 12), tier: TIERS[next() % 4], dist: next() % 5 }));
}

test('schedule_ordered: a higher tier before a lower, the nearer first inside a tier', () => {
	for (let seed = 1; seed < 50; seed++) {
		const out = schedule(works(seed));
		for (let i = 1; i < out.length; i++) {
			const [a, b] = [out[i - 1], out[i]];
			expect(rank(a.tier) < rank(b.tier) || (a.tier === b.tier && a.dist <= b.dist)).toBe(true);
		}
	}
});

test('schedule_whole and schedule_once: exactly the entries wanted, each once', () => {
	for (let seed = 1; seed < 50; seed++) {
		const w = works(seed);
		const out = schedule(w).map((x) => x.entry);
		expect(new Set(out)).toEqual(new Set(w.map((x) => x.entry)));
		expect(out.length).toBe(new Set(out).size);
	}
});

test('schedule_best: an entry two wants name comes at the higher of their tiers', () => {
	for (let seed = 1; seed < 50; seed++) {
		const w = works(seed);
		for (const x of schedule(w)) {
			const best = Math.min(...w.filter((y) => y.entry === x.entry).map((y) => rank(y.tier)));
			expect(rank(x.tier)).toBe(best);
		}
	}
});

test('retier_same_set: moving tiers and signals changes the order alone', () => {
	for (let seed = 1; seed < 30; seed++) {
		const w = works(seed);
		const moved = w.map((x, i) => ({ ...x, tier: TIERS[(rank(x.tier) + i) % 4], dist: (x.dist * 7 + i) % 3 }));
		expect(new Set(schedule(moved).map((x) => x.entry))).toEqual(new Set(schedule(w).map((x) => x.entry)));
	}
	expect(schedule([])).toEqual([]);
});

test('a held part never comes above the tier it is held at (Tier.atMost)', () => {
	for (const cap of TIERS) for (const t of TIERS) expect(rank(atMost(cap, t))).toBeGreaterThanOrEqual(rank(cap));
	expect(atMost('now', 'later')).toBe('later');
	expect(atMost('next', 'now')).toBe('next');
});

test('wants go to the node in tiers, each entry once at its best tier, bounded', () => {
	const got = normalizeWants([
		{ tier: 'idle', entries: [id(1), id(2)] },
		{ tier: 'now', entries: [id(2), 'bad'], queries: [{ types: ['room'] }, { types: ['room'] }] },
		{ tier: 'later', queries: [{ types: ['cut'], vault: 'nope' }] }
	]);
	expect(got).toEqual([
		{ tier: 'now', entries: [id(2)], queries: [{ types: ['room'] }] },
		{ tier: 'idle', entries: [id(1)], queries: [] }
	]);
	const many = normalizeWants([{ tier: 'now', entries: Array.from({ length: 600 }, (_, i) => id(i)) }]);
	expect(many[0].entries.length).toBe(512);
});

test('one handle: a burst of sets is one op, an unmount clears it, and nothing renews it', async () => {
	const calls = [];
	const h = createInterest(async (op) => (calls.push(op), { ok: { accepted: true } }), { scope: 'a'.repeat(32) });
	h.set([{ tier: 'now', entries: [id(1)] }]);
	h.set([{ tier: 'now', entries: [id(2)] }, { tier: 'next', entries: [id(3)] }]);
	await turn();
	expect(calls).toEqual([{ op: 'interest', scope: 'a'.repeat(32), revision: 1, wants: [
		{ tier: 'now', entries: [id(2)], queries: [] }, { tier: 'next', entries: [id(3)], queries: [] }] }]);
	h.set([{ tier: 'next', entries: [id(3)] }, { tier: 'now', entries: [id(2)] }]);
	await turn();
	expect(calls.length).toBe(1);
	await new Promise((r) => setTimeout(r, 50));
	expect(calls.length).toBe(1);
	h.close();
	await turn();
	expect(calls[1]).toEqual({ op: 'interest', scope: 'a'.repeat(32), revision: 2, wants: [] });
	expect(await h.set([{ tier: 'now', entries: [id(9)] }])).toBe(false);
});

test('a node a release older gets the demand op instead, once a set', async () => {
	const calls = [];
	const h = createInterest(async (op) => {
		calls.push(op);
		return op.op === 'interest' ? { refused: 'BadOp', why: 'interest changes what the device holds: run it' } : { ok: { accepted: true, lease_ms: 90000 } };
	}, { scope: 'b'.repeat(32) });
	expect(await h.set([{ tier: 'now', entries: [id(1)], queries: [{ types: ['room'] }] }])).toBe(true);
	expect(calls.map((c) => c.op)).toEqual(['interest', 'demand']);
	expect(calls[1]).toMatchObject({ entries: [id(1)], queries: [{ types: ['room'] }] });
	await h.set([{ tier: 'now', entries: [id(2)] }]);
	expect(calls.map((c) => c.op)).toEqual(['interest', 'demand', 'demand']);
	// a bad interest of this node's is no sign of an older one
	const mine = [];
	const g = createInterest(async (op) => (mine.push(op), { refused: 'BadOp', why: "an interest's revision is a positive safe integer" }));
	expect(await g.set([{ tier: 'now', entries: [id(1)] }])).toBe(false);
	expect(mine.map((c) => c.op)).toEqual(['interest']);
	// a node that knows neither op is sent nothing more
	const none = [];
	const k = createInterest(async (op) => (none.push(op), { refused: 'BadOp' }));
	expect(await k.set([{ tier: 'now', entries: [id(1)] }])).toBe(false);
	expect(await k.set([{ tier: 'now', entries: [id(2)] }])).toBe(false);
	expect(none.map((c) => c.op)).toEqual(['interest', 'demand']);
});
