// Sandbox 7: the rules written out as card code (game/economy/rules-code.js) must play the valley exactly as the
// engine's own fallback rules do. Plays one seeded valley for 40 days both ways, with fixed prices so the market
// trades, and compares every day's stats and every brain's trials; each day it also checks that the Brains card shows
// and asks every aven exactly what the engine would. Run: node scripts/sandbox-8-rules.mjs
import { createWorld, step, CODE, seeValley, GOODS } from '../src/lib/sandbox-8/economy.js';
import { newMind, wear, night } from '../src/lib/sandbox-8/mind.js';
import { stateFor, questionsFor, promptFor } from '../src/lib/sandbox-8/asks.js';
import { loadCode } from '../src/lib/sandbox-8/sandbox.js';
import { defaultCards } from '../game/economy/params.js';

let asked = 0;
/** what every living aven's brain would see and be asked now: by the card code, then by the engine alone */
function brainCheck(w) {
	const run = CODE.run;
	const all = () => JSON.stringify(w.avens.filter((a) => a.alive).map((a) => [stateFor(w, a), questionsFor(w, a, { full: true, writes: true }), a.brain.levels, promptFor(a)]));
	const coded = all();
	CODE.run = null;
	const own = all();
	CODE.run = run;
	asked += 1;
	if (coded !== own) {
		const i = [...coded].findIndex((c, k) => c !== own[k]);
		console.log('BRAINS DIFFER on day', w.day, '\ncard:  ', coded.slice(Math.max(0, i - 200), i + 200), '\nengine:', own.slice(Math.max(0, i - 200), i + 200));
		process.exit(1);
	}
}

function play(days) {
	const w = createWorld(12345);
	for (const a of w.avens) {
		wear(a, newMind(a.name, a.reserveDays));
		a.brain.ready = true;
		for (const g of GOODS) a.grows.includes(g) ? (a.ask[g] = 8 + a.id) : (a.bid[g] = 10 + (a.id % 4));
	}
	if (CODE.run) seeValley(w);
	for (let k = 0; k < days * 96; k++)
		if (step(w, 900)) {
			night(w);
			if (CODE.run) brainCheck(w);
		}
	return w;
}

const own = play(40);
CODE.run = await loadCode(defaultCards());
const coded = play(40);
const info = CODE.run.info();
CODE.run.dispose();
const a = JSON.stringify([own.stats, own.avens.map((x) => x.mind)]);
const b = JSON.stringify([coded.stats, coded.avens.map((x) => x.mind)]);
const calls = info.hooks.reduce((n, h) => n + h.calls, 0);
console.log(`${info.hooks.length} rule cards ran ${calls} hook calls; errors: ${info.errors.length ? JSON.stringify(info.errors) : 'none'}`);
console.log(`the Brains card saw and asked every aven as the engine does, on ${asked} days`);
console.log(`deaths ${own.avens.filter((x) => x.reborn || !x.alive).length}, deals ${own.stats.reduce((n, s) => n + s.deals, 0)}`);
if (a === b) console.log('same: the card code plays the valley exactly as the engine does');
else {
	const d = own.stats.findIndex((s, i) => JSON.stringify(s) !== JSON.stringify(coded.stats[i]));
	console.log('DIFFERENT from day', d, JSON.stringify(own.stats[d]).slice(0, 400), '\nvs', JSON.stringify(coded.stats[d]).slice(0, 400));
	process.exit(1);
}
