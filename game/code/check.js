// @ts-nocheck — plain JS, kept loose on purpose
/**
 * THE ONE CHECKER — every kind of code we keep, checked one way before it is kept, wherever it comes in: the API (an
 * agent over the MCP), the pages, and avenDB proposals. One verdict for all of them:
 *
 *   checkCode(type, raw, { mode }) -> { ok: true, value, notes } | { ok: false, errors }
 *
 * `value` is the clean code entry as it is kept; `errors` say in sentences why it is refused; `notes` what is kept but
 * will do nothing (a library never imported, a fetch with no network). mode 'write' (the default) holds new code to
 * every rule (./rules.js); mode 'read' is for code already kept, which a page draws whatever its rules say now: only its
 * shape is checked, since what the rules refuse the engines drop anyway (safety never rests on this checker).
 *
 * The types (each type's owner may add one with `define`, as the asset schemas do for asset cards, $lib/code/check.js):
 *   view       a Generated UI view: { id, title, note?, kind: a2ui | html, spec }      (./views.js)
 *   view-card  a game's screen: { id, kind: 'view', name, data: { slot, libs, height }, code }, with `slots`
 *   logic      a bare logic module: { code, hooks?, max? }
 *   function   an avenDB function's code, run in QuickJS as an entry moves through a flow: a module that exports
 *              run(event) (src/lib/avendb/functions.js), checked as each one loads to run
 *   config     a game's settings: plain JSON, held to the shape of the repo's seed of it (`seed`), so a config from
 *              the vault can change what a game's numbers are, never what the game finds where
 */
import { ViewError, check as checkView, checkViewCard } from './views.js';
import { JSON_LIMITS, logicSource, plainJson, viewHtml } from './rules.js';

const verdict = (value, errors = [], notes = []) => (errors.length ? { ok: false, errors: errors.slice(0, 12) } : { ok: true, value, notes: notes.slice(0, 12) });

/** the hooks a view's logic answers (src/lib/sandbox/view-logic.js) */
export const VIEW_HOOKS = ['init', 'on'];
/** the hook an avenDB function answers (src/lib/avendb/functions.js) */
export const FUNCTION_HOOKS = ['run'];

export const TYPES = {
	view: {
		what: 'A Generated UI view: declarative JSON (a2ui) or HTML and CSS with an optional script (html), with optional logic',
		check(raw, { mode }) {
			let v;
			try {
				v = checkView(raw);
			} catch (e) {
				if (e instanceof ViewError) return verdict(null, [e.message]);
				throw e;
			}
			if (mode === 'read') return verdict(v);
			const errors = [];
			const notes = [];
			const data = plainJson({ data: v.spec.data, input: v.spec.input }, 'its data');
			if (data) errors.push(data);
			if (v.kind === 'html') {
				const h = viewHtml(v.spec.html, { libs: v.spec.libs });
				errors.push(...h.errors);
				notes.push(...h.notes);
			}
			if (v.spec.logic) {
				const l = logicSource(v.spec.logic, { hooks: VIEW_HOOKS, needs: true });
				errors.push(...l.errors);
				notes.push(...l.notes);
			}
			return verdict(v, errors, notes);
		}
	},
	'view-card': {
		what: "A game's screen (MaiaCity V1): an html view the game hands its state",
		check(raw, { slots, mode }) {
			const r = checkViewCard(raw, slots, { mode });
			if (r.error) return verdict(null, [r.error]);
			return verdict(r.card, [], r.notes ?? []);
		}
	},
	logic: {
		what: 'A logic module, run in QuickJS: exports the hooks it answers',
		check(raw) {
			const code = typeof raw === 'string' ? raw : raw?.code;
			const hooks = Array.isArray(raw?.hooks) ? raw.hooks : [];
			const l = logicSource(code, { hooks, needs: hooks.length > 0, max: raw?.max ?? 20_000 });
			return verdict({ code, ...(hooks.length ? { hooks } : {}) }, l.errors, l.notes);
		}
	},
	function: {
		what: 'An avenDB function, run in QuickJS as an entry moves through a flow: exports run(event)',
		check(raw) {
			const code = typeof raw === 'string' ? raw : raw?.code;
			const l = logicSource(code, { what: 'its code', hooks: FUNCTION_HOOKS, needs: true });
			return verdict({ code }, l.errors, l.notes);
		}
	},
	config: {
		what: "A game's settings: plain JSON in the shape of the repo's seed of them",
		check(raw, { seed }) {
			const plain = plainJson(raw, 'the config', CONFIG_LIMITS);
			if (plain) return verdict(null, [plain]);
			if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return verdict(null, ['a config is a JSON object']);
			if (seed === undefined) return verdict(null, ['a config the repo holds no seed of: no game reads it']);
			const shape = shapeOf(seed, raw);
			return verdict(raw, shape ? [`the config ${shape}`] : []);
		}
	}
};

/** how big a game's settings may be, as JSON */
export const CONFIG_LIMITS = { ...JSON_LIMITS, bytes: 600_000 };

const kindOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'list' : typeof v);

/**
 * Where `value` is not of the shape of `seed`, in a sentence, or '': the same kind of value at every place the seed
 * has one (a number where it has a number, a list where it has a list), every key of the seed's objects there, and each
 * item of a list in the shape of the seed's items: the keys every one of them has, and any other key one of them has of
 * the kind it has there. Keys the seed has not are let be (a game reads none of them).
 */
export function shapeOf(seed, value, path = '') {
	const at = path ? ` at ${path}` : '';
	if (seed === null || seed === undefined) return '';
	if (kindOf(seed) !== kindOf(value)) return `holds a ${kindOf(value)}${at}, where the game reads a ${kindOf(seed)}`;
	if (Array.isArray(seed)) {
		if (!seed.length) return '';
		const objects = seed.every((x) => kindOf(x) === 'object');
		for (let i = 0; i < value.length; i++) {
			const p = objects ? itemShape(seed, value[i], `${path}[${i}]`) : shapeOf(seed[0], value[i], `${path}[${i}]`);
			if (p) return p;
		}
		return '';
	}
	if (typeof seed === 'object') {
		for (const k of Object.keys(seed)) {
			if (!(k in value)) return `has no ${path ? `${path}.` : ''}${k}, which the game reads`;
			const p = shapeOf(seed[k], value[k], path ? `${path}.${k}` : k);
			if (p) return p;
		}
	}
	return '';
}

/** an item of a list whose seed items are objects: the keys all of them have, and the others of the kind one has; and
 * so on down, where they all hold an object at a key */
function itemShape(items, value, path) {
	if (kindOf(value) !== 'object') return `holds a ${kindOf(value)} at ${path}, where the game reads an object`;
	const keys = new Set(items.flatMap((x) => Object.keys(x)));
	for (const k of keys) {
		const has = items.filter((x) => k in x);
		if (!(k in value)) {
			if (has.length === items.length) return `has no ${path}.${k}, which the game reads`;
			continue;
		}
		// what the items hold at k, objects all, is read the same way: the keys every one has, the others as one has them
		const p = has.every((x) => kindOf(x[k]) === 'object')
			? itemShape(has.map((x) => x[k]), value[k], `${path}.${k}`)
			: shapeOf(has[0][k], value[k], `${path}.${k}`);
		if (p) return p;
	}
	return '';
}

/** a type its owner adds: { what, check(raw, ctx) -> verdict } */
export function define(type, def) {
	if (TYPES[type] && TYPES[type] !== def) throw new Error(`the checker already has a type ${type}`);
	if (typeof def?.check !== 'function') throw new Error(`type ${type}: a check(raw, ctx) is needed`);
	TYPES[type] = def;
}

/**
 * `raw` checked as code of `type`: { ok: true, value, notes } or { ok: false, errors }.
 * @param {string} type @param {unknown} raw @param {{ mode?: 'write' | 'read', [k: string]: any }} ctx
 */
export function checkCode(type, raw, ctx = {}) {
	const t = TYPES[type];
	if (!t) return { ok: false, errors: [`no type of code "${String(type).slice(0, 30)}": one of ${Object.keys(TYPES).join(', ')}`] };
	return t.check(raw, { ...ctx, mode: ctx.mode === 'read' ? 'read' : 'write' });
}
