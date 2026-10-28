// @ts-nocheck — private bridge to PageDevice's bounded Rust packet broker. No page-callable transport authority.
import { webTransport } from './webtransport.js';
import { packetPort } from './port.js';
import { MAX_ROUTES, reason } from './packets.js';

export function rtcWorkerCarrier(descriptor, callbacks, post, { MessageChannel = globalThis.MessageChannel } = {}) {
	const channel = new MessageChannel();
	const bridge = packetPort(channel.port1, { receive: callbacks.receive, event: callbacks.event,
		closed: (why) => callbacks.event({ kind: 'closed', reason: reason(why) }) });
	post({ $transport: 'open-rtc', device: descriptor.device, route: descriptor.route, epoch: descriptor.epoch, initiator: descriptor.initiator, port: channel.port2 }, [channel.port2]);
	return { send: bridge.send, signal: (signal) => bridge.event({ kind: 'signal', signal }), close: bridge.close };
}

/** Hooks are feature-detected so an older generated WASM bundle keeps using its existing relay unchanged.
 * Native methods: transport_next()->Promise<command|null>; transport_event(event)->Promise|void;
 * transport_receive(route:string, epoch:u32, bytes:Uint8Array)->Promise<bool>|bool.
 * Open descriptors and signals come ONLY from authenticated PQ core sessions. Rust frames outer datagrams. */
export function deviceTransports(device, { openRtc, openWebTransport = webTransport,
	webtransport = typeof globalThis.WebTransport === 'function', webrtc = typeof openRtc === 'function' } = {}) {
	let stopped = false; const routes = new Map();
	const tell = (event) => {
		try { void Promise.resolve(device.transport_event?.(event)).catch(() => {}); } catch { /* Device may already be freed. */ }
	};
	const close = () => {
		if (stopped) return; stopped = true;
		// Unexpected pump failure must retire Rust's routes too. Stop callback authority first, then send
		// bounded teardown events while the owning PageDevice is still alive (close/free calls us first).
		tell({ kind: 'capabilities', webtransport: false, webrtc: false });
		for (const [key, route] of routes) {
			tell({ kind: 'closed', route: key, epoch: route.epoch });
			route.carrier?.close();
		}
		routes.clear();
	};
	if (!['transport_next', 'transport_event', 'transport_receive'].every((name) => typeof device[name] === 'function')) return { close, done: Promise.resolve() };
	const done = (async () => {
		try {
			await device.transport_event({ kind: 'capabilities', webtransport, webrtc });
			while (!stopped) {
				const command = await device.transport_next();
				if (stopped || !command) break;
				const { route: key, epoch } = command;
				if (typeof key !== 'string' || !key.length || key.length > 128 || !Number.isInteger(epoch) || epoch < 0 || epoch > 0xffff_ffff) continue;
				const previous = routes.get(key);
				if (command.kind === 'open') {
					if (previous && previous.epoch >= epoch) continue;
					if (!previous && routes.size >= MAX_ROUTES) { await device.transport_event({ kind: 'closed', route: key, epoch, reason: 'browser route limit' }); continue; }
					previous?.carrier?.close();
					const route = { epoch, carrier: null };
					routes.set(key, route);
					const active = () => !stopped && routes.get(key) === route;
					const callbacks = {
						receive: (bytes) => active() ? device.transport_receive(key, epoch, bytes) : false,
						event: async (value) => {
							if (!active()) return false;
							if (value.kind === 'closed') routes.delete(key);
							await device.transport_event({ ...value, route: key, epoch }); return true;
						}
					};
					try {
						if (command.transport === 'webtransport') route.carrier = openWebTransport(command, callbacks);
						else if (command.transport === 'webrtc' && openRtc) route.carrier = openRtc(command, callbacks);
						else throw new Error('browser carrier unavailable');
						if (!active()) route.carrier.close();
					} catch (error) { await callbacks.event({ kind: 'closed', reason: reason(error) }); }
				} else if (previous?.epoch === epoch) {
					if (command.kind === 'send') await previous.carrier?.send(command.bytes);
					else if (command.kind === 'signal') await previous.carrier?.signal?.(command.signal);
					else if (command.kind === 'close') { previous.carrier?.close(); if (routes.get(key) === previous) routes.delete(key); }
				}
			}
		} catch { /* A failed/older broker leaves its normal relay and device APIs intact. */ }
		finally { close(); }
	})();
	return { close, done };
}
