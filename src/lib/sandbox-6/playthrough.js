/**
 * SANDBOX 6 · A WHOLE GAME, HEADLESS — the autoplayer (./autoplay.js) plays a valley from the first woodcutter for as
 * long as it is given, saving and loading it on the way, and says how far it got (nothing is won). Proof that every
 * chain runs end to end, the market's included:
 *
 *   node src/lib/sandbox-6/playthrough.js [seed] [seconds]
 */
import { loadGame, newGame } from './sim.js';
import { createAutoplay } from './autoplay.js';

const seed = Number(process.argv[2] ?? 7), end = Number(process.argv[3] ?? 5400);
let sim = newGame(seed);
let seen = 0;
for (let k = 0; sim.state.time < end; k++) {
	sim.step(0.1);
	if (k % 30 === 0) createAutoplay(sim).tick();
	// the game goes on the same from its saved state
	if (k % 6000 === 0) sim = loadGame(JSON.stringify(sim.state));
	for (const m of sim.state.msgs) if (m.n > seen && (seen = m.n) && /founded|left/.test(m.text)) console.log(`${String(Math.round(m.t)).padStart(5)} s  ${m.text}`);
	if (k % 3000 === 0) {
		const m = sim.market();
		console.log(`${String(Math.round(sim.state.time)).padStart(5)} s  abundance ${Math.round(m.abundance)} · ${m.parties.map((/** @type {any} */ p) => `${p.name} ${Math.round(p.score)} wb${Math.round(p.wb)} r${p.reserve.toFixed(2)} (${p.pop}/${p.cap}${p.full ? ' full' : ''})`).join(' · ')} · purse ${Math.round(m.purse)} · sold ${m.sold} bought ${m.bought}`);
	}
}
const s = sim.summary();
console.log(`\n${s.people} people in ${s.villages} ${s.villages === 1 ? 'village' : 'villages'} after ${Math.round(s.time)} s · made ${JSON.stringify(sim.state.made)}`);
process.exit(s.people > 0 ? 0 : 1);
