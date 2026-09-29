// Which transforms a picture takes on its way to the viewer's screen, from its profile, its grades and the LUTs at
// hand — and, when a LUT is missing, a clear fallback that says so instead of showing something wrong in silence.
import type { Cdl } from '$lib/auth/client';
import { ODT, profileInfo } from './color';
import type { InMode, OutMode } from './gl';
import type { Lut } from './luts';

export type ViewPlan = {
	idt: InMode;
	odt: OutMode;
	idtLut: Lut | null;
	odtLut: Lut | null;
	/** shown on the viewer when the picture is not what the render will make of it */
	note: string | null;
	/** the view is exact (LUTs, or an untouched display-referred picture) */
	exact: boolean;
};

/**
 * The plan for one picture.
 *  - Display-referred (Rec.709, sRGB, legacy) and ungraded: straight through, as the render leaves it (C5).
 *  - Display-referred and graded: in through idt-rec709, graded, out through odt-rec709; both by formula when either
 *    LUT is missing (the formula pair is its own exact inverse, so an ungraded part still looks right).
 *  - ACEScct (world renders, log proxies): no input transform; out through odt-rec709, or by formula without it.
 *  - Camera log and HDR (Apple Log, HLG, PQ …): in through their IDT LUT; without it the log signal itself shows.
 */
export function viewPlan(profile: string, grades: Cdl[], luts: Record<string, Lut | null>): ViewPlan {
	const info = profileInfo(profile);
	const odtLut = luts[ODT] ?? null;
	if (info.display) {
		if (!grades.length) return { idt: 0, odt: 0, idtLut: null, odtLut: null, note: null, exact: true };
		const idtLut = info.idt ? (luts[info.idt] ?? null) : null;
		if (idtLut && odtLut) return { idt: 1, odt: 1, idtLut, odtLut, note: null, exact: true };
		return { idt: 2, odt: 2, idtLut: null, odtLut: null, note: 'Approximate view: no preview LUTs yet (formula transforms)', exact: false };
	}
	if (profile === 'acescct' || (!info.idt && !info.display && info.log)) {
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
