// @ts-nocheck — plain JS
// A story going out as a film (./films.js): a cut's renders' films, and the film post of one.
// Run: bun test src/lib/studio/films.test.js
import { expect, test } from 'bun:test';
import { postTypeSchema } from '../avendb/posttypes.js';
import { filmPost, filmsOf, postsOfFilm } from './films.js';

const task = (entry, at, status, outputs, result) => ({
	entry,
	vault: 'V',
	type: 'task',
	record: { kind: 'task', rule: 'render', version: 1, key: entry, inputs: [{ id: 1, name: 'cut', entry: 'c1', at: [] }], params: '{}', status, outputs, result: JSON.stringify(result), at }
});
const deliveries = [
	{ aspect: '16:9', seconds: 33.2, format: '4K HEVC' },
	{ aspect: '16:9', seconds: 0, kind: 'thumbnail' },
	{ aspect: '9:16', seconds: 33.2, format: '1080 H.264' }
];
const world = {
	entries: [
		task('t1', 10, 'done', ['f1', 'f2'], { deliveries }),
		task('t2', 20, 'done', ['f3'], { file: 'r3' }),
		task('t3', 30, 'queued', [], null),
		{ entry: 'f1', vault: 'V', type: 'file', record: { name: 'trailer-16x9.mp4' } },
		{ entry: 'f2', vault: 'V', type: 'file', record: { name: 'trailer-9x16.mp4' } },
		{ entry: 'f3', vault: 'V', type: 'file', record: { name: 'again.mp4' } },
		{ entry: 'p1', vault: 'V', type: 'post', record: { kind: 'post:film', media: { vault: 'V', entry: 'f1' } } }
	]
};

test("a cut's films: its done renders' files, the newest first, each with its shape and length past the thumbnails", () => {
	const films = filmsOf(world, 'c1');
	expect(films.map((f) => [f.file.entry, f.aspect, f.seconds])).toEqual([
		['f3', '', null],
		['f1', '16:9', 33.2],
		['f2', '9:16', 33.2]
	]);
	// a report kept in a file, once read
	expect(filmsOf(world, 'c1', { t2: { deliveries: [{ aspect: '1:1', seconds: 12 }] } })[0]).toMatchObject({ aspect: '1:1', seconds: 12 });
	expect(postsOfFilm(world, 'f1').map((p) => p.entry)).toEqual(['p1']);
});

test('the film post links its story, film, cut and script, and fits the film type', () => {
	const story = { entry: 's1', vault: 'V', title: 'Day 19', record: { title: 'Day 19', language: 'en' } };
	const cut = { entry: 'c1', vault: 'V', record: { timeline: JSON.stringify({ script: { vault: 'V', entry: 'sc1' } }) } };
	const p = filmPost(story, cut, filmsOf(world, 'c1')[1]);
	expect(p).toMatchObject({ kind: 'post:film', title: 'Day 19', story: { entry: 's1' }, media: { entry: 'f1' }, cut: { entry: 'c1' }, script: { entry: 'sc1' }, shape: '16:9', seconds: 33.2 });
	const schema = JSON.parse(postTypeSchema('film', '# template'));
	expect(schema.title).toBe('Post: Film, v1');
	for (const k of Object.keys(p)) expect(schema.properties).toHaveProperty(k);
});
