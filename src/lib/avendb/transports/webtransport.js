// @ts-nocheck — the device worker owns WebTransport; these datagrams remain inner iroh ciphertext.
import { MIN_MTU, MAX_PACKET, packet, packetWriter, reason } from './packets.js';

/** The datagrams held for the device while it is busy: ~5 MB of full-size ones, a few seconds of a fast link. */
const INCOMING = 4096;

export function webTransport(descriptor, { event, receive }, { WebTransport = globalThis.WebTransport, now = Date.now } = {}) {
	let transport, reader, writer, outgoing, stopped = false, reached = false, opening, expiry, settle;
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
			// a close says its code and reason, and the step it came at: before `ready` the session was never up
			void transport.closed.then((info) => close({ name: reached ? 'WebTransport closed' : 'WebTransport refused', ...info }),
				(error) => close(Object.assign(Object.create(error ?? null), { name: `${error?.name ?? 'Error'}${reached ? '' : ' before ready'}`, message: error?.message, source: error?.source, streamErrorCode: error?.streamErrorCode })));
			await transport.ready;
			reached = true;
			if (stopped) return;
			clearTimeout(opening);
			const datagrams = transport.datagrams;
			const mtu = Math.min(MAX_PACKET, datagrams.maxDatagramSize);
			if (!Number.isSafeInteger(mtu) || mtu < MIN_MTU) throw new Error('WebTransport datagrams too small');
			// what arrives while the device works (a page's check and keep) waits for it rather than being dropped: 32
			// datagrams and a second's age lost every packet of a 1.5-4 s take, and with them the inner QUIC's window
			datagrams.incomingHighWaterMark = INCOMING; datagrams.outgoingHighWaterMark = 32;
			datagrams.incomingMaxAge = Infinity; datagrams.outgoingMaxAge = 1000;
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
