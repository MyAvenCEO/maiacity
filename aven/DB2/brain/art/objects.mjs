// avenID's objects, drawn with the paint kit (paint.mjs), one per metaphor (VOICE.md): a signet stamp, a sealed letter,
// a public imprint card, a magnifying glass, strongboxes, phones, a permit badge, a robot helper, a pass, a tick.
import { INK, arc, blob, drawing, ellipse, grad, line, shape } from './paint.mjs';

const WOOD = [[0, '#d39a68'], [0.5, '#a8683f'], [1, '#6e4128']];
const BRASS = [[0, '#f7dc92'], [0.45, '#e2b14f'], [1, '#a67426']];
const WAX = [[0, '#ea7a64'], [0.5, '#c4473a'], [1, '#8a2a21']];

// the emblem pressed into a seal: an A over a bar
const emblem = (cx, cy, s, color) =>
	line(`M${cx - 5 * s},${cy + 5 * s} L${cx},${cy - 6 * s} L${cx + 5 * s},${cy + 5 * s} M${cx - 2.6 * s},${cy + 1.2 * s} L${cx + 2.6 * s},${cy + 1.2 * s}`, color, 2.2 * s);

// a signet stamp: a turned wooden handle on a brass foot
export function signet() {
	const defs = [];
	const [d1, wood] = grad(WOOD, { x1: 0, y1: 0, x2: 1, y2: 0.4 });
	const [d2, knob] = grad([[0, '#e2ab78'], [0.55, '#a8683f'], [1, '#6a3e26']], { radial: true, cx: 0.32, cy: 0.28, r: 0.85 });
	const [d3, brass] = grad(BRASS, { x1: 0, y1: 0, x2: 1, y2: 0 });
	defs.push(d1, d2, d3);
	const body = [
		// the foot: a brass drum
		shape(blob([[64, 160], [64, 186], ...arc(110, 186, 46, 13, 0.15, Math.PI - 0.15, 9).reverse(), [156, 186], [156, 160]].reverse(), { wobble: 0.6, seed: 3 }), brass),
		shape(blob(ellipse(110, 160, 46, 13, 18), { wobble: 0.5, seed: 4 }), '#f3d283'),
		line(blob(arc(110, 160, 36, 9, 0.2, Math.PI - 0.2, 8), { closed: false, wobble: 0.4, seed: 5 }), '#b98633', 1.6, 0.8),
		// the neck
		shape(blob([[96, 160], [100, 140], [97, 124], [103, 112], [117, 112], [123, 124], [120, 140], [124, 160]], { wobble: 0.6, seed: 6 }), wood),
		line('M103,120 C106,132 104,146 102,156', '#e0a877', 2, 0.7),
		// the knob
		shape(blob(ellipse(110, 82, 34, 34, 14), { wobble: 1.4, seed: 7 }), knob),
		line(blob(arc(110, 84, 22, 22, Math.PI * 1.05, Math.PI * 1.55, 5), { closed: false, wobble: 0.6, seed: 8 }), '#f2c896', 3, 0.85),
		line('M98,70 C108,78 118,76 128,88 M95,92 C105,98 116,96 124,104', '#6e4128', 1.4, 0.6),
	];
	return drawing(220, 220, defs, [128, 196, 60, 12], body);
}

// a letter, sealed: a sheet of words with a red wax seal pressed on it
export function letter() {
	const defs = [];
	const [d1, paper] = grad([[0, '#fffaf0'], [0.6, '#f4ead7'], [1, '#e2d2b6']], { x1: 0, y1: 0, x2: 1, y2: 1 });
	const [d2, wax] = grad(WAX, { radial: true, cx: 0.35, cy: 0.3, r: 0.8 });
	defs.push(d1, d2);
	const body = [
		shape(blob([[40, 46], [176, 34], [186, 170], [48, 182]], { wobble: 1.2, seed: 11 }), paper),
		line('M176,34 C182,60 180,110 186,170', '#d9c7a6', 3, 0.6),
		...[62, 80, 98, 116].map((y, i) => line(blob([[62, y + 4 - i], [100, y + 1 - i], [140 - i * 12, y - 1 - i]], { closed: false, wobble: 0.8, seed: 20 + i }), '#8d7b68', 3.2, 0.75)),
		// the seal: a blob of wax, its emblem pressed in
		shape(blob(ellipse(134, 146, 26, 24, 13), { wobble: 2.6, seed: 31 }), wax),
		shape(blob(ellipse(134, 146, 15, 14, 12), { wobble: 0.8, seed: 32 }), '#b13d31', { width: 1.4, stroke: '#7a241c' }),
		emblem(134, 146, 1.4, '#f19a85'),
		line(blob(arc(134, 146, 22, 20, Math.PI * 1.1, Math.PI * 1.45, 4), { closed: false, wobble: 0.4, seed: 33 }), '#f6a28e', 2.4, 0.8),
	];
	return drawing(220, 220, defs, [124, 192, 74, 12], body);
}

// a public imprint card: a card with the seal's imprint in teal ink, for anyone to hold a seal against
export function imprint() {
	const defs = [];
	const [d1, card] = grad([[0, '#fbf6ea'], [1, '#e6dac2']], { x1: 0, y1: 0, x2: 1, y2: 1 });
	defs.push(d1);
	const body = [
		shape(blob([[46, 54], [170, 44], [178, 168], [52, 176]], { wobble: 1, seed: 41 }), card),
		shape(blob(ellipse(112, 110, 36, 34, 14), { wobble: 1, seed: 42 }), 'none', { stroke: '#3f7f86', width: 5 }),
		shape(blob(ellipse(112, 110, 22, 21, 12), { wobble: 0.6, seed: 43 }), 'none', { stroke: '#3f7f86', width: 2.2 }),
		emblem(112, 110, 1.6, '#3f7f86'),
		shape(blob(ellipse(64, 64, 5, 5, 8), { wobble: 0.3, seed: 44 }), '#d8c9ac', { width: 1.6 }),
	];
	return drawing(220, 220, defs, [118, 186, 66, 11], body);
}

// a magnifying glass: a brass ring round the glass, on a wooden handle
export function magnifier() {
	const defs = [];
	const [d1, glass] = grad([[0, '#e8f4f4', 0.95], [0.6, '#a9cfd2', 0.75], [1, '#6f9fa6', 0.85]], { radial: true, cx: 0.35, cy: 0.3, r: 0.85 });
	const [d2, brass] = grad(BRASS, { x1: 0, y1: 0, x2: 1, y2: 1 });
	const [d3, wood] = grad(WOOD, { x1: 0, y1: 0, x2: 1, y2: 1 });
	defs.push(d1, d2, d3);
	const body = [
		shape(blob([[136, 132], [148, 122], [196, 176], [184, 188]], { wobble: 0.8, seed: 51 }), wood),
		shape(blob([[128, 124], [138, 114], [152, 128], [142, 138]], { wobble: 0.4, seed: 52 }), brass),
		shape(blob(ellipse(98, 88, 58, 58, 20), { wobble: 1, seed: 53 }), brass),
		shape(blob(ellipse(98, 88, 46, 46, 18), { wobble: 0.6, seed: 54 }), glass),
		line(blob(arc(98, 88, 34, 34, Math.PI * 1.08, Math.PI * 1.45, 5), { closed: false, wobble: 0.4, seed: 55 }), '#ffffff', 5, 0.9),
		line(blob(arc(98, 88, 52, 52, Math.PI * 1.1, Math.PI * 1.6, 6), { closed: false, wobble: 0.4, seed: 56 }), '#fbe7a8', 2.4, 0.9),
	];
	return drawing(220, 220, defs, [128, 196, 72, 11], body);
}

// a strongbox, in three-quarter view: wooden planks, iron bands, brass corners, a nameplate and a lock. `paint` tints
// its wood, `plate` colours its nameplate, `emblem` presses the signet's mark on the plate
export function chest({ seed = 61, woodStops = WOOD, lidStops, band = '#4a4f57', plate = BRASS, mark = false } = {}) {
	const defs = [];
	const [d1, front] = grad(woodStops, { x1: 0, y1: 0, x2: 1, y2: 1 });
	const [d2, side] = grad(woodStops.map(([o, c]) => [o, c]).slice(1), { x1: 0, y1: 0, x2: 1, y2: 1 });
	const [d3, lid] = grad(lidStops ?? woodStops, { x1: 0, y1: 0, x2: 0.6, y2: 1 });
	const [d4, brass] = grad(plate, { x1: 0, y1: 0, x2: 1, y2: 1 });
	defs.push(d1, d2, d3, d4);
	const F = [[34, 98], [150, 98], [150, 182], [34, 182]];
	const S = [[150, 98], [192, 78], [192, 158], [150, 182]];
	const L = [[34, 98], [150, 98], [192, 78], [190, 62], [168, 40], [76, 46], [44, 66]];
	const body = [
		shape(blob(S, { wobble: 0.6, seed }), side),
		shape(blob(F, { wobble: 0.6, seed: seed + 1 }), front),
		...[120, 142, 164].map((y, i) => line(`M36,${y} C70,${y - 1} 110,${y + 1} 148,${y - 0.5}`, '#5a3420', 1.4, 0.55 + i * 0.05)),
		shape(blob(L, { wobble: 0.8, seed: seed + 2 }), lid),
		line(blob([[44, 66], [76, 46], [168, 40]], { closed: false, wobble: 0.5, seed: seed + 3 }), '#f0c08e', 2.4, 0.7),
		// iron bands over the lid and down the front
		shape(blob([[62, 98], [74, 98], [74, 182], [62, 182]], { wobble: 0.3, seed: seed + 4 }), band, { width: 2 }),
		shape(blob([[112, 98], [124, 98], [124, 182], [112, 182]], { wobble: 0.3, seed: seed + 5 }), band, { width: 2 }),
		shape(blob([[62, 98], [74, 98], [98, 48], [86, 48]], { wobble: 0.3, seed: seed + 6 }), band, { width: 2 }),
		shape(blob([[112, 98], [124, 98], [154, 44], [142, 44]], { wobble: 0.3, seed: seed + 7 }), band, { width: 2 }),
		// the nameplate and the lock
		shape(blob([[80, 108], [106, 108], [106, 128], [80, 128]], { wobble: 0.4, seed: seed + 8 }), brass, { width: 2 }),
		...(mark ? [emblem(93, 118, 0.9, '#7a5418')] : [line('M85,114 L101,114 M85,121 L97,121', '#8c6420', 1.6, 0.8)]),
		shape(blob([[84, 140], [102, 140], [102, 162], [84, 162]], { wobble: 0.4, seed: seed + 9 }), brass, { width: 2 }),
		shape(blob([[91, 146], [95, 146], [96, 156], [90, 156]], { wobble: 0.2, seed: seed + 10 }), '#2e2420', { width: 1 }),
		// brass corners
		shape(blob([[34, 170], [46, 182], [34, 182]], { wobble: 0.2, seed: seed + 11 }), brass, { width: 1.6 }),
		shape(blob([[138, 182], [150, 170], [150, 182]], { wobble: 0.2, seed: seed + 12 }), brass, { width: 1.6 }),
	];
	return drawing(220, 220, defs, [120, 192, 86, 12], body);
}

// a guild's chest: the same box, painted green, with a leaf on its plate
export const guildChest = () =>
	chest({ seed: 71, woodStops: [[0, '#9fbf86'], [0.5, '#6f8f5a'], [1, '#43593a']], band: '#5a4a3a', mark: false });

// a robot helper: a box of a body, a round-cornered head with two eyes, an antenna
export function robot() {
	const defs = [];
	const [d1, metal] = grad([[0, '#d6e2ea'], [0.5, '#98aebd'], [1, '#5f7586']], { x1: 0, y1: 0, x2: 1, y2: 1 });
	const [d2, head] = grad([[0, '#e4edf2'], [0.55, '#a9bcc9'], [1, '#6c8292']], { radial: true, cx: 0.3, cy: 0.25, r: 0.9 });
	defs.push(d1, d2);
	const body = [
		shape(blob([[70, 124], [150, 124], [156, 182], [64, 182]], { wobble: 0.8, seed: 81 }), metal),
		shape(blob([[96, 140], [124, 140], [124, 160], [96, 160]], { wobble: 0.4, seed: 82 }), '#e9b04f', { width: 2 }),
		shape(blob([[108, 112], [112, 112], [112, 124], [108, 124]], { wobble: 0.2, seed: 83 }), '#6c8292', { width: 1.6 }),
		shape(blob([[66, 64], [154, 64], [158, 112], [62, 112]], { wobble: 1, seed: 84 }), head),
		shape(blob(ellipse(90, 88, 9, 9, 10), { wobble: 0.3, seed: 85 }), '#2f3a44', { width: 1.8 }),
		shape(blob(ellipse(130, 88, 9, 9, 10), { wobble: 0.3, seed: 86 }), '#2f3a44', { width: 1.8 }),
		shape(blob(ellipse(87, 85, 3, 3, 6), { wobble: 0.1, seed: 87 }), '#bfe6ee', { width: 0 }),
		shape(blob(ellipse(127, 85, 3, 3, 6), { wobble: 0.1, seed: 88 }), '#bfe6ee', { width: 0 }),
		line('M98,102 C106,106 114,106 122,102', '#2f3a44', 2.4),
		line('M110,64 L110,42', INK, 2.6),
		shape(blob(ellipse(110, 36, 8, 8, 10), { wobble: 0.3, seed: 89 }), '#e2715f'),
		shape(blob([[56, 132], [64, 128], [62, 164], [52, 160]], { wobble: 0.5, seed: 90 }), metal, { width: 2 }),
		shape(blob([[156, 128], [164, 132], [168, 160], [158, 164]], { wobble: 0.5, seed: 91 }), metal, { width: 2 }),
	];
	return drawing(220, 220, defs, [118, 192, 64, 11], body);
}

// a phone, in three-quarter view: a slate slab with its glass. `screen` is drawn on the glass
export function phone(screen = []) {
	const defs = [];
	const [d1, slab] = grad([[0, '#6b7782'], [0.5, '#46515c'], [1, '#262e36']], { x1: 0, y1: 0, x2: 1, y2: 1 });
	const [d2, glass] = grad([[0, '#eaf4f6'], [0.45, '#b9d6dd'], [1, '#7aa3b0']], { x1: 0, y1: 0, x2: 1, y2: 1 });
	defs.push(d1, d2);
	const body = [
		shape(blob([[64, 26], [148, 20], [162, 30], [168, 188], [156, 198], [72, 202], [60, 192], [54, 36]], { wobble: 0.8, seed: 101 }), '#2a3138'),
		shape(blob([[60, 30], [144, 24], [156, 34], [160, 184], [150, 194], [68, 198], [58, 188], [52, 40]], { wobble: 0.8, seed: 102 }), slab),
		shape(blob([[66, 44], [146, 39], [150, 178], [70, 184]], { wobble: 0.5, seed: 103 }), glass, { width: 2 }),
		line('M72,52 L118,49 L74,120 Z', '#ffffff', 0, 0),
		`<path d="M70,48 L124,45 L72,122 Z" fill="#ffffff" opacity="0.28"/>`,
		...screen,
	];
	return drawing(220, 220, defs, [124, 204, 62, 9], body);
}

// a phone keeping its own key: a little signet sealed in a glass case on its screen
export const phoneKey = () =>
	phone([
		shape(blob([[84, 74], [134, 72], [136, 150], [86, 152]], { wobble: 0.6, seed: 111 }), '#d6ecef', { stroke: '#3f7f86', width: 2.4, extra: 'opacity="0.95"' }),
		shape(blob(ellipse(110, 92, 14, 14, 10), { wobble: 0.6, seed: 112 }), '#b8794a', { width: 2 }),
		shape(blob([[104, 104], [116, 104], [118, 124], [102, 124]], { wobble: 0.4, seed: 113 }), '#9a6038', { width: 2 }),
		shape(blob([[94, 124], [126, 124], [126, 136], [94, 136]], { wobble: 0.4, seed: 114 }), '#e2b14f', { width: 2 }),
	]);

// a phone asking for a fingertip: a fingerprint glowing on its glass
export const phonePrint = () =>
	phone([
		...[30, 23, 16, 9].map((r, i) =>
			line(blob(arc(110, 116, r, r * 1.1, Math.PI * (1.05 - i * 0.05), Math.PI * (1.95 + i * 0.05), 8), { closed: false, wobble: 0.5, seed: 121 + i }), '#2f6f78', 3.4, 0.9),
		),
		shape(blob(ellipse(110, 118, 3, 3, 6), { wobble: 0.1, seed: 125 }), '#2f6f78', { width: 0 }),
	]);

// a permit badge on a lanyard: what its holder may do, sealed by who allows it
export function badge() {
	const defs = [];
	const [d1, card] = grad([[0, '#fbf6ea'], [1, '#e2d5bc']], { x1: 0, y1: 0, x2: 1, y2: 1 });
	const [d2, wax] = grad(WAX, { radial: true });
	defs.push(d1, d2);
	const body = [
		line('M84,20 C90,40 98,52 104,62 M140,20 C134,40 126,52 120,62', '#3f7f86', 5),
		shape(blob([[100, 58], [124, 58], [124, 72], [100, 72]], { wobble: 0.3, seed: 131 }), '#c9c2b6', { width: 2 }),
		shape(blob([[60, 70], [162, 66], [168, 190], [64, 194]], { wobble: 1, seed: 132 }), card),
		shape(blob([[62, 76], [162, 72], [163, 96], [63, 100]], { wobble: 0.5, seed: 133 }), '#5a9294', { width: 2 }),
		...[116, 134, 152].map((y, i) => line(`M78,${y} L${140 - i * 18},${y - 1}`, '#8d7b68', 3.2, 0.75)),
		shape(blob(ellipse(140, 170, 15, 14, 12), { wobble: 1.6, seed: 134 }), wax),
		emblem(140, 170, 0.9, '#f19a85'),
	];
	return drawing(220, 220, defs, [120, 204, 56, 9], body);
}

// a pass: a ticket with its stub, its lines, and the issuer's seal
export function pass() {
	const defs = [];
	const [d1, card] = grad([[0, '#fff8ea'], [0.6, '#f3e3c4'], [1, '#dcc59c']], { x1: 0, y1: 0, x2: 1, y2: 1 });
	const [d2, wax] = grad(WAX, { radial: true });
	defs.push(d1, d2);
	const body = [
		shape(blob([[24, 70], [196, 56], [202, 150], [30, 166]], { wobble: 1, seed: 141 }), card),
		line('M150,60 L156,154', '#a08a68', 2, 0.9),
		`<path d="M150,60 L156,154" stroke="#fff8ea" stroke-width="2.4" stroke-dasharray="3 6"/>`,
		...[88, 104, 120, 136].map((y, i) => line(`M44,${y - i * 1.2} L${118 - (i % 2) * 22},${y - 5 - i * 1.2}`, '#8d7b68', 3.4, 0.75)),
		shape(blob(ellipse(178, 104, 15, 14, 12), { wobble: 1.6, seed: 142 }), wax),
		emblem(178, 104, 0.9, '#f19a85'),
	];
	return drawing(220, 220, defs, [116, 176, 86, 10], body);
}

// a tick: a green stamp, checked and found good
export function tick() {
	const defs = [];
	const [d1, green] = grad([[0, '#a7c58d'], [0.55, '#6f8f5a'], [1, '#44603a']], { radial: true, cx: 0.32, cy: 0.28, r: 0.9 });
	defs.push(d1);
	const body = [
		shape(blob(ellipse(110, 104, 62, 60, 16), { wobble: 1.6, seed: 151 }), green),
		shape(blob([[78, 104], [92, 92], [106, 108], [140, 74], [154, 88], [106, 134]], { wobble: 0.8, seed: 152 }), '#fbf6ea', { width: 2.4 }),
	];
	return drawing(220, 220, defs, [120, 180, 60, 10], body);
}

export const objects = {
	signet,
	letter,
	imprint,
	magnifier,
	chest: () => chest({ mark: true }),
	'guild-chest': guildChest,
	'chest-bob': () => chest({ seed: 161, woodStops: [[0, '#9cc6c7'], [0.5, '#5a9294'], [1, '#335f61']], band: '#4a3b30' }),
	robot,
	'phone-key': phoneKey,
	'phone-print': phonePrint,
	badge,
	pass,
	tick,
};
