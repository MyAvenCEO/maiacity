// The parity test: the same world shot rendered twice gives the same frames, bit for bit — in two fresh page loads,
// and in one page after another shot was rendered in between (no frame depends on what came before it).
//
//   node scripts/film/world/parity.mjs [records.json] [--shots 4,13] [--size 128] [--frames 3] [--at 0.5] [--site URL]
//
// Prints each frame's SHA-256 and exits 1 on any difference. Runs on SwiftShader here, Metal on the Mac.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { normalize } from '../../../game/film/shot.js';
import { openWorld, receiver } from './render.mjs';

const args = process.argv.slice(2);
const flag = (/** @type {string} */ k, /** @type {string} */ d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const file = args.find((a) => a.endsWith('.json')) ?? 'scripts/film/worlds/day-19-d.json';
const records = JSON.parse(readFileSync(file, 'utf8')).shots;
const picks = flag('shots', '4,13').split(',').map(Number);
const size = Number(flag('size', '128')), frames = Number(flag('frames', '3')), at = Number(flag('at', '0.5'));
const site = flag('site', process.env.SITE ?? 'http://localhost:5173');
// --keep <dir>: the raw frames too (x2bgr10le, size×size), to look at a difference
const keep = args.includes('--keep') ? args[args.indexOf('--keep') + 1] : null;
if (keep) mkdirSync(keep, { recursive: true });
let runs = 0;
const specs = picks.map((n) => {
	const r = records.find((/** @type {any} */ x) => x.n === n);
	// untimed records get a length and a clock of their own: the same both times, which is all parity needs
	return normalize({ ...r.spec, seconds: r.spec.seconds ?? 4, world: { ...r.spec.world, clock: r.spec.world.clock ?? 30 } });
});

const log = (/** @type {string} */ s) => console.log(s);
/** the frames' hashes, rendering the shots in the given order */
async function run(/** @type {number[]} */ order) {
	runs++;
	const world = await openWorld({ site, log });
	const inbox = await receiver();
	/** @type {Record<number, string[]>} */
	const out = {};
	try {
		for (const i of order) {
			out[i] = [];
			await world.goTo(specs[i].world);
			for (let k = 0; k < frames; k++) {
				const ask = { spec: specs[i], t: at + k / specs[i].fps, width: size, height: size };
				await world.page.evaluate(async (a, url) => {
					const b = await window.__film.capture(a);
					await fetch(url, { method: 'POST', body: b });
				}, ask, `${inbox.url}/f`);
				const frame = /** @type {Buffer} */ (inbox.take('f'));
				if (keep) writeFileSync(`${keep}/shot${picks[i]}-${k}-${runs}.x2bgr10`, frame);
				out[i].push(createHash('sha256').update(frame).digest('hex'));
			}
		}
	} finally {
		await inbox.close();
		await world.close();
	}
	return out;
}

const idx = specs.map((_, i) => i);
const a = await run(idx);
const b = await run([...idx].reverse()); // a fresh page, the shots the other way round
let same = true;
for (const i of idx)
	for (let k = 0; k < frames; k++) {
		const ok = a[i][k] === b[i][k];
		same &&= ok;
		console.log(`shot ${picks[i]} frame ${k}: ${a[i][k].slice(0, 16)} ${ok ? '==' : '!='} ${b[i][k].slice(0, 16)}`);
	}
console.log(same ? 'parity: identical' : 'parity: FRAMES DIFFER');
process.exit(same ? 0 : 1);
