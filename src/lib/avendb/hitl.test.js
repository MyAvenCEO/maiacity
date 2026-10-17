// @ts-nocheck — plain JS
// The HITL queue off the `aips` read (./hitl.js): which AIPs ask a vault, which come back to their author, how many
// wait, the one op that answers, and the card's words.
// Run: bun test src/lib/avendb/hitl.test.js
import { expect, test } from 'bun:test';
import { REVIEW_V1, answering, asksOf, countsOf, detail, lead, revisionsOf, signed, top } from './hitl.js';

const hex = (n) => n.toString(16).padStart(64, '0');
const ALICE = hex(1);
const AGENT = hex(2);
const BOB = hex(3);

/** An AIP as `aips` lists it, in Alice's vault, by the agent, proposed. */
const aip = (n, more = {}) => ({
	bare: false,
	entry: hex(100 + n),
	vault: ALICE,
	key: 'k' + String(n).padStart(7, '0'),
	number: n,
	label: `AIP-${n}`,
	title: `Change ${n}`,
	note: '',
	stage: 'proposed',
	outcome: null,
	why: null,
	was: null,
	tags: [],
	author: AGENT,
	links: [],
	lines: [{ entry: hex(200 + n), line: hex(300 + n), type: 'note', title: 'Note', name: null, heads: [], merged: false }],
	reviews: [],
	signatures: { have: 0, need: 1, of: 'owners' },
	summary: [],
	...more
});

const review = (verdict, current, text = '') => ({ review: hex(400), verdict, text, heads: [], by: ALICE, at: 1, current });

test('only promoted AIPs in the vault, not its own and not answered as they stand, ask it, the oldest number first', () => {
	const aips = [
		aip(3),
		aip(1),
		aip(2, { stage: 'idea', number: 2, label: null }),
		aip(4, { author: ALICE }),
		aip(5, { vault: BOB }),
		aip(6, { reviews: [review('accepted', true)] }),
		aip(7, { reviews: [review('revise', false)] }),
		aip(8, { stage: 'archived', outcome: 'applied' }),
		{ ...aip(9), bare: true, entry: null, number: null, label: null }
	];
	expect(asksOf(ALICE, aips).map((a) => a.number)).toEqual([1, 3, 7]);
	expect(asksOf(BOB, aips).map((a) => a.number)).toEqual([5]);
	expect(countsOf([ALICE, BOB], aips)).toEqual({ [ALICE]: 3, [BOB]: 1 });
});

test("a revise goes back to the AIP's author while it is an idea again", () => {
	const back = aip(1, { stage: 'idea', reviews: [review('revise', false, 'Fewer steps')] });
	const declined = aip(2, { stage: 'idea', reviews: [review('declined', false)] });
	const promoted = aip(3, { reviews: [review('revise', false)] });
	const aips = [back, declined, promoted, { ...back, entry: hex(9), author: BOB }];
	expect(revisionsOf(AGENT, aips)).toEqual([back]);
	expect(revisionsOf(ALICE, aips)).toEqual([]);
});

test('an answer is one aip_review over every line, acting for the vault', () => {
	const a = aip(1, { lines: [...aip(1).lines, { ...aip(1).lines[0], line: hex(301) }] });
	expect(answering(a, 'accepted', 'Yes', ALICE)).toEqual([
		{ op: 'aip_review', entry: a.entry, verdict: 'accepted', text: 'Yes', as: ALICE }
	]);
	expect(answering(a, 'revise', 'x'.repeat(2500), ALICE)[0].text).toHaveLength(2000);
});

test("the card's words: More detail in the Proposals app, the note's lead, the top of the summary, the signatures", () => {
	expect(detail(hex(5))).toBe(`/app/aips/?aip=${hex(5)}`);
	expect(lead('One\n\nTwo\nThree\nFour')).toBe('One\nTwo\nThree…');
	expect(lead('One\nTwo')).toBe('One\nTwo');
	expect(top(['a', 'b', 'c', 'd', 'e'])).toEqual({ shown: ['a', 'b', 'c'], more: 2 });
	expect(top(['a'])).toEqual({ shown: ['a'], more: 0 });
	expect(signed({ have: 0, need: 1, of: 'owners' })).toBe('0 of 1 owner');
	expect(signed({ have: 1, need: 2, of: 'owners' })).toBe('1 of 2 owners');
});

test('the review schema keeps the bytes avenDB ships, so its id', () => {
	const schema = JSON.parse(REVIEW_V1);
	expect(schema.title).toBe('Review, v1');
	expect(schema.required).toEqual(['kind', 'entry', 'line', 'heads', 'verdict']);
	expect(REVIEW_V1.endsWith('}\n')).toBe(true);
});
