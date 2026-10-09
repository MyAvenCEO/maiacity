// Sandbox 7: the rules written out as card code (game/economy/rules-code.js) must play the valley exactly as the
// engine's own fallback rules do. Plays one seeded valley for 40 days both ways, with fixed prices so the market
// trades, and compares every day's stats. Run: node scripts/sandbox-8-rules.mjs
import { createWorld, step, CODE, seeValley, GOODS } from '../src/lib/sandbox-8/economy.js';
import { loadCode } from '../src/lib/sandbox-8/sandbox.js';
import { defaultCards } from '../game/economy/params.js';

function play(days) {
	const w = createWorld(12345);
	for (const a of w.avens) {
		a.brain.ready = true;
		for (const g of GOODS) a.grows.includes(g) ? (a.ask[g] = 8 + a.id) : (a.bid[g] = 10 + (a.id % 4));
	}
	if (CODE.run) seeValley(w);
	for (let k = 0; k < days * 96; k++) step(w, 900);
	return w;
}

const own = play(40);
CODE.run = await loadCode(defaultCards());
const coded = play(40);
const info = CODE.run.info();
CODE.run.dispose();
const a = JSON.stringify(own.stats);
const b = JSON.stringify(coded.stats);
const calls = info.hooks.reduce((n, h) => n + h.calls, 0);
console.log(`${info.hooks.length} rule cards ran ${calls} hook calls; errors: ${info.errors.length ? JSON.stringify(info.errors) : 'none'}`);
console.log(`deaths ${own.avens.filter((x) => x.reborn || !x.alive).length}, deals ${own.stats.reduce((n, s) => n + s.deals, 0)}`);
if (a === b) console.log('same: the card code plays the valley exactly as the engine does');
else {
	const d = own.stats.findIndex((s, i) => JSON.stringify(s) !== JSON.stringify(coded.stats[i]));
	console.log('DIFFERENT from day', d, JSON.stringify(own.stats[d]).slice(0, 400), '\nvs', JSON.stringify(coded.stats[d]).slice(0, 400));
	process.exit(1);
}
