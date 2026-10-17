// @ts-nocheck — plain JS test, run by bun
// The Proposals app's sources in one shape ($lib/proposals/aips.js): an avenDB AIP as the `aips` read lists it, and
// today's MIPs, side by side.
import { describe, expect, test } from 'bun:test';
import { allOf, fromAvendb, fromSandbox7, ms } from './aips.js';

const world = { vaults: [{ id: 'coop', name: 'Maia City COOP' }, { id: 'aven', name: 'avenMaia' }] };
const line = { entry: 'e1', line: 'p1', type: 'config', title: 'V1 settings', name: null, heads: ['h'], merged: false };
const aip = (over = {}) => ({
	bare: false, entry: 'a1', vault: 'coop', key: 'k7Q2mX9a', number: null, label: null, title: 'Cheaper tent', note: 'Why',
	stage: 'idea', outcome: null, why: null, was: null, tags: [], author: 'aven', intent: null, links: [], lines: [line],
	reviews: [], signatures: { have: 0, need: 1, of: 'owners' }, summary: ['Tent rent: 10 → 8'], ...over
});

describe('an avenDB AIP', () => {
	test('an idea is named by its key, by the vault it lives in', () => {
		const a = fromAvendb(aip(), world);
		expect(a).toMatchObject({ key: 'a1', source: 'avendb', label: 'Idea k7Q2mX9a', where: 'Maia City COOP', author: 'avenMaia', stage: 'idea', changes: ['Tent rent: 10 → 8'] });
		expect(a.policy).toBe("1 of Maia City COOP's owners accept");
	});
	test('a proposed one is AIP-n, and a game tag names its game', () => {
		const a = fromAvendb(aip({ stage: 'proposed', number: 3, label: 'AIP-3', tags: ['game:maiacity-v1'] }), world);
		expect(a).toMatchObject({ label: 'AIP-3', game: 'maiacity-v1', where: 'MaiaCity V1', stage: 'proposed' });
	});
	test('a bare proposal is an idea keyed by its line', () => {
		const a = fromAvendb(aip({ bare: true, entry: null, key: null, title: '' }), world);
		expect(a).toMatchObject({ key: 'line:e1:p1', label: 'Proposal', title: 'A change to V1 settings' });
	});
	test('its newest review dates it, in seconds or in ms', () => {
		expect(fromAvendb(aip({ reviews: [{ at: 1_790_000_000 }] }), world).decided).toBe(1_790_000_000_000);
		expect(ms(1_790_000_000_000)).toBe(1_790_000_000_000);
	});
});

test("avenDB's AIPs come first, then today's MIPs, newest first", () => {
	const mip = (number, decided) => ({ number, title: `MIP ${number}`, status: 'accepted', cards: [], remove: [], created: decided, decided });
	const all = allOf([mip(1, '2026-10-01T00:00:00Z'), mip(2, '2026-10-02T00:00:00Z')], null, [aip()], world);
	expect(all.map((a) => a.key)).toEqual(['a1', 's7-2', 's7-1']);
	expect(fromSandbox7(mip(2, '2026-10-02T00:00:00Z'))).toMatchObject({ label: 'MIP-2', where: 'Sandbox 7', stage: 'archived', outcome: 'applied' });
});
