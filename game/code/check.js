// @ts-nocheck — plain JS, kept loose on purpose
/**
 * THE ONE CHECKER — every kind of code we keep, checked one way before it is kept, wherever it comes in: the API (an
 * agent over the MCP, a MIP, a world's cards), the pages, and later avenDB proposals. One verdict for all of them:
 *
 *   checkCode(type, raw, { mode }) -> { ok: true, value, notes } | { ok: false, errors }
 *
 * `value` is the clean code entry as it is kept; `errors` say in sentences why it is refused; `notes` what is kept but
 * will do nothing (a library never imported, a fetch with no network). mode 'write' (the default) holds new code to
 * every rule (./rules.js); mode 'read' is for code already kept, which a page draws whatever its rules say now: only its
 * shape is checked, since what the rules refuse the engines drop anyway (safety never rests on this checker).
 *
 * The types (each type's owner may add one with `define`, as the asset schemas do for asset cards, $lib/code/check.js):
 *   view       a Generated UI view: { id, title, note?, kind: a2ui | html, spec }      (game/genui/views.js)
 *   view-card  a game's screen: { id, kind: 'view', name, data: { slot, libs, height }, code }, with `slots`
 *   rule-card  a Sandbox 7 config card, its code a logic module of HOOKS                 (game/economy/params.js)
 *   logic      a bare logic module: { code, hooks?, max? }
 */
import { ViewError, check as checkView, checkViewCard } from '../genui/views.js';
import { HOOK_NAMES, checkCard as checkRuleCard } from '../economy/params.js';
import { logicSource, plainJson, viewHtml } from './rules.js';

const verdict = (value, errors = [], notes = []) => (errors.length ? { ok: false, errors: errors.slice(0, 12) } : { ok: true, value, notes: notes.slice(0, 12) });

/** the hooks a view's logic answers (src/lib/genui/logic.js) */
export const VIEW_HOOKS = ['init', 'on'];

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
		what: "A game's screen (Sandbox 7, MaiaCity V1): an html view the game hands its state",
		check(raw, { slots, mode }) {
			const r = checkViewCard(raw, slots, { mode });
			if (r.error) return verdict(null, [r.error]);
			return verdict(r.card, [], r.notes ?? []);
		}
	},
	'rule-card': {
		what: "A Sandbox 7 config card: values, data and code (a logic module of the valley's hooks)",
		check(raw, { mode }) {
			const r = checkRuleCard(raw, { mode });
			if (r.error) return verdict(null, [r.error]);
			if (mode === 'read' || r.card.kind === 'view') return verdict(r.card, [], r.notes ?? []);
			const errors = [];
			const data = r.card.data === undefined ? '' : plainJson(r.card.data, `card ${r.card.id}'s data`);
			if (data) errors.push(data);
			const l = r.card.code.trim() ? logicSource(r.card.code, { what: `card ${r.card.id}'s code`, hooks: HOOK_NAMES }) : { errors: [], notes: [] };
			return verdict(r.card, [...errors, ...l.errors], l.notes);
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
	}
};

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
