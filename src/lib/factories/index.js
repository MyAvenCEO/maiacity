/*
 * THE FACTORIES — every production line we build, as the Factories page (/app/factories/) lists it: a whole factory as
 * a live 3D miniature on a real discrete event simulation (AirSup's factory skill, .claude/skills/factory-skill, its
 * runtime ported here: des.js the engine, kit.js the machines, world.js the hall, look.js the lens, app.js the page).
 * A factory is its spec (the product, the demand, the calendar, the route with every cycle time and where it comes
 * from, src/lib/factories/<factory>.js); the engine sizes the line from it and runs it. Each kind lists its versions in
 * HISTORY ($lib/app/versions.js), so a game can anchor to a line as it was: `factories/batterypack-line@1`
 * ($lib/assets). A factory is not built as one object (objectAt throws, as for a biome): `build()` gives its spec.
 */
import { FIRST, versioned } from '$lib/app/versions.js';
import { PACK_REF, SPEC as BATTERYPACK_LINE } from './batterypack-line.js';

/** @typedef {typeof BATTERYPACK_LINE} Spec a factory as AirSup's runtime reads it (SKILL.md "Spec"), with our `standIn` on each station */
/** @typedef {{ id: string, label: string, note: string, from: string, builds: string, build: () => Spec }} Kind a factory: what it builds (by its ref), and its spec */
/** @typedef {Kind & { versions: import('$lib/app/versions.js').Version<() => Spec>[], version: number }} Factory */

/** the kinds' older versions, by id, each with its frozen spec (the rest are at v1)
 * @type {Record<string, (import('$lib/app/versions.js').Change & { build?: () => Spec })[]>} */
const HISTORY = {
	'batterypack-line': [{ ...FIRST, date: '2026-10-15', note: 'First version: 120 packs a day on 2 × 8 h, ten stations on three branches (cells, drawers, BMS boards), every station standing in AirSup’s kit machines until our own are built; the pack on the line is machines/batterypack@9' }]
};

/** @type {Kind[]} */
const LIST = [
	{
		id: 'batterypack-line',
		label: 'BatteryPack line',
		note: 'The line that builds our BatteryPack: cells tested and sorted, a robot standing 280 of them in their holder on the service drawer, the copper plates clamped on, the BMS board made beside it (SMT, flashed and tested) and fitted, the drawer into its shell, an end-of-line test and the pallet; 120 packs a day on two shifts, sized and run by the simulation',
		from: 'Our design: the first factory, 2026-10-15',
		builds: PACK_REF,
		build: () => BATTERYPACK_LINE
	}
];

/** @type {Factory[]} */
export const FACTORIES = versioned(LIST, 'build', HISTORY);
