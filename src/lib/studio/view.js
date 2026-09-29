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
 * The plan for one picture.
 *  - Display-referred (Rec.709, sRGB, legacy) and ungraded: straight through, as the render leaves it (C5).
 *  - Display-referred and graded: in through idt-rec709, graded, out through odt-rec709; both by formula when either
 *    LUT is missing (the formula pair is its own exact inverse, so an ungraded part still looks right).
 *  - ACEScct (world renders, log proxies): no input transform; out through odt-rec709, or by formula without it.
 *  - Camera log and HDR (Apple Log, HLG, PQ …): in through their IDT LUT; without it the log signal itself shows.
 */
/** @param {string} profile @param {Cdl[]} grades @param {Record<string, Lut | null>} luts @returns {ViewPlan} */
export function viewPlan(profile, grades, luts) {
	const info = profileInfo(profile);
	const odtLut = luts[ODT] ?? null;
	if (info.display) {
		if (!grades.length) return { idt: 0, odt: 0, idtLut: null, odtLut: null, note: null, exact: true };
		const idtLut = info.idt ? (luts[info.idt] ?? null) : null;
		if (idtLut && odtLut) return { idt: 1, odt: 1, idtLut, odtLut, note: null, exact: true };
		return { idt: 2, odt: 2, idtLut: null, odtLut: null, note: 'Approximate view: no preview LUTs yet (formula transforms)', exact: false };
	}
	if (profile === 'acescct') {
		return odtLut
			? { idt: 0, odt: 1, idtLut: null, odtLut, note: null, exact: true }
			: { idt: 0, odt: 2, idtLut: null, odtLut: null, note: 'Approximate view: no output LUT yet (formula transform)', exact: false };
	}
	if (info.idt) {
		const idtLut = luts[info.idt] ?? null;
		if (idtLut && odtLut) return { idt: 1, odt: 1, idtLut, odtLut, note: null, exact: true };
		if (idtLut) return { idt: 1, odt: 2, idtLut, odtLut: null, note: 'Approximate view: no output LUT yet (formula transform)', exact: false };
		return { idt: 0, odt: 0, idtLut: null, odtLut: null, note: `No ${info.idt} LUT yet: showing the ${info.label} signal as it is`, exact: false };
	}
	return { idt: 0, odt: 0, idtLut: null, odtLut: null, note: profile === 'unknown' ? 'Colour unknown: set its profile' : `No preview transform for ${info.label}`, exact: false };
}
