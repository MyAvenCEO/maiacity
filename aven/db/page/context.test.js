// @ts-nocheck — deterministic Worlds with the core's explicit authority answers.
import { expect, test } from 'bun:test';
import { contextVaults, createVaultContext, selectedVault } from './context.js';
import { pillVaults } from './vaults.js';

const id = (n) => n.toString(16).padStart(64, '0');
const [SAM, CITY, AVEN, DANIEL, SHARED, MEMBER, RETIRED, UNKNOWN] = [1, 2, 3, 4, 5, 6, 7, 8].map(id);
const vault = (id, name, kind, via, more = {}) => ({ id, name, kind, via, devices: [], owners: [], ...more });
function world() {
	return {
		mine: SAM,
		vaults: [
			vault(DANIEL, 'Daniel', 'human', null, { acting: { as: SAM, reaches: true, shares: false } }),
			vault(AVEN, 'avenMAIA', 'aven', [CITY, SAM]),
			vault(SAM, 'Samuel', 'human', []),
			vault(CITY, 'Maia City', 'coop', [SAM]),
			// Even an Owner share can grant rights in someone else's vault without making it our identity.
			vault(SHARED, 'Shared work', 'coop', null, { acting: { as: SAM, reaches: true, shares: true } }),
			vault(MEMBER, 'Authorized aven', 'aven', [], { acting: { as: MEMBER, reaches: true, shares: true } }),
			vault(RETIRED, 'Retired worker', 'device', [AVEN, CITY, SAM])
		]
	};
}

function selection(initialWorld = world(), remembered = '') {
	let currentWorld = initialWorld;
	let value = remembered;
	const context = createVaultContext({ world: () => currentWorld, read: () => value, write: (id) => (value = id) });
	return { context, saved: () => value, update: (next) => { currentWorld = next; context.reconcile(); } };
}

test('the switcher uses acting authority, not known identities or shared/public access', () => {
	const w = world();
	expect(contextVaults(w).map((v) => v.id)).toEqual([SAM, AVEN, CITY, MEMBER]);
	const listed = pillVaults(w, { [DANIEL]: 8, [CITY]: 2 });
	expect(listed.map((v) => v.id)).toEqual([SAM, AVEN, CITY, MEMBER]);
	expect(listed[0].sub).toBe('You');
	expect(listed.find((v) => v.id === CITY).badge).toBe(2);
	for (const id of [DANIEL, SHARED, RETIRED, UNKNOWN]) expect(selectedVault(w, id)).toBe(SAM);
});

test('the shared selection boundary rejects direct and restored unauthorized IDs', () => {
	const s = selection(world(), DANIEL);
	expect(s.context.current).toBe(SAM);
	s.context.reconcile();
	expect(s.saved()).toBe(SAM);
	for (const id of [CITY, AVEN, MEMBER]) {
		s.context.current = id;
		expect(s.context.current).toBe(id);
		expect(s.saved()).toBe(id);
	}
	for (const id of [DANIEL, SHARED, UNKNOWN]) {
		s.context.current = id; // The same boundary used by menu picks and restored entry routes.
		expect(s.context.current).toBe(SAM);
		expect(s.saved()).toBe(SAM);
	}
});

test('authority loss reconciles selection and a later grant does not resurrect it', () => {
	const s = selection(world(), CITY);
	expect(s.context.current).toBe(CITY);
	const changed = world();
	changed.vaults = changed.vaults.map((v) => v.id === CITY ? { ...v, via: null } : v);
	s.update(changed);
	expect(s.context.current).toBe(SAM);
	expect(s.saved()).toBe(SAM);
	s.update(world());
	expect(s.context.current).toBe(SAM);
	s.context.current = CITY;
	expect(s.context.current).toBe(CITY);
});

test('loading, missing authority and a different account cannot retain a previous context', () => {
	const s = selection(null, CITY);
	expect(s.context.current).toBe('');
	s.context.current = AVEN;
	expect(s.saved()).toBe('');
	s.update(world());
	expect(s.context.current).toBe(SAM);
	const other = { mine: DANIEL, vaults: [vault(DANIEL, 'Daniel', 'human', []), vault(CITY, 'Maia City', 'coop', undefined)] };
	s.update(other);
	expect(s.context.current).toBe(DANIEL);
	expect(selectedVault(other, CITY)).toBe(DANIEL);
	expect(selectedVault({ mine: UNKNOWN, vaults: [] }, SAM)).toBe('');
});
