/**
 * SANDBOX 6 · A WHOLE GAME, HEADLESS — the autoplayer (./autoplay.js) plays a valley from the first woodcutter to the
 * rival keep, saving and loading it on the way, and says how far it got. Proof that every chain runs end to end:
 *
 *   node src/lib/sandbox-6/playthrough.js [seed] [seconds]
 */
import { loadGame, newGame } from './sim.js';
import { createAutoplay } from './autoplay.js';

const seed = Number(process.argv[2] ?? 7), end = Number(process.argv[3] ?? 5400);
let sim = newGame(seed);
let seen = 0;
for (let k = 0; sim.state.time < end && !sim.state.result; k++) {
	sim.step(0.1);
	if (k % 30 === 0) createAutoplay(sim).tick();
	// the game goes on the same from its saved state
	if (k % 6000 === 0) sim = loadGame(JSON.stringify(sim.state));
	for (const m of sim.state.msgs) if (m.n > seen && (seen = m.n) && /Goal|took|lost|yours/.test(m.text)) console.log(`${String(Math.round(m.t)).padStart(5)} s  ${m.text}`);
}
const s = sim.summary();
console.log(`\n${s.result ?? 'still playing'} after ${Math.round(s.time)} s · made ${JSON.stringify(sim.state.made)}`);
for (const g of s.goals) console.log(`${g.done ? '✓' : '·'} ${g.label}`);
process.exit(s.goals.every((g) => g.done) ? 0 : 1);
