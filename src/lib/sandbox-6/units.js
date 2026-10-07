/**
 * SANDBOX 6 · UNITS ON THE PAGE — every number the page shows is in one real unit (./rules.js UNITS): a tonne of a
 * ware (a plank, a steel, a fired clay, a glass), a tonne of the land a factory works (logs, iron ore, raw clay, sand),
 * a tonne of food, a m³ of water (1,000 L), a MWh of energy, and a gold. Gold is how the world market's real prices
 * read, 1,000 € a gold: euros never show.
 */
import { LAND, LOAD_T, WARES } from './rules.js';
import { EUR_PER_GOLD } from './market.js';

/** a number, short: whole with its thousands marked from 100, to a tenth from 1, and to two figures below */
export const fmt = (/** @type {number} */ n) => {
	if (!Number.isFinite(n)) return '∞';
	const a = Math.abs(n);
	const t = a >= 99.95 ? Math.round(a).toLocaleString('en-US') : a >= 0.995 ? String(Math.round(a * 10) / 10) : a < 0.0005 ? '0' : String(Number(a.toPrecision(2)));
	return (n < 0 && t !== '0' ? '−' : '') + t;
};
/** gold, from € of real prices */
export const gold = (/** @type {number} */ eur) => fmt(eur / EUR_PER_GOLD);
/** a ware, from the truckloads the stores count */
export const ware = (/** @type {number} */ loads) => fmt(loads * LOAD_T);
/** energy, from kWh */
export const energy = (/** @type {number} */ kwh) => fmt(kwh / 1000);
/** water, from litres */
export const water = (/** @type {number} */ litres) => fmt(litres / 1000);
/** food, from kg */
export const food = (/** @type {number} */ kg) => fmt(kg / 1000);

/** what one of a thing is called, said after its number: 5 planks, 5 steel, 7.5 energy, 15 logs */
export const nameOf = (/** @type {string} */ k) =>
	k === 'plank' ? 'planks' : k === 'energy' || k === 'gold' || k === 'food' || k === 'water' ? k : (WARES[k]?.label ?? LAND[/** @type {keyof typeof LAND} */ (k)]?.label ?? k).toLowerCase();
/** what one of a thing is, in real units: the page's legend */
export const UNIT_OF = { ware: '1 t', land: '1 t', food: '1 t', water: '1 m³ (1,000 L)', energy: '1 MWh', gold: '1,000 € of real prices' };
/** a recipe's side, in units: "15 logs + 7.5 energy" (or so, with `sep`) @param {Record<string, number>} m */
export const side = (m, sep = ' + ') =>
	Object.entries(m)
		.filter(([, n]) => n > 0)
		.map(([k, n]) => `${fmt(n)} ${nameOf(k)}`)
		.join(sep) || 'nothing';
/** a recipe in units: "15 logs + 7.5 energy → 15 planks" @param {{ in: Record<string, number>, out: Record<string, number> }} r */
export const craftLine = (r) => `${side(r.in)} → ${side(r.out)}`;
/** a cost the builders carry, from loads, in units: "20 planks, 5 steel" @param {Record<string, number>} loads */
export const costLine = (loads) => side(Object.fromEntries(Object.entries(loads).map(([w, n]) => [w, n * LOAD_T])), ', ');
