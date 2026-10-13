/*
 * THE BATTERYCUBE — our own cube (not an OSE design; Samuel 2026-10-13): Open Source Ecology's Power Cube frame
 * (./powercube.js), the same 27" (686 × 660 × 686 mm) cage on its two 4×4 skids with its quick-attach plate and lifting
 * eyes, but no engine and no fuel: four BatteryPacks (./batterypack.js, ~5.2 kWh each) stacked in it to the top
 * (~20.7 kWh), their busbars, and on its back a 6 kW hybrid inverter with an MPPT solar input, so a solar panel plugs
 * straight in and its 52 V comes out as 230 V at its sockets. About 140 kg. Its figures are inferred from common
 * hybrid inverters; its cards say so. Its own actor, beside the Power Cube and the ElectroCube (./electrocube.js).
 */
import { BLACK, CUBE, DARK, HOSE, POWERCUBE_SOURCES, RED, STEEL, cubeCast } from './powercube.js';
import { PACK, batteryPackParts } from './batterypack.js';

const SRC_B = 'BatteryCube (our design)';
const CASE = '#e4e6e3', COPPER = '#b87333', BLUE = '#2f6fb5', SCREEN = '#1d3b4a', LED = '#3ddc84', YELLOW = '#f0c419';
/** the packs: four BatteryPacks, 460 × 480 × 125 mm, stacked 130 apart over the skids, a little ahead of the middle */
const MOD = { l: PACK.L, gap: 130, y: 75 };

const ASSEMBLIES = /** @type {import('./parts.js').Assembly[]} */ ([
	{ id: 'frame', label: 'Frame', note: 'The Power Cube’s own 27" frame: two 4×4 tube skids, 2×2 angle posts and top rails, the quick-attach plate and two lifting eyes, so the BatteryCube is lifted, stacked and coupled like any cube.', out: [0, -0.04, 0] },
	{ id: 'battery', label: 'Battery', note: 'Four BatteryPacks of 280 cells each (51.8 V, ~5.2 kWh), ~20.7 kWh in all, and the copper busbars that join them side by side.', out: [0, 0.45, 0.12] },
	{ id: 'power', label: 'Inverter and sockets', note: 'The 6 kW hybrid inverter on the back: it charges the packs from the sun through its MPPT input, gives 230 V to the sockets, and takes a charge from an ElectroCube or the grid when the sun is short.', out: [0, -0.5, 0.05] }
]);
const STEPS = ['Cut, drill and bolt the frame: skids, posts, top rails, quick-attach plate', 'Slide in the four BatteryPacks; fit the busbars', 'Mount the inverter on the back; wire the solar input, the breakers and the sockets'];

/** @type {import('./powercube.js').Insides} */
function cells(part, { box, cyl, hose, P, kit, Lh, B, base }) {
	const front = MOD.y + MOD.l / 2;
	// four BatteryPacks (./batterypack.js) stacked on the skids, their fronts to the cube's front: each arrives whole
	for (let k = 0; k < 4; k++) batteryPackParts(kit, { at: P(0, MOD.y, B + 10 + k * MOD.gap), base, assembly: () => 'battery', step: () => 2, prefix: `pack-${k + 1}-`, unit: `pack-${k + 1}`, seg: 6 });
	part('battery', { id: 'busbars', label: 'Busbars', count: 2, source: SRC_B, what: 'Two copper bars down the front of the stack, plus and minus, joining the four BatteryPacks side by side so they share the load, and carrying it back to the inverter.', specs: [['Material', 'Tinned copper, 30 × 5 mm'], ['Current', '125 A continuous']] }, base, (put) => {
		for (const x of [90, 140]) put(box(x, front + 18, B + 10 + 2 * MOD.gap - 10, 30, 5, 3 * MOD.gap + 40, 1), COPPER);
		put(hose([[115, front + 20, B + 40], [200, front - 40, B + 30], [200, -Lh + 120, B + 60], [100, -Lh + 160, B + 140]], 12), HOSE);
	});
	part('power', { id: 'inverter', label: 'Hybrid inverter', source: SRC_B, what: 'One box does it all: an MPPT solar charger, a battery charger and a pure-sine inverter. It fills the modules from the panels by day and turns their 48 V into 230 V for the home by night.', specs: [['Power', '6 kW continuous, 12 kW peak [inferred]'], ['Solar in', '500 V, 2 × MPPT, up to 8 kWp'], ['Out', '230 V, 50 Hz'], ['Battery', '48 V LiFePO4, CAN']] }, base, (put) => {
		put(box(0, -Lh + 95, B + 290, 520, 130, 520, 10), CASE);
		put(box(-80, -Lh + 28, B + 400, 180, 4, 110, 4), SCREEN); // its display, on the back
		for (const [x, c] of /** @type {const} */ ([[60, LED], [90, YELLOW], [120, RED]])) put(box(x, -Lh + 28, B + 430, 14, 4, 14, 2), c);
		for (let k = 0; k < 7; k++) put(box(-230 + k * 76, -Lh + 95, B + 560, 8, 110, 20, 1), STEEL); // the heat sink's fins
	});
	part('power', { id: 'solar-in', label: 'Solar input', count: 2, source: SRC_B, what: 'Where the panels plug in: a pair of MC4 connectors, plus and minus, and the DC isolator that cuts them off.', specs: [['Connectors', 'MC4'], ['Isolator', '1,000 V DC']] }, base, (put) => {
		put(cyl([200, -Lh + 30, B + 80], [200, -Lh - 10, B + 80], 12, 10), RED);
		put(cyl([240, -Lh + 30, B + 80], [240, -Lh - 10, B + 80], 12, 10), BLACK);
		put(box(200, -Lh + 26, B + 170, 80, 10, 90, 4), YELLOW);
		put(box(200, -Lh + 18, B + 170, 26, 8, 50, 3), RED);
	});
	part('power', { id: 'sockets', label: 'Sockets and breakers', count: 2, source: SRC_B, what: 'What it gives out: two blue 230 V sockets under spring lids for a home or tools, behind a main breaker and a 30 mA earth-leakage breaker.', specs: [['Sockets', '2 × 230 V, 16 A (CEE blue)'], ['Protection', 'Main breaker + 30 mA RCD']] }, base, (put) => {
		for (const x of [-220, -150]) (put(box(x, -Lh + 26, B + 120, 64, 8, 64, 6), BLUE), put(cyl([x, -Lh + 24, B + 120], [x, -Lh - 10, B + 120], 24, 14), BLUE));
		put(box(-60, -Lh + 26, B + 120, 70, 8, 60, 3), DARK);
	});
}

/** The BatteryCube on its own, every part its own: drawn apart, built. Its size is the Power Cube's. @returns {import('./rig').Cast} */
export const batteryCube = () => cubeCast({ name: 'BatteryCube', assemblies: ASSEMBLIES, steps: STEPS, stepOf: { frame: 1, battery: 2, power: 3 }, sources: POWERCUBE_SOURCES, hums: false, len: CUBE.L, engine: false, controls: false, insides: cells });
