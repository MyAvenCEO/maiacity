// @ts-nocheck — plain JS
// The ops the page grants an agent by (./vaults.js): a standing grant, and the AIP author's shares a Suggester gets
// beside its Suggester's, as the Mac's grant passes them on (avendb-device's `agent::pass_on_aips`).
// Run: bun test src/lib/avendb/vaults.test.js
import { expect, test } from 'bun:test';
import { AIP_AUTHOR, AIPS, aipAuthorOps, standingOps } from './vaults.js';

const hex = (n) => n.toString(16).padStart(64, '0');
const [MINE, COOP, AVEN, AGENT, HIRED] = [1, 2, 3, 4, 5].map(hex);
const KINDS = [
	{ kind: 'human', ownedBy: 'signers', most: null, devices: true, each: null },
	{ kind: 'coop', ownedBy: ['human', 'coop'], most: null, devices: false, each: null },
	{ kind: 'aven', ownedBy: ['human'], most: 1, devices: false, each: 1 },
	{ kind: 'device', ownedBy: ['human', 'coop', 'aven'], most: 1, devices: true, each: null }
];
const vault = (id, kind, owner, via) => ({ id, kind, owners: owner ? [{ vault: owner }] : [], via });
/** The person's world: their vault, a coop it owns, their aven and its agent, and a coop that hired the aven. */
const world = (shares = []) => ({
	mine: MINE,
	vaults: [
		vault(MINE, 'human', null, null),
		vault(COOP, 'coop', MINE, [MINE]),
		vault(AVEN, 'aven', MINE, [MINE]),
		vault(AGENT, 'device', AVEN, [MINE, AVEN]),
		vault(HIRED, 'coop', hex(9), null)
	],
	shares,
	kinds: KINDS
});
const share = (who, over, as) => ({ op: 'share', over, who: { vault: who }, level: AIP_AUTHOR, what: AIPS, as });
const cap = (over, who, more) => ({ over, who, wide: false, group: null, slice: null, ...more });

test('a vault of the person’s gives the aven its AIP author share first, and the aven passes one on', () => {
	expect(aipAuthorOps(world(), MINE, AVEN, AGENT)).toEqual([share(AVEN, MINE, MINE), share(AGENT, MINE, AVEN)]);
	expect(aipAuthorOps(world(), COOP, AVEN, AGENT)).toEqual([share(AVEN, COOP, COOP), share(AGENT, COOP, AVEN)]);
	expect(aipAuthorOps(world(), AVEN, AVEN, AGENT)).toEqual([share(AGENT, AVEN, AVEN)]);
});

test('the aven passes on what it holds already, and an agent that holds one gets none again', () => {
	const held = cap(MINE, AVEN, { slice: { name: 'AIP author' } });
	expect(aipAuthorOps(world([held]), MINE, AVEN, AGENT)).toEqual([share(AGENT, MINE, AVEN)]);
	const editor = cap(HIRED, AVEN, { wide: true, group: 'Editor' });
	expect(aipAuthorOps(world([editor]), HIRED, AVEN, AGENT)).toEqual([share(AGENT, HIRED, AVEN)]);
	const has = cap(MINE, AGENT, { slice: { name: 'AIP author' } });
	expect(aipAuthorOps(world([has]), MINE, AVEN, AGENT)).toEqual([]);
});

test('a coop that hired the aven as a Suggester alone gives its agent no AIP author share', () => {
	const suggester = cap(HIRED, AVEN, { wide: true, group: 'Suggester' });
	expect(aipAuthorOps(world([suggester]), HIRED, AVEN, AGENT)).toEqual([]);
});

test('a standing Suggester brings AIP author shares over each vault of the person’s now; a Viewer none', () => {
	const ops = standingOps(world(), AVEN, AGENT, 'Suggester');
	expect(ops.slice(0, 2)).toEqual([
		{ op: 'share', over: MINE, who: { vault: AVEN }, level: 'Suggester', standing: true, as: MINE },
		{ op: 'share', over: MINE, who: { vault: AGENT }, level: 'Suggester', standing: true, as: AVEN }
	]);
	expect(ops.slice(2)).toEqual([
		share(AVEN, MINE, MINE),
		share(AGENT, MINE, AVEN),
		share(AVEN, COOP, COOP),
		share(AGENT, COOP, AVEN)
	]);
	expect(standingOps(world(), AVEN, AGENT, 'Viewer')).toHaveLength(2);
});
