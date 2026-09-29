// Day 19 — "A city in its own garden": thirteen shots from Sandbox 4, one for each line the narrator speaks.
//
// Every line is its own take (Grandpa Spuds Oxley, ElevenLabs v3, through fal), placed with a breath before it —
// the pacing is set here, not by how fast the voice reads. The cuts fall in those pauses; each take's word timings
// (studio/<take>.json, from `bun voice say`) put the captions on the words. Hours are chosen for the light: low warm
// sun, long shadows, dusk at the end. Each shot carries its own sound (sfx: [library path, level]).
import { readFileSync } from 'node:fs';
import { cuts, drift, ease, move, orbit, turn } from './camera.mjs';

const R = (deg) => (deg * Math.PI) / 180;
/** A point on a dome's ring: its centre, a radius, an angle (as Sandbox 4 measures it), a height. */
const ring = (c, r, a, y) => [c[0] + r * Math.sin(a), y, c[1] + r * Math.cos(a)];

const LEAD = 2.5; // music alone before the first word
const lines = [
	{ take: 'day-19-spuds-01', cid: '8bfcdb0808397b78306e9e9c8935eb5211aec0361ddf638a1df2fbc76feb655e', pause: 0 },
	{ take: 'day-19-spuds-02', cid: '399edf6dcd7558645c12c5c1ba5c5a2b07eda6d7d29ab99cc10bf47bfe457c1f', pause: 2.2 },
	{ take: 'day-19-spuds-03', cid: '6084fb81fb65af1e9803caf651ccf0823fd9468a2f944621d9fcab4802f33b7c', pause: 2.0 },
	{ take: 'day-19-spuds-04', cid: 'c85216bcfc8815964d96827c1fae7dea0c015f989b3c00a505d599bf74cd7375', pause: 2.4 },
	{ take: 'day-19-spuds-05', cid: '27cda35428451706559284c9f1ee7317fed9057316abebe768bb77226e1dd1b3', pause: 2.2 },
	{ take: 'day-19-spuds-06', cid: '6bafb035b4b7010deea0aebe9e3d79f17c9bda0835b90b6a868d222c8a22f173', pause: 2.0 },
	{ take: 'day-19-spuds-07', cid: '7b112fdbbd08373be4b504ffa6abcd022a8878fe7d087df5683222a404bb9444', pause: 2.6 },
	{ take: 'day-19-spuds-08', cid: '86c34d4c6736294cac650f85f3e5a56194b23e0610b201eb0b71c15c40232342', pause: 1.8 },
	{ take: 'day-19-spuds-09', cid: '16b14c61449c36fed3ef2cc4052cc60247dd4e8b0fe681449d472b58c3d8e957', pause: 2.6 },
	{ take: 'day-19-spuds-10', cid: '5d3fa59f5217c7500ae12a0552a6b8b9d04e5d0ccba99252d28c2154c32564ae', pause: 2.2 },
	{ take: 'day-19-spuds-11', cid: '49592fba81affabc36dd564dbd095aea640250c23cc3732a7b2f0337e45427f9', pause: 2.4 },
	{ take: 'day-19-spuds-12', cid: 'e4741b3081f733c17ca6564ac94dd12f36d6b9a5711d0526354df1ca9d831968', pause: 2.8 },
	{ take: 'day-19-spuds-13', cid: 'a014f513f6a5e1369bf4ec733dac564e28f6b7faf343e78368cdfb08ef42ecca', pause: 2.6 }
];

// place every take: its first word a pause after the last word of the one before
const voices = [];
for (const [i, l] of lines.entries()) {
	// the take's words, as the library describes it (library/<cid>.json)
	const words = JSON.parse(readFileSync(new URL(`../../library/${l.cid}.json`, import.meta.url), 'utf8')).meta.words;
	const first = words[0].start, last = words.at(-1).end;
	const speaks = i === 0 ? LEAD : voices[i - 1].speechEnd + l.pause;
	const at = speaks - first; // where the take's own 0 lands on the film
	voices.push({ cid: l.cid, take: l.take, at, speechStart: speaks, speechEnd: at + last, words });
}
const c = cuts(voices.map((v) => ({ start: v.speechStart, end: v.speechEnd })), { lead: 0, tail: 4.5 });

const large1 = [0, 150], large2 = [130, 75]; // two of the six large domes: terrace at 5 m, from 34 to 41 m out

const shots = [
	{
		// 1 · "At first light… a small city wakes inside its own garden." — along the path from a large dome's east door
		name: 'first-light', hour: 6.6, fov: 40, stand: [190, 76], sfx: [['f3ebbb41045f0a45d3a27d6782beb71973fa539e9640d1c7d1b9434b02351575.mp3', 0.22]],
		path: move([208, 1.5, 77], [186, 2.1, 75.5], [130, 17, 75], [130, 21, 75], drift)
	},
	{
		// 2 · "…bought almost everything they ate from far away…" — the road out, empty, toward the edge
		name: 'the-road-out', hour: 6.9, fov: 38, stand: [236, 0], sfx: [['f3ebbb41045f0a45d3a27d6782beb71973fa539e9640d1c7d1b9434b02351575.mp3', 0.16]],
		path: move([226, 1.7, -5], [228, 1.7, -3.6], [330, 2, 12], [330, 2, 16], drift)
	},
	{
		// 3 · "Here… breakfast grows twenty paces from the bed." — from a gallery room down onto the table on the plaza
		name: 'twenty-paces', hour: 7.6, fov: 50, stand: [200, 12], dome: 8, sfx: [['b6713600778441dab6c5232fa418af56a85209b17308e16975684fafd6bd3f84.mp3', 0.2]],
		path: move([211.8, 6.2, 1.0], [211.6, 6.3, 1.0], [200, 3.2, 0], [201, 0.2, 0], ease)
	},
	{
		// 4 · "Every home opens onto a wide terrace…" — a slow push to the rail of a large dome's terrace, through an
		// arch (they stand every 7.5°, centred on 45°) and out over the canopy in the morning sun
		name: 'terrace-morning', hour: 8.1, fov: 46, stand: [150, 105], dome: 2, sfx: [['f3ebbb41045f0a45d3a27d6782beb71973fa539e9640d1c7d1b9434b02351575.mp3', 0.18], ['7605ffd5723a4511ba9320009d5e2beda3f9a734ad244d7765a6120bf4200e82.mp3', 0.05]],
		path: move(ring(large2, 37.2, R(45), 6.5), ring(large2, 39.4, R(45), 6.7), ring(large2, 110, R(45), 4), ring(large2, 110, R(47), 2.5), drift)
	},
	{
		// 5 · "Beneath each dome, mango and fig…" — a crane up from the forest floor into the canopy
		name: 'the-layers', hour: 9.2, fov: 48, stand: [140, 88], dome: 2, sfx: [['b6713600778441dab6c5232fa418af56a85209b17308e16975684fafd6bd3f84.mp3', 0.2], ['7605ffd5723a4511ba9320009d5e2beda3f9a734ad244d7765a6120bf4200e82.mp3', 0.08]],
		path: move([146, 0.5, 86], [145, 7.5, 85], [138, 0.8, 80], [134, 10, 76], ease)
	},
	{
		// 6 · "The glass that shelters them is also their power…" — straight up into the master dome's solar glass
		name: 'the-glass', hour: 12.5, fov: 55, stand: [22, 30], dome: 0, sfx: [['b6713600778441dab6c5232fa418af56a85209b17308e16975684fafd6bd3f84.mp3', 0.16]],
		path: turn([24, 3, 26], R(10), R(40), R(56), R(70))
	},
	{
		// 7 · "Between the domes grows a food forest… hens… geese… bees…" — low through the forest past the hives to the hens
		name: 'food-forest', hour: 15.2, fov: 42, stand: [64, 100], sfx: [['f3ebbb41045f0a45d3a27d6782beb71973fa539e9640d1c7d1b9434b02351575.mp3', 0.1], ['4ffa6fe2e7cbc5082a78a3eabed4706afde5d6cb3eaa9af8ba5b05ab1d3d5da7.mp3', 0.22], ['7605ffd5723a4511ba9320009d5e2beda3f9a734ad244d7765a6120bf4200e82.mp3', 0.08]],
		path: move([76, 1.1, 114], [56, 1.3, 95], [60, 0.8, 104], [49, 1.0, 77], ease)
	},
	{
		// 8 · "Almost everything the people here eat, they grow together…" — up out of the food forest to the domes it feeds
		name: 'what-they-grow', hour: 15.8, fov: 42, stand: [176, 36], sfx: [['f3ebbb41045f0a45d3a27d6782beb71973fa539e9640d1c7d1b9434b02351575.mp3', 0.14], ['646b67cf337fdfdb3446e55b1f1edd4bfc3e6469bc12ea3acd07901cc71cda8f.mp3', 0.08]],
		path: move([176, 1.6, 34], [196, 34, 22], [162, 1.0, 24], [120, 4, 80], ease)
	},
	{
		// 9 · "Thirteen domes… two hundred and thirty-three people…" — a rising orbit over the whole cell from the stream
		name: 'the-ring', hour: 17.2, fov: 40, stand: [40, 290], sfx: [['f3ebbb41045f0a45d3a27d6782beb71973fa539e9640d1c7d1b9434b02351575.mp3', 0.12], ['42cbca3f5c288272cc9e836a4a1f970c2edd14c4c95b282fc166bc0ff1f978d7.mp3', 0.12]],
		path: orbit([0, 0], R(8), R(34), 330, 290, 26, 150, [0, 8, 0])
	},
	{
		// 10 · "At the centre, the great dome is their commons…" — a crane down over the forest onto the stone theatre
		name: 'the-theatre', hour: 18.2, fov: 46, stand: [0, 34], dome: 0, sfx: [['b6713600778441dab6c5232fa418af56a85209b17308e16975684fafd6bd3f84.mp3', 0.16]],
		path: move([36, 19, 26], [21, 10, 15], [0, -1.5, 0], [0, -2.2, 0], ease)
	},
	{
		// 11 · "Nothing here was handed down…" — along a large dome's arcade at sunset
		name: 'the-arcade', hour: 19.1, fov: 36, stand: [0, 200], sfx: [['f3ebbb41045f0a45d3a27d6782beb71973fa539e9640d1c7d1b9434b02351575.mp3', 0.12], ['1934113f408410383c16336a37d2e274579e0cc0802e574dcc232982cca02a84.mp3', 0.1]],
		path: orbit(large1, R(-10), R(10), 57, 55, 3, 3.4, [0, 8, 150], drift)
	},
	{
		// 12 · "In the evening, the terraces fill with voices…" — along a terrace and its places at dusk
		name: 'terrace-evening', hour: 19.5, fov: 42, stand: [14, 196], dome: 1, sfx: [['f3ebbb41045f0a45d3a27d6782beb71973fa539e9640d1c7d1b9434b02351575.mp3', 0.1], ['1934113f408410383c16336a37d2e274579e0cc0802e574dcc232982cca02a84.mp3', 0.12]],
		path: move(ring(large1, 38.6, R(18), 6.5), ring(large1, 38.4, R(28), 6.5), ring(large1, 37.6, R(46), 5.6), ring(large1, 37.6, R(58), 5.6), drift)
	},
	{
		// 13 · "And as night falls…" — up and back from a forest path at dusk until the lit ring fills the square
		name: 'nightfall', hour: 19.9, fov: 44, stand: [70, 200], grade: 'eq=gamma=1.15:saturation=1.08', sfx: [['1934113f408410383c16336a37d2e274579e0cc0802e574dcc232982cca02a84.mp3', 0.16], ['f3ebbb41045f0a45d3a27d6782beb71973fa539e9640d1c7d1b9434b02351575.mp3', 0.08]],
		path: move([74, 5, 206], [62, 105, 300], [30, 6, 120], [0, 0, 30], ease)
	}
];

export default {
	name: 'day-19-a-city-in-its-own-garden',
	size: 1080,
	fps: 30,
	voices, // each take and where it lands
	music: '4196e2e516c7843e92c35d63980354f66ff2c9209a1c4fab8e1c7fccd1ac7a3d.mp3',
	musicLevels: [0.22, 0.4, voices[9].speechStart - 3], // low under the voice, lifting into the commons line
	cuts: c,
	shots: shots.map((s, i) => ({ ...s, seconds: c[i].seconds }))
};
