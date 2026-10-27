// @ts-nocheck — bounded Window/worker bridge, one port per route generation.
import { MAX_BYTES, MAX_PACKETS, packet, reason } from './packets.js';

/** How long a packet waits for the other side to take it before it counts as lost, and an event before the carrier
 *  closes. */
export const PACKET_WAIT = 5000;
export const EVENT_WAIT = 30_000;

export function packetPort(port, { receive, event, closed }, { packetWait = PACKET_WAIT, eventWait = EVENT_WAIT } = {}) {
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
			// a packet the other side hasn't taken in time is a lost datagram, as on any link, not a dead carrier: a
			// worker busy with a page's check for seconds closed every WebRTC route on the iPhone (batch 4 round,
			// "Window/worker carrier timed out" each ~5 s after it opened); a signal or ready event that long unanswered is
			const lost = () => {
				if (!pending.delete(id)) return;
				bytes -= size; resolve(false);
			};
			const timer = setTimeout(() => kind === 'packet' ? lost() : close('Window/worker carrier timed out'), kind === 'packet' ? packetWait : eventWait);
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
