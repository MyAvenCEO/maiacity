// @ts-nocheck — plain JS
// The ops the page grants an agent by (./vaults.js): a standing grant, and the AIP author's shares a Suggester gets
// beside its Suggester's, as the Mac's grant passes them on (avendb-device's `agent::pass_on_aips`); and how a
// Suggester's share reads since drafts, one given before them told apart; and each key the key move kept listed once.
// Run: bun test src/lib/avendb/vaults.test.js
import { expect, test } from 'bun:test';
import {
	AIP_AUTHOR,
	AIPS,
	aipAuthorOps,
	deviceRoles,
	levelName,
	newest,
	newestKey,
	offerDevice,
	signerName,
	OLD_SUGGESTER,
	opsWords,
	opWords,
	rowHint,
	rowLevel,
	standingOps
} from './vaults.js';

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

test('a Suggester proposes new entries; one given before drafts is named apart and says it may not yet', () => {
	const read = { op: 'read' };
	const rest = [{ op: 'set', path: [], on: 'proposals' }, { op: 'propose' }, { op: 'merge', on: 'proposals' }];
	const ops = [read, { op: 'create', on: 'proposals' }, ...rest];
	expect(opsWords(ops)).toBe(
		'read, propose new entries, change anything on a proposal, start proposals and bring the main line into a proposal'
	);
	expect(opsWords([read, ...rest])).not.toContain('new entries');
	expect(opWords({ op: 'create' })).toBe('add new entries');
	expect(opWords({ op: 'create', on: 'main' })).toBe('add new entries on the main line');

	const hint = 'Reads it, suggests changes and new entries to merge';
	const w = { ...world(), groups: [{ name: 'Suggester', hint, ops, everyone: false, level: 'write' }] };
	const now = cap(MINE, AGENT, { wide: true, group: 'Suggester', drafts: true });
	expect(levelName(now, w)).toBe('Suggester');
	expect(levelName({ ...now, drafts: false }, w)).toBe(OLD_SUGGESTER);
	expect(levelName({ ...now, drafts: null }, w)).toBe('Suggester');

	const row = { kind: 'grant', level: 'write', group: 'Suggester', name: 'Suggester', drafts: true };
	expect(rowLevel(row, w)).toBe('Suggester');
	expect(rowHint(row, w)).toBe(hint);
	expect(rowLevel({ ...row, drafts: false }, w)).toBe(OLD_SUGGESTER);
	expect(rowHint({ ...row, drafts: false }, w)).toContain('may not propose new entries yet');
	expect(rowHint({ ...row, group: null, name: 'Drafts only' }, w)).toBe('May propose new entries');
	expect(rowHint({ ...row, group: null, name: 'Tick done', drafts: false }, w)).toBeUndefined();
});

test('the master recovery key from before the key move stays listed, as the old one, beside the new', () => {
	const [old, now, pass] = [1, 2, 3].map(hex);
	const v = {
		id: hex(9),
		kind: 'human',
		name: 'Ivy',
		root: pass,
		devices: [],
		owners: [
			{ signer: pass, recovery: false, by: 'passkey', next: null },
			{ signer: old, recovery: true, legacy: true, by: null, next: null },
			{ signer: now, recovery: true, legacy: false, by: null, next: null }
		]
	};
	const world = { recovery: now, vaults: [v] };
	expect(newest(v.owners)).toEqual(v.owners);
	expect([now, old].map((k) => signerName(world, k))).toEqual(['the master recovery key', 'the old/legacy recovery key']);
});

test('a key the key move kept beside its next is listed once, by its newest', () => {
	const [old, now, phone, pass, next] = [1, 2, 3, 4, 5].map(hex);
	const v = {
		id: hex(9),
		owners: [
			{ signer: pass, recovery: false, by: 'passkey', next },
			{ signer: next, recovery: false, by: 'passkey', next: null },
			{ vault: hex(8) }
		],
		devices: [
			{ id: old, me: true, next: now },
			{ id: now, me: true, next: null },
			{ id: phone, me: false }
		]
	};
	const world = { vaults: [v] };
	expect(newest(v.devices).map((d) => d.id)).toEqual([now, phone]);
	expect(newest(v.owners)).toEqual([v.owners[1], v.owners[2]]);
	expect([old, now, phone, pass, hex(7)].map((k) => newestKey(world, k))).toEqual([now, now, phone, next, hex(7)]);
});

test('an aven’s devices are named by what they are: its server by its offer, agents by the Mac, the rest the cloud’s', () => {
	// avenDB's server's offer, as src/lib/avendb/server.js had it before the key move: its device's earlier key
	const offer =
		'AVENDB1UAYTJU2GDDXXNHWO5YZJOJJBYJFXCKVEPNGILCF6ORDFGRZQXIYOKZOGNSNV64ZIP4VEW4HJPYXUPWZBQJWGRT75JV4CAO3N25TOCMYBAS6PKHZODTUQCGLIOR2HA4Z2F4XWC5TFNZSGELTNMFUWCLTDNF2HSLY';
	const server = offerDevice(offer);
	expect(server).toBe('e565c66c9b5f73287f2a4b70e97e2f47db21826c68cffd4d78203b6dd766e133');
	expect(offerDevice('no offer')).toBeNull();
	const [moved, claude, claudeOld, cloud, phone] = [11, 12, 13, 14, 15].map(hex);
	const aven = {
		...vault(AVEN, 'aven', COOP, [COOP, MINE]),
		devices: [
			{ id: server, me: false, next: moved },
			{ id: moved, me: false, next: null },
			{ id: claudeOld, me: false, next: claude },
			{ id: claude, me: false, next: null },
			{ id: cloud, me: false, next: null, old: true }
		]
	};
	const mine = { ...vault(MINE, 'human', null, null), devices: [{ id: phone, me: false, name: 'Safari on iPhone' }] };
	const w = { mine: MINE, vaults: [mine, aven], kinds: KINDS };
	const onMac = deviceRoles(w, offer, [{ name: 'agentClaude', device: claude, cloud: false }]);
	expect([server, moved].map((d) => onMac.get(d))).toEqual(['avenDB’s server', 'avenDB’s server']);
	expect([claudeOld, claude].map((d) => onMac.get(d))).toEqual(['agentClaude on this Mac', 'agentClaude on this Mac']);
	expect(onMac.get(cloud)).toBe('agentCloud, for cloud sessions');
	expect(onMac.has(phone)).toBe(false);
	// a browser knows no Mac's agents: it names the server alone, and the others stay a device of the aven
	const inBrowser = deviceRoles(w, offer);
	expect(inBrowser.get(moved)).toBe('avenDB’s server');
	expect(inBrowser.has(claude) || inBrowser.has(cloud)).toBe(false);
	// a cloud agent the Mac added is named by its note
	const added = deviceRoles(w, offer, [{ name: 'agentCloud', device: cloud, cloud: true }]);
	expect([added.get(cloud), added.get(claude)]).toEqual(['agentCloud, for cloud sessions', 'An agent not on this Mac']);
});
