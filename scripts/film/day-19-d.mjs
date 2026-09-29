// Day 19 · variant D — "A city in its own garden", recut for story: a hook, a sunrise peak, the dip of the tired
// land, the wonder of food grown at home, the pride of a city its people built, a tender evening, and hope.
//
// Every line is its own take (Grandpa Spuds Oxley), placed with the breath before it that the emotion asks for.
// Every shot starts on a word: `cue: [line, 'words']` cuts just before those words are spoken — so the mango is on
// screen as "mango" is said. Hard cuts only. The score is composed to the same clock (music.chunks, see score.ts).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fly, landing, move, orbit, turn, whip } from './camera.mjs';

const R = (deg) => (deg * Math.PI) / 180;
const ring = (c, r, a, y) => [c[0] + r * Math.sin(a), y, c[1] + r * Math.cos(a)];
const still = (p, q) => move(p, p, q, q);
const large1 = [0, 150], large2 = [130, 75], master = [0, 0];

// ── the voice: take, and the breath before it (the pacing lives here) ──────────────────────────
const COLD_OPEN = 3.5;
const lines = [
	{ take: 'day-19-d-hook', cid: '2240cbbadefb4c89e9c50509df8f5c254f8c4f68a806d7775dfd31c083dc60dd', pause: 0 }, //       0 the hook — quiet
	{ take: 'day-19-d-01', cid: '8eb8e81ca8f95c15996f61d8ceefe6cf4053a16c63cfd04ca82da6fcd91ae9a7', pause: 2.8 }, //       1 sunrise — the music swells in the pause
	{ take: 'day-19-spuds-02', cid: '399edf6dcd7558645c12c5c1ba5c5a2b07eda6d7d29ab99cc10bf47bfe457c1f', pause: 2.6 }, //   2 the dip
	{ take: 'day-19-spuds-03', cid: '6084fb81fb65af1e9803caf651ccf0823fd9468a2f944621d9fcab4802f33b7c', pause: 2.4 }, //   3 "Here…" — after a beat of silence
	{ take: 'day-19-spuds-04', cid: 'c85216bcfc8815964d96827c1fae7dea0c015f989b3c00a505d599bf74cd7375', pause: 1.6 }, //   4
	{ take: 'day-19-spuds-05', cid: '27cda35428451706559284c9f1ee7317fed9057316abebe768bb77226e1dd1b3', pause: 2.2 }, //   5 abundance begins
	{ take: 'day-19-spuds-06', cid: '6bafb035b4b7010deea0aebe9e3d79f17c9bda0835b90b6a868d222c8a22f173', pause: 1.4 }, //   6
	{ take: 'day-19-spuds-07', cid: '7b112fdbbd08373be4b504ffa6abcd022a8878fe7d087df5683222a404bb9444', pause: 1.8 }, //   7 the montage
	{ take: 'day-19-d-08', cid: '22710421c8dd79bdc3d7e183db174284eab762a9a5d38db2577a7db485292a99', pause: 1.2 }, //       8 health
	{ take: 'day-19-d-09', cid: 'a602a1fc67af46b8b77266e25f7a895440d232eb66e2348e995a2850fcc16d7c', pause: 3.8 }, //       9 after a breath of music alone
	{ take: 'day-19-d-10', cid: 'afe72d1358d21b744a354aa1465ca1513d28ae3af933d84fe93bfc450061fcd1', pause: 1.4 }, //       10 the commons
	{ take: 'day-19-spuds-11', cid: '49592fba81affabc36dd564dbd095aea640250c23cc3732a7b2f0337e45427f9', pause: 1.8 }, //   11
	{ take: 'day-19-d-12', cid: '373048a0beecf79a1c1041cd77b43ed8d28651546321d9056ecea0b21030d610', pause: 2.6 }, //       12 evening
	{ take: 'day-19-spuds-13', cid: 'a014f513f6a5e1369bf4ec733dac564e28f6b7faf343e78368cdfb08ef42ecca', pause: 3.0 } //    13 after two seconds of frogs alone
];
const TAIL = 5;

// the takes' words, as the library describes them (library/<cid>.json, or LIBRARY=<dir>). Without them the shots are
// still whole as data — camera, light, world — only their places on the film's clock are unknown: `voices`, `cuts`,
// `music` and `sound` are then null and each shot has no `start`/`seconds` (a timeline gives them instead).
const LIB = process.env.LIBRARY ? pathToFileURL(`${resolve(process.env.LIBRARY)}/`) : new URL('../../library/', import.meta.url);
const wordsOf = (cid) => {
	const f = new URL(`${cid}.json`, LIB);
	return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).meta.words : null;
};
let voices = [];
for (const [i, l] of lines.entries()) {
	const words = wordsOf(l.cid);
	if (!words) {
		voices = null;
		break;
	}
	const speaks = i === 0 ? COLD_OPEN : voices[i - 1].speechEnd + l.pause;
	const at = speaks - words[0].start;
	voices.push({ cid: l.cid, take: l.take, at, speechStart: speaks, speechEnd: at + words.at(-1).end, words });
}
const norm = (w) => w.toLowerCase().replace(/[^a-z0-9']/g, '');
/** When the words `phrase` begin in line `i`, on the film's clock (a hair before, so the cut lands on the word). */
function cueAt(i, phrase) {
	const v = voices[i], want = phrase.split(/\s+/).map(norm);
	for (let k = 0; k < v.words.length; k++)
		if (want.every((w, j) => norm(v.words[k + j]?.word ?? '') === w)) return v.at + v.words[k].start - 0.12;
	throw new Error(`cue not found: line ${i} "${phrase}"`);
}

// ── the shots ─────────────────────────────────────────────────────────────────────────────────
// size: EWS · WS · MS · CU · ECU · macro — the grammar, and what the stills are judged against
const COLD = 'eq=saturation=0.45:gamma=0.96:contrast=1.04,colorbalance=bs=0.10:bm=0.05:bh=0.02';
// the exposure is set per shot by grade.mjs; these are looks, not brightness
// the dip on top of COLD: sicklier (green-grey), harder, with grain — the world as it was should feel wrong
const DIP = 'eq=saturation=0.58:contrast=1.08,colorbalance=rs=-0.05:gs=0.04:bs=0.03:rm=-0.04:gm=0.03:bm=0.02:rh=-0.03:gh=0.02,noise=alls=12:allf=t+u,vignette=angle=PI/4';
// the city by day, from "Here… breakfast" on: a touch more colour, so the contrast with the dip lands
const BRIGHT = 'eq=saturation=1.14';
const NIGHT = 'eq=saturation=1.08,colorbalance=bs=0.06:bm=0.03';
const shots = [
	// ACT I · hook and sunrise
	// the hook, in one drone flight: off the forest floor, up through the canopy, back and over the domes to the view —
	// the dawn just glowing behind them. It never stops; the sunrise shot goes on in the same direction (east).
	{ name: 'the-flight', size: 'EWS', at: 0, hour: 4.98, exposure: 9, hourTo: 5.05, fov: 40, stand: [-150, 60], path: fly([
		[[-205, 1.4, 36], [-196, 1.9, 44]],
		[[-209, 8, 38], [-160, 13, 26]],
		[[-232, 32, 32], [-70, 16, 6]],
		[[-266, 60, 2], [0, 16, 0]],
		[[-285, 80, -40], [0, 18, 0]]
	]) },
	// the sun itself, in time-lapse: its disc clears the horizon beside the master dome (sunrise is +x, the east)
	{ name: 'the-sun-rises', size: 'WS', after: [0, 0.3], hour: 5.05, exposure: 1.3, hourTo: 5.4, fov: 52, stand: [150, 20], path: move([78, 26, -30], [90, 27, -30], [400, 24, -34], [400, 25, -34]) },
	// the camera between the low sun and a dome: the glass takes the light head-on
	{ name: 'the-glass-glows', size: 'WS', cue: [1, 'the glass'], hour: 5.5, exposure: 1.4, hourTo: 5.6, fov: 40, stand: [190, 88], path: move([226, 22, 100], [212, 24, 95], [130, 14, 75], [130, 16, 75]) },
	{ name: 'the-city-wakes', size: 'MS', cue: [1, 'wakes'], hour: 6.5, fov: 45, stand: [158, 102], dome: 2, path: move(ring(large2, 50, R(58), 7.6), ring(large2, 47, R(62), 7.2), ring(large2, 30, R(60), 6.2), ring(large2, 30, R(62), 6.2)) },
	// the dip
	// the dip: out over the last trees, across the edge, into land with nothing on it — five moving shots on the words
	{ name: 'the-edge', mood: 'dip', extra: DIP, size: 'WS', cue: [2, 'Not long ago'], hour: 7.0, fov: 44, stand: [-360, 10], grade: COLD, props: 'tired-land', path: move([-366, 7, 12], [-404, 5, 10], [-700, 0, 14], [-700, 0, 10]) },
	{ name: 'bought-everything', mood: 'dip', extra: DIP, size: 'EWS', cue: [2, 'bought almost'], hour: 7.0, fov: 50, stand: [-360, 10], grade: COLD, props: 'tired-land', path: move([-398, 46, -50], [-412, 45, -42], [-530, 0, 30], [-540, 0, 40]) },
	{ name: 'far-away', mood: 'dip', extra: DIP, size: 'LS', cue: [2, 'from far away'], hour: 7.0, fov: 9, stand: [-360, 10], grade: COLD, props: 'tired-land', path: move([-461, 1.8, -300], [-461, 1.8, -290], [-471, 1.6, 500], [-471, 1.6, 510]) },
	{ name: 'the-long-road', mood: 'dip', extra: DIP, size: 'MS', cue: [2, 'carried by trucks'], hour: 7.0, fov: 58, stand: [-360, 10], grade: COLD, props: 'tired-land', path: move([-463.5, 3, -5], [-463.5, 3, 24], [-472, 2.4, 15], [-472, 2.4, 44]) },
	{ name: 'a-tired-land', mood: 'dip', extra: DIP, size: 'EWS', cue: [2, 'across a tired'], hour: 7.0, fov: 46, stand: [-360, 10], grade: COLD, props: 'tired-land', path: move([-452, 3, 62], [-456, 38, 84], [-470, 0, 20], [-480, 0, 0]) },
	// warmth returns
	{ name: 'the-bed', mood: 'bright', extra: BRIGHT, size: 'MS', cue: [3, 'Here'], hour: 7.3, fov: 50, stand: [200, 12], dome: 8, path: move([215.6, 5.6, 1.6], [216.2, 5.6, 1.8], [224, 5.2, 2.6], [224, 5.2, 3.2]) },
	{ name: 'twenty-paces', mood: 'bright', extra: BRIGHT, size: 'MS', cue: [3, 'twenty paces'], hour: 7.6, fov: 50, stand: [200, 12], dome: 8, path: move([211.8, 6.2, 1.0], [211.6, 6.3, 1.0], [200, 3.2, 0], [201, 0.2, 0]) },
	{ name: 'terrace-from-the-air', mood: 'bright', extra: BRIGHT, size: 'WS', cue: [4, 'Every home'], hour: 8.0, fov: 40, stand: [20, 196], dome: 1, path: move(ring(large1, 64, R(15), 16), ring(large1, 60, R(28), 13), ring(large1, 38, R(22), 5), ring(large1, 38, R(30), 5)) },
	{ name: 'through-the-arch', mood: 'bright', extra: BRIGHT, size: 'MS', cue: [4, 'every morning'], hour: 8.1, fov: 46, stand: [150, 105], dome: 2, sfx: [['7605ffd5723a4511ba9320009d5e2beda3f9a734ad244d7765a6120bf4200e82.mp3', 0.05]], path: move(ring(large2, 37.2, R(45), 6.5), ring(large2, 39.4, R(45), 6.7), ring(large2, 110, R(45), 4), ring(large2, 110, R(47), 2.5)) },
	// ACT II · abundance and health
	{ name: 'the-layers', mood: 'bright', extra: BRIGHT, size: 'WS', cue: [5, 'Beneath'], hour: 9.2, fov: 48, stand: [140, 88], dome: 2, sfx: [['7605ffd5723a4511ba9320009d5e2beda3f9a734ad244d7765a6120bf4200e82.mp3', 0.08]], path: move([146, 0.5, 86], [145, 7.5, 85], [138, 0.8, 80], [134, 10, 76]) },
	{ name: 'mango', mood: 'bright', extra: BRIGHT, size: 'ECU', cue: [5, 'mango'], hour: 9.3, fov: 12, stand: [140, 88], dome: 2, path: move([140, 1.5, 80], [140.1, 1.52, 80.2], [148, 3, 84], [148, 3.05, 84.2]) },
	{ name: 'fig', mood: 'bright', extra: BRIGHT, size: 'ECU', cue: [5, 'fig'], hour: 9.3, fov: 12, stand: [140, 88], dome: 2, path: move([147, 1.4, 72], [147.2, 1.42, 72], [141, 3.2, 69], [141, 3.3, 69.2]) },
	{ name: 'coffee-and-cacao', mood: 'bright', extra: BRIGHT, size: 'CU', cue: [5, 'coffee'], hour: 9.4, fov: 28, stand: [140, 88], dome: 2, path: move([143, 1.1, 91], [143, 1.2, 91], [139, 1.3, 93], [139, 3.2, 93]) },
	{ name: 'the-living-soil', mood: 'bright', extra: BRIGHT, size: 'macro', cue: [5, 'and the soil'], hour: 9.5, fov: 55, stand: [140, 88], dome: 2, path: move([136, 0.25, 82], [137.6, 0.25, 82.6], [134.5, 0.05, 84], [136, 0.05, 84.6]) },
	{ name: 'sun-through-the-cells', mood: 'bright', extra: BRIGHT, size: 'CU', cue: [6, 'The glass'], hour: 12.5, fov: 35, stand: [0, 34], dome: 0, path: turn([0, 3, 20], R(-8), R(8), R(58), R(66)) },
	{ name: 'every-pane', mood: 'bright', extra: BRIGHT, size: 'WS', cue: [6, 'every pane'], hour: 12.6, fov: 18, stand: [60, -150], path: move([60, 28, -172], [64, 28.5, -171], [130, 15, -75], [130, 15.5, -75]) },
	{ name: 'the-gallery', mood: 'bright', extra: BRIGHT, size: 'MS', cue: [6, 'that runs'], hour: 12.8, fov: 45, stand: [0, 40], dome: 0, blur: 6, path: whip(move(ring(master, 56.5, R(30), 7.8), ring(master, 56.5, R(36), 7.8), [0, 6, 0], [0, 6, 0]), { out: 0.9 }) },
	{ name: 'the-food-forest', mood: 'bright', extra: BRIGHT, size: 'WS', cue: [7, 'Between'], hour: 15.0, fov: 44, stand: [70, 120], blur: 6, path: whip(move([36, 18, 152], [74, 11, 116], [90, 2, 100], [104, 1, 88]), { into: 0.9 }) },
	{ name: 'fruit-and-nut-trees', mood: 'bright', extra: BRIGHT, size: 'MS', cue: [7, 'fruit and nut'], hour: 15.1, fov: 40, stand: [96, 22], path: move([95, 1.6, 20], [92, 1.6, 26], [80, 2.5, 30], [78, 2.5, 36]) },
	{ name: 'berries-and-vegetables', mood: 'bright', extra: BRIGHT, size: 'CU', cue: [7, 'berries'], hour: 15.2, fov: 30, stand: [0, 40], dome: 0, path: move([2, 1.4, 40], [3, 1.4, 40], [7, 0.6, 37], [8, 0.6, 37]) },
	{ name: 'hens', mood: 'bright', extra: BRIGHT, size: 'CU', cue: [7, 'hens'], hour: 15.3, fov: 30, stand: [56, 86], sfx: [['4ffa6fe2e7cbc5082a78a3eabed4706afde5d6cb3eaa9af8ba5b05ab1d3d5da7.mp3', 0.45]], path: move([55, 1.0, 84], [54.6, 1.0, 83.4], [49, 0.4, 77], [49, 0.4, 77]) },
	{ name: 'geese', mood: 'bright', extra: BRIGHT, size: 'MS', cue: [7, 'geese'], hour: 15.4, fov: 32, stand: [100, 300], sfx: [['646b67cf337fdfdb3446e55b1f1edd4bfc3e6469bc12ea3acd07901cc71cda8f.mp3', 0.32], ['42cbca3f5c288272cc9e836a4a1f970c2edd14c4c95b282fc166bc0ff1f978d7.mp3', 0.14]], path: move([101, 1.0, 300], [100.5, 1.0, 300.6], [94, 0.4, 314], [94, 0.4, 314]) },
	{ name: 'bees', mood: 'bright', extra: BRIGHT, size: 'ECU', cue: [7, 'and bees'], hour: 15.5, fov: 24, stand: [62, 100], sfx: [['7605ffd5723a4511ba9320009d5e2beda3f9a734ad244d7765a6120bf4200e82.mp3', 0.3]], path: move([60, 1.0, 101], [59.8, 1.0, 101.3], [57, 0.8, 104], [57, 0.8, 104]) },
	{ name: 'goats', mood: 'bright', extra: BRIGHT, size: 'MS', cue: [8, 'Almost'], hour: 15.7, fov: 35, stand: [150, 136], sfx: [['0fa1e0014afb92607afdcb7f92e0f3e0f31e179024d3c2398b6d247b39517867.mp3', 0.45]], path: move([143, 1.2, 129.5], [140.6, 1.2, 125.8], [134, 0.5, 115], [134, 0.5, 115]) },
	{ name: 'picked-ripe', mood: 'bright', extra: BRIGHT, size: 'ECU', cue: [8, 'Picked'], hour: 15.8, fov: 10, stand: [172, 40], path: move([170, 1.6, 40], [170.2, 1.62, 40.1], [163, 3, 37], [163, 3.05, 37.1]) },
	{ name: 'a-few-minutes-walk', mood: 'bright', extra: BRIGHT, size: 'WS', cue: [8, 'and never'], hour: 16.0, fov: 42, stand: [176, 36], sfx: [['646b67cf337fdfdb3446e55b1f1edd4bfc3e6469bc12ea3acd07901cc71cda8f.mp3', 0.07]], blur: 6, path: whip(move([176, 1.6, 34], [196, 34, 22], [162, 1.0, 24], [120, 4, 80]), { out: 0.9, d: 0.08 }) },
	// ACT III · together
	{ name: 'the-ring', mood: 'bright', extra: BRIGHT, size: 'EWS', cue: [9, 'Thirteen'], hour: 17.2, fov: 40, stand: [40, 290], sfx: [['42cbca3f5c288272cc9e836a4a1f970c2edd14c4c95b282fc166bc0ff1f978d7.mp3', 0.1]], blur: 6, path: whip(orbit(master, R(8), R(34), 330, 290, 26, 150, [0, 8, 0]), { into: 0.9, d: 0.08 }) },
	{ name: 'the-stream', mood: 'bright', extra: BRIGHT, size: 'MS', cue: [9, 'hear the stream'], hour: 17.4, fov: 38, stand: [100, 290], sfx: [['42cbca3f5c288272cc9e836a4a1f970c2edd14c4c95b282fc166bc0ff1f978d7.mp3', 0.32]], path: move([104, 12, 290], [105, 12, 291], [108, 0, 304], [109, 0, 304]) },
	{ name: 'the-commons', mood: 'bright', extra: BRIGHT, size: 'WS', cue: [10, 'At the centre'], hour: 17.6, fov: 44, stand: [0, 96], path: move([0, 2, 102], [0, 3, 96], [0, 26, 0], [0, 30, 0]) },
	{ name: 'the-workshops', mood: 'bright', extra: BRIGHT, size: 'MS', cue: [10, 'the workshops'], hour: 17.8, fov: 46, stand: [0, 60], dome: 0, path: move(ring(master, 60, R(100), 1.7), ring(master, 60, R(104), 1.7), ring(master, 62, R(118), 1.2), ring(master, 62, R(121), 1.2)) },
	{ name: 'young-and-old', mood: 'bright', extra: BRIGHT, size: 'CU', cue: [10, 'where young'], hour: 17.9, fov: 30, stand: [0, 60], dome: 0, path: move(ring(master, 61.2, R(108), 1.5), ring(master, 61.2, R(109), 1.5), ring(master, 63, R(111), 0.9), ring(master, 63, R(112), 0.9)) },
	{ name: 'the-stone-theatre', mood: 'bright', extra: BRIGHT, size: 'WS', cue: [10, 'and a stone'], hour: 18.2, fov: 46, stand: [0, 34], dome: 0, path: move([36, 19, 26], [21, 10, 15], [0, -1.5, 0], [0, -2.2, 0]) },
	{ name: 'the-node', size: 'ECU', cue: [11, 'Nothing'], hour: 19.0, fov: 20, stand: [0, 160], dome: 1, path: turn([0, 18, 150], R(0), R(14), R(84), R(86)) },
	{ name: 'raised-by-its-people', size: 'WS', cue: [11, 'Every dome'], hour: 19.3, fov: 40, stand: [0, 200], sfx: [['1934113f408410383c16336a37d2e274579e0cc0802e574dcc232982cca02a84.mp3', 0.06]], path: move([4, 0.6, 208], [3, 1.2, 204], [0, 30, 150], [0, 33, 150]) },
	// ACT IV · evening, and hope
	{ name: 'lanterns', size: 'MS', cue: [12, 'In the evening'], hour: 19.6, exposure: 1.5, fov: 42, stand: [14, 196], dome: 1, sfx: [['1934113f408410383c16336a37d2e274579e0cc0802e574dcc232982cca02a84.mp3', 0.12]], path: move(ring(large1, 38.6, R(18), 6.5), ring(large1, 38.4, R(28), 6.5), ring(large1, 37.6, R(46), 5.6), ring(large1, 37.6, R(58), 5.6)) },
	{ name: 'the-forest-grows-quiet', size: 'WS', cue: [12, 'and the forest'], hour: 20.0, exposure: 8, fov: 40, stand: [40, 210], grade: NIGHT, sfx: [['1934113f408410383c16336a37d2e274579e0cc0802e574dcc232982cca02a84.mp3', 0.14]], path: move(ring(large1, 80, R(40), 14), ring(large1, 76, R(46), 13), [0, 16, 150], [0, 18, 150]) },
	{ name: 'path-lights', size: 'MS', cue: [13, 'And as night'], hour: 20.4, exposure: 6, fov: 44, stand: [70, 200], grade: NIGHT, path: move([46, 26, 252], [50, 28, 246], [0, 10, 150], [0, 12, 150]) },
	{ name: 'a-better-way-to-live', size: 'EWS', cue: [13, 'it becomes'], hour: 20.3, exposure: 7, fov: 44, stand: [70, 200], grade: NIGHT, sfx: [['1934113f408410383c16336a37d2e274579e0cc0802e574dcc232982cca02a84.mp3', 0.08]], path: move([74, 30, 214], [62, 105, 300], [30, 6, 120], [0, 14, 0], landing) } // ends on the master dome, as the sunrise began: the loop
];

// every shot runs from its word to the next shot's word; the last one to the end of the film
// a shot starts on a word (cue), just after a line ends (after: [line, seconds]) — the music plays on it — or at a time
function timing() {
	const starts = shots.map((s) => (s.cue ? cueAt(s.cue[0], s.cue[1]) : s.after ? voices[s.after[0]].speechEnd + s.after[1] : s.at));
	const total = voices.at(-1).speechEnd + TAIL;
	const cuts = starts.map((start, i) => ({ start, end: i + 1 < starts.length ? starts[i + 1] : total, seconds: (i + 1 < starts.length ? starts[i + 1] : total) - start }));

	// ── the score: sections that follow the arc, cut on the same clock (score.ts composes it) ─────
	const t = (i) => voices[i].speechStart;
	const music = {
		cid: '58ef55fcb26fb51d526cbc497b5b7fdf8c68f54d86571a8017f26faf45d8baca.mp3',
		chunks: [
			{ until: t(1) - 1.5, styles: ['cinematic ambient intro', 'pre-dawn stillness', 'soft high string pad', 'sparse felt piano single notes', 'mysterious, intimate', '60 bpm'] },
			{ until: t(2) - 0.4, styles: ['epic cinematic sunrise swell', 'warm brass and soaring strings', 'wordless choir pad', 'gentle timpani rolls', 'awe, radiant, triumphant', 'rising to a peak'] },
			{ until: t(3) - 0.6, styles: ['sudden drop to near silence', 'single low cello drone', 'thin, cold, wind-like texture', 'melancholic, minor key', 'sparse'] },
			{ until: t(5) - 0.4, styles: ['warm felt piano motif returns', 'hopeful, tender', 'major key', 'soft strings underneath', 'gentle'] },
			{ until: t(7) - 0.4, styles: ['playful marimba and pizzicato pulse enters', 'curious, bright, growing', 'light percussion', '92 bpm'] },
			{ until: voices[8].speechEnd + 0.8, styles: ['marimba and pizzicato at full energy', 'joyful, abundant, dancing rhythm', 'bright strings join', 'building to a lift', '96 bpm'] },
			{ until: voices[11].speechEnd + 0.6, styles: ['big epic cinematic swell', 'full orchestra', 'taiko and orchestral drums', 'soaring strings and horns', 'proud, triumphant, awe', 'peak at the start'] },
			{ until: t(13) - 0.4, styles: ['sudden quiet', 'solo piano and cello', 'tender, intimate, evening', 'slow', 'lots of space'] },
			{ until: total, styles: ['final emotional swell', 'strings, piano and gentle choir', 'hopeful resolution', 'warm', 'ends softly, fading out'] }
		]
	};

	// ── the sound: a bed for every scene, running on under the cuts; spot sounds on their shots; a few hits on the turns ──
	// A bed runs from its first shot's cut to its last shot's end and crossfades into the next one (`fade`). The picture
	// cuts, the place does not — so its sound does not restart at every cut. The hits are aligned on their loudest
	// moment (`peak`): the boom lands on the cut into the tired land, the lorry passes on "trucks".
	const at = (name) => cuts[shots.findIndex((s) => s.name === name)];
	const sound = {
		beds: [
			{ cid: 'f392c807c75f2fa38adabe086bc95701c10cfab88f05074a3b9e751ab8335895.mp3', from: 'the-flight', to: 'the-city-wakes', level: 0.3, loop: true },
			{ cid: 'b663781598745c432553f4bc544642724600b9677e301f7c0e7a5c8f038edfa9.mp3', from: 'the-edge', to: 'a-tired-land', level: 0.34, loop: true, hardOut: true },
			{ cid: '1914dca5b50a9f0cc55320ecc6c78c2a0d8c7e3602fc1cd4511b5b96f05cca68.mp3', from: 'the-edge', to: 'a-tired-land', level: 0.34, loop: true, hardOut: true },
			{ cid: 'b6713600778441dab6c5232fa418af56a85209b17308e16975684fafd6bd3f84.mp3', from: 'the-bed', to: 'the-gallery', level: 0.2, after: 0.35, fadeIn: 0.5 },
			{ cid: 'f3ebbb41045f0a45d3a27d6782beb71973fa539e9640d1c7d1b9434b02351575.mp3', from: 'the-food-forest', to: 'the-stream', level: 0.17 },
			{ cid: '4d34f215c6e292bc385692aae02eeb8ed7917f51138b1059c2adf439fa535d97.mp3', from: 'the-commons', to: 'the-stone-theatre', level: 0.3, loop: true },
			{ cid: 'b6713600778441dab6c5232fa418af56a85209b17308e16975684fafd6bd3f84.mp3', from: 'the-node', to: 'lanterns', level: 0.15, in: 200 },
			{ cid: '46e638bd4b75170f5450ffe1ec7232d22bfb0da0b5edaf88674e2065066f8d18.mp3', from: 'the-forest-grows-quiet', to: 'a-better-way-to-live', level: 0.26, loop: true }
		],
		hits: [
			{ cid: 'ec63e7d66166fe119d76abb832ee1ff077f46eae2a2ad24ab5cc435feab3f8a7.mp3', peak: at('the-edge').start, level: 0.6 },
			{ cid: '8bbd14b92078058f71888fc91233a516e32cc5d2785f523d49151d2dac437df6.mp3', peak: at('the-long-road').start + 0.7, level: 0.55 },
			{ cid: '8bbd14b92078058f71888fc91233a516e32cc5d2785f523d49151d2dac437df6.mp3', peak: at('the-edge').start + 1.2, level: 0.42 },
			{ cid: 'd4ae234054ed8d36b2c14a104b2c1c38992c38251570d2d056f90f545cd08669.mp3', peak: at('far-away').start + 0.5, level: 0.32 },
			{ cid: '044e58504895e10963eb13eef303b8c7684826f2e585ce0aeb06596678491328.mp3', peak: at('the-bed').start + 0.7, level: 0.42 },
			{ cid: 'cda4f556c62f50acc13f221c098c7341d4a498cc0388a017a0554ec5b1a75121.mp3', peak: at('the-ring').start + 1.2, level: 0.28 },
			{ cid: '2cc8e24903d8c60a09a7d2a022741683831350aaa3e730c2f749e718fe9766c6.mp3', peak: voices.at(-1).speechEnd + 0.6, level: 0.45 }
		]
	};

	// ── the score's own turns: cues that take its place for a stretch (score.ts composes them, sound.ts cuts them in) ──
	// The base score plays everywhere else. Over the dip a cue of dread replaces it — a hit on the cut, then dissonance
	// with no melody — and stops dead on "Here…"; after a beat of silence a burst of light and a bouncy, happy piano
	// take over until the score's marimba section. Replacing cues less than a second apart leave silence between them.
	const HERE = at('the-bed').start;
	music.cues = [
		{
			name: 'dip', cid: '0351080bc48a35843bea1a1cba0d9d789a5443cd05d28e654af10c77bb1952a3.mp3', from: at('the-edge').start - 0.13, to: HERE, replace: true, level: 0.5, // its impact (0.13 s in) on the cut
			chunks: [
				{ seconds: 3, styles: ['sudden dissonant orchestral impact', 'low brass and timpani cluster', 'dark, ominous', 'then a hollow ring-out'] },
				{ seconds: HERE - (at('the-edge').start - 0.25) - 3, styles: ['disturbing dark ambient drone', 'dissonant low strings and cello clusters', 'metallic industrial pulse like distant machinery', 'tense, oppressive, uneasy', 'minor key, no melody', 'slowly building dread'] }
			]
		},
		{
			// "Here… breakfast": the turn, in the music — a burst of light, then a bouncy, happy piano that runs on into the
			// score's marimba section (it takes the score's place until then)
			name: 'breakfast', cid: 'e26e51c1c6245692031e3790eb057fa88e4fdcc14e584f6fe55ef9a329507f48.mp3', from: HERE + 0.35, to: t(5) - 0.4, replace: true, level: 0.62, fin: 0.02, blend: 2.5, // hands over to the score's marimba in the pause before "Beneath…"
			chunks: [
				{ seconds: 3, styles: ['bright joyful orchestral bloom', 'sunburst major chord', 'strings, harp and glockenspiel', 'sudden light and warmth, relief'] },
				{ seconds: t(5) - 0.4 - (HERE + 0.35) - 3, styles: ['upbeat happy piano, rhythmic and bouncy', 'pizzicato strings and light hand percussion', 'playful, joyful, sunny morning', 'major key, lively, 92 bpm', 'building energy'] }
			]
		}
	];
	return { total, cuts, music, sound };
}
const { total = null, cuts = null, music = null, sound = null } = voices ? timing() : {};

// the film's scenes, by voice line: what the library tags each shot, take, cue and sound with (scene: …)
const SCENES = ['hook', 'sunrise', 'the dip', 'breakfast', 'breakfast', 'under the glass', 'under the glass', 'food forest', 'food forest', 'the ring', 'the commons', 'the commons', 'night', 'night'];
const lineOf = (s) => (s.cue ? s.cue[0] : s.after ? s.after[0] + 1 : 0); // a shot after a line leads into the next

export default {
	sound,
	name: 'day-19-d',
	day: 19,
	scenes: SCENES,
	size: 1080,
	fps: 30,
	voices,
	music,
	total,
	cuts,
	shots: shots.map((s, i) => ({ ...s, scene: SCENES[lineOf(s)], start: cuts?.[i].start, seconds: cuts?.[i].seconds }))
};
