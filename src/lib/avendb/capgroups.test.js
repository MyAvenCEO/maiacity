// @ts-nocheck
// The Maia City vault's cap groups (./capgroups.js): what the seed defines where the vault holds none of a name yet,
// and which a person holds by the shares over the vault their world shows; and which vault is Maia City to anyone
// (./vaults.js `serverCity`).
// Run: bun test src/lib/avendb/capgroups.test.js
import { describe, expect, test } from 'bun:test';
import { ADMIN, CAP_GROUPS, CITIZEN, TRAVELER, capGroupOps, groupHolders, heldGroups, moveOps } from './capgroups.js';
import { refs } from './ops.js';
import { seedCity, serverCity } from './vaults.js';

const CITY = 'c'.repeat(64);
const ME = 'a'.repeat(64);
const [T, C] = ['1'.repeat(64), '2'.repeat(64)];
const groups = [
	{ entry: T, name: TRAVELER, caps: [], includes: [] },
	{ entry: C, name: CITIZEN, caps: [], includes: [T] }
];
const share = (o) => ({ id: 'x', over: CITY, who: ME, capGroup: null, ...o });
const world = (shares) => ({ mine: ME, vaults: [], shares });

describe('the seed defines', () => {
	test('every group in a vault that holds none, each including the one just defined before it', () => {
		const ops = capGroupOps([], CITY);
		expect(ops.map((o) => o.group.name)).toEqual([TRAVELER, CITIZEN, ADMIN]);
		expect(ops[0]).toEqual({ op: 'define_group', vault: CITY, group: { name: TRAVELER, caps: CAP_GROUPS[0].caps, includes: [] } });
		expect(ops[1].group.includes).toEqual(['$0']);
		expect(ops[2].group.includes).toEqual(['$1']);
		// run one after another, the include names what the one before defined
		expect(refs(ops[1], [{ entry: T }]).group.includes).toEqual([T]);
	});

	test('only what is missing, including the groups the vault holds', () => {
		const ops = capGroupOps([groups[0]], CITY);
		expect(ops.map((o) => o.group.name)).toEqual([CITIZEN, ADMIN]);
		expect(ops[0].group).toMatchObject({ name: CITIZEN, includes: [T] });
		expect(capGroupOps(groups, CITY)).toEqual([{ op: 'define_group', vault: CITY, group: { name: ADMIN, caps: CAP_GROUPS[2].caps, includes: [C] } }]);
	});

	test('nothing in a vault that holds them all', () =>
		expect(capGroupOps([...groups, { entry: '3'.repeat(64), name: ADMIN, caps: [], includes: [C] }], CITY)).toEqual([]));

	test('a Traveler reads the games, the recipes, the code and the settings; a Citizen all of MaiaCity V1 besides; an Admin all of it', () => {
		expect(CAP_GROUPS[0].caps).toEqual([{ op: 'read', where: { type: ['game', 'recipe', 'view', 'logic', 'config'] } }]);
		expect(CAP_GROUPS[1].caps).toEqual([{ op: 'read', where: { tag: 'game:maiacity-v1' } }]);
		expect(CAP_GROUPS[2]).toEqual({ name: ADMIN, caps: [{ op: 'read' }], includes: [CITIZEN] });
	});
});

describe('a person holds', () => {
	test('the group a share to their vault names, and every group it includes', () => {
		expect([...heldGroups(world([share({ capGroup: C })]), CITY, groups)].sort()).toEqual([CITIZEN, TRAVELER]);
		expect([...heldGroups(world([share({ capGroup: T })]), CITY, groups)]).toEqual([TRAVELER]);
	});

	test('a group shared with everyone', () => {
		expect([...heldGroups(world([share({ who: 'everyone', capGroup: T })]), CITY, groups)]).toEqual([TRAVELER]);
	});

	test('nothing from a share over another vault, to someone else, or naming no group', () => {
		const other = [share({ over: 'd'.repeat(64), capGroup: C }), share({ who: 'b'.repeat(64), capGroup: C }), share({})];
		expect(heldGroups(world(other), CITY, groups).size).toBe(0);
	});

	test('nothing from a group the vault does not hold, and a loop of includes ends', () => {
		expect(heldGroups(world([share({ capGroup: '9'.repeat(64) })]), CITY, groups).size).toBe(0);
		const loop = [
			{ entry: T, name: TRAVELER, caps: [], includes: [C] },
			{ entry: C, name: CITIZEN, caps: [], includes: [T] }
		];
		expect(heldGroups(world([share({ capGroup: T })]), CITY, loop).size).toBe(2);
	});
});

describe('Maia City, to anyone', () => {
	const vault = (id, kind, owner, devices = []) => ({ id, kind, name: null, owners: owner ? [{ vault: owner }] : [{ signer: 'f'.repeat(64), recovery: false }], devices });
	const [SAM, SERVER, FAKE, FAKE_AVEN] = ['5'.repeat(64), '6'.repeat(64), '7'.repeat(64), '8'.repeat(64)];
	const vaults = [
		vault(ME, 'human'),
		vault(SAM, 'human'),
		vault(CITY, 'coop', SAM),
		vault(SERVER, 'aven', CITY, [{ id: '9'.repeat(64), me: false }]),
		// a look-alike: a coop owned by a coop, and its aven with a device
		vault(FAKE, 'coop', CITY),
		vault(FAKE_AVEN, 'aven', FAKE, [{ id: 'e'.repeat(64), me: false }])
	];
	const keeps = (who, o = {}) => ({ id: 'k', over: ME, who, level: 'backup', whole: true, ...o });

	test('is the coop of the seed whose aven keeps the person’s vault, whoever founded it', () => {
		expect(serverCity({ mine: ME, vaults, shares: [keeps(SERVER)] })?.id).toBe(CITY);
	});

	test('is none by a share on a part of their vault, or to a vault that is no seed’s server', () => {
		expect(serverCity({ mine: ME, vaults, shares: [keeps(SERVER, { whole: false })] })).toBeUndefined();
		expect(serverCity({ mine: ME, vaults, shares: [keeps(FAKE_AVEN)] })).toBeUndefined();
		expect(serverCity({ mine: ME, vaults, shares: [keeps(SERVER, { over: SAM })] })).toBeUndefined();
	});

	test('stays Maia City with a second human owner, to the server’s keeps and to each owner as theirs (Samuel 2026-10-21)', () => {
		const DAN = 'd'.repeat(64);
		const two = vaults.map((v) => (v.id === CITY ? { ...v, owners: [{ vault: SAM }, { vault: DAN }] } : v)).concat(vault(DAN, 'human'));
		expect(serverCity({ mine: ME, vaults: two, shares: [keeps(SERVER)] })?.id).toBe(CITY);
		expect(seedCity({ mine: SAM, vaults: two, shares: [] })?.id).toBe(CITY);
		expect(seedCity({ mine: DAN, vaults: two, shares: [] })?.id).toBe(CITY);
		expect(seedCity({ mine: ME, vaults: two, shares: [] })).toBeUndefined();
		// a coop a coop owns beside a human is no seed's
		const mixed = two.map((v) => (v.id === CITY ? { ...v, owners: [{ vault: SAM }, { vault: FAKE }] } : v));
		expect(seedCity({ mine: SAM, vaults: mixed, shares: [] })).toBeUndefined();
	});
});

describe('the Vaults app', () => {
	const [BOB, KEY] = ['b'.repeat(64), 'k'.repeat(64)];
	const cap = (o) => ({ id: 's1', over: CITY, who: BOB, capGroup: T, issuer: CITY, ...o });

	test('reads who holds which group, and the invites still open', () => {
		const { held, invites } = groupHolders(
			[cap({}), cap({ id: 's2', capGroup: null, who: 'everyone' }), cap({ id: 's3', who: KEY }), cap({ id: 's4', over: ME })],
			CITY,
			groups,
			(id) => id === BOB
		);
		expect([...held]).toEqual([[BOB, [{ share: 's1', group: T, name: TRAVELER }]]]);
		expect(invites).toEqual([{ share: 's3', group: T, name: TRAVELER, issuer: CITY }]);
	});

	test('makes a traveler a citizen: the Citizen share first, then the Traveler one revoked', () =>
		expect(moveOps(CITY, BOB, CITIZEN, groups, [{ share: 's1', name: TRAVELER }])).toEqual([
			{ op: 'share_group', over: CITY, group: C, who: { vault: BOB }, as: CITY },
			{ op: 'revoke', share: 's1', as: CITY }
		]));

	test('and back, and nothing where they hold it alone already', () => {
		expect(moveOps(CITY, BOB, TRAVELER, groups, [{ share: 's2', name: CITIZEN }])).toEqual([
			{ op: 'share_group', over: CITY, group: T, who: { vault: BOB }, as: CITY },
			{ op: 'revoke', share: 's2', as: CITY }
		]);
		expect(moveOps(CITY, BOB, TRAVELER, groups, [{ share: 's1', name: TRAVELER }])).toEqual([]);
		// holding both, the other is revoked alone
		expect(moveOps(CITY, BOB, CITIZEN, groups, [{ share: 's1', name: TRAVELER }, { share: 's2', name: CITIZEN }])).toEqual([
			{ op: 'revoke', share: 's1', as: CITY }
		]);
	});
});
