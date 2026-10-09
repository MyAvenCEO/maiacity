// @ts-nocheck — plain JS game state, kept loose on purpose
// The live values of every number the valley runs on. Their catalogue (ranges, units, plain sentences) is
// game/economy/params.js, shared with the API; the values themselves come from a config kept in the database and
// changed by MIPs, with any local changes on top while you play with them. The Policies and World views list them in
// plain words; a change applies at once, or on the next Reset where it shapes the valley itself. The page holds one
// valley, so the live values sit in one shared object, RULES.

import { GOODS, GOOD_LABEL, PARAMS } from '../../../game/economy/params.js';

export { GOODS, GOOD_LABEL, PARAMS };

/** the live values, by key */
export const RULES = Object.fromEntries(PARAMS.map((p) => [p.key, p.value]));
/** the values of the config the valley runs on (the catalogue's defaults until one is loaded); changes are local on top */
export const DEFAULTS = { ...RULES };
/** which config that is: its id, name and version (id null: the catalogue's defaults, not connected) */
export const CONFIG = { id: /** @type {string | null} */ (null), name: 'Defaults', version: 0 };

/** what one aven needs to eat and drink each day; kept in step with RULES @type {Record<string, number>} */
export const NEED = { water: 3, fruits: 2, vegetables: 2, legumes: 2, chicken: 2 };
/** the share of a stock that rots each night; kept in step with RULES @type {Record<string, number>} */
export const ROT = { water: 0, fruits: 0.25, vegetables: 0.15, legumes: 0.05, chicken: 0.3 };

function sync() {
	NEED.water = RULES.needWater;
	for (const g of ['fruits', 'vegetables', 'legumes', 'chicken']) NEED[g] = RULES.needFood;
	for (const g of Object.keys(ROT)) ROT[g] = RULES[`rot_${g}`] / 100;
}

/** run on a config from the database: its values become the base, and `local` (changes you are trying) go on top */
export function useConfig(cfg, local = {}) {
	for (const p of PARAMS) DEFAULTS[p.key] = Number.isFinite(Number(cfg?.params?.[p.key])) ? Math.min(p.max, Math.max(p.min, Number(cfg.params[p.key]))) : p.value;
	CONFIG.id = cfg?.id ?? null;
	CONFIG.name = cfg?.name ?? 'Defaults';
	CONFIG.version = cfg?.version ?? 0;
	setRules(DEFAULTS);
	setRules(local);
}

/** set one rule (clamped to its range) */
export function setRule(key, value) {
	const p = PARAMS.find((q) => q.key === key);
	if (!p || !Number.isFinite(value)) return;
	RULES[key] = Math.min(p.max, Math.max(p.min, value));
	sync();
}

/** set many at once, e.g. from a saved set; unknown keys are ignored */
export function setRules(values) {
	for (const [k, v] of Object.entries(values ?? {})) setRule(k, Number(v));
}

/** back to the config's values */
export function resetRules() {
	setRules(DEFAULTS);
}

/** the rules that differ from the config's: the changes you are trying */
export function changedRules() {
	return Object.fromEntries(Object.entries(RULES).filter(([k, v]) => v !== DEFAULTS[k]));
}

sync();
