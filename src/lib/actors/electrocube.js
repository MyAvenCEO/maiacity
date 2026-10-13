/*
 * THE ELECTROCUBE — our own cube (not an OSE design; Samuel 2026-10-13): Open Source Ecology's Power Cube frame,
 * engine, tank, battery and quick-attach plate (./powercube.js), but where the hydraulics were, a brushless alternator
 * on the engine's shaft, its control box and sockets on the back, so the cube that could drive a village's machines
 * lights its homes instead. The alternator is longer than the pump and its tank were, so the ElectroCube is 27" wide
 * and high but 35" (900 mm) long. Its figures are inferred from the engine (20.9 kW) and common 3,000/3,600 rpm
 * alternators; its cards say so. Its own actor, beside the Power Cube and the BatteryCube (./batterycube.js).
 */
import { block } from './excavator-rig.js';
import { BLACK, CPL, CRANK, DARK, HOSE, OWN, OWN_STEPS, RED, S, STEEL, cubeCast } from './powercube.js';

/** the ElectroCube's length: the alternator needs more room than the pump and its tank */
export const ELECTROCUBE_L = 900;

/** its assemblies and steps: the Power Cube's, the hydraulics' place taken by the alternator and its sockets */
const ASSEMBLIES = /** @type {import('./parts.js').Assembly[]} */ (OWN.map((a) => (a.id === 'hydraulics' ? { id: 'electrics', label: 'Electrics', note: 'A brushless alternator flanged to the engine and turned by its shaft, its voltage regulator and breakers in a box on the back, and the sockets a home, a workshop or the village grid plugs into.', out: [0, 0.22, -0.55] } : a)));
const STEPS = OWN_STEPS.map((x, i) => (i === 2 ? 'Flange the alternator to the engine on its coupling; fit its feet, the control box, the sockets and the cable' : x));

/** the ElectroCube's own parts, where the Power Cube's hydraulics are: all figures inferred (no OSE design exists) */
/** @type {import('./powercube.js').Insides} */
function electrics(part, { box, cyl, hose, T, Lh, B, joints, base }) {
	const AX0 = CPL - 50, AX1 = -Lh + 40; // the alternator's length along the shaft, from its flange to its end bell
	const SRC_E = 'ElectroCube (our design)';
	part('electrics', { id: 'coupling', label: 'Flexible coupling', source: SRC_E, what: 'A rubber-element coupling between the engine’s shaft and the alternator’s rotor: it takes up the twin’s firing pulses so the rotor turns smoothly.', moves: 'Turns with the engine (shown slowed).', drive: 'The crankshaft; it drives the rotor', specs: [['Type', 'Jaw coupling, rubber spider [inferred]']] }, joints.coupling, (put) => {
		put(cyl([0, CPL - 40, CRANK], [0, CPL + 40, CRANK], 34, 18), STEEL);
		put(cyl([0, CPL - 6, CRANK], [0, CPL + 6, CRANK], 40, 18), BLACK);
		// the rotor's fan at its far end, turning with it: it draws air through the alternator
		for (let k = 0; k < 8; k++) {
			const g = block(0.006, 0.11, 0.03, [0, 0, 0], 0.003);
			g.rotateZ((k / 8) * Math.PI * 2);
			g.translate(0, CRANK * S, (AX1 + 20) * S);
			put(T(g), DARK);
		}
	});
	part('electrics', { id: 'adapter', label: 'Alternator adapter (bell housing)', source: SRC_E, what: 'An SAE bell housing bolted to the engine’s face and the alternator’s flange: it holds the two shafts in line, as the pump mount did.', specs: [['Flange', 'SAE 5 / 6.5" [inferred]']] }, base, (put) => {
		put(cyl([0, CPL - 30, CRANK], [0, AX0, CRANK], 120, 24, 100), '#5b6266');
		put(box(0, -170, B + 30, 200, 100, 12, 2), STEEL);
	});
	part('electrics', { id: 'alternator', label: 'Brushless alternator', source: SRC_E, what: 'A single-bearing, brushless synchronous alternator: its rotor turns inside the stator’s copper windings and gives alternating current at the engine’s governed speed. The 28 hp twin carries about 15 kVA of it.', moves: 'Its rotor turns with the engine.', drive: 'The engine, through the coupling', specs: [['Power', '~15 kVA (12 kW) continuous [inferred: 20.9 kW engine]'], ['Output', '400 V three-phase and 230 V, 50 Hz at 3,000 rpm (60 Hz at 3,600)'], ['Type', 'Brushless, self-excited, single bearing'], ['Cooling', 'Its own fan, on the rotor']] }, base, (put) => {
		put(cyl([0, AX0, CRANK], [0, AX1, CRANK], 128, 28), '#2f4d6e');
		for (let y = AX0 - 25; y > AX1 + 20; y -= 22) put(cyl([0, y, CRANK], [0, y - 4, CRANK], 131, 28), '#3c5f86'); // the stator's ribs
		put(cyl([0, AX1, CRANK], [0, AX1 - 18, CRANK], 120, 28), '#5b6266'); // the end bell, its fan behind the grille
		put(box(0, (AX0 + AX1) / 2, CRANK + 150, 170, 160, 50, 6), '#2f4d6e'); // the terminal box on top
	});
	part('electrics', { id: 'feet', label: 'Alternator foot', source: SRC_E, what: 'A steel foot under the alternator’s end bell, bolted to the frame’s back cross member on rubber mounts; its flange end hangs on the engine.', specs: [['Mounts', 'Rubber, anti-vibration']] }, base, (put) => {
		put(box(0, AX1 + 15, 92, 220, 40, 32, 3), STEEL);
		for (const sx of [-1, 1]) put(cyl([sx * 80, AX1 + 15, 76], [sx * 80, AX1 + 15, 84], 18, 10), BLACK);
	});
	part('electrics', { id: 'control-box', label: 'Control box (regulator and breakers)', source: SRC_E, what: 'The box on the cube’s back: the automatic voltage regulator that holds the voltage steady as loads come and go, the main breaker, an earth-leakage breaker, an hour meter and a voltmeter.', specs: [['Regulator', 'AVR, ±1 %'], ['Protection', 'Main breaker + 30 mA RCD'], ['Meters', 'Volts, hours']] }, base, (put) => {
		put(box(-120, -Lh + 30, 470, 300, 60, 220, 8), DARK);
		put(cyl([-200, -Lh, 520], [-200, -Lh - 6, 520], 30, 20), '#f4f4ee');
		put(box(-60, -Lh - 2, 520, 90, 6, 40, 3), BLACK);
	});
	part('electrics', { id: 'sockets', label: 'Sockets', count: 3, source: SRC_E, what: 'What the cube gives out: a red three-phase socket for the village grid or a workshop, and two blue 230 V sockets for a home or tools, each under its spring lid.', specs: [['Three-phase', '400 V, 16 A (CEE red)'], ['Single phase', '2 × 230 V, 16 A (CEE blue)']] }, base, (put) => {
		for (const [x, c] of /** @type {const} */ ([[60, RED], [140, '#2f6fb5'], [210, '#2f6fb5']])) {
			put(box(x, -Lh + 4, 300, 64, 8, 64, 6), c);
			put(cyl([x, -Lh + 2, 300], [x, -Lh - 30, 300], 24, 14), c);
		}
	});
	part('electrics', { id: 'cable', label: 'Alternator cable', source: SRC_E, what: 'The armoured cable from the alternator’s terminal box to the control box and sockets.', specs: [['Cable', '5 × 4 mm², H07RN-F']] }, base, (put) => {
		put(hose([[0, (AX0 + AX1) / 2, CRANK + 175], [-80, -Lh + 120, 520], [-120, -Lh + 60, 470]], 10), HOSE);
		put(hose([[-120, -Lh + 60, 400], [100, -Lh + 40, 320], [140, -Lh + 10, 300]], 9), HOSE);
	});
}

/** The ElectroCube on its own, every part its own: it runs, stops, is drawn apart and built. @returns {import('./rig').Cast} */
export const electroCube = () =>
	cubeCast({ name: 'ElectroCube', assemblies: ASSEMBLIES, steps: STEPS, stepOf: { frame: 1, engine: 2, electrics: 3, controls: 4 }, len: ELECTROCUBE_L, insides: electrics });
