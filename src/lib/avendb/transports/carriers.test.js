// @ts-nocheck — browser API fakes exercise lifecycle and bounds without opening network connections.
import { expect, test } from 'bun:test';
import { packetWriter, MAX_BYTES } from './packets.js';
import { webTransport } from './webtransport.js';
import { webRtc } from './webrtc.js';
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

function wtFixture(options = {}) {
	const instances = [], events = [], received = [];
	class WT {
		constructor(url, config) {
			this.url = url; this.config = config; instances.push(this);
			this.opening = deferred(); this.ready = this.opening.promise; this.ending = deferred(); this.closed = this.ending.promise;
			this.reads = []; this.writes = [];
			this.datagrams = { maxDatagramSize: options.mtu ?? 1000,
				readable: { getReader: () => ({ read: () => { const d = deferred(); this.reads.push(d); return d.promise; }, cancel: async () => { this.cancelled = true; for (const d of this.reads) d.resolve({ done: true }); } }) },
				writable: { getWriter: () => ({ ready: Promise.resolve(), write: async (bytes) => this.writes.push([...bytes]), abort: async () => { this.aborted = true; } }) }
			};
		}
		close() { this.didClose = true; this.ending.resolve(); }
	}
	const descriptor = { url: 'https://owned.example:4443/packets', expires: 100, certificateHashes: ['ab'.repeat(32)], ...options.descriptor };
	const carrier = webTransport(descriptor, { event: (e) => events.push(e), receive: (b) => received.push([...b]) }, { WebTransport: WT, now: () => 0 });
	return { carrier, instances, events, received };
}

test('WebTransport pins authenticated hashes, reports outer MTU, and carries only datagrams', async () => {
	const f = wtFixture(); const wt = f.instances[0];
	try {
		expect(wt.config.allowPooling).toBe(false); expect(wt.config.requireUnreliable).toBe(true);
		expect(wt.config.serverCertificateHashes).toEqual([{ algorithm: 'sha-256', value: new Uint8Array(32).fill(0xab) }]);
		wt.opening.resolve(); expect(await f.carrier.ready).toBe(true);
		expect(f.events).toEqual([{ kind: 'ready', mtu: 1000 }]);
		expect(wt.datagrams.incomingHighWaterMark).toBe(32); expect(wt.datagrams.outgoingMaxAge).toBe(1000);
		expect(await f.carrier.send(new Uint8Array([1, 2, 3]))).toBe(true);
		expect(await f.carrier.send(new Uint8Array(1001))).toBe(false);
		wt.reads[0].resolve({ value: new Uint8Array([4, 5]), done: false }); await flush();
		expect(wt.writes).toEqual([[1, 2, 3]]); expect(f.received).toEqual([[4, 5]]);
		f.carrier.close(); await flush(); expect(wt.cancelled).toBe(true); expect(wt.aborted).toBe(true);
		expect(f.events.filter((e) => e.kind === 'closed')).toHaveLength(1);
		expect(await f.carrier.send(new Uint8Array([1]))).toBe(false);
	} finally { f.carrier.close(); }
});

test('WebTransport receive bounds are independent of its smaller outbound MTU', async () => {
	const f = wtFixture({ mtu: 1000 }), wt = f.instances[0];
	try {
		wt.opening.resolve(); expect(await f.carrier.ready).toBe(true);
		wt.reads[0].resolve({ value: new Uint8Array(1272).fill(7), done: false }); await flush();
		expect(f.received).toEqual([new Array(1272).fill(7)]);
		wt.reads[1].resolve({ value: new Uint8Array(65_536), done: false }); await flush();
		expect(f.received).toHaveLength(1);
		expect(await f.carrier.send(new Uint8Array(1001))).toBe(false);
		expect(await f.carrier.send(new Uint8Array(1000))).toBe(true);
	} finally { f.carrier.close(); }
});

test('WebTransport closing during ready ignores late completion; invalid descriptors never dial', async () => {
	const f = wtFixture(); const wt = f.instances[0];
	f.carrier.close(); wt.opening.resolve(); await flush();
	expect(await f.carrier.ready).toBe(false); expect(f.events.some((e) => e.kind === 'ready')).toBe(false);
	for (const descriptor of [{ url: 'http://owned.example' }, { url: 'https://user:secret@owned.example' }, { expires: 0 }, { certificateHashes: ['bad'] }]) {
		const invalid = wtFixture({ descriptor }); expect(await invalid.carrier.ready).toBe(false); expect(invalid.instances).toEqual([]);
	}
	const small = wtFixture({ mtu: 255 }); small.instances[0].opening.resolve(); expect(await small.carrier.ready).toBe(false);
	expect(small.instances[0].didClose).toBe(true);
});

test('packet writer bounds queued bytes/count, closes blocked senders and times out stalled carriers', async () => {
	const blocked = deferred(), errors = [];
	const writer = packetWriter(() => blocked.promise, (e) => errors.push(e));
	const pending = Array.from({ length: 64 }, () => writer.send(new Uint8Array(1000)));
	expect(await writer.send(new Uint8Array(1))).toBe(false);
	writer.close(); expect((await Promise.all(pending)).every((v) => v === false)).toBe(true); blocked.resolve(true); await flush();
	expect(errors).toEqual([]);
	const bytes = packetWriter(() => new Promise(() => {}), () => {}, { timeout: 10 });
	const a = bytes.send(new Uint8Array(65_535)), b = bytes.send(new Uint8Array(65_535));
	expect(await bytes.send(new Uint8Array(3))).toBe(false); expect(await a).toBe(false); expect(await b).toBe(false); bytes.close();
});

export class FakeChannel {
	constructor(label = 'avendb-iroh-v1', options = { ordered: false, maxRetransmits: 0 }) { Object.assign(this, options); this.label = label; this.maxPacketLifeTime = null; this.readyState = 'connecting'; this.bufferedAmount = 0; this.sent = []; }
	open() { this.readyState = 'open'; this.onopen?.(); }
	send(bytes) { this.sent.push([...bytes]); }
	close() { this.readyState = 'closed'; this.didClose = true; }
}
export class FakePeer {
	static instances = [];
	constructor(config) { this.config = config; this.sctp = { maxMessageSize: 65536 }; this.candidates = []; FakePeer.instances.push(this); }
	createDataChannel(label, options) { return this.channel = new FakeChannel(label, options); }
	async createOffer() { return { type: 'offer', sdp: 'our offer' }; }
	async createAnswer() { return { type: 'answer', sdp: 'our answer' }; }
	async setLocalDescription(value) { this.localDescription = value; }
	async setRemoteDescription(value) { this.remoteDescription = value; }
	async addIceCandidate(value) { this.candidates.push(value); }
	close() { this.didClose = true; }
}

test('RTC uses host-only unreliable data channels and bounded bufferedAmount backpressure', async () => {
	FakePeer.instances = []; const events = [], received = [];
	const carrier = webRtc({ initiator: true }, { event: (e) => events.push(e), receive: (b) => received.push([...b]) }, { RTCPeerConnection: FakePeer });
	const pc = FakePeer.instances[0], dc = pc.channel;
	try {
		await flush(); expect(pc.config.iceServers).toEqual([]); expect(dc.ordered).toBe(false); expect(dc.maxRetransmits).toBe(0);
		expect(events[0]).toEqual({ kind: 'signal', signal: { description: { type: 'offer', sdp: 'our offer' } } });
		dc.open(); expect(await carrier.ready).toBe(true);
		dc.bufferedAmount = MAX_BYTES; const writing = carrier.send(new Uint8Array([1])); await flush(); expect(dc.sent).toEqual([]);
		dc.bufferedAmount = 0; dc.onbufferedamountlow(); expect(await writing).toBe(true); expect(dc.sent).toEqual([[1]]);
		dc.onmessage({ data: new Uint8Array([2, 3]).buffer }); await flush(); expect(received).toEqual([[2, 3]]);
		dc.bufferedAmount = MAX_BYTES; const stopped = carrier.send(new Uint8Array([4])); await flush(); carrier.close(); expect(await stopped).toBe(false);
		expect(pc.didClose).toBe(true); expect(dc.didClose).toBe(true); expect(dc.onmessage).toBeNull();
	} finally { carrier.close(); }
});

test('RTC queues bounded ICE before description, rejects repeated/glare SDP and ordered channels', async () => {
	FakePeer.instances = []; const events = [];
	const carrier = webRtc({ initiator: false }, { event: (e) => events.push(e), receive: () => {} }, { RTCPeerConnection: FakePeer });
	const pc = FakePeer.instances[0];
	try {
		await carrier.signal({ candidate: { candidate: 'candidate:host', sdpMid: '0', sdpMLineIndex: 0, ignored: 'discard' } }); expect(pc.candidates).toEqual([]);
		await carrier.signal({ description: { type: 'offer', sdp: 'remote offer' } });
		expect(pc.candidates).toEqual([{ candidate: 'candidate:host', sdpMid: '0', sdpMLineIndex: 0 }]);
		expect(events[0].signal.description).toEqual({ type: 'answer', sdp: 'our answer' });
		expect(await carrier.signal({ description: { type: 'offer', sdp: 'second' } })).toBe(false); expect(pc.didClose).toBe(true);
	} finally { carrier.close(); }
	const rejected = webRtc({ initiator: false }, { event: () => {}, receive: () => {} }, { RTCPeerConnection: FakePeer });
	const next = FakePeer.instances.at(-1), ordered = new FakeChannel('avendb-iroh-v1', { ordered: true, maxRetransmits: 0 });
	next.ondatachannel({ channel: ordered }); expect(await rejected.ready).toBe(false); expect(ordered.didClose).toBe(true);
});

test('RTC signaling stays ordered across async core callbacks and close drops queued candidates', async () => {
	FakePeer.instances = []; const sent = [], blocked = deferred();
	const carrier = webRtc({ initiator: true }, { event: async (e) => { sent.push(e); if (e.kind === 'signal') await blocked.promise; }, receive: () => {} }, { RTCPeerConnection: FakePeer });
	const pc = FakePeer.instances[0];
	try {
		await flush();
		pc.onicecandidate({ candidate: { toJSON: () => ({ candidate: 'first candidate' }) } });
		pc.onicecandidate({ candidate: null }); await flush();
		expect(sent).toHaveLength(1);
		blocked.resolve(); await flush();
		expect(sent.map((e) => e.signal)).toEqual([{ description: { type: 'offer', sdp: 'our offer' } }, { candidate: { candidate: 'first candidate' } }, { candidate: null }]);
	} finally { blocked.resolve(); carrier.close(); }
	const pending = deferred(), after = [];
	const closing = webRtc({ initiator: true }, { event: async (e) => { after.push(e); if (e.kind === 'signal') await pending.promise; }, receive: () => {} }, { RTCPeerConnection: FakePeer });
	await flush(); FakePeer.instances.at(-1).onicecandidate({ candidate: null }); closing.close(); pending.resolve(); await flush();
	expect(after.filter((e) => e.kind === 'signal')).toHaveLength(1);
});

test('a late RTC offer after close cannot publish signaling or reopen the channel', async () => {
	const offer = deferred(), events = [];
	class SlowPeer extends FakePeer { createOffer() { return offer.promise; } }
	const carrier = webRtc({ initiator: true }, { event: (e) => events.push(e), receive: () => {} }, { RTCPeerConnection: SlowPeer });
	carrier.close(); offer.resolve({ type: 'offer', sdp: 'late' }); await flush();
	expect(await carrier.ready).toBe(false); expect(events).toEqual([{ kind: 'closed', reason: 'closed' }]);
	expect(FakePeer.instances.at(-1).localDescription).toBeUndefined();
});

test('RTC close settles signals behind a stalled offer; oversized signaling fails the route', async () => {
	const offer = deferred();
	class SlowPeer extends FakePeer { createOffer() { return offer.promise; } }
	const carrier = webRtc({ initiator: true }, { event: () => {}, receive: () => {} }, { RTCPeerConnection: SlowPeer });
	const signal = carrier.signal({ candidate: null }); carrier.close(); expect(await signal).toBe(false);
	offer.resolve({ type: 'offer', sdp: 'late' }); await flush();
	const events = [];
	const large = webRtc({ initiator: false }, { event: (e) => events.push(e), receive: () => {} }, { RTCPeerConnection: FakePeer });
	expect(await large.signal({ description: { type: 'offer', sdp: 'a'.repeat(16 << 10) } })).toBe(false);
	expect(events).toEqual([{ kind: 'closed', reason: 'RTC signaling overflow' }]);
});
