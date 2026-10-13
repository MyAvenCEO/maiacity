/*
 * THE CLICKLOCK — our one snap-in latch (Samuel 2026-10-13), for anything that slides into a place and must come out
 * again by hand: a BatteryPack into its BatteryCube, and later any drawer, module or cassette. Two spring pawls on the
 * sliding thing's sides ride up a ramp on the fixed rails and drop into a keeper notch with a click; one flush tab on
 * its face pulls both pawls back, and the thing slides out. No tool, no screw, nothing to lose.
 * In mm, the sliding thing's frame: x across, y along to its face, z up; the caller draws with its own box().
 */

/** the ClickLock's card, shared by every machine that uses one */
export const CLICKLOCK = {
	label: 'ClickLock',
	what: 'Our one snap-in latch: slide it in and two spring pawls click into the keepers on the rails; press the flush tab on its face and both let go, and it slides out. No tool, no screw.',
	specs: /** @type {[string, string][]} */ ([['Hold', '2 spring pawls, ~300 N each [inferred]'], ['Release', 'One flush tab, ~20 N'], ['Used by', 'BatteryPack, BatteryCube']])
};

/**
 * The sliding half: a pawl on each side `half` from the middle, `back` behind the face, at height z; the release tab
 * on the face (y = face) at height `tabZ`.
 * @param {(x: number, y: number, z: number, w: number, l: number, h: number, r?: number) => any} box
 * @param {(geo: any, color: string) => void} put
 * @param {{ half: number, face: number, z: number, tabZ: number, back?: number, steel?: string, tab?: string }} o
 */
export function clickLatch(box, put, { half, face, z, tabZ, back = 40, steel = '#8d9396', tab = '#3a3f44' }) {
	for (const sx of [-1, 1]) put(box(sx * (half + 3), face - back, z, 6, 12, 8, 1), steel); // the pawls
	put(box(0, face + 1.5, tabZ, 64, 3, 12, 1.5), tab); // the release tab, flush
	put(box(0, face + 3.2, tabZ, 40, 0.6, 2, 0.3), '#d9dcde'); // its light line
}

/**
 * The fixed half: a rail on each side `half` from the middle, `len` long ending at `face`, at height z, with its ramp
 * and keeper notch `back` behind the face.
 * @param {(x: number, y: number, z: number, w: number, l: number, h: number, r?: number) => any} box
 * @param {(geo: any, color: string) => void} put
 * @param {{ half: number, face: number, z: number, len: number, back?: number, steel?: string }} o
 */
export function clickKeeper(box, put, { half, face, z, len, back = 40, steel = '#8d9396' }) {
	for (const sx of [-1, 1]) {
		put(box(sx * (half + 9), face - len / 2, z, 10, len, 4, 1), steel); // the rail
		put(box(sx * (half + 9), face - back - 12, z + 6, 10, 10, 8, 1), steel); // the keeper, just behind the pawl
	}
}
