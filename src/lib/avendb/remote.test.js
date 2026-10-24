// @ts-nocheck — the actual page wrapper, with no WASM/network or stored identities opened.
import { expect, test } from 'bun:test';
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

test('page wrapper closes Window RTC on device free/crash and never sends old device work to a replacement worker', async () => {
	const oldWorker = globalThis.Worker, oldPeer = globalThis.RTCPeerConnection;
	const workers = [], peers = [];
	class Worker extends EventTarget {
		constructor() { super(); this.sent = []; workers.push(this); }
		postMessage(value) { this.sent.push(value); }
		answer(ok) { const request = this.sent.at(-1); this.onmessage({ data: { id: request.id, ok } }); }
		terminate() { this.terminated = true; }
	}
	class Peer {
		constructor(config) { this.config = config; peers.push(this); }
		createDataChannel(label, options) { return this.channel = { label, ...options, maxPacketLifeTime: null, readyState: 'connecting', close() { this.closed = true; } }; }
		async createOffer() { return { type: 'offer', sdp: 'offer' }; }
		async setLocalDescription(value) { this.localDescription = value; }
		close() { this.closed = true; }
	}
	globalThis.Worker = Worker; globalThis.RTCPeerConnection = Peer;
	const ports = [];
	try {
		const remote = await import('./remote.js');
		const opening = remote.Device.open({}, null, null); const first = workers[0];
		expect(first.sent[0]).toEqual({ $transport: 'capabilities', webrtc: false });
		// Real Workers are EventTargets; exercise the diagnostics listener too.
		first.dispatchEvent(new Event('messageerror'));
		expect(first.terminated).not.toBe(true);
		first.answer({ $device: 0, id: 'device', endpoint: 'endpoint', passkey: 'key', offer: 'offer' }); const device = await opening;
		const rtc = () => { const { port1, port2 } = new MessageChannel(); ports.push(port1, port2); first.onmessage({ data: { $transport: 'open-rtc', device: 0, route: `route${peers.length}`, epoch: 1, initiator: true, port: port2 } }); };
		rtc(); await flush(); expect(peers.length).toBe(1); expect(peers[0].config.iceServers).toEqual([]);
		device.free(); expect(peers[0].closed).toBe(true); expect(peers[0].channel.closed).toBe(true);
		first.answer(undefined); await flush();
		const again = remote.Device.open({}, null, null); first.answer({ $device: 0 }); const oldDevice = await again;
		rtc(); await flush();
		// A page callback still awaiting a result belongs to this exact worker, even after it fails.
		const late = deferred(); const running = oldDevice.run({}, () => late.promise).catch((error) => error);
		const fn = first.sent.at(-1).args[1].$fn;
		first.onmessage({ data: { fn, call: 123, args: [] } }); await flush();
		first.onerror({ message: 'crashed' }); expect(peers[1].closed).toBe(true); expect(first.terminated).toBe(true);
		expect((await running).worker).toBe(true);
		const load = remote.load(); const second = workers[1]; second.answer(undefined); await load;
		const count = second.sent.length; oldDevice.free(); late.resolve('late callback'); await flush();
		expect(second.sent.length).toBe(count);
		await expect(oldDevice.run({})).rejects.toThrow('this device worker has ended');
		first.onerror({ message: 'late old error' }); expect(second.terminated).not.toBe(true);
		second.onerror({ message: 'test cleanup' });
	} finally {
		for (const port of ports) port.close(); globalThis.Worker = oldWorker; globalThis.RTCPeerConnection = oldPeer;
	}
});
