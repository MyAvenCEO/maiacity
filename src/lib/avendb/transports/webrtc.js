// @ts-nocheck — Window-owned RTC carries opaque inner iroh packets. No public STUN/TURN or media capture.
import { MAX_BYTES, MAX_PACKET, MIN_MTU, packet, packetWriter, reason } from './packets.js';
const LABEL = 'avendb-iroh-v1';
const MAX_SIGNALS = 128;
const MAX_SIGNAL = 16 << 10;
const MAX_SDP = MAX_SIGNAL;

export function webRtc({ initiator }, { event, receive }, { RTCPeerConnection = globalThis.RTCPeerConnection } = {}) {
	let pc, channel, outgoing, stopped = false, settle, opening, drain, signals = 0, candidates = [], input = Promise.resolve(), output = Promise.resolve(), outputCount = 0, outputBytes = 0, inputCount = 0, inputBytes = 0, end;
	const ready = new Promise((resolve) => { settle = resolve; });
	const ended = new Promise((resolve) => { end = resolve; });
	const close = (why = 'closed') => {
		if (stopped) return;
		stopped = true; end(false); clearTimeout(opening); outgoing?.close(); settle(false); drain?.(); candidates = [];
		if (channel) { channel.onopen = channel.onmessage = channel.onerror = channel.onclose = channel.onbufferedamountlow = null; try { channel.close(); } catch { /* closed */ } }
		if (pc) { pc.onicecandidate = pc.ondatachannel = pc.onconnectionstatechange = null; try { pc.close(); } catch { /* closed */ } }
		void Promise.resolve(event({ kind: 'closed', reason: reason(why) })).catch(() => {});
	};
	// Keep SDP/ICE in browser event order even if the core sends each over a separate async request.
	const publish = (signal) => {
		const size = new TextEncoder().encode(JSON.stringify(signal)).byteLength;
		if (stopped) return Promise.resolve(false);
		if (size > MAX_SIGNAL || outputCount >= MAX_SIGNALS || outputBytes + size > MAX_BYTES) { close('RTC signaling overflow'); return Promise.resolve(false); }
		outputCount++; outputBytes += size;
		const sent = Promise.race([output.then(() => stopped ? false : event({ kind: 'signal', signal })), ended]);
		output = sent.catch(() => {});
		return sent.finally(() => { outputCount--; outputBytes -= size; });
	};
	const attach = (next) => {
		if (stopped || channel || next.label !== LABEL || next.ordered !== false || next.maxRetransmits !== 0 || next.maxPacketLifeTime != null) { next.close(); if (!stopped) close('unexpected RTC channel'); return; }
		channel = next; channel.binaryType = 'arraybuffer'; channel.bufferedAmountLowThreshold = MAX_BYTES / 2;
		channel.onerror = () => close('RTC channel error'); channel.onclose = () => close('RTC channel closed');
		channel.onbufferedamountlow = () => drain?.();
		channel.onopen = () => {
			if (stopped) return;
			clearTimeout(opening);
			const limit = pc.sctp?.maxMessageSize;
			const mtu = Math.min(MAX_PACKET, limit === 0 || limit === undefined ? MAX_PACKET : limit);
			if (!Number.isSafeInteger(mtu) || mtu < MIN_MTU) { close('RTC messages too small'); return; }
			outgoing = packetWriter(async (bytes) => {
				while (!stopped && channel.bufferedAmount + bytes.byteLength > MAX_BYTES) await new Promise((resolve) => { drain = resolve; });
				drain = null;
				if (stopped || channel.readyState !== 'open') return false;
				channel.send(bytes); return true;
			}, close, { mtu });
			void Promise.resolve(event({ kind: 'ready', mtu })).then(() => { if (!stopped) settle(true); }, close);
		};
		let incoming = 0, incomingBytes = 0;
		channel.onmessage = ({ data }) => {
			if (stopped || !(data instanceof ArrayBuffer)) return;
			const bytes = new Uint8Array(data);
			if (!packet(bytes) || incoming >= 64 || incomingBytes + bytes.byteLength > MAX_BYTES) return;
			incoming++; incomingBytes += bytes.byteLength;
			void Promise.resolve().then(() => { if (!stopped) return receive(bytes); }).catch(close).finally(() => { incoming--; incomingBytes -= bytes.byteLength; });
		};
		if (channel.readyState === 'open') channel.onopen();
	};
	try {
		if (!RTCPeerConnection || typeof initiator !== 'boolean') throw new Error('WebRTC unavailable');
		pc = new RTCPeerConnection({ iceServers: [], iceCandidatePoolSize: 0, bundlePolicy: 'max-bundle' });
		opening = setTimeout(() => close('RTC opening timed out'), 15_000);
		let emitted = 0;
		pc.onicecandidate = ({ candidate }) => {
			if (stopped || ++emitted > MAX_SIGNALS) return;
			void publish({ candidate: candidate?.toJSON() ?? null }).catch(close);
		};
		pc.onconnectionstatechange = () => { if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) close(`RTC ${pc.connectionState}`); };
		pc.ondatachannel = ({ channel }) => attach(channel);
		if (initiator) {
			attach(pc.createDataChannel(LABEL, { ordered: false, maxRetransmits: 0 }));
			input = (async () => {
				const offer = await pc.createOffer(); if (stopped) return;
				await pc.setLocalDescription(offer); if (!stopped) await publish({ description: { type: 'offer', sdp: pc.localDescription.sdp } });
			})().catch(close);
		}
	} catch (error) { close(error); }
	return {
		ready,
		send: (bytes) => stopped || !outgoing ? Promise.resolve(false) : outgoing.send(bytes),
		signal(signal) {
			if (stopped) return Promise.resolve(false);
			let size;
			try { size = new TextEncoder().encode(JSON.stringify(signal)).byteLength; } catch { size = MAX_SIGNAL + 1; }
			if (size > MAX_SIGNAL || ++signals > MAX_SIGNALS || inputCount >= MAX_SIGNALS || inputBytes + size > MAX_BYTES) { close('RTC signaling overflow'); return Promise.resolve(false); }
			inputCount++; inputBytes += size;
			input = Promise.race([input.then(async () => {
				if (stopped) return false;
				if (signal?.description) {
					const { type, sdp } = signal.description;
					if (type !== (initiator ? 'answer' : 'offer') || typeof sdp !== 'string' || sdp.length > MAX_SDP || pc.remoteDescription) throw new Error('invalid RTC description');
					await pc.setRemoteDescription({ type, sdp }); if (stopped) return false;
					for (const candidate of candidates.splice(0)) { await pc.addIceCandidate(candidate); if (stopped) return false; }
					if (!initiator) { const answer = await pc.createAnswer(); if (stopped) return false; await pc.setLocalDescription(answer); if (!stopped) await publish({ description: { type: 'answer', sdp: pc.localDescription.sdp } }); }
				} else if (signal && 'candidate' in signal) {
					const candidate = signal.candidate;
					if (candidate !== null && (typeof candidate !== 'object' || typeof candidate.candidate !== 'string' || candidate.candidate.length > 4096 || (candidate.sdpMid != null && (typeof candidate.sdpMid !== 'string' || candidate.sdpMid.length > 256)) || (candidate.sdpMLineIndex != null && (!Number.isSafeInteger(candidate.sdpMLineIndex) || candidate.sdpMLineIndex < 0 || candidate.sdpMLineIndex > 65535)))) throw new Error('invalid ICE candidate');
					const bounded = candidate === null ? null : { candidate: candidate.candidate, sdpMid: candidate.sdpMid ?? null, sdpMLineIndex: candidate.sdpMLineIndex ?? null };
					if (!pc.remoteDescription) candidates.push(bounded); else await pc.addIceCandidate(bounded);
				} else throw new Error('invalid RTC signal');
				return !stopped;
			}), ended]).catch((error) => { close(error); return false; });
			return input.finally(() => { inputCount--; inputBytes -= size; });
		},
		close
	};
}
