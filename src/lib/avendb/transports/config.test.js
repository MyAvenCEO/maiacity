// @ts-nocheck — Bun tests use minimal fake browser API constructors.
import { expect, test } from 'bun:test';
import { browserCarrierCapabilities, rtcIceServers } from './config.js';
const supported = { WebTransport: class {}, RTCPeerConnection: class {} };

test('ordinary builds advertise WebRTC between browsers but not WebTransport', () => {
	expect(browserCarrierCapabilities(supported)).toEqual({ webtransport: false, webrtc: true });
});

test('only the explicit true build flag enables WebTransport', () => {
	for (const setting of ['', 'false', '0', '1', 'TRUE', true, null]) {
		expect(browserCarrierCapabilities(supported, setting)).toEqual({ webtransport: false, webrtc: true });
	}
	expect(browserCarrierCapabilities(supported, 'true')).toEqual({ webtransport: true, webrtc: true });
});

test('a build can turn WebRTC off', () => {
	expect(browserCarrierCapabilities(supported, undefined, 'false')).toEqual({ webtransport: false, webrtc: false });
});

test('each carrier still requires its local browser API', () => {
	expect(browserCarrierCapabilities({}, 'true')).toEqual({ webtransport: false, webrtc: false });
	expect(browserCarrierCapabilities({ RTCPeerConnection: class {} }, 'true')).toEqual({ webtransport: false, webrtc: true });
	expect(browserCarrierCapabilities({ WebTransport: class {} }, 'true')).toEqual({ webtransport: true, webrtc: false });
	expect(browserCarrierCapabilities({})).toEqual({ webtransport: false, webrtc: false });
});

test('WebRTC learns its address from avenDB\'s own STUN, never a public one', () => {
	expect(rtcIceServers()).toEqual([{ urls: ['stun:avendb.maia.city:3478'] }]);
	expect(rtcIceServers('off')).toEqual([]);
	expect(rtcIceServers('stun:a.example:3478, stun:b.example')).toEqual([{ urls: ['stun:a.example:3478', 'stun:b.example'] }]);
	// anything but a plain stun: URL is left out: no TURN credentials, no other scheme
	expect(rtcIceServers('turn:user:pass@x.example, javascript:alert(1)')).toEqual([]);
});
