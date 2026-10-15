/*
 * A NAME OF 32 BYTES AS AN ADDRESS READS IT — every thing that never changes is named by the BLAKE3 hash of its bytes
 * (an asset's recipe, $lib/assets/recipes.js), and every avenDB entry by its id (a Universe post,
 * $lib/universe/posts.js): 32 bytes, written in code and data as 64 hex digits. At the root of the site the same 32
 * bytes read in lower-case base32 without padding, 52 letters, as an iroh doc id reads (/<id>/, src/params/doc.js),
 * and `?t=` after it gives the thing's title as words, only so the address reads (`slug`).
 */

/** a name of 32 bytes in an address */
export const ID = /^[a-z2-7]{52}$/;

const ABC = 'abcdefghijklmnopqrstuvwxyz234567';

/**
 * 64 hex digits as they read in an address. Throws for anything else.
 * @param {string} hex
 */
export function idOf(hex) {
	if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error(`not 32 bytes in hex: ${String(hex).slice(0, 80)}`);
	let bits = 0, value = 0, out = '';
	for (const h of hex.match(/../g) ?? []) {
		value = ((value << 8) | parseInt(h, 16)) & 0xffff;
		bits += 8;
		while (bits >= 5) out += ABC[(value >>> (bits -= 5)) & 31];
	}
	return out + ABC[(value << (5 - bits)) & 31];
}

/**
 * The 64 hex digits an address names; undefined when it names no 32 bytes, or not as `idOf` writes them (its last
 * letter carries 4 bits past the bytes, which must be 0).
 * @param {string} id
 */
export function hexOf(id) {
	if (!ID.test(id)) return undefined;
	let bits = 0, value = 0, out = '';
	for (const c of id) {
		value = (value << 5) | ABC.indexOf(c);
		bits += 5;
		if (bits >= 8) {
			out += ((value >>> (bits -= 8)) & 255).toString(16).padStart(2, '0');
			value &= (1 << bits) - 1;
		}
	}
	return value === 0 ? out : undefined;
}

/**
 * A title as it reads in an address: lower case, words joined by dashes.
 * @param {string} title @param {string} [none] what it reads as when no word is left
 */
export const slug = (title, none = 'post') =>
	title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || none;
