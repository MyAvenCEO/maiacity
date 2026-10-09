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
//   Every trial leaves one compact line in the aven's log, a change that just failed is not offered again for a while,
//   and a run's start folds the older lines into one tally, so the log never grows.
// - Lessons, as in Agentic Context Engineering (ACE): a short playbook of the aven's own lines, each with a count of
//   the stretches that bore it out and went against it, grown by small edits (one new lesson at a time, weighed by the
//   next stretch's score against the last), never rewritten whole, so it neither bloats nor collapses; a lesson that
//   lost twice more than it won goes. Only a brain that writes text (Qwen) adds lessons.
// - Deaths: when and why it died, and what stood around it, one line each. Dying of thirst also makes it keep more
//   water from then on, without asking: the one instinct the valley gives it.
// The mind lives in the database (api/src/economy.js, econ_brains) per world (its run's id) and aven name: read when it opens,
// written every night, and editable by the admin's agents over the studio's MCP (their edits land on the next night).

/** the character: what each dial means, at its low and its high end */
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
/** what a trial may change: a dial or a want, one step up or down */
const KNOBS = [
	...Object.keys(DIALS).map((k) => ['dials', k, 0, 10]),
	...Object.entries(WANTS).map(([k, w]) => ['wants', k, w.min, w.max])
];

export const TRIAL_DAYS = 3; // one trial's budget, in game days: a day alone is mostly luck
const MARGIN = 2; // a trial must beat the old setting by this much a day to be kept, so luck alone rarely keeps one
const SHORT = { water: 30, food: 6 }; // what a unit gone short costs the score, in HEARTS: water kills, food waits
const KEEP = { log: 8, lessons: 5, deaths: 4 };
const TABU = 3; // a change that failed is not offered again for this many trials

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
const hash = (s) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
const kindOf = (g) => (g === 'water' ? 'water' : 'food');
const r1 = (v) => Math.round(v * 10) / 10;

/** a new mind: every aven its own character from the start (from its name), its wants around the config's stock
 * target */
export function newMind(name, reserveDays = 3) {
	let h = hash(name);
	const roll = (lo, hi) => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0), lo + (h % (hi - lo + 1)));
	return {
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
}
const birth = (m) => (m.born ??= { dials: { ...m.dials }, wants: { ...m.wants } });

/** a mind as stored, made whole (an older or hand-edited one may lack parts) */
export function wholeMind(m, name, reserveDays) {
	const fresh = newMind(name, reserveDays);
	if (!m || typeof m !== 'object') return fresh;
	const out = { ...fresh, ...m, name };
	out.dials = Object.fromEntries(
		Object.keys(DIALS).map((k) => [k, clamp(Number(m.dials?.[k] ?? fresh.dials[k]), 0, 10)])
	);
	out.wants = Object.fromEntries(
		Object.entries(WANTS).map(([k, w]) => [k, clamp(Number(m.wants?.[k] ?? fresh.wants[k]), w.min, w.max)])
	);
	for (const k of ['log', 'lessons', 'deathLog', 'tabu']) out[k] = Array.isArray(m[k]) ? m[k].slice(-50) : [];
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
	// sleep on it: the older trial lines fold into the tally, the newest few stay as they are
	if (m.log.length > KEEP.log / 2) m.log.splice(0, m.log.length - KEEP.log / 2);
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
	if (m.log.length > KEEP.log) m.log.splice(0, m.log.length - KEEP.log);
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
			// reborn: a fresh life in the same world, its brain as it was
			m.gone = false;
			Object.assign(m, { win: null, base: null });
			note(m, `d${world.day} reborn with ${Math.round(a.hearts)} HEARTS`);
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
				!a.grows.includes('water') && a.bid.water != null
					? `my water bid ${a.bid.water}${cheapest != null ? ` vs cheapest ask ${cheapest}` : ''}`
					: '',
				`lost ${Math.round(a.lost?.hearts ?? a.hearts)} HEARTS`,
				`kept ${m.wants.water}d water, ${m.wants.food}d food`
			].filter(Boolean);
			m.deathLog.push(`d${a.diedOn} died of ${cause}: ${bits.join(', ')}`);
			if (m.deathLog.length > KEEP.deaths) m.deathLog.splice(0, m.deathLog.length - KEEP.deaths);
			if (m.trial) {
				m[m.trial.kind][m.trial.key] = m.trial.from;
				note(m, `d${a.diedOn} ${label(m.trial)}: died during it, undone`);
				m.tabu.push(`${m.trial.kind}.${m.trial.key}${m.trial.to > m.trial.from ? '+' : '-'}`);
				m.trial = null;
			}
			// the instinct: thirst teaches it to keep more water
			if (cause === 'thirst' && m.wants.water < WANTS.water.max) {
				const was = m.wants.water;
				m.wants.water = Math.min(WANTS.water.max, was + 2);
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
		const lost = Object.entries(short).reduce((n, [g, q]) => n + q * SHORT[kindOf(g)], 0);
		w.sum += a.hearts - w.hearts - lost;
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
	for (const [kind, key, lo, hi] of KNOBS) {
		const v = m[kind][key];
		for (const d of [1, -1]) {
			const to = v + d;
			if (to < lo || to > hi || m.tabu.includes(`${kind}.${key}${d > 0 ? '+' : '-'}`)) continue;
			const what =
				kind === 'wants'
					? `keep ${to} days of ${key} in stock (now ${v})`
					: `${DIALS[key].label.toLowerCase()} ${to}/10 (now ${v}; high: ${DIALS[key].high})`;
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
	const knob = KNOBS.find((k) => k[0] === kind && k[1] === key);
	if (!knob) return null;
	const from = m[kind][key];
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
	if (m.lessons.length > KEEP.lessons) {
		const worst = m.lessons.reduce((w, l) => (l.up - l.down < w.up - w.down ? l : w), m.lessons[0]);
		m.lessons.splice(m.lessons.indexOf(worst), 1);
	}
	return true;
}
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
	return {
		character: Object.fromEntries(Object.entries(m.dials).map(([k, v]) => [k, `${v}/10`])),
		character_means: Object.fromEntries(Object.entries(DIALS).map(([k, d]) => [k, `0 ${d.low}, 10 ${d.high}`])),
		wants: `I keep ${m.wants.water} days of water and ${m.wants.food} days of food in stock and buy up to that`,
		life: `now in ${m.world}, my world number ${m.runs}; ${m.days} days lived over all my worlds; died ${m.deaths} time${m.deaths === 1 ? '' : 's'}; ${m.tally.trials} trials, ${m.tally.kept} kept`,
		since_birth: m.born ? drift(m) : 'as born',
		...(m.changed ? { this_world_vs_my_last: m.changed } : {}),
		trying_now: m.trial
			? `${label(m.trial)} since day ${m.trial.day}: kept only if my score beats ${m.base}/day`
			: 'nothing: measuring my current setting',
		score_means: `HEARTS gained a day, less ${SHORT.water} for each unit of water and ${SHORT.food} for each unit of food I go short`,
		trials: m.log.slice(-6),
		lessons: m.lessons.map((l) => `#${l.id} ${l.text} (+${l.up} −${l.down}${l.world ? `, learned in ${l.world}` : ''})`),
		deaths: m.deathLog.slice()
	};
}

/** how far its character and wants have moved since it was new */
function drift(m) {
	const moved = [
		...Object.keys(DIALS).map((k) => [k, m.born.dials[k], m.dials[k]]),
		...Object.keys(WANTS).map((k) => [`${k} stock`, m.born.wants[k], m.wants[k]])
	].filter(([, a, b]) => a !== b);
	return moved.length ? moved.map(([k, a, b]) => `${k} ${a}→${b}`).join(', ') : 'as born';
}

/** a question's line on the character it should act in */
export function inCharacter(a, ...keys) {
	const m = a.mind;
	if (!m) return '';
	return ` Act in character: ${keys.map((k) => `${DIALS[k].label.toLowerCase()} ${m.dials[k]}/10`).join(', ')} (see my_brain).`;
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
	for (const [k, v] of Object.entries(e?.dials ?? {}))
		if (k in DIALS && Number.isFinite(Number(v))) {
			const to = clamp(Number(v), 0, 10);
			if (to !== m.dials[k]) (said.push(`${k} ${m.dials[k]}→${to}`), (m.dials[k] = to));
		}
	for (const [k, v] of Object.entries(e?.wants ?? {}))
		if (k in WANTS && Number.isFinite(Number(v))) {
			const to = clamp(Number(v), WANTS[k].min, WANTS[k].max);
			if (to !== m.wants[k]) (said.push(`${k} stock ${m.wants[k]}→${to}`), (m.wants[k] = to));
		}
	if (e?.lesson && addLesson(m, e.lesson)) said.push(`lesson: ${m.lessons.at(-1).text}`);
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
