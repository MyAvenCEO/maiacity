/** @typedef {{ kind: 'aven', root: string, size: number, len: number, media: string }} AvenRef */
/** @typedef {{ kind: 'public', hash: string, extension: string }} PublicRef */
/** @typedef {AvenRef | PublicRef | { kind: 'external', url: string }} MediaRef */

const HASH = /^[0-9a-f]{64}$/;
const PUBLIC = /^([0-9a-f]{64})(\.[a-z0-9]+)?$/;
const SIZE = /^\d+$/;

/** @param {unknown} value @returns {MediaRef | null} */
export function parseMediaRef(value) {
	if (typeof value !== 'string') return null;
	if (value.startsWith('aven:')) {
		const parts = value.split(':');
		const [, root, sealed, plain, encoded = ''] = parts;
		if ((parts.length !== 4 && parts.length !== 5) || !HASH.test(root) || !SIZE.test(sealed) || !SIZE.test(plain)) return null;
		const size = Number(sealed), len = Number(plain);
		if (!Number.isSafeInteger(size) || !Number.isSafeInteger(len) || size < len) return null;
		try {
			const media = decodeURIComponent(encoded);
			if (/[\u0000-\u001f\u007f]/.test(media)) return null;
			return { kind: 'aven', root, size, len, media };
		} catch {
			return null;
		}
	}
	const hash = PUBLIC.exec(value);
	if (hash) return { kind: 'public', hash: hash[1], extension: hash[2] ?? '' };
	try {
		const url = new URL(value);
		if (url.protocol === 'https:' || url.protocol === 'http:') return { kind: 'external', url: value };
	} catch {}
	return null;
}

/** @param {unknown} value @returns {AvenRef} */
export function requireAvenRef(value) {
	const ref = parseMediaRef(value);
	if (ref?.kind !== 'aven') throw new Error('Not a readable avenDB media reference; import legacy media into avenDB first.');
	return ref;
}

/** @param {unknown} value */
export const isAven = (value) => parseMediaRef(value)?.kind === 'aven';

/** @param {{ root: string, size: number, len: number | null }} file @param {string | null | undefined} media */
export function avenRef(file, media) {
	const ref = `aven:${file.root}:${file.size}:${file.len}:${encodeURIComponent(media ?? '')}`;
	requireAvenRef(ref);
	return ref;
}

/** @param {string} value */
export function avenUrl(value) {
	const ref = requireAvenRef(value);
	return `aven://localhost/${ref.root}?size=${ref.size}&len=${ref.len}${ref.media ? `&media=${encodeURIComponent(ref.media)}` : ''}`;
}
