// @ts-nocheck — Bun, as the other plain JS suites.
import { expect, test } from 'bun:test';
import { emptySync, observeSync, peerCoverage, peerStatus, missingUpdates } from './sync-status.js';
const report = (change = {}) => ({ peers: 3, logs: 2483, behind: 192, pulling: 5, pages: 1200, ...change });
const sample = (change = {}, at = 1000) => observeSync(emptySync(), report(change), at);

test('unknown and disconnected status never claims complete coverage or durable data', () => {
	for (const state of [emptySync(), sample({ peers: 0, logs: 0, behind: 0, pulling: 0 })]) {
		expect(peerCoverage(state)).toBeNull();
		expect(peerStatus(state).active).toBe(false);
		expect(peerStatus(state).details.join(' ')).not.toMatch(/100%|saved locally|in sync/i);
	}
	expect(peerStatus(sample({ peers: 0, logs: 0, behind: 0, pulling: 0 })).label).toBe('No peers connected');
});

test('primary status counts missing logs, while active requests have their own units', () => {
	const status = peerStatus(sample());
	expect(status.label).toBe('Receiving updates · 192 logs behind');
	expect(status.label).not.toContain('%');
	expect(status.details.join(' ')).toContain('5 active sync requests');
	expect(status.details.join(' ')).toContain('2,291 of 2,483 announced peer logs currently covered (92%)');
	expect(status.details.join(' ')).toContain('does not measure local disk saves or file downloads');
});

test('missing work stays visible indefinitely with no active request', () => {
	const waiting = observeSync(sample({ pulling: 0 }), report({ pulling: 0 }), 3600000);
	expect(missingUpdates(waiting)).toBe(true);
	expect(peerStatus(waiting).active).toBe(true);
	expect(peerStatus(waiting).label).toBe('Waiting for updates · 192 logs behind');
});

test('new peer frontiers can lower relative coverage without retaining a false high-water mark', () => {
	const complete = sample({ behind: 0, pulling: 0 });
	expect(peerCoverage(complete)).toBe(1);
	expect(peerStatus(complete).label).toBe('Up to date with connected peers');
	const changed = observeSync(complete, report(), 2000);
	expect(peerCoverage(changed)).toBe(2291 / 2483);
	expect(peerStatus(changed).label).toContain('192 logs behind');
});

test('remount preserves reported work but starts a new page-observation baseline', () => {
	const before = observeSync(sample(), report({ pages: 1201 }), 2000);
	expect(before.paged).toBe(2000);
	const remounted = observeSync(emptySync(), report({ pages: 1201 }), 3000);
	expect(remounted.paged).toBe(0);
	expect(peerCoverage(remounted)).toBe(peerCoverage(before));
	expect(peerStatus(remounted).label).toBe(peerStatus(before).label);
	expect(peerStatus(remounted).details.join(' ')).toContain('No new transfer page observed');
	const next = observeSync(remounted, report({ pages: 1202 }), 4000);
	expect(next.paged).toBe(4000);
	expect(peerStatus(next).details.join(' ')).toContain('Last new transfer page observed just now');
});

test('a replacement node counter does not inherit an old transfer timestamp', () => {
	const old = observeSync(sample(), report({ pages: 1201 }), 2000);
	const replacement = observeSync(old, report({ pages: 2 }), 3000);
	expect(replacement.paged).toBe(0);
	expect(replacement.pages).toBe(2);
});

test('broad checking requests do not masquerade as missing logs or global completion', () => {
	const status = peerStatus(sample({ behind: 0, pulling: 5 }));
	expect(status.active).toBe(true);
	expect(status.label).toBe('Checking peer updates');
	expect(status.details[0]).toBe('5 active sync requests; checking for peer updates.');
});

test('an inconsistent announcement snapshot still exposes every missing log without fabricating a ratio', () => {
	const state = sample({ logs: 4, behind: 6, pulling: 0 });
	expect(peerCoverage(state)).toBeNull();
	expect(peerStatus(state).active).toBe(true);
	expect(peerStatus(state).label).toBe('Waiting for updates · 6 logs behind');
	expect(peerStatus(state).details.join(' ')).not.toContain('%');
});

test('a failed read marks old work as stale instead of making it disappear or calling it current', () => {
	const status = peerStatus({ ...sample(), known: false });
	expect(status.active).toBe(true);
	expect(status.fraction).toBeNull();
	expect(status.label).toBe('Peer status unavailable');
	expect(status.details[0]).toContain('Last report: 192 logs needed updates');
});
