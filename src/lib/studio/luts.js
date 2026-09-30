// The LUTs the viewer takes pictures through: odt-rec709 (the timeline to the screen, the ACES 2.0 output transform)
// and each profile's IDT (a proxy's own journey into ACEScct). The Mac app bakes every one of them natively
// (`color_lut`: vault-media's cst for the journeys in, its aces2 for the output); nothing is fetched or committed.

/**
 * A 3D LUT, ready for the GPU: size³ RGBA floats, red fastest, then green, then blue.
 * @typedef {{ name: string, size: number, data: Float32Array, title?: string, hash?: string }} Lut
 */
/**
 * Where the LUTs came from: this Mac, or nowhere yet (the viewer then shows the signal as it is, and says so).
 * @typedef {'mac' | 'none'} LutSource
 */

/** @type {WeakMap<Lut, { size: number, data: Float32Array }>} */
const rgb = new WeakMap();
/**
 * A LUT as Sandbox 4's film mode takes it (`__film.show({ view: { lut } })`, C3): `{ size, data }` with RGB triples,
 * red fastest (the .cube order). The same object every time for the same LUT, so the world uploads it once.
 * @param {Lut | null} l
 */
export function filmLut(l) {
	if (!l) return null;
	let out = rgb.get(l);
	if (!out) {
		const n = l.size ** 3, data = new Float32Array(n * 3);
		for (let i = 0; i < n; i++) (data[i * 3] = l.data[i * 4]), (data[i * 3 + 1] = l.data[i * 4 + 1]), (data[i * 3 + 2] = l.data[i * 4 + 2]);
		out = { size: l.size, data };
		rgb.set(l, out);
	}
	return out;
}

/**
 * A LUT baked by the Mac (`color_lut`): a profile's input journey (vault-media's cst), or `odt-rec709` (its aces2).
 * A u32 size, then size³ RGB f32, red fastest — as RGBA for the GPU.
 * @param {string} profile @returns {Promise<Lut>}
 */
export async function nativeLut(profile) {
	const { command } = await import('$lib/native');
	return { ...cubeOf(await command('color_lut', { profile })), name: profile, title: `${profile} (Mac)` };
}

/** A cube the Mac sends: a u32 size, then size³ RGB f32, red fastest — as RGBA for the GPU. @param {unknown} raw */
function cubeOf(raw) {
	const bytes = raw instanceof ArrayBuffer ? raw : new Uint8Array(/** @type {number[]} */ (raw)).buffer;
	const size = new DataView(bytes).getUint32(0, true);
	const rgb = new Float32Array(bytes, 4, size * size * size * 3);
	const data = new Float32Array(size * size * size * 4);
	for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
		data[j] = rgb[i];
		data[j + 1] = rgb[i + 1];
		data[j + 2] = rgb[i + 2];
		data[j + 3] = 1;
	}
	return { size, data };
}

/** @type {Map<string, Promise<Lut>>} */
const graded = new Map();
/**
 * A clip's colour as the Mac bakes it (`color_grade`, from vault-render's grade and looks, their only maths): its
 * balance, its own grade, its scene's look and the film's, as a cube over ACEScct the viewer samples. The last few are
 * kept, by what they are.
 * @param {import('../../../game/film/color.js').Balance | null} balance @param {import('$lib/auth/client').Cdl[]} grades
 * @param {import('$lib/auth/client').Look[]} [looks] @returns {Promise<Lut>}
 */
export function gradeLut(balance, grades, looks = []) {
	const key = JSON.stringify([balance, grades, looks]);
	let lut = graded.get(key);
	if (!lut) {
		lut = import('$lib/native').then(async ({ command }) => ({ ...cubeOf(await command('color_grade', { balance, grades, looks })), name: 'grade', hash: key }));
		lut.catch(() => graded.delete(key));
		graded.set(key, lut);
		if (graded.size > 48) graded.delete(/** @type {string} */ (graded.keys().next().value));
	}
	return lut;
}

/** A grade preset: its name, what the studio calls it, its CDL. @typedef {{ name: string, label: string, cdl: import('$lib/auth/client').Cdl }} Preset */
/** The grade presets as Rust holds them (vault-render `grade::PRESETS`). @returns {Promise<Preset[]>} */
export async function nativePresets() {
	const { command } = await import('$lib/native');
	return command('color_presets');
}

/** @type {Map<string, Promise<string>>} */
const thumbs = new Map();
/**
 * A shot's thumbnail as it will look (`color_thumb`: its grading still through its balance, grade and looks,
 * natively), as an object URL. The last few are kept, by what they are.
 * @param {string} still @param {import('../../../game/film/color.js').Balance | null} balance
 * @param {import('$lib/auth/client').Cdl[]} grades @param {import('$lib/auth/client').Look[]} [looks] @returns {Promise<string>}
 */
export function gradedThumb(still, balance, grades, looks = []) {
	const key = JSON.stringify([still, balance, grades, looks]);
	let url = thumbs.get(key);
	if (!url) {
		url = import('$lib/native').then(async ({ command }) => {
			const raw = await command('color_thumb', { still, balance, grades, looks, width: 320 });
			const bytes = raw instanceof ArrayBuffer ? raw : new Uint8Array(/** @type {number[]} */ (raw)).buffer;
			return URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
		});
		url.catch(() => thumbs.delete(key));
		thumbs.set(key, url);
		if (thumbs.size > 96) {
			const [k, old] = /** @type {[string, Promise<string>]} */ (thumbs.entries().next().value);
			thumbs.delete(k);
			void old.then((u) => URL.revokeObjectURL(u)).catch(() => {});
		}
	}
	return url;
}
