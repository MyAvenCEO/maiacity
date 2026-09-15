// Bunny.net helpers. Everything is derived from BUNNY_API_KEY (account API key),
// so no other secret has to be stored anywhere.
// Local runs read .env; CI passes the key in the environment.
import { readFileSync } from 'node:fs';

function loadEnv() {
	try {
		for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
			const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
			if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
		}
	} catch {
		// no .env — CI, or nothing to load
	}
}
loadEnv();

const API = 'https://api.bunny.net';
const VIDEO_API = 'https://video.bunnycdn.com';

export const NAMES = {
	storage: 'maiacity',
	pullZone: 'maiacity',
	streamLibrary: 'maiaCITY',
	hostnames: ['maia.city', 'www.maia.city']
};

const key = () => {
	const k = process.env.BUNNY_API_KEY;
	if (!k) throw new Error('BUNNY_API_KEY is not set');
	return k;
};

export async function api(path, { method = 'GET', body, base = API, accessKey } = {}) {
	const res = await fetch(`${base}${path}`, {
		method,
		headers: {
			AccessKey: accessKey ?? key(),
			accept: 'application/json',
			...(body ? { 'content-type': 'application/json' } : {})
		},
		body: body ? JSON.stringify(body) : undefined
	});

	const text = await res.text();
	if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 400)}`);
	return text ? JSON.parse(text) : null;
}

export const videoApi = (path, opts = {}) => api(path, { ...opts, base: VIDEO_API });

/** The storage zone holding the built site, on the cheapest (volume/HDD) tier. */
export async function ensureStorageZone() {
	const zones = await api('/storagezone');
	const existing = zones.find((z) => z.Name === NAMES.storage);
	if (existing) return existing;

	return api('/storagezone', {
		method: 'POST',
		body: {
			Name: NAMES.storage,
			Region: 'DE', // Falkenstein — main region, cheapest egress to EU
			ZoneTier: 0, // 0 = Standard/volume (HDD), 1 = Edge (SSD)
			ReplicationRegions: []
		}
	});
}

/** The pull zone that serves the storage zone to the world. */
export async function ensurePullZone(storageZone) {
	const zones = await api('/pullzone');
	const existing = zones.find((z) => z.Name === NAMES.pullZone);
	if (existing) return existing;

	return api('/pullzone', {
		method: 'POST',
		body: {
			Name: NAMES.pullZone,
			Type: 1, // 1 = volume tier (cheapest)
			OriginType: 2, // storage zone
			StorageZoneId: storageZone.Id,
			EnableSmartCache: true
		}
	});
}

export async function ensureHostnames(pullZone) {
	const added = [];
	for (const hostname of NAMES.hostnames) {
		if (pullZone.Hostnames?.some((h) => h.Value === hostname)) continue;
		await api(`/pullzone/${pullZone.Id}/addHostname`, { method: 'POST', body: { Hostname: hostname } });
		added.push(hostname);
	}
	return added;
}

/** Free Let's Encrypt certificate — only works once DNS points at Bunny. */
export async function requestCertificate(hostname) {
	try {
		await api(`/pullzone/loadFreeCertificate?hostname=${encodeURIComponent(hostname)}`);
		return { hostname, ok: true };
	} catch (error) {
		return { hostname, ok: false, error: String(error.message).slice(0, 200) };
	}
}

export async function ensureStreamLibrary() {
	// Stream libraries are managed through the account API, not video.bunnycdn.com.
	const { Items } = await api('/videolibrary?page=1&perPage=100');
	const existing = Items?.find((l) => l.Name === NAMES.streamLibrary);
	if (existing) return existing;

	return api('/videolibrary', { method: 'POST', body: { Name: NAMES.streamLibrary, ReplicationRegions: [] } });
}

export const storageBase = (zone) =>
	`https://${zone.Region === 'DE' ? '' : zone.Region.toLowerCase() + '.'}storage.bunnycdn.com/${zone.Name}`;
