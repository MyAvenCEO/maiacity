// The preview LUTs the viewer takes pictures through: odt-rec709 (the timeline to the screen) and each profile's IDT
// (a proxy's own encoding into the timeline). The worker bakes them from the transform configs and keeps them in the
// library as cache files (C5); `GET /api/film/luts` names them. Nothing here is ever baked or committed.
import { API, filmLuts, missing } from '$lib/auth/client';

/** @typedef {import('$lib/auth/client').MediaItem} MediaItem */
/**
 * A 3D LUT, ready for the GPU: size³ RGBA floats, red fastest, then green, then blue (as bake.py writes it).
 * @typedef {{ name: string, size: number, data: Float32Array, title?: string, hash?: string }} Lut
 */
/**
 * Where the LUT list came from: the API (stream A's route), the library itself (fallback), or nowhere.
 * @typedef {'api' | 'library' | 'none'} LutSource
 */

/** @param {Uint8Array} bytes */
const gunzip = async (bytes) => {
	const out = new Blob([/** @type {BlobPart} */ (bytes)]).stream().pipeThrough(new DecompressionStream('gzip'));
	return new Uint8Array(await new Response(out).arrayBuffer());
};

/**
 * A LUT file's numbers. Two formats: bake.py's MLUT1 (gzip · 'MLUT1' · uint32 LE header length · JSON header
 * {name, size, min, max} · size³ × RGB uint16 LE, red fastest, value = min + (max − min) · u / 65535), and a plain
 * Resolve/Adobe `.cube` (LUT_3D_SIZE n, then n³ lines "r g b", red fastest; DOMAIN_MIN/MAX taken as 0…1).
 * @param {string} name @param {ArrayBuffer} raw @returns {Promise<Lut>}
 */
export async function parseLut(name, raw) {
	let bytes = new Uint8Array(raw);
	if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = await gunzip(bytes);
	const magic = new TextDecoder().decode(bytes.subarray(0, 5));
	if (magic === 'MLUT1') {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const hlen = view.getUint32(5, true);
		/** @type {{ size: number, min: number, max: number, title?: string }} */
		const head = JSON.parse(new TextDecoder().decode(bytes.subarray(9, 9 + hlen)));
		const n = head.size, count = n * n * n, off = 9 + hlen;
		const data = new Float32Array(count * 4), k = (head.max - head.min) / 65535;
		for (let i = 0; i < count; i++) {
			for (let c = 0; c < 3; c++) data[i * 4 + c] = head.min + k * view.getUint16(off + (i * 3 + c) * 2, true);
			data[i * 4 + 3] = 1;
		}
		return { name, size: n, data, title: head.title };
	}
	const text = new TextDecoder().decode(bytes);
	const size = Number(/LUT_3D_SIZE\s+(\d+)/.exec(text)?.[1]);
	if (!size) throw new Error(`${name}: not a LUT this viewer reads`);
	const rows = text.split(/\r?\n/).filter((l) => /^\s*[-+0-9.eE]+\s+[-+0-9.eE]+\s+[-+0-9.eE]+\s*$/.test(l));
	const data = new Float32Array(size ** 3 * 4);
	rows.slice(0, size ** 3).forEach((l, i) => {
		const [r, g, b] = l.trim().split(/\s+/).map(Number);
		data.set([r, g, b, 1], i * 4);
	});
	return { name, size, data };
}

/**
 * Which preview LUTs exist, by transform name → the file's CID.
 * ADAPTER (until stream A's `GET /api/film/luts` lands): when the route is missing, the library is searched for the
 * cache files the worker writes (tag `role:lut`, `meta.transform`). Remove the `library` branch once the route is live.
 * @param {MediaItem[]} library
 * @returns {Promise<{ from: LutSource, luts: Record<string, { cid: string, hash?: string }> }>}
 */
export async function lutIndex(library) {
	try {
		const luts = await filmLuts();
		return { from: 'api', luts };
	} catch (e) {
		if (!missing(e)) console.warn('film LUTs:', /** @type {Error} */ (e).message);
	}
	/** @type {Record<string, { cid: string, hash?: string }>} */
	const luts = {};
	for (const m of library)
		if (m.tags.includes('role:lut') && typeof m.meta?.transform === 'string')
			luts[m.meta.transform] ??= { cid: m.cid, hash: typeof m.meta.hash === 'string' ? m.meta.hash : undefined };
	return { from: Object.keys(luts).length ? 'library' : 'none', luts };
}

/** @type {Map<string, Promise<Lut | null>>} */
const loaded = new Map();
/**
 * A LUT's numbers, fetched once per CID (a CID never changes its bytes).
 * @param {string} name @param {string} cid @returns {Promise<Lut | null>}
 */
export function loadLut(name, cid) {
	let p = loaded.get(cid);
	if (!p) {
		p = fetch(`${API}/api/media/${cid}`, { credentials: 'include' })
			.then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
			.then((b) => parseLut(name, b))
			.catch((e) => {
				console.warn(`LUT ${name} (${cid}):`, e.message);
				return null;
			});
		loaded.set(cid, p);
	}
	return p;
}
