// @ts-nocheck — Bun, as the other plain JS suites.
import { expect, test } from 'bun:test';
import { emptySync, observeSync, peerCoverage, peerStatus, missingUpdates, liveSync, STALL } from './sync-status.js';
const report = (change = {}) => ({ peers: 3, logs: 2483, behind: 192, pulling: 5, pages: 1200, ...change });
const sample = (change = {}, at = 1000) => observeSync(emptySync(), report(change), at);

test('unknown and disconnected status never claims complete coverage or durable data', () => {
	for (const state of [emptySync(), sample({ peers: 0, logs: 0, behind: 0, pulling: 0 })]) {
		expect(peerCoverage(state)).toBeNull();
		expect(peerStatus(state).active).toBe(false);
		expect(peerStatus(state).details.join(' ')).not.toMatch(/100%|saved locally|in sync/i);
	}
	expect(peerStatus(sample({ peers: 0, logs: 0, behind: 0, pulling: 0 })).label).toBe('Peer status unknown · offline');
});

test('primary status counts missing logs, while active requests have their own units', () => {
	const status = peerStatus(sample());
	expect(status.label).toBe('Syncing · receiving 192 logs');
	expect(status.label).not.toContain('%');
	expect(status.details.join(' ')).toContain('5 active sync requests');
	expect(status.details.join(' ')).toContain('2,291 of 2,483 announced peer logs currently covered (92%)');
	expect(status.details.join(' ')).toContain('does not measure local disk saves or file downloads');
});

test('missing work stays visible indefinitely with no active request', () => {
	const waiting = observeSync(sample({ pulling: 0 }), report({ pulling: 0 }), 3600000);
	expect(missingUpdates(waiting)).toBe(true);
	expect(peerStatus(waiting).active).toBe(true);
	expect(peerStatus(waiting).label).toBe('Waiting for peers · receiving 192 logs');
});

test('new peer frontiers can lower relative coverage without retaining a false high-water mark', () => {
	const complete = sample({ behind: 0, pulling: 0 });
	expect(peerCoverage(complete)).toBe(1);
	expect(peerStatus(complete).label).toBe('Incoming logs current · sharing unverified');
	const changed = observeSync(complete, report(), 2000);
	expect(peerCoverage(changed)).toBe(2291 / 2483);
	expect(peerStatus(changed).label).toContain('receiving 192 logs');
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
	expect(peerStatus(state).label).toBe('Waiting for peers · receiving 6 logs');
	expect(peerStatus(state).details.join(' ')).not.toContain('%');
});

test('a failed read marks old work as stale instead of making it disappear or calling it current', () => {
	const status = peerStatus({ ...sample(), known: false });
	expect(status.active).toBe(true);
	expect(status.fraction).toBeNull();
	expect(status.label).toBe('Peer status unavailable');
	expect(status.details[0]).toContain('Last report: 192 logs needed updates');
});

test('incoming log completion never claims outgoing or file completion', () => {
 const status = peerStatus(sample({ behind: 0, pulling: 0 }));
 expect(status.label).not.toMatch(/up to date/i);
 expect(status.details.join(' ')).toContain('acknowledgment unavailable');
 expect(status.details.join(' ')).toContain('completeness unavailable');
});

test('the pill moves with every edit and page while no log is whole yet, and says what it waits on once nothing moves', () => {
	const mac = (pulling, edits, last) => ({ device: '36ee6eef' + '0'.repeat(56), name: 'Mac', pages: 0, edits, last,
		pulling: pulling && { since: 1000, stage: 'taking edits', took: edits } });
	const at = (change, previous, when) => observeSync(previous, report({ edits: change.edits, from: [mac(true, change.edits, change.last)], ...change.counts }), when);
	const start = at({ edits: 5000, last: 900 }, emptySync(), 1000);
	expect(liveSync(start, 1000).line).toBe('Syncing 2,291/2,483');
	expect(start.base).toBe(5000);

	// the logs stand still; the edits a page brings move the line, the peer and the page's age
	const paged = at({ edits: 5800, last: 2000, counts: { pages: 1201 } }, start, 2000);
	let live = liveSync(paged, 2000);
	expect(live.line).toBe('Syncing 2,291/2,483 · +800 edits');
	expect(live.stalled).toBe(false);
	expect(live.rows).toContainEqual(['Mac', 'taking edits · 5,800 edits · page just now']);
	expect(live.rows).toContainEqual(['Edits taken', '5,800 (+800 now)']);
	live = liveSync(paged, 4000);
	expect(live.rows).toContainEqual(['Last page', '2 s ago']);

	// a second answer with the same counts moves nothing; the clock alone brings it to waiting, by name and for how long
	const same = at({ edits: 5800, last: 2000, counts: { pages: 1201 } }, paged, 3000);
	expect(same.since).toBe(2000);
	live = liveSync(same, 2000 + STALL + 7000);
	expect(live.stalled).toBe(true);
	expect(live.line).toBe('Waiting on Mac · 12 s');
	expect(live.rows).toContainEqual(['Waiting on', 'Mac for 12 s']);
	expect(liveSync(same, 2000 + 125000).line).toBe('Waiting on Mac · 2 min');

	// the next edits end the wait at once
	const more = at({ edits: 5810, last: 20000, counts: { pages: 1202 } }, same, 20000);
	expect(liveSync(more, 20500).line).toBe('Syncing 2,291/2,483 · +810 edits');

	// a log whole moves the count; once none is behind and no pull runs, the pill has nothing live to say
	const whole = at({ edits: 5810, last: 20000, counts: { pages: 1202, behind: 191 } }, more, 21000);
	expect(liveSync(whole, 21000).line).toBe('Syncing 2,292/2,483 · +810 edits');
	expect(liveSync(observeSync(whole, report({ pages: 1202, behind: 0, pulling: 0, edits: 5810, from: [mac(false, 5810, 20000)] }), 22000), 22000)).toBeNull();
});

test('with no pull running it waits on the peers it hears, named by their device when they wrote no card', () => {
	const peerOf = (device) => ({ device, name: null, pulling: null, pages: 0, edits: 0, last: 0 });
	const idle = observeSync(emptySync(), report({ pulling: 0, edits: 0, from: [peerOf('85b01be4' + '0'.repeat(56)), peerOf('2f74eca3' + '0'.repeat(56))] }), 1000);
	const live = liveSync(idle, 1000 + STALL + 1000);
	expect(live.line).toBe('Waiting on 85b01be4, 2f74eca3 · 6 s');
	expect(live.rows).toContainEqual(['Last page', 'none yet']);
});

test('a device too old to tell edits or peers still reads as before', () => {
	const old = sample();
	expect(old.edits).toBe(0);
	expect(old.from).toEqual([]);
	expect(liveSync(old, 1000).line).toBe('Syncing 2,291/2,483');
	expect(liveSync(old, 1000 + STALL).line).toBe('Waiting on peers · 5 s');
});

test('a peer whose connection drops a moment keeps its coverage, marked reconnecting, so the counts hold', () => {
	const peerOf = (device, name, reconnecting) => ({ device, name, reconnecting, pulling: null, pages: 0, edits: 0, last: 0 });
	const both = [peerOf('36ee6eef', 'Mac', false), peerOf('85b01be4', null, false)];
	const before = observeSync(emptySync(), report({ peers: 2, pulling: 0, from: both }), 1000);
	// the always-on peer's connection drops: the device still counts it by what it told last, its logs and what it lacks
	const dropped = observeSync(before, report({ peers: 2, reconnecting: 1, pulling: 0, from: [both[0], peerOf('85b01be4', null, true)] }), 2000);
	expect([dropped.logs, dropped.behind, dropped.reconnecting]).toEqual([before.logs, before.behind, 1]);
	expect(dropped.since).toBe(before.since);
	expect(liveSync(dropped, 2000 + STALL).line).toBe('Waiting on Mac, 85b01be4 (reconnecting) · 6 s');
	// a report can't say more peers reconnect than it counts
	expect(observeSync(emptySync(), report({ peers: 1, reconnecting: 3 }), 1000).reconnecting).toBe(1);
});
