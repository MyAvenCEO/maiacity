// Sandbox 7: a posted-price world (a Trading card with a `price` hook) played for N days with a stand-in brain that
// always picks the middle answer of each question, so the market alone has to find the prices. Prints each good's
// posted price, what traded and who is alive, day by day. Run: node scripts/sandbox-8-posted.mjs <cards.json> [days] [seed] [inherited-prices.json]
import fs from 'node:fs';
import { createWorld, step, CODE, seeValley, GOODS, fieldBase, levelShare, openCost, capexOf } from '../src/lib/sandbox-8/economy.js';
import { newMind, wear, night } from '../src/lib/sandbox-8/mind.js';
import { questionsFor, applyAnswers } from '../src/lib/sandbox-8/asks.js';
import { loadCode } from '../src/lib/sandbox-8/sandbox.js';
import { useConfig } from '../src/lib/sandbox-8/rules.js';

const cards = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const days = Number(process.argv[3] ?? 40);
useConfig({ id: 'test', name: 'test', version: 1, cards, params: Object.assign({}, ...cards.map((c) => c.values ?? {})) });
CODE.run = await loadCode(cards);
const w = createWorld(Number(process.argv[4] ?? 4242));
// a world that follows another: the prices it left, as a JSON file { good: price } (optional)
if (process.argv[5]) w.inherited = JSON.parse(fs.readFileSync(process.argv[5], 'utf8'));
for (const a of w.avens) wear(a, newMind(a.name, a.reserveDays));
seeValley(w);
// the stand-in brain, asked every 2 game hours: for each good it buys, the most days of stock (of 0-7) whose cost at
// the posted price stays within a tenth of its HEARTS, at least 1 day while it can pay for it: cheap goods it stocks up
// on, dear ones it buys day by day. The market has to find the prices from that alone.
const DAYS = [0, 1, 2, 3, 4, 5, 7];
const decide = (a, full = false) => {
	const q = questionsFor(w, a, { full });
	const pick = (k) => {
		const g = k.slice(4);
		const p = w.posted?.[g] ?? 2;
		const cost = (d) => Math.max(0, a.need?.[g] ?? (g === 'water' ? 3 : 2)) * d * p;
		let i = 1;
		for (let j = 1; j < DAYS.length; j++) if (cost(DAYS[j]) <= a.hearts * 0.1) i = j;
		return i;
	};
	// where an option says what it costs and risks in HEARTS, the cheapest total of the two
	const priced = (x) => {
		const v = x.criteria.map((c) => c.match(/costs ([\d.]+) HEARTS now.*?risks about ([\d.]+) HEARTS/)).map((m) => (m ? Number(m[1]) + Number(m[2]) : null));
		return v.every((n) => n != null) ? v.indexOf(Math.min(...v)) : null;
	};
	// a field decision, as a careful entrepreneur would: plant (or open) where the valley's fields, those still growing
	// included, give least against what it needs; level up where its own crop is short; each aven a little different
	// (its own taste for risk), and one move at a time
	const field = (k, x) => {
		const slot = Number(k.slice(5)) - 1;
		const f = a.fields[slot];
		const live = w.avens.filter((o) => o.alive);
		const yieldOf = (g) => live.reduce((n, o) => n + (o.fields ?? []).filter((h) => h.crop === g).reduce((m, h) => m + fieldBase(g) * levelShare(h.level), 0), 0);
		const short = (g) => (live.length * (g === 'water' ? 3 : 2)) / Math.max(0.5, yieldOf(g));
		const taste = 1 + ((a.id * 7919) % 10) / 20; // 1 to 1.45: how short a crop must look before it moves
		const codes = x.criteria.map((c) => c);
		const levels = a.brain.levels[k];
		const best = GOODS.map((g, i) => [g, i]).sort((p, q) => short(q[0]) - short(p[0]))[(a.id + w.day) % 2];
		if (!f) return slot === a.fields.length && short(best[0]) > taste && a.hearts > openCost(slot) * 1.5 ? levels.indexOf(2 + best[1]) : 0;
		if (short(f.crop) > taste && f.level < 3 && a.hearts > capexOf(f.crop, f.level + 1) * 1.5) return levels.indexOf(1);
		if (short(f.crop) < 0.7 && short(best[0]) > taste * 1.3) return levels.indexOf(2 + best[1]);
		return 0;
	};
	const answers = Object.fromEntries(Object.entries(q).map(([k, x]) => [k, { score: k.startsWith('buy_') ? (priced(x) ?? pick(k)) : k.startsWith('field') ? Math.max(0, field(k, x)) : 0 }]));
	applyAnswers(w, a, answers, 'stand-in');
};
const totals = { short: 0, rot: 0, deaths: 0, deaths10: 0, alive: w.avens.length };
for (let k = 0; k < days * 96; k++) {
	if (k % 8 === 0) for (const a of w.avens) if (a.alive) decide(a, k % 24 === 0);
	if (step(w, 900)) {
		night(w);
		const r = w.stats.at(-1);
		totals.short += Object.values(r.short).reduce((n, x) => n + Object.values(x).reduce((m, q) => m + q, 0), 0);
		totals.rot += GOODS.reduce((n, g) => n + r.rotted[g], 0);
		totals.deaths += Math.max(0, totals.alive - r.alive);
		if (r.day <= 10) totals.deaths10 += Math.max(0, totals.alive - r.alive);
		totals.alive = r.alive;
		if (process.env.FIELDS) console.log('   fields', w.avens.map((x) => `${x.name}:${(x.fields ?? []).map((f) => f.crop.slice(0, 3) + f.level).join('+')}|${Math.round(x.hearts)}`).join(' '));
		console.log(`d${r.day} alive ${r.alive} posted ${GOODS.map((g) => `${g.slice(0, 3)} ${w.posted?.[g] ?? '-'}`).join(' ')} | units ${GOODS.map((g) => r.units[g]).join('/')} rot ${GOODS.map((g) => r.rotted[g]).join('/')}`);
	}
}
console.log(`totals: deaths ${totals.deaths} (first 10 days ${totals.deaths10}), coop ${Math.round(w.coop?.hearts ?? 0)}, units short ${totals.short}, rotted ${totals.rot}, alive at the end ${totals.alive}`);
const info = CODE.run.info();
console.log('errors', JSON.stringify(info.errors));
CODE.run.dispose();
