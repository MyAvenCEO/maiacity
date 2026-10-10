// @ts-nocheck — plain JS game state, kept loose on purpose
// Each aven's brain (Samuel's word; the code calls it its mind, since brain.js is the model it asks, d1 or Qwen), its
// own in each world: every world is a standalone capsule (Samuel, 2026-10-09). A new world starts each aven with a copy
// of its latest brain, which then changes only there; an old world opened again brings back the brains it had. Who it is, what it wants, what it tried and how that went, what
// it learned and how it died. It is the aven's own, never a MIP's: the config sets only where a new brain starts.
//
// The pattern, kept as small as it goes (a few hundred tokens in every ask):
// - A character of a few dials, 0-10, and its wants (days of water and of food it keeps in stock). Every ask carries
//   them, and each question reads the dials that matter to it, so d1, which can only pick among options, acts on them
//   as well as Qwen.
// - Trials, as in Karpathy's autoresearch: change one thing, run it for a fixed budget (TRIAL_DAYS), measure one number
//   (the score: HEARTS gained a day, less a heavy price for every unit of water gone short and a lighter one for food),
//   keep the change only if it beat the last stretch on the old setting by a margin, else go back. The game's number
//   decides, never the brain's opinion of itself (agents grading themselves inflate their memories, 2026 research).
//   Every trial leaves one compact line in the aven's log, and a change that just failed is not offered again for a while.
// - Lessons, as in Agentic Context Engineering (ACE): a short playbook of the aven's own lines, each with a count of
//   the stretches that bore it out and went against it, grown by small edits (one new lesson at a time, weighed by the
//   next stretch's score against the last), never rewritten whole; a lesson that lost twice more than it won goes. Only a
//   brain that writes text (Qwen) adds lessons.
// - Every memory is kept, and copied whole into a new world (Samuel, 2026-10-10: all of them, not the last five); what
//   no longer applies is forgotten by hand or by a new world's MIP. Each ask carries only the best of it (PROMPT): the
//   ten lessons that bore out best, the newest trials and deaths.
// - Deaths: when and why it died, and what stood around it, one line each. Dying of thirst also makes it keep more
//   water from then on, without asking: the one instinct the valley gives it.
// The mind lives in the database (api/src/economy.js, econ_brains) per world (its run's id) and aven name: read when it opens,
// written every night, and editable by the admin's agents over the studio's MCP (their edits land on the next night).

import { brainRule, CODE, activity } from './economy.js';
import { RULES } from './rules.js';

/** the valley's own character: what each dial means, at its low and its high end (a world's Brains card may declare
 * its own, see traits()) */
export const DIALS = {
	greed: {
		label: 'Greed',
		low: 'prices low to sell all it grows',
		high: 'asks high and waits for a buyer who pays'
	},
	thrift: {
		label: 'Thrift',
		low: 'pays what it takes to get its needs',
		high: 'pays as little as it can'
	},
	haggle: {
		label: 'Haggling',
		low: 'gives in quickly to strike a deal',
		high: 'hardly gives in'
	}
};
/** its wants: how many days of each need it keeps in stock (and so buys up to) */
export const WANTS = {
	water: { label: 'Water in stock', unit: 'days', min: 1, max: 10 },
	food: { label: 'Food in stock', unit: 'days', min: 1, max: 10 }
};

export const TRIAL_DAYS = 3; // one trial's budget, in game days: a day alone is mostly luck
const MARGIN = 2; // a trial must beat the old setting by this much a day to be kept, so luck alone rarely keeps one
const SHORT = { water: 30, food: 6 }; // what a unit gone short costs the score, in HEARTS: water kills, food waits
const PROMPT = { trials: 6, lessons: 10, deaths: 4 }; // how much of its memory goes into each ask
const TABU = 3; // a change that failed is not offered again for this many trials

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
const hash = (s) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
const kindOf = (g) => (g === 'water' ? 'water' : 'food');
const r1 = (v) => Math.round(v * 10) / 10;

// ---- what a brain is: its traits, declared by the world (Samuel, 2026-10-09: one standard way to show any brain) ----
// The Brains card's `traits` hook says which dials make up an aven's character (each with its range and what its two
// ends mean), which wants it keeps, and what its trials optimise (the score, in a sentence). The page draws a brain
// from this alone, its trials change only these, and its asks read only these, so a world without haggling has no
// haggling dial. A dial the world doesn't declare is kept in the brain as it was (a later world may declare it again).

/** the valley's own traits: greed and thrift, haggling only where avens may give in, and its two stock wants */
function ownTraits() {
	return {
		dials: ['greed', 'thrift', ...(RULES.haggleMax > 0 ? ['haggle'] : [])].map((key) => ({ key, ...DIALS[key], min: 0, max: 10 })),
		wants: Object.entries(WANTS).map(([key, w]) => ({ key, ...w })),
		score: `HEARTS gained a day, less ${SHORT.water} for each unit of water and ${SHORT.food} for each unit of food gone short`
	};
}
const KEY = /^[a-z][a-z0-9_]{0,20}$/;
const words = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : '');
/** one declared trait, checked: { key, label, low, high, unit, min, max } or null */
function trait(t, fallback) {
	if (!t || typeof t !== 'object' || !KEY.test(t.key ?? '')) return null;
	const base = fallback[t.key] ?? {};
	const min = Number.isFinite(t.min) ? Math.round(t.min) : base.min ?? 0;
	const max = Number.isFinite(t.max) ? Math.round(t.max) : base.max ?? 10;
	if (min < 0 || max > 100 || max <= min) return null;
	return { key: t.key, label: words(t.label, 40) || base.label || t.key, low: words(t.low, 120) || base.low || '', high: words(t.high, 120) || base.high || '', unit: words(t.unit, 20) || base.unit || '', min, max };
}
/** a `traits` answer, checked; the valley's own where a part won't do */
function checkTraits(v, own) {
	if (!v || typeof v !== 'object') return own;
	const list = (xs, fallback, n) => {
		if (!Array.isArray(xs)) return null;
		const out = xs.slice(0, n).map((t) => trait(t, fallback)).filter(Boolean);
		return out.length && new Set(out.map((t) => t.key)).size === out.length ? out : null;
	};
	return { dials: list(v.dials, DIALS, 8) ?? own.dials, wants: list(v.wants, WANTS, 6) ?? own.wants, score: words(v.score, 300) || own.score };
}
let known = { code: /** @type {any} */ (undefined), values: '', traits: /** @type {any} */ (null) };
/** the brain's traits in the world playing now: the Brains card's `traits` hook, else the valley's own */
export function traits() {
	const values = JSON.stringify(RULES);
	const code = CODE.run && CODE.seen === CODE.run ? CODE.run : null; // the code the hooks run on now, if any
	if (known.traits && known.code === code && known.values === values) return known.traits;
	const raw = ownTraits();
	const own = checkTraits(raw, raw);
	known = { code, values, traits: brainRule('traits', {}, own, checkTraits) };
	return known.traits;
}
/** what a trial may change: a declared dial or want, one step up or down */
const knobs = () => {
	const t = traits();
	return [...t.dials.map((d) => ['dials', d.key, d.min, d.max]), ...t.wants.map((w) => ['wants', w.key, w.min, w.max])];
};
const dialOf = (key) => traits().dials.find((d) => d.key === key);

/** a new mind: every aven its own character from the start (from its name), its wants around the config's stock
 * target */
export function newMind(name, reserveDays = 3) {
	let h = hash(name);
	const roll = (lo, hi) => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0), lo + (h % (hi - lo + 1)));
	const m = {
		v: 1,
		name,
		runs: 0,
		days: 0,
		deaths: 0,
		dials: Object.fromEntries(Object.keys(DIALS).map((k) => [k, roll(2, 8)])),
		wants: {
			water: clamp(reserveDays + roll(-1, 2), 1, 10),
			food: clamp(reserveDays + roll(-1, 1), 1, 10)
		},
		trial: null, // { kind, key, from, to, run, day }
		base: null, // the score a day of the last stretch on the current setting
		win: null, // the stretch being measured: { day, n, sum, hearts }
		log: [], // one line per trial, newest last
		lessons: [], // { text, up, down }
		lessonId: 0,
		probe: null, // the newest lesson, weighed by the next stretch: { id, against }
		born: null, // its character and wants when it was new, to see how far it has come
		tally: { trials: 0, kept: 0 }, // every trial ever, folded from the log
		deathLog: [], // one line per death, newest last
		tabu: [], // changes that failed lately: 'dials.greed+'
		due: false, // a stretch just ended: the next full ask also picks the next trial (and, on Qwen, a lesson)
		applied: 0 // the newest MCP edit already taken in
	};
	// a dial or want its world declares beyond the valley's own starts somewhere in the middle of its range
	const t = traits();
	const mid = (x) => roll(x.min + Math.round((x.max - x.min) / 5), x.max - Math.round((x.max - x.min) / 5));
	for (const d of t.dials) if (!(d.key in m.dials)) m.dials[d.key] = mid(d);
	for (const w of t.wants) if (!(w.key in m.wants)) m.wants[w.key] = mid(w);
	return m;
}
const birth = (m) => (m.born ??= { dials: { ...m.dials }, wants: { ...m.wants } });

/** a mind as stored, made whole (an older or hand-edited one may lack parts) */
export function wholeMind(m, name, reserveDays) {
	const fresh = newMind(name, reserveDays);
	if (!m || typeof m !== 'object') return fresh;
	const out = { ...fresh, ...m, name };
	// every dial and want it has (a world that doesn't declare one leaves it be), within the range declared now
	const t = traits();
	const whole = (kind, list, base) =>
		Object.fromEntries(
			[...new Set([...Object.keys(fresh[kind]), ...Object.keys(m[kind] && typeof m[kind] === 'object' ? m[kind] : {})])]
				.filter((k) => KEY.test(k))
				.map((k) => {
					const r = list.find((x) => x.key === k) ?? base[k] ?? { min: 0, max: 10 };
					const v = Number(m[kind]?.[k] ?? fresh[kind][k]);
					return [k, clamp(Number.isFinite(v) ? v : fresh[kind][k] ?? r.min, r.min, r.max)];
				})
		);
	out.dials = whole('dials', t.dials, Object.fromEntries(Object.keys(DIALS).map((k) => [k, { min: 0, max: 10 }])));
	out.wants = whole('wants', t.wants, WANTS);
	for (const k of ['log', 'lessons', 'deathLog', 'tabu']) out[k] = Array.isArray(m[k]) ? m[k].slice() : [];
	out.tally = {
		trials: Number(m.tally?.trials) || 0,
		kept: Number(m.tally?.kept) || 0
	};
	delete out.updated;
	return out;
}

/** a run begins: a trial the last run left unfinished is undone, and the measuring starts over */
export function beginRun(m, world = 'a world', { resume = false } = {}) {
	if (m.trial) {
		m[m.trial.kind][m.trial.key] = m.trial.from;
		note(m, `d${m.trial.day} ${label(m.trial)}: left before it was measured, undone`);
	}
	if (!resume) m.runs += 1; // worlds played
	m.world = world;
	birth(m);
	Object.assign(m, {
		trial: null,
		base: null,
		win: null,
		due: false,
		probe: null,
		gone: false
	});
	return m;
}

/** the aven acts on its mind: its wants are what it buys up to */
export function wear(a, m) {
	a.mind = m;
	a.keep = m.wants;
}

const label = (t) => `${t.kind === 'wants' ? `${t.key} stock` : t.key} ${t.from}→${t.to}`;
function note(m, line) {
	m.log.push(line);
}

/** one day's score for a trial: HEARTS gained, less what going short cost (the Brains card's `score` hook) */
function dayScore(a, gained, short) {
	const own = gained - Object.entries(short).reduce((n, [g, q]) => n + q * SHORT[kindOf(g)], 0);
	return brainRule('score', { aven: a, gained, short }, own, (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1e9, Math.min(1e9, v)) : own));
}

/**
 * night: each aven's mind takes in its day. The day's score goes on the stretch; when a stretch is full it is judged:
 * a trial is kept or undone by the number, a plain stretch becomes the measure for the next trial. A death closes it
 * all with a line. Call after the night (economy.js step said a day ended).
 */
export function night(world) {
	for (const a of world.avens) {
		const m = a.mind;
		if (!m) continue;
		if (m.gone) {
			if (!a.alive) continue;
			// a new life in the same world, its brain as it was. Nothing in its memory says so, nor with how much (Samuel,
			// 2026-10-10: a brain must not count on coming back): to its brain, death is the end of everything it holds
			m.gone = false;
			Object.assign(m, { win: null, base: null });
		}
		const short = a.yesterday?.short ?? {};
		if (!a.alive) {
			m.gone = true;
			m.deaths += 1;
			m.days += 1;
			const cause = a.lost?.cause ?? (a.body.water <= 0 ? 'thirst' : 'hunger');
			const w = world.market.water;
			const cheapest = w.sells[0]?.price;
			const bits = [
				world.weather.dry || (world.weather.dryFrom && world.weather.dryFrom > world.day - 4) ? 'dry spell' : '',
				// what water cost it, in the words of its world's market: the posted price and how much of its need its
				// HEARTS paid for, else its bid against the cheapest ask
				!a.grows.includes('water') && w.posted != null
					? `WATER at ${w.posted} HEARTS a unit: my ${Math.round(a.lost?.hearts ?? a.hearts)} HEARTS paid for ${Math.floor((a.lost?.hearts ?? a.hearts) / w.posted)} of my ${a.need?.water ?? '?'} a day`
					: !a.grows.includes('water') && a.bid.water != null
						? `my water bid ${a.bid.water}${cheapest != null ? ` vs cheapest ask ${cheapest}` : ''}`
						: '',
				`lost ${Math.round(a.lost?.hearts ?? a.hearts)} HEARTS`,
				`kept ${m.wants.water}d water, ${m.wants.food}d food`
			].filter(Boolean);
			m.deathLog.push(`d${a.diedOn} died of ${cause}: ${bits.join(', ')}`);
			if (m.trial) {
				m[m.trial.kind][m.trial.key] = m.trial.from;
				note(m, `d${a.diedOn} ${label(m.trial)}: died during it, undone`);
				m.tabu.push(`${m.trial.kind}.${m.trial.key}${m.trial.to > m.trial.from ? '+' : '-'}`);
				m.trial = null;
			}
			// the instinct: thirst teaches it to keep more water
			const thirst = traits().wants.find((x) => x.key === 'water');
			if (cause === 'thirst' && thirst && m.wants.water < thirst.max) {
				const was = m.wants.water;
				m.wants.water = Math.min(thirst.max, was + 2);
				note(m, `d${a.diedOn} after dying of thirst: water stock ${was}→${m.wants.water}`);
			}
			continue;
		}
		m.days += 1;
		const w = (m.win ??= {
			day: world.day - 1,
			n: 0,
			sum: 0,
			hearts: a.hearts
		});
		w.sum += dayScore(a, a.hearts - w.hearts, short);
		w.hearts = a.hearts;
		w.n += 1;
		if (w.n < TRIAL_DAYS) continue;
		const score = r1(w.sum / w.n);
		m.win = { day: world.day, n: 0, sum: 0, hearts: a.hearts };
		// the newest lesson is weighed by this stretch against the one before it was learned
		if (m.probe) {
			const l = m.lessons.find((x) => x.id === m.probe.id);
			if (l) {
				if (score >= m.probe.against) l.up += 1;
				else l.down += 1;
				if (l.down - l.up >= 2) m.lessons.splice(m.lessons.indexOf(l), 1);
			}
			m.probe = null;
		}
		const t = m.trial;
		if (t) {
			const kept = m.base == null || score > m.base + MARGIN;
			m.tally.trials += 1;
			if (kept) m.tally.kept += 1;
			if (!kept) {
				m[t.kind][t.key] = t.from;
				m.tabu.push(`${t.kind}.${t.key}${t.to > t.from ? '+' : '-'}`);
			}
			note(
				m,
				`d${t.day}-${world.day - 1} ${label(t)}: ${score}/day vs ${m.base ?? '?'}, ${kept ? 'kept' : 'undone'}`
			);
			activity(world, { kind: 'trial', changes: [`${kept ? 'kept' : 'undid'} ${label(t)}: it scored ${score}/day against ${m.base ?? '?'}`] }, a);
			if (kept)
				m.base = score; // the new setting's own stretch is the measure now
			else m.base = null; // the old setting gets a fresh stretch before the next trial
			m.trial = null;
			m.tabu = m.tabu.slice(-TABU);
			m.lastScore = score;
			m.due = true;
		} else {
			m.base = score;
			m.lastScore = score;
			m.due = true;
		}
	}
}

/** what the aven's brain may try next: every one-step change not failed lately, and "nothing" */
export function trialOptions(m) {
	const opts = {
		none: 'Change nothing for now: just measure my current setting again'
	};
	for (const [kind, key, lo, hi] of knobs()) {
		const v = m[kind][key];
		for (const d of [1, -1]) {
			const to = v + d;
			if (to < lo || to > hi || m.tabu.includes(`${kind}.${key}${d > 0 ? '+' : '-'}`)) continue;
			const what =
				kind === 'wants'
					? `keep ${to} days of ${key} in stock (now ${v})`
					: `${dialOf(key).label.toLowerCase()} ${to} of ${hi} (now ${v}${dialOf(key).high ? `; high: ${dialOf(key).high}` : ''})`;
			opts[`${kind}.${key}${d > 0 ? '+' : '-'}`] = `${d > 0 ? 'Raise' : 'Lower'}: ${what}`;
		}
	}
	return opts;
}

/** the next trial begins (an answer to the trial question), or none: either way the next stretch is measured */
export function startTrial(m, pick, world) {
	m.due = false;
	if (!pick || pick === 'none' || m.base == null) return null;
	const [kind, rest] = pick.split('.');
	const key = rest.slice(0, -1);
	const up = rest.endsWith('+');
	const knob = knobs().find((k) => k[0] === kind && k[1] === key);
	if (!knob) return null;
	const from = m[kind][key] ?? knob[2];
	const to = clamp(from + (up ? 1 : -1), knob[2], knob[3]);
	if (to === from) return null;
	m[kind][key] = to;
	m.trial = { kind, key, from, to, run: m.runs, world: m.world, day: world.day };
	return m.trial;
}

/** a lesson written by the aven's brain (Qwen): added unless it says what one already says; the weakest goes when
 * there are too many */
export function addLesson(m, text) {
	const t = String(text ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 110);
	if (t.length < 8 || /^none\b/i.test(t)) return false;
	const key = (s) =>
		s
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, ' ')
			.trim()
			.slice(0, 40);
	if (m.lessons.some((l) => key(l.text) === key(t))) return false;
	m.lessons.push({ id: ++m.lessonId, text: t, up: 0, down: 0, world: m.world });
	return true;
}
/** every memory a brain keeps, as one interface (Samuel, 2026-10-10): each list, what an entry says, the world it came
 * from where it knows, and how an entry is named to forget it (a lesson by its id, any other line by its words). The
 * Avens view lists them all this way, and a new world's MIP says which of the copied ones its brains forget */
export const MEMORY = [
	{ key: 'lessons', label: 'Lessons', ref: (l) => l.id, text: (l) => `#${l.id} ${l.text} (+${l.up} −${l.down})`, world: (l) => l.world ?? null },
	{ key: 'log', label: 'Trials', ref: (s) => s, text: (s) => s, world: () => null },
	{ key: 'deathLog', label: 'Deaths', ref: (s) => s, text: (s) => s, world: () => null },
	{ key: 'tabu', label: 'Not to try again soon', ref: (s) => s, text: (s) => s, world: () => null }
];
/** a brain's memories, list by list (only the lists that hold something), each entry { ref, text, world } */
export function memoryOf(m) {
	return MEMORY.map((k) => ({ key: k.key, label: k.label, entries: (Array.isArray(m?.[k.key]) ? m[k.key] : []).map((e) => ({ ref: k.ref(e), text: k.text(e), world: k.world(e) })) })).filter((l) => l.entries.length);
}
/** forget one entry of one memory list; true if it was there */
export function forgetMemory(m, list, ref) {
	const k = MEMORY.find((x) => x.key === list);
	if (!k || !Array.isArray(m?.[list])) return false;
	const i = m[list].findIndex((e) => String(k.ref(e)) === String(ref));
	if (i < 0) return false;
	m[list].splice(i, 1);
	return true;
}

/** what a brain is never told: that the dead come back, and with how much */
const HIDDEN = ['rebirthDays', 'startHearts'];
const hidden = (text) => /\breborn\b|\brebirth\b|\bcome back\b|\bnext life\b/i.test(text);

/** what a world is set to, as a brain remembers it: every value of the catalogue, and its cards by name */
export function worldStamp(rules, cards) {
	return {
		values: Object.fromEntries(Object.entries(rules).filter(([, v]) => typeof v === 'number')),
		cards: (cards ?? []).map((c) => c.name || c.id)
	};
}

/** a brain copied into a new world (Samuel): it is told what is set differently from the world it came from, since a
 * lesson from there may not hold here. `params` is the catalogue (labels and units) */
export function enterWorld(m, stamp, params) {
	const was = m.stamp;
	m.stamp = stamp;
	if (!was?.values) return (m.changed = null);
	const out = [];
	for (const p of params) {
		if (HIDDEN.includes(p.key)) continue;
		const a = was.values[p.key],
			b = stamp.values[p.key];
		if (a !== undefined && b !== undefined && a !== b) out.push(`${p.label} ${a}→${b}${p.unit && !/=|at least|yes/.test(p.unit) ? ` ${p.unit}` : ''}`);
	}
	for (const c of stamp.cards) if (!was.cards?.includes(c)) out.push(`new card ${c}`);
	for (const c of was.cards ?? []) if (!stamp.cards.includes(c)) out.push(`card ${c} gone`);
	m.changed = out.length ? out.slice(0, 12) : ['nothing: the same settings as my last world'];
	note(m, `${m.world} → a new world: ${out.length ? out.slice(0, 5).join(', ') : 'same settings'}`);
	return m.changed;
}

/** the mind as its brain reads it in every ask: compact, a few hundred tokens */
export function mindFor(a) {
	const m = a.mind;
	if (!m) return undefined;
	const t = traits();
	return {
		character: Object.fromEntries(t.dials.map((d) => [d.key, `${m.dials[d.key]} of ${d.max}`])),
		character_means: Object.fromEntries(t.dials.map((d) => [d.key, `${d.min} ${d.low}, ${d.max} ${d.high}`])),
		wants: `I keep ${t.wants.map((w) => `${m.wants[w.key]} ${w.unit} of ${w.key}`).join(' and ')} in stock and buy up to that`,
		// its memory is its line's: the lives before this one, which ended in death; nothing says it comes back
		life: `now in ${m.world}, my line's world number ${m.runs}; ${m.days} days lived by my line; ${m.deaths} earlier li${m.deaths === 1 ? 'fe' : 'ves'} of my line ended in death; ${m.tally.trials} trials, ${m.tally.kept} kept`,
		since_birth: m.born ? drift(m) : 'as born',
		...(m.changed ? { this_world_vs_my_last: m.changed } : {}),
		trying_now: m.trial
			? `${label(m.trial)} since day ${m.trial.day}: kept only if my score beats ${m.base}/day`
			: 'nothing: measuring my current setting',
		score_means: t.score,
		trials: m.log.slice(-PROMPT.trials).filter((l) => !hidden(l)),
		lessons: best(m.lessons.filter((l) => !hidden(l.text))).map((l) => `#${l.id} ${l.text} (+${l.up} −${l.down}${l.world ? `, learned in ${l.world}` : ''})`),
		deaths_in_my_line: m.deathLog.slice(-PROMPT.deaths)
	};
}

/** its best lessons for an ask: the PROMPT.lessons that bore out best (up − down, the newer first on a tie), in the
 * order it learned them */
function best(list) {
	if (list.length <= PROMPT.lessons) return list;
	const top = new Set(list.slice().sort((x, y) => y.up - y.down - (x.up - x.down) || y.id - x.id).slice(0, PROMPT.lessons));
	return list.filter((l) => top.has(l));
}

/** how far its character and wants have moved since it was new */
function drift(m) {
	const moved = [
		...traits().dials.map((d) => [d.key, m.born.dials[d.key], m.dials[d.key]]),
		...traits().wants.map((w) => [`${w.key} stock`, m.born.wants[w.key], m.wants[w.key]])
	].filter(([, a, b]) => a != null && a !== b);
	return moved.length ? moved.map(([k, a, b]) => `${k} ${a}→${b}`).join(', ') : 'as born';
}

/** a question's line on the character it should act in */
export function inCharacter(a, ...keys) {
	const m = a.mind;
	const on = keys.map(dialOf).filter(Boolean); // a dial its world doesn't declare plays no part
	if (!m || !on.length) return '';
	return ` Act in character: ${on.map((d) => `${d.label.toLowerCase()} ${m.dials[d.key]} of ${d.max}`).join(', ')} (see my_brain).`;
}

/** the night's extra questions, on the first full ask after a stretch ended: the next trial, and on a brain that
 * writes, one lesson and one vote */
export function mindQuestions(a, { writes = false } = {}) {
	const m = a.mind;
	if (!m?.due || m.gone) return {};
	const q = {};
	if (m.base != null)
		q.next_trial = {
			type: 'choice',
			instructions: `Your last ${TRIAL_DAYS} days scored ${m.lastScore}/day (see my_brain: trials, lessons, deaths). Pick ONE change to try for the next ${TRIAL_DAYS} days. It is kept only if your score then beats ${m.base + MARGIN}/day, else it is undone. Try what your trials, lessons and deaths suggest; don't repeat what just failed.`,
			criteria: trialOptions(m)
		};
	if (writes) {
		q.lesson = {
			type: 'text',
			instructions: `From your trials, deaths and these last days, write ONE short new lesson for yourself (at most 100 characters, a concrete rule like "Buy water before dry spells"), or "none" if you learned nothing new.`
		};
	}
	return q;
}

/** take in the answers to the night's questions; the lines it adds to the decision feed */
export function applyMind(world, a, answers) {
	const m = a.mind;
	if (!m) return [];
	const said = [];
	// only the first answer to the night's questions counts: another ask sent meanwhile carried them too
	if (m.due && ('next_trial' in answers || 'lesson' in answers)) {
		const t = startTrial(m, answers.next_trial?.choice, world);
		if (t) said.push(`tries ${label(t)}`);
		if (answers.lesson?.text && addLesson(m, answers.lesson.text)) {
			said.push(`learned: ${m.lessons.at(-1).text}`);
			m.probe = { id: m.lessons.at(-1).id, against: m.lastScore ?? 0 };
		}
		m.due = false;
	}
	return said;
}

/** an edit from outside (the admin's agents over MCP, through the API): dials, wants, a lesson to add or drop */
export function editMind(m, e) {
	const said = [];
	const t = traits();
	for (const [k, v] of Object.entries(e?.dials ?? {}))
		if (t.dials.some((d) => d.key === k) && Number.isFinite(Number(v))) {
			const d = dialOf(k);
			const to = clamp(Number(v), d.min, d.max);
			if (to !== m.dials[k]) (said.push(`${k} ${m.dials[k]}→${to}`), (m.dials[k] = to));
		}
	for (const [k, v] of Object.entries(e?.wants ?? {}))
		if (t.wants.some((w) => w.key === k) && Number.isFinite(Number(v))) {
			const w = t.wants.find((x) => x.key === k);
			const to = clamp(Number(v), w.min, w.max);
			if (to !== m.wants[k]) (said.push(`${k} stock ${m.wants[k]}→${to}`), (m.wants[k] = to));
		}
	if (e?.lesson && addLesson(m, e.lesson)) said.push(`lesson: ${m.lessons.at(-1).text}`);
	for (const f of Array.isArray(e?.forget) ? e.forget : []) if (forgetMemory(m, f?.list, f?.ref)) said.push(f.list === 'lessons' ? `forgot #${f.ref}` : `forgot "${String(f.ref).slice(0, 40)}"`);
	if (e?.forget_lesson != null) {
		const i = m.lessons.findIndex((l) => l.id === Number(e.forget_lesson));
		if (i >= 0) (said.push(`forgot #${m.lessons[i].id}`), m.lessons.splice(i, 1));
	}
	if (said.length) {
		// a setting changed from outside: the trial running is called off (the edit wins), and the new setting is measured
		// afresh before the next one
		birth(m);
		Object.assign(m, { trial: null, base: null, win: null });
		note(
			m,
			`set by ${e.by ?? 'the admin'}: ${said.join(', ')}${e.note ? ` (${String(e.note).slice(0, 80)})` : ''}`
		);
	}
	return said;
}

/** the mind as stored: what lasts, without the run's own bookkeeping */
export function keepMind(m) {
	const { gone, win, ...rest } = m;
	return rest;
}
