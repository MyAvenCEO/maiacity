// @ts-nocheck — plain JS, kept loose on purpose
// Card code in a sandbox. A config card may carry JavaScript (its `code`), proposed by anyone, an agent over the MCP
// too, so it never runs as the page's own: each card gets its own QuickJS engine from the logic core
// ($lib/sandbox/logic.js) with no page, no network, no keys and no clock to wait on, 8 MB of memory, a share of work a
// call, and the core's deterministic profile (Math.random seeded by the run, the clock frozen at its start).
// The code exports hooks (game/economy/params.js, HOOKS): every rule of the valley is one (Samuel, 2026-10-09: the
// whole rulebook is card code, each section card's own or its default, game/economy/rules-code.js). The valley calls
// each one at its moment with a copy of what it needs and takes back plain JSON. A card whose code throws, runs too
// long, eats its memory or answers nothing is stopped for the run and the valley goes on with its own value. Every load
// gets a fresh engine, dropped with the run, so whatever a card took is given back. The valley calls its hooks as it
// goes, so for now the engines run beside it on the page's thread; the valley moves into the logic host's worker whole
// next (code-architecture plan, C6).

import { HOOK_NAMES, HOOKS, fullCards } from '../../../game/economy/params.js';
import { LIMITS, open, quickjs } from '../sandbox/logic.js';

export { LIMITS };

/** one card's code, loaded into its own engine: the hooks it exports, and how to call them */
function load(QJS, card, profile) {
	const unit = { id: card.id, name: card.name || card.id, hooks: [], error: '', calls: 0, ms: 0 };
	const engine = open(QJS, { code: card.code, file: `${card.id}.js`, ...profile });
	unit.error = engine.error;
	unit.hooks = HOOK_NAMES.filter((h) => engine.exports.includes(h));
	unit.see = (json) => engine.call('see', null, json);
	unit.call = (name, json) => {
		const t = performance.now();
		let v;
		try {
			v = engine.call('hook', name, json);
		} catch (e) {
			throw new Error(`${name}: ${e.message || String(e)}`);
		}
		unit.calls += 1;
		unit.ms += performance.now() - t;
		if (typeof v !== 'string') throw new Error(`${name} answered nothing`);
		return JSON.parse(v);
	};
	unit.dispose = engine.dispose;
	return unit;
}

/**
 * Load the code of every card, every section card with its rules' code (its own, else the default), in the config's
 * order. The valley then calls `see(valley)` once a night and `run(hook, args, value)` at each hook's moment: the card
 * that owns the rule first, then every other card exporting that hook, each given what the one before made of it.
 * `seed` and `now` make the run's cards decide the same on every device.
 * @param {object[]} cards @param {{ seed?: number, now?: number }} [profile]
 */
export async function loadCode(cards, { seed = 0, now = 0 } = {}) {
	// a view card's code is a screen (HTML), run in its own frame by the page, never here
	const coded = fullCards(cards).filter((c) => c?.kind !== 'view' && typeof c?.code === 'string' && c.code.trim());
	if (!coded.length) return null;
	const QJS = await quickjs();
	const units = coded.map((c) => load(QJS, c, { seed, now }));
	const owner = Object.fromEntries(HOOKS.map((h) => [h.name, h.card]));
	const live = (name) => units.filter((u) => !u.error && u.hooks.includes(name)).sort((a, b) => (b.id === owner[name]) - (a.id === owner[name]));
	const fail = (u, e) => {
		u.error = e.message || String(e);
		u.failedAt = Date.now();
	};
	return {
		units,
		/** does any card (still) run this hook? */
		has: (name) => live(name).length > 0,
		/** tonight's valley, the same for every hook until the next */
		see(valley) {
			if (!units.some((u) => !u.error && u.hooks.length)) return;
			const json = JSON.stringify(valley);
			for (const u of units)
				if (!u.error && u.hooks.length)
					try {
						u.see(json);
					} catch (e) {
						fail(u, new Error(`reading the valley: ${e.message || String(e)}`));
					}
		},
		run(name, args, value) {
			for (const u of live(name))
				try {
					const v = u.call(name, JSON.stringify({ ...args, value }));
					if (v !== undefined) value = v;
				} catch (e) {
					fail(u, e);
				}
			return value;
		},
		/** what runs and what failed, for the page and the saved run */
		info: () => ({
			hooks: units.filter((u) => !u.error && u.hooks.length).map((u) => ({ card: u.id, name: u.name, hooks: [...u.hooks], calls: u.calls, ms: Math.round((u.ms / Math.max(1, u.calls)) * 1000) / 1000 })),
			errors: units.filter((u) => u.error).map((u) => ({ card: u.id, name: u.name, error: u.error }))
		}),
		dispose: () => units.forEach((u) => u.dispose())
	};
}
