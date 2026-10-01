// Which transforms a picture takes on its way to the viewer's screen, from its profile, its grades and the LUTs at
// hand — and, when a LUT is missing, a clear fallback that says so instead of showing something wrong in silence.
import { ODT, profileInfo } from './color.js';

/** @typedef {import('$lib/auth/client').Cdl} Cdl */
/** @typedef {import('./luts.js').Lut} Lut */
/**
 * note: shown on the viewer when the picture is not what the render will make of it; exact: the view is exact (LUTs,
 * or an untouched display-referred picture).
 * @typedef {{ idt: import('./gl.js').InMode, odt: import('./gl.js').OutMode, idtLut: Lut | null, odtLut: Lut | null, note: string | null, exact: boolean }} ViewPlan
 */

/**
 * The plan for one picture — one path for all: in through its journey into ACEScct (the input LUT the Mac bakes from
 * the same maths it makes the proxies with), graded, out through odt-rec709.
 *  - ACEScct (every proxy, world renders): no input transform; out through odt-rec709.
 *  - Everything else (Rec.709, sRGB, camera log, HDR …): in through its input LUT; without it the signal itself shows,
 *    and the viewer says so.
 *  - Display-referred (a film we rendered, a delivery): nothing at all — its output transform is baked in.
 */
/** @param {string} profile @param {Cdl[]} grades @param {Record<string, Lut | null>} luts @returns {ViewPlan} */
export function viewPlan(profile, grades, luts) {
	// rendered, display-referred: exactly as it is — its output transform is in it already
	if (profile === 'display') return { idt: 0, odt: 0, idtLut: null, odtLut: null, note: null, exact: true };
	const info = profileInfo(profile);
	const odtLut = luts[ODT] ?? null;
	// no output LUT (the Mac has not baked it yet): the signal as it is, and the viewer says so — never an approximation
	if (!odtLut) return { idt: 0, odt: 0, idtLut: null, odtLut: null, note: 'The output LUT is not baked yet: showing the signal as it is', exact: false };
	if (profile === 'acescct') return { idt: 0, odt: 1, idtLut: null, odtLut, note: null, exact: true };
	if (info.idt) {
		const idtLut = luts[info.idt] ?? null;
		if (idtLut) return { idt: 1, odt: 1, idtLut, odtLut, note: null, exact: true };
		return { idt: 0, odt: 0, idtLut: null, odtLut: null, note: `No ${info.idt} LUT yet: showing the ${info.label} signal as it is`, exact: false };
	}
	return { idt: 0, odt: 0, idtLut: null, odtLut: null, note: profile === 'unknown' ? 'Colour unknown: set its profile' : `No preview transform for ${info.label}`, exact: false };
}
