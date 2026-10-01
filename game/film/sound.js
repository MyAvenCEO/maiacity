// A sound clip's EQ as data: bands in order, each one biquad from the Audio EQ Cookbook. The render mixes them in Rust
// (vault-render `eq`), the studio plays them with Web Audio's BiquadFilterNode — the same filters, from this schema.
// Checked as Rust checks them (`clean_eq`).

/** @typedef {'highpass' | 'lowshelf' | 'peaking' | 'notch' | 'highshelf' | 'lowpass'} EqType */
/** @typedef {{ type: EqType, f: number, gain: number, q: number }} EqBand */

export const EQ_TYPES = /** @type {EqType[]} */ (['highpass', 'lowshelf', 'peaking', 'notch', 'highshelf', 'lowpass']);
export const MAX_BANDS = 8;

const clamp = (/** @type {any} */ x, /** @type {number} */ lo, /** @type {number} */ hi, /** @type {number} */ d) => {
	const k = Number(x);
	return x !== null && x !== undefined && x !== '' && Number.isFinite(k) ? Math.min(hi, Math.max(lo, k)) : d;
};

/** A clip's EQ, checked: known types, 20 Hz – 20 kHz, ±24 dB, q 0.1–18; a peak or shelf at 0 dB dropped. @returns {EqBand[]} */
export function cleanEq(/** @type {any} */ v) {
	if (!Array.isArray(v)) return [];
	/** @type {EqBand[]} */
	const out = [];
	for (const b of v) {
		if (!b || typeof b !== 'object' || !EQ_TYPES.includes(b.type)) continue;
		const f = Number(b.f);
		if (b.f === null || b.f === undefined || !Number.isFinite(f)) continue;
		const type = /** @type {EqType} */ (b.type);
		const gain = Math.round(clamp(b.gain, -24, 24, 0) * 100) / 100;
		const q = Math.round(clamp(b.q, 0.1, 18, type === 'peaking' || type === 'notch' ? 1 : Math.SQRT1_2) * 1000) / 1000;
		if ((type === 'peaking' || type === 'lowshelf' || type === 'highshelf') && gain === 0) continue;
		out.push({ type, f: Math.min(20000, Math.max(20, f)), gain, q });
		if (out.length === MAX_BANDS) break;
	}
	return out;
}

/** A band as Web Audio's BiquadFilterNode takes it: its high- and low-pass read Q in dB. @param {EqBand} b */
export const webAudioQ = (b) => (b.type === 'highpass' || b.type === 'lowpass' ? 20 * Math.log10(b.q) : b.q);

/** A band in a few characters: "HP 90", "+3 dB 4k", "notch 50". @param {EqBand} b */
export function bandLabel(b) {
	const hz = b.f >= 1000 ? `${Math.round(b.f / 100) / 10}k` : `${Math.round(b.f)}`;
	const db = `${b.gain > 0 ? '+' : ''}${b.gain} dB`;
	return { highpass: `HP ${hz}`, lowpass: `LP ${hz}`, notch: `notch ${hz}`, peaking: `${db} ${hz}`, lowshelf: `${db} <${hz}`, highshelf: `${db} >${hz}` }[b.type];
}

export const MAX_KEYS = 64;

/** A clip's gain keys ([seconds into the clip, dB]), checked as Rust checks them (`clean_keys`). @returns {[number, number][]} */
export function cleanKeys(/** @type {any} */ v) {
	if (!Array.isArray(v)) return [];
	return v
		.filter((k) => Array.isArray(k) && Number.isFinite(Number(k[0])) && Number.isFinite(Number(k[1])) && k[0] !== null && k[1] !== null)
		.map((k) => /** @type {[number, number]} */ ([Math.round(Math.max(0, Number(k[0])) * 1000) / 1000, Math.round(Math.min(12, Math.max(-60, Number(k[1]))) * 100) / 100]))
		.sort((a, b) => a[0] - b[0])
		.slice(0, MAX_KEYS);
}

/** The keys' gain at `t` seconds into the clip, dB: straight lines between them, the ends held. @param {[number, number][]} keys @param {number} t */
export function keyDb(keys, t) {
	if (!keys.length) return 0;
	if (t <= keys[0][0]) return keys[0][1];
	for (let i = 1; i < keys.length; i++) {
		const [t0, d0] = keys[i - 1], [t1, d1] = keys[i];
		if (t <= t1) return t1 > t0 ? d0 + ((d1 - d0) * (t - t0)) / (t1 - t0) : d1;
	}
	return keys[keys.length - 1][1];
}
