// A shot list written before shots were data (scripts/film/day-19-d.mjs …) as world shot records, in a JSON file
// beside it (scripts/film/worlds/<name>.json): each shot's camera, lens, hour, world, exposure, shutter, look and
// sounds (game/film/shot.js fromLegacy).
//
//   node scripts/film/worlds/export.mjs scripts/film/day-19-d.mjs [out.json]
//
// A shot's length and its place on the film's clock come from the voice's word timings (the vault, or LIBRARY=<dir>).
// Without them — or with --untimed — they are left null: the timeline gives them (api/scripts/world-timeline.ts
// fills them in from each shot's clip), so the file never carries timings from anywhere else.
import { writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fromLegacy, stable } from '../../../game/film/shot.js';

const args = process.argv.slice(2);
const list = args.find((a) => a.endsWith('.mjs'));
if (!list) throw new Error('usage: node scripts/film/worlds/export.mjs <shot list.mjs> [out.json] [--untimed]');
const film = (await import(pathToFileURL(resolve(list)).href)).default;
const timed = !args.includes('--untimed') && film.shots.every((s) => Number.isFinite(s.seconds));
const out = args.find((a) => a.endsWith('.json')) ?? resolve('scripts/film/worlds', `${film.name ?? basename(list, '.mjs')}.json`);
const shots = film.shots.map((s, i) => {
	const spec = fromLegacy(s, timed ? {} : { seconds: 1, clock: 0 });
	if (!timed) {
		// untimed: the record without its length and clock, to be filled in from the timeline
		spec.seconds = /** @type {any} */ (null);
		spec.world.clock = /** @type {any} */ (null);
	}
	return { n: i + 1, name: s.name, spec };
});
// sorted keys, one shot per line: the file diffs well when a shot changes
const text = `{\n"film": ${JSON.stringify(film.name)},\n"timed": ${timed},\n"note": ${JSON.stringify(timed ? 'seconds and world.clock from the voice word timings' : 'seconds and world.clock are null: each comes from its clip on the timeline (clip.in + clip.dur, clip.start − clip.in)')},\n"shots": [\n${shots.map((s) => stable(s)).join(',\n')}\n]\n}\n`;
writeFileSync(out, text);
console.log(`${shots.length} shots → ${out}${timed ? '' : ' (untimed)'}`);
