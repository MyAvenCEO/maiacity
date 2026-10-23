// @ts-nocheck — Bun tests use minimal fake browser API constructors.
import { expect, test } from 'bun:test';
import { browserCarrierCapabilities } from './config.js';
const supported = { WebTransport: class {}, RTCPeerConnection: class {} };

test('ordinary builds do not advertise optional carriers even when both APIs exist', () => {
	expect(browserCarrierCapabilities(supported)).toEqual({ webtransport: false, webrtc: false });
});

test('only the explicit true build flag enables optional browser carriers', () => {
	for (const setting of ['', 'false', '0', '1', 'TRUE', true, null]) {
		expect(browserCarrierCapabilities(supported, setting)).toEqual({ webtransport: false, webrtc: false });
	}
	expect(browserCarrierCapabilities(supported, 'true')).toEqual({ webtransport: true, webrtc: true });
});

test('an opted-in build still requires each local browser API', () => {
	expect(browserCarrierCapabilities({}, 'true')).toEqual({ webtransport: false, webrtc: false });
	expect(browserCarrierCapabilities({ RTCPeerConnection: class {} }, 'true')).toEqual({ webtransport: false, webrtc: true });
	expect(browserCarrierCapabilities({ WebTransport: class {} }, 'true')).toEqual({ webtransport: true, webrtc: false });
});
