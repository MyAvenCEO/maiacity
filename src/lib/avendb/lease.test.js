// @ts-nocheck — synthetic storage for Bun.
import { describe, expect, test } from 'bun:test';
import { createLease, LIFE } from './lease.js';

const storage = () => {
	const m = new Map();
	return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};
const DEVICE = 'ab'.repeat(32), PASSKEY = 'cd'.repeat(32);
const pad = () => Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const setup = () => {
	let t = 1_000_000;
	const local = storage(), session = storage();
	const lease = createLease({ local: () => local, session: () => session, now: () => t });
	return { lease, local, session, at: (ms) => (t = ms), now: () => t };
};

describe('the lease keeps an unlocked device across a new load, for a while', () => {
	test('a kept lease opens again within its life, by its pad and passkey alone', async () => {
		const { lease, local } = setup();
		await lease.keep(pad(), DEVICE, PASSKEY);
		const kept = local.getItem('avendb:lease:v1');
		expect(kept).not.toContain(Buffer.from(pad()).toString('hex'));
		const got = await lease.take(DEVICE);
		expect(got?.passkey).toBe(PASSKEY);
		expect([...(got?.pad ?? [])]).toEqual([...pad()]);
	});

	test('an ended, other device\'s, tampered or keyless lease opens nothing and is dropped', async () => {
		const s = setup();
		await s.lease.keep(pad(), DEVICE, PASSKEY);
		expect(await s.lease.take('ef'.repeat(32))).toBeNull();
		expect(s.lease.kept()).toBe(false);

		await s.lease.keep(pad(), DEVICE, PASSKEY);
		s.at(s.now() + LIFE + 1);
		expect(await s.lease.take(DEVICE)).toBeNull();
		expect(s.lease.kept()).toBe(false);

		await s.lease.keep(pad(), DEVICE, PASSKEY);
		const l = JSON.parse(s.local.getItem('avendb:lease:v1'));
		s.local.setItem('avendb:lease:v1', JSON.stringify({ ...l, until: l.until + 1 }));
		expect(await s.lease.take(DEVICE)).toBeNull();
		expect(s.lease.kept()).toBe(false);

		await s.lease.keep(pad(), DEVICE, PASSKEY);
		s.session.m.clear();
		expect(await s.lease.take(DEVICE)).toBeNull();
		expect(s.lease.kept()).toBe(false);
	});

	test('renewing pushes its end on; ending it drops it', async () => {
		const s = setup();
		await s.lease.keep(pad(), DEVICE, PASSKEY);
		s.at(s.now() + LIFE - 10);
		await s.lease.renew();
		s.at(s.now() + LIFE - 10);
		expect((await s.lease.take(DEVICE))?.passkey).toBe(PASSKEY);
		s.lease.end();
		await s.lease.renew();
		expect(s.lease.kept()).toBe(false);
		expect(await s.lease.take(DEVICE)).toBeNull();
	});

	test('it keeps nothing for a pad or ids of the wrong shape', async () => {
		const s = setup();
		await s.lease.keep(new Uint8Array(31), DEVICE, PASSKEY);
		await s.lease.keep(pad(), 'nope', PASSKEY);
		expect(s.lease.kept()).toBe(false);
	});
});

