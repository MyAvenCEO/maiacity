/*
 * THE BATTERYPACK LINE — the first factory of maiaCITY: a line that builds our own BatteryPack
 * ($lib/actors/batterypack.js, machines/batterypack@9: 460 × 480 × 125 mm, 280 cylindrical 21700 cells as 14S20P in two
 * holder plates, copper contact plates pressed on by a clamp with no welds, an L-shaped service drawer carrying the
 * holders, cells, plates, BMS and inner plug, a closed shell with a foot, a grip, a ClickLock, a back socket and an LED
 * strip). This file is the spec AirSup's factory skill reads (.claude/skills/factory-skill/SKILL.md): the product, the
 * demand, the calendar and the route, every number with where it comes from. The simulation ($lib/factories/des.js)
 * sizes the line from it and runs it; nothing here was tuned to a result.
 *
 * Assumptions (2026-10-15):
 *   - Volume: 120 packs a day, thirty BatteryCubes (four packs each, ~20.7 kWh): a street of homes a day. A village's
 *     own line, supplying the villages around it; 33,600 cells and ~620 kWh of storage a day.
 *   - Calendar: 2 shifts of 8 h, 06:00 to 22:00 (discrete assembly; process.md), 57,600 production seconds a day.
 *     Takt 480 s a pack.
 *   - Scope: from incoming cells to packs on pallets. Bought in: the 21700 cells (in trays of 280), the shell with its
 *     grip, ClickLock, release buttons and back socket already fitted, the two L-drawer plates (cut and bent), the two
 *     injection-moulded holder plates, the stamped copper contact plates, the bare BMS printed circuit boards and
 *     their components. Line-side at the stations that use them; only the cells, the drawers and the BMS boards are
 *     modelled as flows (three branch heads).
 *   - Every station stands in AirSup's kit machines for now (Samuel: "stand-ins first"); `standIn` on each station
 *     names the kit machine and the Machine of ours that will replace it, built one at a time with machine-skill.
 *
 * Route (the pack's own build steps, src/lib/actors/batterypack.js STEPS_9), with cycle times a process engineer would
 * recognise (typical: .claude/skills/factory-skill/references/process.md):
 *   cells:  sort (OCV/IR test and sort) ─┐
 *   drawer: drawer (L-drawer, bottom plates and holder) ─┴→ load (robot stands 280 cells) → plates (top holder, plates,
 *           clamp) ─┐
 *   BMS:    smt (printer, pick and place, reflow) → flash (firmware and test) ─┴→ bms (BMS fitted, leads, inner plug) →
 *           close (drawer into the shell, grip and ClickLock checked) → eol (end-of-line test) → pack (box and pallet)
 */

/**
 * the pack the line builds, by its ref. Kept at version 9: version 10 has the same outside, measure for measure, at
 * five times the triangles per token (139,560 against 28,364, its cells and plates inside) and the line draws dozens
 * of packs; it moves to version 10 once a token keeps only what shows outside
 */
export const PACK_REF = 'pin:factories/batterypack';

/** the cells of one pack, and the test and loading rates per cell the cycle times are built from */
const CELLS = 280;
/** seconds a cell on a four-channel OCV/IR sorter (typical 3,000 to 7,000 cells an hour on 18650/21700 sorters: 0.5 to 1.2 s) */
const SORT_PER_CELL = 0.8;
/** seconds a cell for a six-axis arm with a single vacuum gripper: pick from the tray, orient by polarity, stand it in
 *  the holder (a fast arm's pick-and-place cycle is 0.5 to 0.8 s; with vision and the light press into the holder, typical 1.2 s) */
const LOAD_PER_CELL = 1.2;

const H = 3600, MIN = 60;

/**
 * The line as AirSup's runtime defines it (SKILL.md "Spec"), plus two fields of ours on every station: `standIn`, the
 * kit machine that stands there now and the Machine of ours it stands in for, and on the product stages a `ref` for a
 * stage drawn as one of our assets at its real size, with the kit shape AirSup's own page falls back to (`airsup`).
 */
export const SPEC = {
	id: 'batterypack-line',
	prompt: 'a line that builds 120 BatteryPacks a day',
	title: 'BatteryPack line',
	fig: 'maiaCITY · Factories',
	kicker: 'live discrete event simulation',
	sign: 'BATTERYPACK',
	product: { name: 'pack', unit: 'packs', perToken: 1 },
	demand: { perDay: 120 },
	calendar: { shifts: 2, hoursPerShift: 8, startHour: 6 },
	sizing: { targetUtil: 0.85 },
	release: 'capacity',
	seed: 15,
	stations: [
		// the cells' branch
		{
			id: 'sort', name: 'Cell test and sort', machine: 'tester', input: 'cells', stage: 'tray',
			ct: CELLS * SORT_PER_CELL, cv: 0.03, buffer: 4, mtbf: 5 * H, mttr: 15 * MIN,
			note: `OCV and 1 kHz AC-IR on every cell, graded into bins of 5 mV and 1 mΩ so a parallel group of 20 is matched; ${SORT_PER_CELL} s a cell on a four-channel sorter (typical), ${CELLS} cells a pack. About 1 % of cells fail and are replaced from the same bin, so a set of ${CELLS} always goes on. Stand-in: AirSup's tester, until our own cell sorter is built.`,
			standIn: { kit: 'tester', for: 'machines/cell-sorter', label: 'Cell sorter' }
		},
		// the drawers' branch
		{
			id: 'drawer', name: 'Drawer and bottom plates', machine: 'bench', input: 'drawer', stage: 'drawer',
			ct: 240, cv: 0.15, buffer: 4, operators: 1,
			note: 'The L-drawer riveted from its front plate and base plate, the bottom holder set on the base plate and the 15 bottom copper contact plates laid in its pockets; manual, typical 4 min (bench assembly 1 to 10 min). Stand-in: AirSup\'s bench, until our own drawer bench is built.',
			standIn: { kit: 'bench', for: 'machines/drawer-bench', label: 'Drawer bench' }
		},
		{
			id: 'load', name: 'Cell loading robot', machine: 'robot', after: ['sort', 'drawer'], stage: 'loaded',
			ct: CELLS * LOAD_PER_CELL, cv: 0.04, buffer: 3, mtbf: 5 * H, mttr: 12 * MIN,
			note: `A six-axis arm with a vacuum gripper takes each cell from the sorted tray, turns it to its row's polarity (the 14 groups of 20 alternate up and down, so one plate joins each group to the next) and stands it in the bottom holder: ${CELLS} cells at ${LOAD_PER_CELL} s (typical). Robot cell MTBF 5 h, MTTR 12 min. Stand-in: AirSup's robot cell, until our own cell loader is built.`,
			standIn: { kit: 'robot', for: 'machines/cell-loader', label: 'Cell loader' }
		},
		{
			id: 'plates', name: 'Top holder, plates and clamp', machine: 'bench', stage: 'clamped',
			ct: 300, cv: 0.12, buffer: 3, operators: 1,
			note: 'The top holder pressed over the 280 cell tops, the 15 top copper plates laid in it, the clamp bar screwed down to 4 N·m so every plate is pressed onto its cells (no welds, no glue), then a 14-point row-voltage check; manual, typical 5 min. Stand-in: AirSup\'s bench, until our own plate and clamp press is built.',
			standIn: { kit: 'bench', for: 'machines/clamp-press', label: 'Plate and clamp press' }
		},
		// the BMS boards' branch
		{
			id: 'smt', name: 'BMS board: SMT', machine: 'smt', input: 'pcb', stage: 'pcb', length: 6,
			ct: 90, cv: 0.04, buffer: 6, mtbf: 4 * H, mttr: 15 * MIN,
			note: 'A 14S BMS board: solder paste printed, about 260 parts placed at 0.3 s each on a one-head pick-and-place, reflowed at 240 °C in line; a board every 90 s, each riding through in about 5 min. High-speed automation MTBF 4 h, MTTR 15 min. Stand-in: AirSup\'s SMT line, until our own is built.',
			standIn: { kit: 'smt', for: 'machines/smt-line', label: 'SMT line' }
		},
		{
			id: 'flash', name: 'BMS flash and test', machine: 'tester', stage: 'bms',
			ct: 120, cv: 0.05, buffer: 6, yield: 0.97,
			note: 'Firmware over SWD, then a functional test on a cell simulator: the 14 channels, balancing, over-current, the two temperature inputs, the socket\'s data pins; 2 min (EOL electrical 30 to 120 s). 3 % fail and go to rework, off the line. Stand-in: AirSup\'s tester, until our own board tester is built.',
			standIn: { kit: 'tester', for: 'machines/board-tester', label: 'Board tester' }
		},
		// the pack comes together
		{
			id: 'bms', name: 'BMS fitting', machine: 'bench', after: ['plates', 'flash'], stage: 'wired',
			ct: 240, cv: 0.15, buffer: 3, operators: 1,
			note: 'The tested BMS board screwed to the drawer\'s base plate, its 15 sense leads to the plates, two temperature probes between the cells, the inner plug on its bracket; manual, typical 4 min. Stand-in: AirSup\'s bench, until our own BMS bench is built.',
			standIn: { kit: 'bench', for: 'machines/bms-bench', label: 'BMS bench' }
		},
		{
			id: 'close', name: 'Into the shell', machine: 'bench', stage: 'pack',
			ct: 180, cv: 0.12, buffer: 3, operators: 1,
			note: 'The shell arrives line-side with its grip, ClickLock, release buttons and back socket fitted; the drawer slides in between the two corner columns until both catches click into the base plate, the inner plug meets the socket and the LED strip wakes; the grip\'s trigger is squeezed once to check the ClickLock\'s pawls pull back; typical 3 min. Stand-in: AirSup\'s bench, until our own closing bench is built.',
			standIn: { kit: 'bench', for: 'machines/closing-bench', label: 'Closing bench' }
		},
		{
			id: 'eol', name: 'End-of-line test', machine: 'tester', stage: 'pack',
			ct: 480, cv: 0.04, buffer: 4, yield: 0.985, mtbf: 10 * H, mttr: 15 * MIN,
			note: 'On the back socket: insulation at 500 V, BMS communication, a 20 A charge and a 50 A discharge pulse with every row\'s voltage and resistance read, the LED strip and the ClickLock; 8 min. 1.5 % fail and go back to the drawer bench (yield 0.95 to 0.995 for a test). Stand-in: AirSup\'s tester, until our own pack tester is built.',
			standIn: { kit: 'tester', for: 'machines/pack-tester', label: 'Pack tester' }
		},
		{
			id: 'pack', name: 'Label and palletise', machine: 'packer', stage: 'pack',
			ct: 60, cv: 0.08, buffer: 6, mtbf: 4 * H, mttr: 10 * MIN,
			note: 'The pack\'s serial and its test record printed on its label, a film sleeve, then two to a layer and six layers on a Euro pallet (312 kg); no carton, the packs go straight into BatteryCubes; 60 s (packer MTBF 3 to 6 h, MTTR 10 to 15 min). Stand-in: AirSup\'s packer, until our own packer is built.',
			standIn: { kit: 'packer', for: 'machines/pack-packer', label: 'Packer' }
		}
	],
	/** what each stage looks like on the belts: our own shapes at their real size (kit.js, "maiaCITY additions"), and
	 *  the finished pack our own BatteryPack by its ref, built in the asset box; `airsup` is the kit shape AirSup's own
	 *  page falls back to, `pallet` how the finished product stacks on a Euro pallet */
	stages: {
		cells: { shape: 'celltray', color: '#2f6fb5', airsup: 'cell' },
		tray: { shape: 'celltray', color: '#2f6fb5', sorted: true, airsup: 'cell' },
		drawer: { shape: 'ldrawer', color: '#b9bfc4', airsup: 'sheet' },
		loaded: { shape: 'ldrawer', color: '#b9bfc4', cells: true, airsup: 'module' },
		clamped: { shape: 'ldrawer', color: '#b9bfc4', cells: true, plates: true, airsup: 'module' },
		pcb: { shape: 'bmsboard', color: '#2c7a4a', airsup: 'pcb' },
		bms: { shape: 'bmsboard', color: '#2c7a4a', parts: true, airsup: 'pcb' },
		wired: { shape: 'ldrawer', color: '#b9bfc4', cells: true, plates: true, bms: true, airsup: 'module' },
		pack: { shape: 'asset', ref: PACK_REF, color: '#1f2225', airsup: 'pack', pallet: { nx: 2, nz: 1, dx: 0.54, dz: 0, dy: 0.127, ny: 6 } }
	},
	look: { tilt: { focusY: 0.47, band: 0.08, amount: 16 } }
};
