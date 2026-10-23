// @ts-nocheck — the device worker owns WebTransport; these datagrams remain inner iroh ciphertext.
import { MIN_MTU, MAX_PACKET, packet, packetWriter, reason } from './packets.js';

export function webTransport(descriptor, { event, receive }, { WebTransport = globalThis.WebTransport, now = Date.now } = {}) {
	let transport, reader, writer, outgoing, stopped = false, opening, expiry, settle;
	const ready = new Promise((resolve) => { settle = resolve; });
	const close = (why = 'closed') => {
		if (stopped) return;
		stopped = true; clearTimeout(opening); clearTimeout(expiry); outgoing?.close(); settle(false);
		void reader?.cancel().catch(() => {}); void writer?.abort().catch(() => {});
		try { transport?.close(); } catch { /* already closed */ }
		void Promise.resolve(event({ kind: 'closed', reason: reason(why) })).catch(() => {});
	};
	void (async () => {
		try {
			if (!WebTransport) throw new Error('WebTransport unavailable');
			const url = new URL(descriptor.url);
			if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('invalid WebTransport URL');
			const remaining = descriptor.expires * 1000 - now();
			if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 14 * 86400_000) throw new Error('expired WebTransport capability');
			const hashes = descriptor.certificateHashes;
			if (!Array.isArray(hashes) || !hashes.length || hashes.length > 4 || hashes.some((hash) => !/^[0-9a-f]{64}$/.test(hash))) throw new Error('invalid certificate hashes');
			const serverCertificateHashes = hashes.map((hash) => ({ algorithm: 'sha-256', value: Uint8Array.from(hash.match(/../g), (byte) => parseInt(byte, 16)) }));
			transport = new WebTransport(url.href, { allowPooling: false, requireUnreliable: true, serverCertificateHashes });
			opening = setTimeout(() => close('WebTransport opening timed out'), 10_000);
			expiry = setTimeout(() => close('WebTransport capability expired'), remaining);
			void transport.closed.then(() => close('WebTransport closed'), close);
			await transport.ready;
			if (stopped) return;
			clearTimeout(opening);
			const datagrams = transport.datagrams;
			const mtu = Math.min(MAX_PACKET, datagrams.maxDatagramSize);
			if (!Number.isSafeInteger(mtu) || mtu < MIN_MTU) throw new Error('WebTransport datagrams too small');
			datagrams.incomingHighWaterMark = 32; datagrams.outgoingHighWaterMark = 32;
			datagrams.incomingMaxAge = 1000; datagrams.outgoingMaxAge = 1000;
			reader = datagrams.readable.getReader(); writer = datagrams.writable.getWriter();
			outgoing = packetWriter(async (bytes) => { await writer.ready; if (stopped) return false; await writer.write(bytes); return true; }, close, { mtu });
			await event({ kind: 'ready', mtu });
			if (stopped) return;
			settle(true);
			while (!stopped) {
				const { value, done } = await reader.read();
				if (stopped) break;
				if (done) { close('WebTransport datagrams ended'); break; }
				// maxDatagramSize is the outbound limit; the peer may send larger datagrams.
				if (packet(value)) await receive(value);
			}
		} catch (error) { close(error); }
	})();
	return { ready, send: (bytes) => stopped || !outgoing ? Promise.resolve(false) : outgoing.send(bytes), close };
}
