// @ts-nocheck — browser transport internals
export const MAX_PACKET = 65_535;
export const MAX_PACKETS = 64;
export const MAX_ROUTES = 8;
export const MAX_BYTES = 128 << 10;
export const MIN_MTU = 256;

export function packet(value, mtu = MAX_PACKET) {
	return value instanceof Uint8Array && value.byteLength > 0 && value.byteLength <= mtu;
}

/** Bounds include the active write. Each caller learns when its datagram was handed to the carrier.
 * A stalled carrier closes; QUIC and the existing relay handle loss, never a reliable outer stream. */
export function packetWriter(write, failed, { mtu = MAX_PACKET, timeout = 5000 } = {}) {
	let closed = false, running = false, bytes = 0, current, wake;
	const queue = [];
	const stopped = new Promise((resolve) => { wake = resolve; });
	const close = () => {
		if (closed) return;
		closed = true; wake(false); current?.resolve(false);
		for (const item of queue.splice(0)) item.resolve(false);
		bytes = 0;
	};
	const pump = async () => {
		if (running) return;
		running = true;
		while (!closed && queue.length) {
			current = queue.shift();
			let timer;
			try {
				const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('carrier write timed out')), timeout); });
				const accepted = await Promise.race([Promise.resolve().then(() => closed ? false : write(current.bytes)), deadline, stopped]);
				current.resolve(!closed && accepted !== false);
			} catch (error) {
				close(); failed(error);
			} finally { clearTimeout(timer); }
			if (!closed) bytes -= current.bytes.byteLength;
			current = null;
		}
		running = false;
	};
	return {
		send(value) {
			if (closed || !packet(value, mtu) || queue.length + Number(!!current) >= MAX_PACKETS || bytes + value.byteLength > MAX_BYTES) return Promise.resolve(false);
			bytes += value.byteLength;
			const answer = new Promise((resolve) => queue.push({ bytes: value.slice(), resolve }));
			void pump(); return answer;
		},
		close
	};
}

/** Why a carrier ended, in words: a WebTransportError's `source` and code, or a close's code, kept beside its message,
 *  as Safari rejects with an empty one (the iPhone's carrier closed with no reason at all, 2026-10-27). */
export function reason(error) {
	const parts = [error?.name && error.name !== 'Error' ? error.name : '', error?.message ?? (typeof error === 'object' ? '' : error)];
	if (error?.source) parts.push(`source ${error.source}`);
	if (error?.streamErrorCode != null) parts.push(`stream code ${error.streamErrorCode}`);
	if (error?.closeCode != null) parts.push(`close code ${error.closeCode}${error.reason ? ` ${error.reason}` : ''}`);
	return (parts.filter(Boolean).join(': ') || (error == null ? 'closed' : String(error)) || 'closed').slice(0, 160);
}
