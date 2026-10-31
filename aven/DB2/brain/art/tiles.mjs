// The packages' objects, one per tile on Brain's dashboard, drawn with the paint kit (paint.mjs), each the metaphor
// avenMAIA approved for it (A203): a quilt, a card-index drawer, a pantry of jars, a signal tower, a music box, a chess
// knight, a writing desk, a sand tray, a folded map, a logbook and a dictionary. The slides' objects (objects.mjs) keep
// their slide meanings and are never a tile's.
import { arc, blob, drawing, ellipse, grad, line, shape } from './paint.mjs';

const WOOD = [[0, '#d39a68'], [0.5, '#a8683f'], [1, '#6e4128']];
const DARK = [[0, '#b07a4e'], [0.5, '#7e4c2e'], [1, '#4f2e1c']];
const BRASS = [[0, '#f7dc92'], [0.45, '#e2b14f'], [1, '#a67426']];
const PAPER = [[0, '#fffaf0'], [0.6, '#f4ead7'], [1, '#e2d2b6']];
const SAND = [[0, '#f6e2b8'], [0.6, '#e6c88f'], [1, '#c9a46a']];
const TEAL = '#5a9294';
const TERRA = '#c98a6c';
const OCHRE = '#dbb17d';
const SAGE = '#939a7c';
const CREAM = '#f6ecd9';
const ROSE = '#d9a3a0';
const stitch = (d, w = 1.6) => `<path d="${d}" fill="none" stroke="#fff6e6" stroke-width="${w}" stroke-dasharray="3 4" stroke-linecap="round" opacity="0.9"/>`;
// a point on a quad (a, b, c, d clockwise from top left) at (u, v) in 0..1
const at = ([a, b, c, d], u, v) => {
	const top = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
	const bot = [d[0] + (c[0] - d[0]) * u, d[1] + (c[1] - d[1]) * u];
	return [top[0] + (bot[0] - top[0]) * v, top[1] + (bot[1] - top[1]) * v];
};

// avenDOCS: a patchwork quilt, pieces from several hands sewn into one
export function quilt() {
	const q = [[34, 50], [182, 40], [192, 178], [40, 190]];
	const colours = [TEAL, OCHRE, TERRA, SAGE, '#e9d3b0', TEAL, TERRA, ROSE, OCHRE];
	const defs = [];
	const body = [shape(blob(q, { wobble: 1.2, seed: 201 }), CREAM, { width: 3 })];
	for (let i = 0; i < 3; i++)
		for (let j = 0; j < 3; j++) {
			const [d, fill] = grad([[0, '#ffffff', 1], [0.25, colours[i * 3 + j], 1], [1, colours[i * 3 + j], 1]], { x1: 0, y1: 0, x2: 1, y2: 1 });
			defs.push(d);
			const pts = [at(q, j / 3, i / 3), at(q, (j + 1) / 3, i / 3), at(q, (j + 1) / 3, (i + 1) / 3), at(q, j / 3, (i + 1) / 3)];
			const inset = pts.map(([x, y], k) => [x + [4, -4, -4, 4][k], y + [4, 4, -4, -4][k]]);
			body.push(shape(blob(inset, { wobble: 0.8, seed: 210 + i * 3 + j }), fill, { width: 1.6 }));
			body.push(stitch(blob(inset.map(([x, y], k) => [x + [5, -5, -5, 5][k], y + [5, 5, -5, -5][k]]), { wobble: 0.4, seed: 230 + i * 3 + j })));
		}
	// a corner turned up: the underside shows
	body.push(shape(blob([[192, 178], [160, 182], [186, 150]], { wobble: 0.5, seed: 240 }), '#efe1c6', { width: 2 }));
	return drawing(220, 220, defs, [118, 198, 80, 11], body);
}

// avenOPS: a card-index drawer, one card pulled up out of it
export function drawer() {
	const defs = [];
	const [d1, wood] = grad(WOOD, { x1: 0, y1: 0, x2: 1, y2: 1 });
	const [d2, side] = grad(DARK, { x1: 0, y1: 0, x2: 1, y2: 1 });
	const [d3, card] = grad(PAPER, { x1: 0, y1: 0, x2: 1, y2: 1 });
	const [d4, brass] = grad(BRASS, { x1: 0, y1: 0, x2: 1, y2: 1 });
	defs.push(d1, d2, d3, d4);
	const tabs = [TEAL, OCHRE, TERRA, SAGE];
	const body = [
		// the back of the drawer, behind the cards
		shape(blob([[50, 92], [170, 84], [184, 110], [64, 118]], { wobble: 0.6, seed: 301 }), side),
		// cards standing in it, their tabs up
		...[0, 1, 2, 3].flatMap((k) => [
			shape(blob([[56 + k * 4, 92 + k * 5], [170 - k * 2, 84 + k * 5], [172 - k * 2, 124], [58 + k * 4, 130]], { wobble: 0.5, seed: 310 + k }), card, { width: 1.6 }),
			shape(blob([[62 + k * 30, 93 + k * 4], [84 + k * 30, 92 + k * 4], [84 + k * 30, 83 + k * 4], [62 + k * 30, 84 + k * 4]], { wobble: 0.3, seed: 320 + k }), tabs[k], { width: 1.4 }),
		]),
		// the card pulled out, its lines
		shape(blob([[86, 34], [160, 30], [164, 112], [90, 116]], { wobble: 0.8, seed: 330 }), card),
		shape(blob([[96, 36], [120, 35], [120, 26], [96, 27]], { wobble: 0.3, seed: 331 }), TEAL, { width: 1.6 }),
		...[52, 66, 80, 94].map((y, i) => line(`M100,${y - i * 0.4} L${148 - (i % 2) * 18},${y - 2 - i * 0.4}`, '#8d7b68', 3, 0.75)),
		// the drawer's front and side
		shape(blob([[44, 118], [178, 108], [182, 176], [48, 186]], { wobble: 0.8, seed: 340 }), wood),
		shape(blob([[178, 108], [190, 112], [192, 170], [182, 176]], { wobble: 0.5, seed: 341 }), side),
		// its brass label holder and pull
		shape(blob([[90, 132], [136, 129], [137, 146], [91, 149]], { wobble: 0.4, seed: 342 }), brass, { width: 2 }),
		shape(blob([[96, 136], [130, 134], [131, 143], [97, 145]], { wobble: 0.3, seed: 343 }), CREAM, { width: 1.2 }),
		shape(blob(ellipse(114, 163, 10, 6, 10), { wobble: 0.4, seed: 344 }), brass, { width: 2 }),
		line('M52,124 C90,120 140,116 172,114', '#e0a877', 2, 0.6),
	];
	return drawing(220, 220, defs, [118, 196, 76, 11], body);
}

// avenSTORE: a pantry shelf of sealed jars, each with its tag
export function jars() {
	const defs = [];
	const [d1, wood] = grad(WOOD, { x1: 0, y1: 0, x2: 0, y2: 1 });
	const [d2, brass] = grad(BRASS, { x1: 0, y1: 0, x2: 1, y2: 0 });
	const [d3, glass] = grad([[0, '#f2fbfb', 0.7], [0.6, '#cfe4e4', 0.45], [1, '#9fc2c4', 0.6]], { x1: 0, y1: 0, x2: 1, y2: 0 });
	const [d4, tag] = grad(PAPER, { x1: 0, y1: 0, x2: 1, y2: 1 });
	defs.push(d1, d2, d3, d4);
	const jar = (x, w, h, fill, seed) => {
		const top = 160 - h;
		return [
			shape(blob([[x, top + 14], [x + w, top + 14], [x + w + 2, 154], [x + w - 4, 160], [x + 4, 160], [x - 2, 154]], { wobble: 0.8, seed }), fill),
			shape(blob([[x + 2, top + 40], [x + w - 2, top + 40], [x + w, 154], [x + w - 4, 158], [x + 4, 158], [x, 154]], { wobble: 0.6, seed: seed + 1 }), glass, { width: 2 }),
			line(`M${x + 8},${top + 22} C${x + 6},${top + 60} ${x + 6},${top + 100} ${x + 8},${150}`, '#ffffff', 3, 0.55),
			shape(blob([[x - 3, top + 2], [x + w + 3, top + 2], [x + w + 3, top + 16], [x - 3, top + 16]], { wobble: 0.5, seed: seed + 2 }), brass, { width: 2.2 }),
		];
	};
	const tagged = (x, y, seed) => [
		line(`M${x},${y - 18} L${x + 6},${y}`, '#8d7b68', 1.4, 0.9),
		shape(blob([[x - 2, y], [x + 26, y - 3], [x + 28, y + 14], [x, y + 17]], { wobble: 0.5, seed }), tag, { width: 1.6 }),
		line(`M${x + 4},${y + 6} L${x + 22},${y + 4} M${x + 4},${y + 11} L${x + 16},${y + 10}`, '#3f7f86', 1.8, 0.9),
	];
	const body = [
		...jar(30, 44, 92, TERRA, 401),
		...jar(86, 50, 112, OCHRE, 411),
		...jar(148, 42, 80, SAGE, 421),
		...tagged(56, 104, 431),
		...tagged(116, 86, 432),
		...tagged(172, 118, 433),
		// the shelf
		shape(blob([[14, 160], [206, 156], [208, 174], [16, 178]], { wobble: 0.7, seed: 440 }), wood),
		line('M22,166 C80,163 150,162 200,162', '#e0a877', 2, 0.6),
	];
	return drawing(220, 220, defs, [112, 192, 92, 10], body);
}

// avenPEERS: a lantern-lit signal tower, passing light on
export function tower() {
	const defs = [];
	const [d1, stone] = grad([[0, '#e6dccb'], [0.55, '#bfae98'], [1, '#8d7a66']], { x1: 0, y1: 0, x2: 1, y2: 0 });
	const [d2, roof] = grad([[0, '#d98f72'], [0.6, '#a5675a'], [1, '#6f3f35']], { x1: 0, y1: 0, x2: 1, y2: 1 });
	const [d3, glow] = grad([[0, '#fff6c8', 1], [0.5, '#ffd772', 0.9], [1, '#f2a93b', 0]], { radial: true, cx: 0.5, cy: 0.5, r: 0.5 });
	const [d4, lamp] = grad([[0, '#fff3b5'], [1, '#f0b44a']], { radial: true, cx: 0.4, cy: 0.35, r: 0.8 });
	defs.push(d1, d2, d3, d4);
	const body = [
		`<circle cx="110" cy="62" r="62" fill="${glow}"/>`,
		// rays to either side: the light passed on
		...[[-1, -6], [-1, 10], [1, -6], [1, 10]].map(([s, dy]) => line(`M${110 + s * 34},${62 + dy * 0.5} L${110 + s * 82},${62 + dy * 2.2}`, '#f2b84b', 3, 0.7)),
		// the tower
		shape(blob([[84, 96], [136, 96], [150, 192], [70, 192]], { wobble: 1, seed: 501 }), stone),
		...[118, 140, 162].map((y, i) => line(`M${80 - i * 2},${y} L${140 + i * 2},${y - 1}`, '#8d7a66', 1.6, 0.7)),
		shape(blob([[100, 160], [120, 159], [121, 192], [99, 192]], { wobble: 0.5, seed: 502 }), '#6e4128', { width: 2 }),
		// the lantern room and its roof
		shape(blob([[86, 86], [134, 86], [136, 98], [84, 98]], { wobble: 0.5, seed: 503 }), '#5b4a43', { width: 2.2 }),
		shape(blob([[92, 50], [128, 50], [130, 86], [90, 86]], { wobble: 0.6, seed: 504 }), lamp),
		line('M110,52 L110,84 M100,52 L99,84 M120,52 L121,84', '#a67426', 1.6, 0.8),
		shape(blob([[84, 52], [110, 24], [136, 52]], { wobble: 0.6, seed: 505 }), roof),
		shape(blob(ellipse(110, 22, 4, 4, 8), { wobble: 0.2, seed: 506 }), '#e2b14f', { width: 1.6 }),
	];
	return drawing(220, 220, defs, [118, 196, 52, 9], body);
}

// avenRUNTIME: a music box, its lid open on a brass comb and cylinder; it plays the same tune every time
export function musicBox() {
	const defs = [];
	const [d1, wood] = grad(WOOD, { x1: 0, y1: 0, x2: 1, y2: 1 });
	const [d2, side] = grad(DARK, { x1: 0, y1: 0, x2: 1, y2: 1 });
	const [d3, brass] = grad(BRASS, { x1: 0, y1: 0, x2: 0, y2: 1 });
	const [d4, felt] = grad([[0, '#c8606a'], [1, '#7d2f3a']], { x1: 0, y1: 0, x2: 1, y2: 1 });
	defs.push(d1, d2, d3, d4);
	const body = [
		// the lid, open behind
		shape(blob([[46, 98], [150, 92], [160, 30], [58, 36]], { wobble: 0.8, seed: 601 }), wood),
		shape(blob([[56, 92], [146, 87], [153, 42], [64, 46]], { wobble: 0.6, seed: 602 }), felt, { width: 1.8 }),
		// the box's inside: the cylinder with its pins, and the comb
		shape(blob([[46, 98], [150, 92], [170, 106], [64, 114]], { wobble: 0.5, seed: 603 }), '#5b3a26'),
		shape(blob([[70, 100], [140, 96], [142, 108], [72, 112]], { wobble: 0.4, seed: 604 }), brass, { width: 2 }),
		...Array.from({ length: 9 }, (_, i) => `<circle cx="${76 + i * 7.5}" cy="${103 - i * 0.4 + (i % 3) * 1.6}" r="1.3" fill="#7a5320"/>`),
		...Array.from({ length: 8 }, (_, i) => line(`M${80 + i * 7.5},${113 - i * 0.4} L${82 + i * 7.5},${105 - i * 0.4}`, '#c99a3d', 2.2, 1)),
		// the box's front and side
		shape(blob([[46, 98], [64, 114], [66, 178], [46, 166]], { wobble: 0.5, seed: 605 }), side),
		shape(blob([[64, 114], [170, 106], [172, 168], [66, 178]], { wobble: 0.8, seed: 606 }), wood),
		line('M72,124 C110,120 140,118 164,116', '#e0a877', 2, 0.6),
		// the crank
		shape(blob([[170, 136], [186, 134], [187, 140], [171, 142]], { wobble: 0.3, seed: 607 }), brass, { width: 1.8 }),
		shape(blob([[183, 128], [189, 128], [190, 150], [184, 150]], { wobble: 0.3, seed: 608 }), brass, { width: 1.8 }),
		// two notes rising
		...[[176, 70], [194, 48]].map(([x, y], i) => [
			shape(blob(ellipse(x, y, 6, 4.6, 10), { wobble: 0.3, seed: 610 + i }), '#3b2c27', { width: 1 }),
			line(`M${x + 5},${y - 1} L${x + 5},${y - 22} L${x + 13},${y - 18}`, '#3b2c27', 2.4, 1),
		]).flat(),
	];
	return drawing(220, 220, defs, [112, 192, 70, 10], body);
}

// avenACTORS: a chess knight, a piece that takes its turn
export function knight() {
	const defs = [];
	const [d1, wood] = grad([[0, '#e8c08f'], [0.5, '#c18a55'], [1, '#7e4c2e']], { x1: 0, y1: 0, x2: 1, y2: 0.6 });
	const [d2, base] = grad(DARK, { x1: 0, y1: 0, x2: 1, y2: 0 });
	defs.push(d1, d2);
	const body = [
		// the base, in two rings
		shape(blob([[60, 172], [160, 172], [164, 188], [56, 188]], { wobble: 0.6, seed: 701 }), base),
		shape(blob([[72, 156], [148, 156], [154, 172], [66, 172]], { wobble: 0.6, seed: 702 }), wood),
		// the horse's head and neck
		shape(
			blob([[78, 156], [84, 128], [74, 112], [66, 98], [70, 84], [90, 66], [96, 46], [108, 54], [124, 40], [146, 58], [156, 86], [150, 120], [142, 156]], { wobble: 1.2, seed: 703 }),
			wood,
		),
		// the mane, the eye, the nostril, the ear's line
		line('M126,46 C140,58 150,80 148,108 C146,124 144,140 142,152', '#7e4c2e', 3, 0.7),
		line('M132,52 C142,66 146,84 144,100', '#7e4c2e', 2, 0.6),
		shape(blob(ellipse(104, 74, 4, 3.2, 8), { wobble: 0.2, seed: 704 }), '#3b2c27', { width: 1 }),
		`<circle cx="74" cy="92" r="2.2" fill="#3b2c27"/>`,
		line('M98,58 C104,52 108,52 112,54', '#f1d2a6', 2, 0.8),
		line('M92,120 C104,124 116,122 126,116', '#f1d2a6', 2.4, 0.6),
	];
	return drawing(220, 220, defs, [118, 196, 62, 10], body);
}

// avenOS: a writing desk with pigeonholes, the apps each in their place
export function desk() {
	const defs = [];
	const [d1, wood] = grad(WOOD, { x1: 0, y1: 0, x2: 1, y2: 1 });
	const [d2, inside] = grad(DARK, { x1: 0, y1: 0, x2: 1, y2: 1 });
	const [d3, paper] = grad(PAPER, { x1: 0, y1: 0, x2: 1, y2: 1 });
	defs.push(d1, d2, d3);
	const cells = [];
	const kinds = [TEAL, null, OCHRE, TERRA, SAGE, null];
	for (let r = 0; r < 2; r++)
		for (let c = 0; c < 3; c++) {
			const x = 58 + c * 36;
			const y = 44 + r * 34;
			cells.push(shape(blob([[x, y], [x + 32, y - 1], [x + 32, y + 30], [x, y + 31]], { wobble: 0.4, seed: 801 + r * 3 + c }), inside, { width: 1.8 }));
			const k = kinds[r * 3 + c];
			if (k) {
				cells.push(shape(blob([[x + 5, y + 10], [x + 26, y + 8], [x + 27, y + 30], [x + 6, y + 31]], { wobble: 0.4, seed: 810 + r * 3 + c }), paper, { width: 1.4 }));
				cells.push(shape(blob([[x + 8, y + 10], [x + 18, y + 9], [x + 18, y + 4], [x + 8, y + 5]], { wobble: 0.2, seed: 820 + r * 3 + c }), k, { width: 1.2 }));
			}
		}
	const body = [
		// the hutch
		shape(blob([[50, 34], [170, 30], [172, 118], [52, 120]], { wobble: 0.8, seed: 830 }), wood),
		...cells,
		// the writing top, and a sheet on it
		shape(blob([[26, 118], [194, 112], [200, 134], [22, 142]], { wobble: 0.8, seed: 831 }), wood),
		shape(blob([[74, 118], [128, 116], [132, 130], [76, 133]], { wobble: 0.5, seed: 832 }), paper, { width: 1.6 }),
		// the legs
		shape(blob([[34, 140], [46, 139], [46, 190], [36, 190]], { wobble: 0.4, seed: 833 }), inside, { width: 2 }),
		shape(blob([[176, 134], [188, 133], [186, 186], [176, 186]], { wobble: 0.4, seed: 834 }), inside, { width: 2 }),
		line('M30,124 C90,120 150,118 192,116', '#e0a877', 2, 0.6),
	];
	return drawing(220, 220, defs, [112, 196, 86, 9], body);
}

// avenSANDBOX: a sand tray with tiny houses, to try things out
export function sandTray() {
	const defs = [];
	const [d1, wood] = grad(WOOD, { x1: 0, y1: 0, x2: 1, y2: 1 });
	const [d2, sand] = grad(SAND, { x1: 0, y1: 0, x2: 1, y2: 1 });
	const [d3, side] = grad(DARK, { x1: 0, y1: 0, x2: 1, y2: 0 });
	defs.push(d1, d2, d3);
	const house = (x, y, s, wall, roof, seed) => [
		shape(blob([[x, y], [x + 18 * s, y - 2 * s], [x + 18 * s, y + 16 * s], [x, y + 18 * s]], { wobble: 0.4, seed }), wall, { width: 1.8 }),
		shape(blob([[x - 3 * s, y + 1], [x + 9 * s, y - 13 * s], [x + 21 * s, y - 2 * s]], { wobble: 0.4, seed: seed + 1 }), roof, { width: 1.8 }),
		shape(blob([[x + 7 * s, y + 8 * s], [x + 12 * s, y + 7.5 * s], [x + 12 * s, y + 17 * s], [x + 7 * s, y + 17.5 * s]], { wobble: 0.2, seed: seed + 2 }), '#6e4128', { width: 1.2 }),
	];
	const body = [
		// the tray: its back rim, the sand, its front
		shape(blob([[30, 82], [186, 72], [204, 128], [18, 142]], { wobble: 0.8, seed: 901 }), wood),
		shape(blob([[40, 88], [180, 79], [192, 124], [30, 135]], { wobble: 1, seed: 902 }), sand, { width: 2 }),
		...[[60, 116, 90, 112], [110, 104, 150, 100], [70, 98, 100, 95]].map(([a, b, c, d], i) => line(`M${a},${b} C${a + 10},${b - 3} ${c - 10},${d + 3} ${c},${d}`, '#c9a46a', 1.6, 0.8)),
		shape(blob([[18, 142], [204, 128], [204, 148], [20, 164]], { wobble: 0.6, seed: 903 }), side),
		// the houses, a tree, a path between them
		`<path d="M76,112 C96,108 112,104 132,96" fill="none" stroke="#a5675a" stroke-width="2" stroke-dasharray="2 5" stroke-linecap="round"/>`,
		...house(54, 96, 1.1, CREAM, TERRA, 910),
		...house(128, 82, 1, '#eef3ef', TEAL, 920),
		...house(98, 112, 0.8, CREAM, OCHRE, 930),
		shape(blob([[166, 108], [168, 92], [172, 108]], { wobble: 0.2, seed: 940 }), '#6e4128', { width: 1.6 }),
		shape(blob(ellipse(169, 86, 10, 12, 10), { wobble: 1, seed: 941 }), SAGE, { width: 1.8 }),
	];
	return drawing(220, 220, defs, [112, 176, 92, 10], body);
}

// the architecture: a folded map, its route dotted to a mark
export function map() {
	const defs = [];
	const panel = (pts, stops, seed) => {
		const [d, fill] = grad(stops, { x1: 0, y1: 0, x2: 1, y2: 1 });
		defs.push(d);
		return shape(blob(pts, { wobble: 0.6, seed }), fill);
	};
	const light = [[0, '#fbf3e2'], [1, '#eadcc0']];
	const shade = [[0, '#e8d8b8'], [1, '#cdb88f']];
	const body = [
		panel([[24, 50], [78, 62], [78, 186], [24, 172]], light, 1001),
		panel([[78, 62], [134, 46], [134, 170], [78, 186]], shade, 1002),
		panel([[134, 46], [194, 58], [194, 182], [134, 170]], light, 1003),
		// land and water
		shape(blob([[30, 120], [56, 108], [76, 120], [76, 168], [30, 160]], { wobble: 2, seed: 1004 }), '#b9c7a2', { width: 1.4, stroke: '#7d8a63' }),
		shape(blob([[140, 64], [176, 70], [188, 96], [160, 108], [140, 92]], { wobble: 2, seed: 1005 }), '#a9cbd0', { width: 1.4, stroke: '#5a9294' }),
		shape(blob([[96, 110], [124, 102], [130, 128], [104, 140]], { wobble: 2, seed: 1006 }), '#b9c7a2', { width: 1.4, stroke: '#7d8a63' }),
		// the route and its mark
		`<path d="M40,96 C70,80 90,140 118,120 S160,130 168,150" fill="none" stroke="#a5675a" stroke-width="3" stroke-dasharray="2 7" stroke-linecap="round"/>`,
		line('M160,142 L176,158 M176,142 L160,158', '#c4473a', 4, 1),
		// a compass mark
		line('M50,64 L50,84 M42,74 L58,74', '#3f7f86', 2, 0.9),
		line('M46,62 L50,56 L54,62', '#3f7f86', 2, 0.9),
	];
	return drawing(220, 220, defs, [112, 196, 88, 9], body);
}

// the decisions: an open logbook, a pen across it
export function logbook() {
	const defs = [];
	const [d1, page] = grad(PAPER, { x1: 0, y1: 0, x2: 1, y2: 1 });
	const [d2, cover] = grad([[0, '#6f9fa6'], [0.6, '#3f646b'], [1, '#2a4549']], { x1: 0, y1: 0, x2: 1, y2: 1 });
	const [d3, pen] = grad([[0, '#d98f72'], [0.6, '#a5675a'], [1, '#6f3f35']], { x1: 0, y1: 0, x2: 0, y2: 1 });
	const [d4, brass] = grad(BRASS, { x1: 0, y1: 0, x2: 1, y2: 1 });
	defs.push(d1, d2, d3, d4);
	const rows = (x0, x1, y0, tilt, n, seed) =>
		Array.from({ length: n }, (_, i) => line(`M${x0},${y0 + i * 13 + tilt * 0.2} L${x1 - (i % 3) * 10},${y0 + i * 13 + tilt}`, '#8d7b68', 2.6, 0.7));
	const body = [
		shape(blob([[18, 72], [108, 82], [202, 64], [206, 168], [110, 186], [16, 172]], { wobble: 0.8, seed: 1101 }), cover),
		shape(blob([[26, 66], [108, 78], [108, 178], [24, 164]], { wobble: 0.8, seed: 1102 }), page),
		shape(blob([[108, 78], [194, 58], [196, 160], [108, 178]], { wobble: 0.8, seed: 1103 }), page),
		line('M108,78 C106,110 106,150 108,178', '#c9b38e', 3, 0.8),
		...rows(36, 98, 92, 2, 6, 1104),
		...rows(118, 184, 86, -3, 6, 1105),
		// a ribbon marker
		shape(blob([[150, 172], [158, 170], [160, 196], [154, 190], [148, 196]], { wobble: 0.3, seed: 1106 }), '#c4473a', { width: 1.6 }),
		// the pen, across the right page
		shape(blob([[96, 150], [172, 92], [180, 100], [104, 158]], { wobble: 0.4, seed: 1107 }), pen),
		shape(blob([[96, 150], [104, 158], [86, 166]], { wobble: 0.2, seed: 1108 }), brass, { width: 2 }),
		line('M120,138 L164,104', '#f2c4ae', 2, 0.7),
	];
	return drawing(220, 220, defs, [112, 198, 92, 9], body);
}

// the glossary: a thick dictionary, thumb tabs cut into its edge
export function dictionary() {
	const defs = [];
	const [d1, cover] = grad([[0, '#d98f72'], [0.55, '#a5675a'], [1, '#6f3f35']], { x1: 0, y1: 0, x2: 1, y2: 1 });
	const [d2, edge] = grad([[0, '#fbf4e4'], [1, '#e2d2b6']], { x1: 0, y1: 0, x2: 0, y2: 1 });
	const [d3, gold] = grad(BRASS, { x1: 0, y1: 0, x2: 1, y2: 1 });
	defs.push(d1, d2, d3);
	const tabs = [TEAL, OCHRE, SAGE, TERRA, TEAL];
	const body = [
		// the pages' edge, then the cover
		shape(blob([[136, 44], [168, 56], [170, 186], [138, 176]], { wobble: 0.5, seed: 1201 }), edge),
		...Array.from({ length: 9 }, (_, i) => line(`M${140 + i * 3},${48 + i * 1.3} L${142 + i * 3},${178 + i * 0.9}`, '#cdb88f', 1, 0.7)),
		...tabs.map((c, i) => shape(blob([[150, 66 + i * 22], [160, 69 + i * 22], [160, 80 + i * 22], [150, 77 + i * 22]], { wobble: 0.3, seed: 1210 + i }), c, { width: 1.4 })),
		shape(blob([[50, 36], [136, 44], [138, 176], [52, 168]], { wobble: 0.8, seed: 1202 }), cover),
		shape(blob([[42, 40], [54, 36], [56, 168], [44, 172]], { wobble: 0.5, seed: 1203 }), '#6f3f35', { width: 2.2 }),
		// its title plate and gilt lines
		shape(blob([[72, 70], [118, 74], [118, 104], [72, 100]], { wobble: 0.5, seed: 1204 }), gold, { width: 2 }),
		line('M80,82 L110,84 M84,92 L104,93', '#7a5320', 2.4, 0.9),
		line('M64,128 L126,134 M64,140 L126,146', '#e2b14f', 2, 0.8),
	];
	return drawing(220, 220, defs, [104, 192, 66, 10], body);
}

export const tiles = {
	quilt,
	drawer,
	jars,
	tower,
	'music-box': musicBox,
	knight,
	desk,
	'sand-tray': sandTray,
	map,
	logbook,
	dictionary,
};
