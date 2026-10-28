// @ts-nocheck — Vite substitutes these build flags; ordinary builds keep their existing relay paths.
/** Optional browser carriers. WebTransport, a browser's straight HTTP/3 link to avenDB's server, is on wherever the
 * browser has it (Safari since 26.4) and the server offers it, unless a build sets VITE_AVENDB_BROWSER_CARRIERS=false:
 * through the relay alone a phone took 3-40 s a page (Samuel 2026-10-26). WebRTC (P8) is on wherever the browser has it,
 * unless a build sets VITE_AVENDB_WEBRTC=false: a page's straight way to another page, and to the Mac app, whose node
 * answers it with a WebRTC peer of its own (avendb-net's transports/webrtc.rs). It only carries packets of the same
 * authenticated post-quantum iroh connection, so it grants no peer authority either. */
export function browserCarrierCapabilities(scope = globalThis, setting = import.meta.env?.VITE_AVENDB_BROWSER_CARRIERS, rtc = import.meta.env?.VITE_AVENDB_WEBRTC) {
	const enabled = setting !== 'false' && setting !== false;
	return {
		webtransport: enabled && typeof scope.WebTransport === 'function',
		webrtc: (setting === 'true' || rtc !== 'false') && typeof scope.RTCPeerConnection === 'function'
	};
}

/** Where a browser's WebRTC carrier learns the address its network shows, to offer it to its peer: avenDB's
 * own STUN responder (avendb-server's stun.rs), never a public one, so no third party learns who syncs with whom.
 * VITE_AVENDB_STUN names another (`stun:host:port`, comma-separated), or `off` for none: then two browsers reach each
 * other straight only on one network. */
export function rtcIceServers(setting = import.meta.env?.VITE_AVENDB_STUN) {
	if (setting === 'off') return [];
	const urls = (typeof setting === 'string' && setting.trim() ? setting : 'stun:avendb.maia.city:3478')
		.split(',').map((url) => url.trim()).filter((url) => /^stuns?:[A-Za-z0-9.-]+(:\d{1,5})?$/.test(url));
	return urls.length ? [{ urls }] : [];
}
