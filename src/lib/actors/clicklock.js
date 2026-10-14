/*
 * THE CLICKLOCK — our one snap-in latch (Samuel 2026-10-13), for anything that slides into a place and must come out
 * again by hand: a BatteryPack into its BatteryCube, and later any drawer, module or cassette. Two spring pawls on the
 * sliding thing's sides ride up a ramp on the fixed rails and drop into a keeper notch with a click; one flush tab on
 * its face (or the trigger in its grip) pulls both pawls back by two short cables, and the thing slides out. No tool, no screw, nothing to lose.
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
 * on the face (y = face) at height `tabZ`; with `withTab` false a grip's trigger releases it instead.
 * @param {(x: number, y: number, z: number, w: number, l: number, h: number, r?: number) => any} box
 * @param {(geo: any, color: string) => void} put
 * @param {{ half: number, face: number, z: number, tabZ: number, back?: number, steel?: string, tab?: string, withTab?: boolean }} o
 */
export function clickLatch(box, put, { half, face, z, tabZ, back = 40, steel = '#8d9396', tab = '#3a3f44', withTab = true }) {
	for (const sx of [-1, 1]) put(box(sx * (half + 3), face - back, z, 6, 12, 8, 1), steel); // the pawls
	if (!withTab) return; // released by a grip instead (its trigger pulls the same two cables)
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

/**
 * The sliding half in all its pieces, each its own part for a machine's exploded view: the two pawls, their springs
 * and pivot pins, the two release cables and the trigger (in a grip at `grip`, or the face's tab). With `straight`
 * (the grip's trigger at the pawls' own height), each cable runs flat at that one height: in through the face, along
 * its inside to the corner and straight back along the side wall to its pawl. Returns [id, card, draw] for the
 * machine to add with its own part().
 * @param {(x: number, y: number, z: number, w: number, l: number, h: number, r?: number) => any} box
 * @param {(a: [number, number, number], b: [number, number, number], r: number, n?: number) => any} cyl
 * @param {{ half: number, face: number, z: number, grip?: [number, number, number], straight?: boolean, back?: number, steel?: string, dark?: string }} o
 * @returns {[string, { label: string, count?: number, what: string, specs: [string, string][] }, (put: (geo: any, color: string) => void) => void][]}
 */
export function clickLockPieces(box, cyl, { half, face, z, grip, straight = false, back = 40, steel = '#8d9396', dark = '#3a3f44' }) {
	const y = face - back; // the pawls' teeth
	/** @type {[number, number, number]} */
	const t = grip ?? [0, face + 2, 24];
	return [
		['lock-pawls', { label: 'Pawls', count: 2, what: 'Two steel levers, one inside each side wall. Each pivots at its back end; its tooth at the front pokes out through a slot in the wall. Sliding in, the tooth rides up the rail’s ramp, is pushed in, and snaps out again behind the keeper: that is the click.', specs: [['Material', 'Stainless steel, 3 mm, hardened tooth'], ['Travel', '4 mm']] }, (put) => {
			for (const sx of [-1, 1]) {
				put(box(sx * (half - 4), y - 18, z, 6, 44, 8, 1), steel); // the lever
				put(box(sx * (half + 2), y, z, 8, 10, 8, 1), steel); // its tooth, through the wall
			}
		}],
		['lock-springs', { label: 'Pawl springs', count: 2, what: 'A small coil spring behind each pawl presses its tooth outward, so it always drops into the keeper on its own: you never have to lock it, only to unlock it.', specs: [['Type', 'Compression, stainless'], ['Force', '~15 N each [inferred]']] }, (put) => {
			for (const sx of [-1, 1]) for (let k = 0; k < 5; k++) put(cyl([sx * (half - 22 + k * 3), y - 4, z], [sx * (half - 21 + k * 3), y - 4, z], 3, 8), steel);
		}],
		['lock-pivots', { label: 'Pivot pins', count: 2, what: 'A pin through each pawl’s back end, standing in the case floor: the pawl swings round it, in and out.', specs: [['Pin', '⌀ 4 mm, stainless']] }, (put) => {
			for (const sx of [-1, 1]) put(cyl([sx * (half - 4), y - 38, z - 8], [sx * (half - 4), y - 38, z + 8], 2.5, 8), steel);
		}],
		['lock-cables', { label: 'Release cables', count: 2, what: straight ? 'Two short steel cables in sleeves, both at the pawls’ own height: from the trigger in through the face, along its inside to the corner and straight back along the side wall to the pawl, no bend up or down. Pulling the trigger pulls both cables, and both pawls swing in together, out of their keepers.' : 'Two short steel cables in sleeves run from the trigger along the inside of the face to the two pawls. Pulling the trigger pulls both cables, and both pawls swing in together, out of their keepers.', specs: [['Cable', '⌀ 1.5 mm steel in a PTFE sleeve'], ['Pull', '4 mm']] }, (put) => {
			for (const sx of [-1, 1]) {
				/** @type {[number, number, number][]} */
				const path = straight
					? [[sx * 60, t[1], z], [sx * 60, face - 10, z], [sx * (half - 24), face - 10, z], [sx * (half - 8), y - 6, z]]
					: [[sx * 30, t[1] - 4, t[2]], [sx * 50, face - 8, t[2]], [sx * (half - 40), face - 10, z + 2], [sx * (half - 8), y - 6, z]];
				for (let i = 1; i < path.length; i++) put(cyl(path[i - 1], path[i], 1.6, 6), dark);
			}
		}],
		['lock-trigger', { label: 'Trigger', what: grip ? 'The bar under the grip: your fingers close round the grip and press it up, it pulls both cables, and the pawls let go. Let go and the springs push it back.' : 'The flush tab on the face: press it and it pulls both cables, and the pawls let go.', specs: [['Force', '~20 N'], ['Travel', '4 mm']] }, (put) => {
			put(box(t[0], t[1], t[2], grip ? 130 : 64, grip ? 8 : 3, grip ? 8 : 12, grip ? 3 : 1.5), dark);
			put(box(t[0], t[1] + (grip ? 4.5 : 1.8), t[2], grip ? 90 : 40, 0.6, 2, 0.3), '#d9dcde');
		}]
	];
}
