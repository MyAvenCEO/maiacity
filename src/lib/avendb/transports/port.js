// @ts-nocheck — bounded Window/worker bridge, one port per route generation.
import { MAX_BYTES, MAX_PACKETS, packet, reason } from './packets.js';

export function packetPort(port, { receive, event, closed }) {
	let stopped = false, next = 0, bytes = 0, incoming = 0, incomingBytes = 0;
	const pending = new Map();
	const close = (why = 'closed', notify = true) => {
		if (stopped) return;
		stopped = true;
		if (notify) { try { port.postMessage({ kind: 'close', reason: reason(why) }); } catch { /* detached */ } }
		port.onmessage = port.onmessageerror = null; port.close();
		for (const item of pending.values()) { clearTimeout(item.timer); item.resolve(false); }
		pending.clear(); bytes = 0; closed?.(why);
	};
	const sizeOf = (value) => {
		try { const size = JSON.stringify(value)?.length * 2; return Number.isSafeInteger(size) ? size : MAX_BYTES + 1; } catch { return MAX_BYTES + 1; }
	};
	const send = (kind, value, size) => {
		if (stopped || pending.size >= MAX_PACKETS || size > MAX_BYTES || bytes + size > MAX_BYTES) return Promise.resolve(false);
		const id = next++;
		return new Promise((resolve) => {
			const timer = setTimeout(() => close('Window/worker carrier timed out'), 5000);
			pending.set(id, { resolve, timer, size }); bytes += size;
			try {
				if (kind === 'packet') { const owned = value.slice(); port.postMessage({ kind, id, bytes: owned }, [owned.buffer]); }
				else port.postMessage({ kind, id, event: value });
			} catch (error) { close(error); }
		});
	};
	port.onmessage = ({ data }) => {
		if (stopped || !data || typeof data !== 'object') return;
		if (data.kind === 'close') { close(data.reason, false); return; }
		if (data.kind === 'ack') {
			const item = pending.get(data.id); if (!item) return;
			pending.delete(data.id); clearTimeout(item.timer); bytes -= item.size; item.resolve(data.accepted === true); return;
		}
		if (!Number.isSafeInteger(data.id) || data.id < 0) return;
		const valid = data.kind === 'packet' ? packet(data.bytes) : data.kind === 'event' && data.event && typeof data.event === 'object';
		const size = data.kind === 'packet' ? data.bytes?.byteLength : sizeOf(data.event);
		if (!valid || incoming >= MAX_PACKETS || incomingBytes + size > MAX_BYTES) { close('Window/worker carrier overflow'); return; }
		incoming++; incomingBytes += size;
		void Promise.resolve().then(() => {
			if (stopped) return false;
			return data.kind === 'packet' ? receive(data.bytes) : event(data.event);
		}).then((accepted) => {
			if (!stopped) port.postMessage({ kind: 'ack', id: data.id, accepted: accepted !== false });
		}, close).finally(() => { incoming--; incomingBytes -= size; });
	};
	port.onmessageerror = () => close('Window/worker carrier message error'); port.start?.();
	return {
		send: (value) => packet(value) ? send('packet', value, value.byteLength) : Promise.resolve(false),
		event: (value) => send('event', value, sizeOf(value)),
		close
	};
}
