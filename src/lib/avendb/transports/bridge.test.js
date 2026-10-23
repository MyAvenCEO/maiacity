// @ts-nocheck — genuine MessagePorts, fake authenticated broker/carriers; no network or vault access.
import { expect, test } from 'bun:test';
import { packetPort } from './port.js';
import { deviceTransports, rtcWorkerCarrier } from './worker.js';
import { rtcPageHost } from './page.js';
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const until = async (condition) => { for (let i = 0; i < 100 && !condition(); i++) await new Promise((r) => setTimeout(r, 1)); expect(condition()).toBe(true); };

function broker() {
	const commands = [], waiters = [], events = [], packets = [];
	return { events, packets, push: (value) => waiters.length ? waiters.shift()(value) : commands.push(value),
		transport_next: () => commands.length ? Promise.resolve(commands.shift()) : new Promise((r) => waiters.push(r)),
		transport_event: async (event) => { events.push(event); },
		transport_receive: (route, epoch, bytes) => { packets.push({ route, epoch, bytes: [...bytes] }); return true; }
	};
}

test('MessagePort credits bound outstanding packets and close resolves blocked senders', async () => {
	const { port1, port2 } = new MessageChannel(), blocked = deferred(), received = [];
	const a = packetPort(port1, { receive: () => {}, event: () => {} });
	const b = packetPort(port2, { receive: async (bytes) => { received.push(bytes); await blocked.promise; }, event: () => {} });
	try {
		const pending = Array.from({ length: 64 }, () => a.send(new Uint8Array([1])));
		expect(await a.send(new Uint8Array([2]))).toBe(false);
		await until(() => received.length === 64);
		a.close(); expect((await Promise.all(pending)).every((v) => v === false)).toBe(true);
		blocked.resolve(); await flush(); expect(await a.send(new Uint8Array([1]))).toBe(false);
	} finally { a.close(); b.close(); }
});

test('broker routes are epoch-scoped, sends wait for carrier capacity, old WASM keeps relay', async () => {
	const d = broker(), carriers = [], blocked = deferred();
	const manager = deviceTransports(d, { openWebTransport: (descriptor, cb) => {
		const carrier = { descriptor, cb, sent: [], send: async (bytes) => { carrier.sent.push([...bytes]); await blocked.promise; return true; }, close: () => { carrier.closed = true; void cb.event({ kind: 'closed', reason: 'closed' }); } };
		carriers.push(carrier); return carrier;
	} });
	try {
		d.push({ kind: 'open', route: 'r', epoch: 1, transport: 'webtransport' }); await flush();
		await carriers[0].cb.event({ kind: 'ready', mtu: 1000 });
		d.push({ kind: 'open', route: 'r', epoch: 2, transport: 'webtransport' }); await flush();
		expect(carriers[0].closed).toBe(true);
		expect(carriers[0].cb.receive(new Uint8Array([1]))).toBe(false);
		await carriers[0].cb.event({ kind: 'ready', mtu: 900 }); expect(d.events.some((e) => e.kind === 'ready' && e.mtu === 900)).toBe(false);
		d.push({ kind: 'send', route: 'r', epoch: 1, bytes: new Uint8Array([1]) });
		d.push({ kind: 'send', route: 'r', epoch: 2, bytes: new Uint8Array([2]) });
		d.push({ kind: 'send', route: 'r', epoch: 2, bytes: new Uint8Array([3]) }); await flush();
		expect(carriers[1].sent).toEqual([[2]]); blocked.resolve(); await flush(); expect(carriers[1].sent).toEqual([[2], [3]]);
		manager.close(); expect(carriers[1].closed).toBe(true); expect(carriers[1].cb.receive(new Uint8Array([4]))).toBe(false);
		d.push(null); await manager.done;
		const old = deviceTransports({}); await old.done; old.close();
	} finally { blocked.resolve(); manager.close(); d.push(null); }
});

test('worker broker and Window RTC bridge carry packets/signals and device closure together', async () => {
	const d = broker(), carriers = [];
	const host = rtcPageHost({ create: (descriptor, cb) => {
		const carrier = { descriptor, cb, sent: [], signals: [], send: async (bytes) => { carrier.sent.push([...bytes]); return true; }, signal: async (value) => { carrier.signals.push(value); return true; }, close: () => { carrier.closed = true; void cb.event({ kind: 'closed' }); } };
		carriers.push(carrier); return carrier;
	} });
	const manager = deviceTransports(d, { openRtc: (descriptor, cb) => rtcWorkerCarrier({ ...descriptor, device: 7 }, cb, (data) => host.message(data)) });
	try {
		d.push({ kind: 'open', route: 'rtc', epoch: 4, transport: 'webrtc', initiator: true }); await until(() => carriers.length === 1);
		await carriers[0].cb.event({ kind: 'ready', mtu: 65_535 });
		expect(d.events.find((event) => event.kind === 'ready')).toEqual({ kind: 'ready', mtu: 65_535, route: 'rtc', epoch: 4 });
		d.push({ kind: 'send', route: 'rtc', epoch: 4, bytes: new Uint8Array([10]) }); await until(() => carriers[0].sent.length === 1);
		await carriers[0].cb.receive(new Uint8Array([11])); expect(d.packets).toEqual([{ route: 'rtc', epoch: 4, bytes: [11] }]);
		d.push({ kind: 'signal', route: 'rtc', epoch: 4, signal: { description: { type: 'answer', sdp: 'answer' } } }); await until(() => carriers[0].signals.length === 1);
		await carriers[0].cb.event({ kind: 'signal', signal: { candidate: null } }); expect(d.events.at(-1).signal).toEqual({ candidate: null });
		host.closeDevice(7); await until(() => d.events.some((e) => e.kind === 'closed'));
		expect(carriers[0].closed).toBe(true); expect(await carriers[0].cb.receive(new Uint8Array([12]))).toBe(false);
	} finally { manager.close(); host.close(); d.push(null); await manager.done; }
});

test('unsupported carrier and worker route limit fail closed without stopping other relay-backed device work', async () => {
	const d = broker(), closed = [];
	const manager = deviceTransports(d, { openWebTransport: () => ({ close: () => closed.push(true) }) });
	try {
		d.push({ kind: 'open', route: 'unavailable', epoch: 1, transport: 'webrtc', initiator: true }); await flush();
		expect(d.events.find((event) => event.kind === 'closed')).toEqual({ kind: 'closed', route: 'unavailable', epoch: 1, reason: 'browser carrier unavailable' });
		for (let i = 0; i < 9; i++) d.push({ kind: 'open', route: `r${i}`, epoch: 1, transport: 'webtransport' });
		await flush(); expect(d.events.at(-1)).toEqual({ kind: 'closed', route: 'r8', epoch: 1, reason: 'browser route limit' });
		manager.close(); expect(closed).toHaveLength(8); d.push(null); await manager.done;
	} finally { manager.close(); d.push(null); }
});

test('carrier capabilities are reported before consuming commands, with unavailable APIs disabled', async () => {
	const d = broker();
	const manager = deviceTransports(d, { webtransport: false, webrtc: false });
	await flush();
	expect(d.events).toEqual([{ kind: 'capabilities', webtransport: false, webrtc: false }]);
	manager.close(); d.push(null); await manager.done;
	let called = false;
	const legacy = deviceTransports({ transport_event: () => { called = true; } });
	await legacy.done; expect(called).toBe(false);
});

test('unexpected pump failure retires Rust routes and capabilities before closing carriers', async () => {
	let fail;
	const failure = new Promise((_, reject) => { fail = reject; });
	const events = [], closures = [];
	let next = 0;
	const d = {
		transport_next: () => next++ === 0 ? Promise.resolve({ kind: 'open', route: 'failed', epoch: 3, transport: 'webtransport' }) : failure,
		transport_receive: () => true,
		transport_event: async (event) => { events.push(event); }
	};
	const manager = deviceTransports(d, { webtransport: true,
		openWebTransport: (_, cb) => ({ close: () => { closures.push(true); void cb.event({ kind: 'ready', mtu: 512 }); } }) });
	await flush(); fail(new Error('broker failed')); await manager.done;
	expect(events).toEqual([
		{ kind: 'capabilities', webtransport: true, webrtc: false },
		{ kind: 'capabilities', webtransport: false, webrtc: false },
		{ kind: 'closed', route: 'failed', epoch: 3 }
	]);
	expect(closures).toHaveLength(1);
	manager.close(); expect(closures).toHaveLength(1);
});
