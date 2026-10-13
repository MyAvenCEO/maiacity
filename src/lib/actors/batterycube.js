/*
 * THE BATTERYCUBE — our own cube (not an OSE design; Samuel 2026-10-13): Open Source Ecology's Power Cube frame
 * (./powercube.js), the same 27" (686 × 660 × 686 mm) cage on its two 4×4 skids with its quick-attach plate and lifting
 * eyes, but no engine and no fuel: four BatteryPacks (./batterypack.js, ~5.2 kWh each) stacked in it to the top
 * (~20.7 kWh), plugged into a backplane and held by ClickLocks (./clicklock.js), and on its back a 6 kW bidirectional inverter with an MPPT
 * solar input and an AC inlet to charge from outside power, so a solar panel plugs
 * straight in and its 52 V comes out as 230 V at its sockets. About 140 kg. Its figures are inferred from common
 * hybrid inverters; its cards say so. Its own actor, beside the Power Cube and the ElectroCube (./electrocube.js).
 */
import { BLACK, CUBE, DARK, POWERCUBE_SOURCES, RED, STEEL, cubeCast } from './powercube.js';
import { loop } from './rig';
import { ease } from './excavator-rig.js';
import { PACK, batteryPackParts } from './batterypack.js';
import { CLICKLOCK, clickKeeper } from './clicklock.js';

const SRC_B = 'BatteryCube (our design)';
const CASE = '#e4e6e3', COPPER = '#b87333', BLUE = '#2f6fb5', SCREEN = '#1d3b4a', LED = '#3ddc84', YELLOW = '#f0c419';
/** the packs: four BatteryPacks, 460 × 480 × 125 mm, stacked 130 apart over the skids, a little ahead of the middle */
const MOD = { l: PACK.L, gap: 130, y: 75 };

const ASSEMBLIES = /** @type {import('./parts.js').Assembly[]} */ ([
	{ id: 'frame', label: 'Frame', note: 'The Power Cube’s own 27" frame: two 4×4 tube skids, 2×2 angle posts and top rails, the quick-attach plate and two lifting eyes, so the BatteryCube is lifted, stacked and coupled like any cube.', out: [0, -0.04, 0] },
	{ id: 'battery', label: 'Battery', note: 'Four BatteryPacks of 280 cells each (51.8 V, ~5.2 kWh), ~20.7 kWh in all, each plugged by its back into the backplane that joins them side by side.', out: [0, 0.45, 0.12] },
	{ id: 'power', label: 'Inverter and sockets', note: 'The 6 kW bidirectional inverter on the back: it charges the packs from the sun through its MPPT input or from outside power at its AC inlet (the grid, an ElectroCube, a generator), and gives 230 V to the sockets.', out: [0, -0.5, 0.05] }
]);
const STEPS = ['Cut, drill and bolt the frame: skids, posts, top rails, quick-attach plate', 'Fit the backplane; slide in the four BatteryPacks, each plugs itself in', 'Mount the inverter on the back; wire the solar input, the AC inlet, the breakers and the sockets'];

/** a BatteryCube's insides at version `v` (2: one-way inverter, no AC inlet; 3: bidirectional, its AC inlet;
 * 4: its packs at v4, a centre grip each)
 * @param {Parameters<import('./powercube.js').Insides>[0]} part @param {Parameters<import('./powercube.js').Insides>[1]} tools */
function cells(part, { box, cyl, P, kit, Lh, B, base }, v = 4) {
		// four BatteryPacks (./batterypack.js) stacked on the skids, their fronts to the cube's front: each arrives whole
	for (let k = 0; k < 4; k++) batteryPackParts(kit, { at: P(0, MOD.y, B + 10 + k * MOD.gap), base, assembly: () => 'battery', step: () => 2, prefix: `pack-${k + 1}-`, unit: `pack-${k + 1}`, seg: 6, v: v >= 4 ? 4 : 3 });
	const back = MOD.y - MOD.l / 2, top = B + 10 + 4 * MOD.gap;
	part('battery', { id: 'backplane', label: 'Backplane', source: SRC_B, what: 'A board behind the stack with a socket for each BatteryPack: slide a pack in and its back plug finds its socket on the guide pins; pull it out and it lets go. Copper bars inside it join the four side by side and carry their 52 V to the inverter.', specs: [['Sockets', '4, blind-mate'], ['Bus', 'Tinned copper, 30 × 5 mm, 125 A'], ['Data', 'CAN from every pack to the inverter']] }, base, (put) => {
		put(box(0, back - 15, (B + top) / 2, 420, 10, top - B, 2), DARK);
		for (let k = 0; k < 4; k++) {
			const z = B + 10 + k * MOD.gap + 58;
			put(box(0, back - 13, z, 180, 8, 54, 1), BLACK);
			for (const x of [-45, 45]) put(box(x, back - 9, z, 38, 1, 16), x < 0 ? RED : COPPER);
		}
		for (const x of [-60, 60]) put(box(x, back - 25, B + 300, 30, 10, 60, 1), COPPER); // the straps to the inverter
	});
	part('battery', { ...CLICKLOCK, id: 'pack-rails', label: 'Pack rails', count: 4, source: SRC_B, what: `${CLICKLOCK.what} Here: a pair of rails for each BatteryPack, their keepers where the pack’s back plug meets the backplane.` }, base, (put) => {
		for (let k = 0; k < 4; k++) clickKeeper(box, put, { half: PACK.W / 2, face: MOD.y + MOD.l / 2, z: B + 10 + k * MOD.gap + 4, len: MOD.l });
	});
	part('power', { id: 'inverter', label: 'Hybrid inverter', source: SRC_B, what: v < 3 ? 'One box does it all: an MPPT solar charger, a battery charger and a pure-sine inverter. It fills the packs from the panels by day and turns their 52 V into 230 V for the home by night.' : 'One bidirectional box does it all: an MPPT solar charger, a charger from outside power and a pure-sine inverter. It fills the packs from the panels by day, or from the grid, an ElectroCube or a generator at its AC inlet, and turns their 52 V into 230 V for the home.', specs: [['Power', '6 kW continuous, 12 kW peak [inferred]'], ['Solar in', '500 V, 2 × MPPT, up to 8 kWp'], ['AC in (charging)', '230 V, up to 5 kW [inferred]'], ['Out', '230 V, 50 Hz'], ['Battery', '52 V, CAN to every pack']] }, base, (put) => {
		put(box(0, -Lh + 80, B + 290, 520, 100, 520, 10), CASE);
		put(box(-80, -Lh + 28, B + 400, 180, 4, 110, 4), SCREEN); // its display, on the back
		for (const [x, c] of /** @type {const} */ ([[60, LED], [90, YELLOW], [120, RED]])) put(box(x, -Lh + 28, B + 430, 14, 4, 14, 2), c);
		for (let k = 0; k < 7; k++) put(box(-230 + k * 76, -Lh + 80, B + 560, 8, 90, 20, 1), STEEL); // the heat sink's fins
	});
	part('power', { id: 'solar-in', label: 'Solar input', count: 2, source: SRC_B, what: 'Where the panels plug in: a pair of MC4 connectors, plus and minus, and the DC isolator that cuts them off.', specs: [['Connectors', 'MC4'], ['Isolator', '1,000 V DC']] }, base, (put) => {
		put(cyl([200, -Lh + 30, B + 80], [200, -Lh - 10, B + 80], 12, 10), RED);
		put(cyl([240, -Lh + 30, B + 80], [240, -Lh - 10, B + 80], 12, 10), BLACK);
		put(box(200, -Lh + 26, B + 170, 80, 10, 90, 4), YELLOW);
		put(box(200, -Lh + 18, B + 170, 26, 8, 50, 3), RED);
	});
	if (v >= 3) part('power', { id: 'ac-in', label: 'AC inlet', source: SRC_B, what: 'Where outside power comes in to charge it: a red-ringed 230 V inlet under a spring lid. Plug in the grid, an ElectroCube or a generator and the inverter runs backwards, filling the packs.', specs: [['Inlet', '230 V, 16 A (CEE)'], ['Charges at', 'up to 5 kW [inferred]']] }, base, (put) => {
		put(box(-220, -Lh + 26, B + 200, 64, 8, 64, 6), BLUE);
		put(cyl([-220, -Lh + 24, B + 200], [-220, -Lh - 10, B + 200], 24, 14), BLUE);
		put(cyl([-220, -Lh - 10, B + 200], [-220, -Lh - 12, B + 200], 26, 14), RED);
	});
	part('power', { id: 'sockets', label: 'Sockets and breakers', count: 2, source: SRC_B, what: 'What it gives out: two blue 230 V sockets under spring lids for a home or tools, behind a main breaker and a 30 mA earth-leakage breaker.', specs: [['Sockets', '2 × 230 V, 16 A (CEE blue)'], ['Protection', 'Main breaker + 30 mA RCD']] }, base, (put) => {
		for (const x of [-220, -150]) (put(box(x, -Lh + 26, B + 120, 64, 8, 64, 6), BLUE), put(cyl([x, -Lh + 24, B + 120], [x, -Lh - 10, B + 120], 24, 14), BLUE));
		put(box(-60, -Lh + 26, B + 120, 70, 8, 60, 3), DARK);
	});
}

/** The BatteryCube on its own (version `v`; from v5 it pulls a pack out and pushes it back as a move), every part its own: drawn apart, built. Its size is the Power Cube's. @returns {import('./rig').Cast} */
export const batteryCube = (v = 5) => {
	const cast = cubeCast({ name: 'BatteryCube', assemblies: ASSEMBLIES, steps: STEPS, stepOf: { frame: 1, battery: 2, power: 3 }, sources: POWERCUBE_SOURCES, hums: false, len: CUBE.L, engine: false, controls: false, insides: (part, tools) => cells(part, tools, v) });
	if (v < 5) return cast;
	// from v5 a pack comes out and goes back (Samuel 2026-10-13): the third pack's grip is squeezed, it slides out on its
	// rails, waits, slides back in and clicks home
	const ids = (cast.catalog?.parts ?? []).map((p) => p.id).filter((id) => id.startsWith(PULLED));
	/** @param {number} out how far it is out (m) @param {number} squeeze the trigger, 0…1 @returns {import('./rig').Pose} */
	const pulled = (out, squeeze) => {
		/** @type {import('./rig').Pose} */
		const p = {};
		for (const id of ids) p[`p.${id}`] = [0, 0, 0, 1, 0, 0, out];
		p[`p.${PULLED}lock-trigger`] = [0, 0, 0, 1, 0, squeeze * 0.004, out];
		return p;
	};
	const s = (/** @type {number} */ u, /** @type {number} */ a, /** @type {number} */ b) => ease(Math.min(1, Math.max(0, (u - a) / (b - a))));
	cast.clips['pull out'] = (t) => {
		const u = loop(t, 8) * 8; // seconds into its 8 s
		const squeeze = s(u, 0.3, 0.7) - s(u, 3.2, 3.4);
		const out = PULL * (s(u, 0.8, 3) - s(u, 4.6, 6.8));
		return pulled(out, squeeze);
	};
	cast.poses = { ...cast.poses, 'pulled out': pulled(PULL, 0) };
	return cast;
};
/** the pack that comes out, and how far (m): most of its length, its back plug well clear of the backplane */
const PULLED = 'pack-3-', PULL = 0.36;
