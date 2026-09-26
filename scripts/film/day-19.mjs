// Day 19 — "A city in its own garden": ten shots from Sandbox 4, one for each line Brian speaks.
// The cuts follow his word timings (day-19.spans.json, from the take's ElevenLabs timestamps).
// Hours are chosen for the light: low warm sun, long shadows, the last shot at night.
// Each shot carries its own sound (sfx: [library path, level]) — the game's recordings, crossfading at the cuts.
import { cuts, drift, ease, look, move, orbit, turn } from './camera.mjs';
import spans from './day-19.spans.json' with { type: 'json' };

const c = cuts(spans);
const R = (deg) => (deg * Math.PI) / 180;

const shots = [
	{
		// 1 · "At first light, the glass above the forest begins to glow…" — up through the edge forest at a large dome
		name: 'first-light', sfx: [['/sounds/forest_nature.mp3', 0.22]], hour: 6.6, fov: 40, stand: [190, 76],
		// along the path from the east door, the glass lit from behind
		path: move([208, 1.5, 77], [186, 2.1, 75.5], [130, 17, 75], [130, 21, 75], drift)
	},
	{
		// 2 · "…bought almost everything they ate from far away…" — the road out, empty, toward the edge
		name: 'the-road-out', sfx: [['/sounds/forest_nature.mp3', 0.16]], hour: 6.9, fov: 38, stand: [236, 0],
		path: move([226, 1.7, -5], [228, 1.7, -3.6], [330, 2, 12], [330, 2, 16], drift)
	},
	{
		// 3 · "Here, breakfast grows twenty paces from the bed." — from a gallery room in a medium dome down to its forest
		name: 'twenty-paces', sfx: [['/sounds/soft-nature.mp3', 0.2]], hour: 7.6, fov: 50, stand: [200, 12], dome: 8,
		// from the edge of a gallery room, over the rail and down into the forest
		path: move([211.8, 6.2, 1.0], [211.6, 6.3, 1.0], [200, 3.2, 0], [201, 0.2, 0], ease)
	},
	{
		// 4 · "Beneath each dome, mango and fig…" — crane up from the forest floor into the canopy of a large dome
		name: 'the-layers', sfx: [['/sounds/soft-nature.mp3', 0.2], ['/sounds/bees.mp3', 0.08]], hour: 9.2, fov: 48, stand: [140, 88], dome: 2,
		path: move([146, 0.5, 86], [145, 7.5, 85], [138, 0.8, 80], [134, 10, 76], ease)
	},
	{
		// 5 · "The glass that shelters them is also their power…" — straight up into the master dome's solar glass, turning
		name: 'the-glass', sfx: [['/sounds/soft-nature.mp3', 0.16]], hour: 12.5, fov: 55, stand: [22, 30], dome: 0,
		path: turn([24, 3, 26], R(10), R(40), R(56), R(70))
	},
	{
		// 6 · "Between the domes the land belongs to the geese, the goats and the bees…" — low along the goats to a playground
		name: 'between-the-domes', sfx: [['/sounds/forest_nature.mp3', 0.12], ['/sounds/sheep.mp3', 0.14], ['/sounds/geese.mp3', 0.1], ['/sounds/bees.mp3', 0.06]], hour: 15.6, fov: 40, stand: [120, 118],
		// low along the goats, outside the large dome's arcade, to the playground
		path: move([152, 1.0, 142], [101, 1.3, 111], [134, 0.8, 118], [78, 1.8, 88], ease)
	},
	{
		// 7 · "Thirteen domes stand together in one ring…" — a rising orbit over the whole cell from the stream
		name: 'the-ring', sfx: [['/sounds/forest_nature.mp3', 0.12], ['/sounds/water_stream.mp3', 0.12]], hour: 17.2, fov: 40, stand: [40, 290],
		path: orbit([0, 0], R(8), R(34), 330, 290, 26, 150, [0, 8, 0])
	},
	{
		// 8 · "At the centre, the great dome gathers them all…" — down into the master dome's stone theatre
		name: 'the-theatre', sfx: [['/sounds/soft-nature.mp3', 0.16]], hour: 18.2, fov: 46, stand: [0, 34], dome: 0,
		// a crane down over the forest onto the stone theatre
		path: move([36, 19, 26], [21, 10, 15], [0, -1.5, 0], [0, -2.2, 0], ease)
	},
	{
		// 9 · "Nothing here was handed down…" — along the arcade of a large dome at sunset
		name: 'the-arcade', sfx: [['/sounds/forest_nature.mp3', 0.12], ['/sounds/frog.mp3', 0.1]], hour: 19.1, fov: 36, stand: [0, 200],
		path: orbit([0, 150], R(-10), R(10), 57, 55, 3, 3.4, [0, 8, 150], drift)
	},
	{
		// 10 · "And as night falls and the lights come on…" — pull back and up from a forest path until the lit ring fills the frame
		name: 'nightfall', sfx: [['/sounds/frog.mp3', 0.16], ['/sounds/forest_nature.mp3', 0.08]], hour: 20.2, fov: 44, stand: [70, 200], grade: 'eq=gamma=1.3:saturation=1.1',
		path: move([72, 1.8, 204], [60, 70, 330], [30, 3, 120], [0, 4, 0], ease)
	}
];

export default {
	name: 'day-19-a-city-in-its-own-garden',
	size: 1080,
	fps: 30,
	voiceOffset: 2,
	voice: '/studio/voice/day-19-a-city-in-its-own-garden.mp3', // Brian, ElevenLabs v3
	music: '/music/atlasaudio-cinematic-motivation.mp3',
	musicLevels: [0.24, 0.42, 55], // low under the first seven lines, lifting into the eighth
	cuts: c,
	shots: shots.map((s, i) => ({ ...s, seconds: c[i].seconds }))
};
