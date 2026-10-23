// @ts-nocheck — Vite substitutes this build flag; ordinary builds keep their existing relay paths.
/** Optional browser carriers require an intentional build opt-in and the local browser API.
 * Native WT listeners have their own explicit configuration. This does not grant peer authority. */
export function browserCarrierCapabilities(scope = globalThis, setting = import.meta.env?.VITE_AVENDB_BROWSER_CARRIERS) {
	const enabled = setting === 'true';
	return {
		webtransport: enabled && typeof scope.WebTransport === 'function',
		webrtc: enabled && typeof scope.RTCPeerConnection === 'function'
	};
}
