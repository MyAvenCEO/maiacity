/**
 * The game's pixel art, drawn by code: every texture and every item is 16 × 16 pixels, painted from a short recipe and
 * a seed, so the same resource always looks the same and no picture file is kept. A recipe is [painter, ...args];
 * paint() returns the 256 colours of one tile, row by row ('#rrggbb', or null where an item leaves the pixel empty).
 * Nothing here touches the page: library.js puts the tiles on canvases.
 */

export const SIZE = 16;

/** a string's seed (FNV-1a), so a resource's look follows from its id @param {string} text */
export function seedOf(text) {
	let h = 2166136261;
	for (const c of text) h = Math.imul(h ^ /** @type {number} */ (c.codePointAt(0)), 16777619);
	return h >>> 0;
}

/** a small seeded random, 0 to 1 (mulberry32) @param {number} seed */
export function random(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** @param {string} colour */
const channels = (colour) => [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));
/** @param {number[]} rgb */
const hex = (rgb) => '#' + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
/** how light a colour looks, 0 to 255 @param {string} colour */
export const luma = (colour) => {
	const [r, g, b] = channels(colour);
	return 0.299 * r + 0.587 * g + 0.114 * b;
};
/** a colour lighter (amount > 0, towards white) or darker (amount < 0, towards black) @param {string} colour @param {number} amount */
export const shade = (colour, amount) =>
	hex(channels(colour).map((v) => (amount > 0 ? v + (255 - v) * amount : v * (1 + amount))));

/** a palette from dark to light, so a painter's middle tones come up most and its ends are the specks @param {string[]} palette */
const ordered = (palette) => [...palette].sort((a, b) => luma(a) - luma(b));
/** @param {string[]} palette @param {number} t 0 to 1 */
const pick = (palette, t) => palette[Math.max(0, Math.min(palette.length - 1, Math.floor(t * palette.length)))];
/** @param {(x: number, y: number) => string | null} fn */
const tile = (fn) => Array.from({ length: SIZE * SIZE }, (_, i) => fn(i % SIZE, Math.floor(i / SIZE)));
/** @param {number} x @param {number} y */
const inside = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;

/** a smooth random field over the tile, 0 to 1, with `cells` soft bumps across it @param {() => number} rand */
function field(rand, cells = 4) {
	const n = cells + 1;
	const grid = Array.from({ length: n * n }, rand);
	/** @param {number} i @param {number} j */
	const at = (i, j) => grid[j * n + i];
	/** @param {number} t */
	const ease = (t) => t * t * (3 - 2 * t);
	return (/** @type {number} */ x, /** @type {number} */ y) => {
		const fx = ((x + 0.5) / SIZE) * cells, fy = ((y + 0.5) / SIZE) * cells;
		const i = Math.min(Math.floor(fx), cells - 1), j = Math.min(Math.floor(fy), cells - 1);
		const tx = ease(fx - i), ty = ease(fy - j);
		const top = at(i, j) + (at(i + 1, j) - at(i, j)) * tx;
		const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * tx;
		return top + (bottom - top) * ty;
	};
}

/** @typedef {(string | null)[]} Tile */

/** the painters a recipe names: each gets the seeded random and the recipe's arguments, and returns a tile */
const PAINTERS = {
	/** clumped grain in the palette's colours: soil, stone, wool @param {() => number} rand @param {string[]} palette */
	noise(rand, palette, grain = 0.45) {
		const tones = ordered(palette), f = field(rand);
		return tile((x, y) => pick(tones, (1 - grain) * f(x, y) + grain * rand()));
	},

	/** a rock with clusters of another mineral in it: ores, granite, obsidian @param {() => number} rand @param {string[]} base @param {string[]} flecks */
	speckle(rand, base, flecks, clusters = 6) {
		const pixels = PAINTERS.noise(rand, base);
		const tones = ordered(flecks);
		const blob = [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1], [2, 1], [1, 2]];
		for (let k = 0; k < clusters; k++) {
			const cx = 1 + Math.floor(rand() * 13), cy = 1 + Math.floor(rand() * 13);
			blob.forEach(([dx, dy], i) => {
				if (i > 1 && rand() > 0.55) return;
				const x = cx + dx, y = cy + dy;
				if (!inside(x, y)) return;
				// lit from the top left: the light edge of a fleck up there, its shadow down here
				const at = dx + dy < 1 ? tones.length - 1 : dx + dy > 1 ? 0 : Math.floor(tones.length / 2);
				pixels[y * SIZE + x] = tones[at];
			});
		}
		return pixels;
	},

	/** layers lying one on another, gently bent: sandstone, slate @param {() => number} rand @param {string[]} palette */
	bands(rand, palette, bend = 1) {
		const rows = [];
		while (rows.length < SIZE + 4) {
			const colour = palette[Math.floor(rand() * palette.length)], height = 2 + Math.floor(rand() * 3);
			for (let i = 0; i < height; i++) rows.push(colour);
		}
		const phase = rand() * 6;
		return tile((x, y) => {
			const row = rows[y + 2 + Math.round(Math.sin(x * 0.45 + phase) * bend)];
			return rand() < 0.14 ? shade(row, rand() < 0.5 ? 0.08 : -0.08) : row;
		});
	},

	/** grain running up and down: bark, basalt, dripstone; `marks` are dark dashes across it, a birch's @param {() => number} rand @param {string[]} palette @param {{colour: string, count: number}} [marks] */
	columns(rand, palette, marks) {
		const cols = [];
		while (cols.length < SIZE) {
			const colour = palette[Math.floor(rand() * palette.length)], width = 1 + Math.floor(rand() * 2);
			for (let i = 0; i < width; i++) cols.push(colour);
		}
		const pixels = tile((x) => (rand() < 0.16 ? shade(cols[x], rand() < 0.5 ? 0.1 : -0.12) : cols[x]));
		for (let k = 0; k < (marks?.count ?? 0); k++) {
			const x0 = Math.floor(rand() * 14), y = Math.floor(rand() * SIZE), length = 2 + Math.floor(rand() * 3);
			for (let x = x0; x < Math.min(SIZE, x0 + length); x++) pixels[y * SIZE + x] = /** @type {{colour: string}} */ (marks).colour;
		}
		return pixels;
	},

	/** a log's cut end: growth rings inside a ring of bark @param {() => number} rand @param {string[]} palette @param {string[]} bark */
	rings(rand, palette, bark) {
		const tones = ordered(palette);
		return tile((x, y) => {
			const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
			if (d > 6.5) return bark[Math.floor(rand() * bark.length)];
			// rings one or two pixels wide, light and dark in turn, round a dark pith
			if (d < 1) return tones[0];
			const ring = Math.floor(d / 1.5 + (rand() - 0.5) * 0.35);
			return tones[ring % 2 ? 1 : tones.length - 1];
		});
	},

	/** soil with something growing or lying on its top edge: a grass block's sides @param {() => number} rand @param {string[]} soil @param {string[]} top */
	fringe(rand, soil, top, depth = 3) {
		const below = PAINTERS.noise(rand, soil), above = PAINTERS.noise(rand, top);
		const edge = Array.from({ length: SIZE }, () => depth + (rand() < 0.35 ? 1 : 0) - (rand() < 0.2 ? 1 : 0));
		return tile((x, y) => (y < edge[x] || (y === edge[x] && rand() < 0.25) ? above : below)[y * SIZE + x]);
	},

	/** rounded stones lying together: gravel @param {() => number} rand @param {string[]} palette */
	pebbles(rand, palette) {
		const tones = ordered(palette);
		const pixels = /** @type {Tile} */ (tile(() => tones[0]));
		for (let k = 0; k < 28; k++) {
			const cx = rand() * SIZE, cy = rand() * SIZE, r = 1 + rand() * 1.4;
			const colour = tones[1 + Math.floor(rand() * (tones.length - 1))];
			for (let y = Math.floor(cy - r); y <= cy + r; y++)
				for (let x = Math.floor(cx - r); x <= cx + r; x++) {
					if (!inside(x, y) || Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) continue;
					pixels[y * SIZE + x] = x + 0.5 < cx && y + 0.5 < cy ? shade(colour, 0.15) : colour;
				}
		}
		return pixels;
	},

	/** a crown's leaves with dark gaps between them @param {() => number} rand @param {string[]} palette */
	leaves(rand, palette) {
		const pixels = PAINTERS.noise(rand, palette, 0.7);
		const dark = shade(ordered(palette)[0], -0.35);
		for (let k = 0; k < 14; k++) {
			const x = Math.floor(rand() * SIZE), y = Math.floor(rand() * SIZE);
			pixels[y * SIZE + x] = dark;
			if (x + 1 < SIZE && rand() < 0.5) pixels[y * SIZE + x + 1] = dark;
		}
		return pixels;
	},

	/** a moving surface with broken lines of light on it: water, lava @param {() => number} rand @param {string[]} palette @param {string} light */
	waves(rand, palette, light) {
		const pixels = PAINTERS.noise(rand, palette, 0.25);
		for (let row = 1 + Math.floor(rand() * 3); row < SIZE; row += 4) {
			const phase = rand() * 6;
			for (let x = 0; x < SIZE; x++) {
				if (rand() < 0.25) continue;
				const y = row + Math.round(Math.sin(x * 0.7 + phase) * 0.8);
				if (inside(x, y)) pixels[y * SIZE + x] = light;
			}
		}
		return pixels;
	},

	/** a clear surface with light caught in streaks across it: ice @param {() => number} rand @param {string[]} palette @param {string} light */
	ice(rand, palette, light) {
		const pixels = PAINTERS.noise(rand, palette, 0.3);
		for (let k = 0; k < 4; k++) {
			let x = Math.floor(rand() * SIZE), y = Math.floor(rand() * SIZE);
			for (let step = 3 + Math.floor(rand() * 5); step > 0 && inside(x, y); step--, x++, y--) pixels[y * SIZE + x] = light;
		}
		return pixels;
	},

	/**
	 * ridges running down a fruit or a stem, a groove every `period` pixels: pumpkin, melon, cactus
	 * @param {() => number} rand @param {string[]} palette @param {string} groove
	 * @param {{spines?: {colour: string, count: number}, period?: number}} [options]
	 */
	ribs(rand, palette, groove, { spines, period = 5 } = {}) {
		const pixels = PAINTERS.noise(rand, palette, 0.35);
		for (let y = 0; y < SIZE; y++)
			for (let x = 0; x < SIZE; x++) {
				if (x % period === 0) pixels[y * SIZE + x] = groove;
				else if (x % period === 1) pixels[y * SIZE + x] = shade(/** @type {string} */ (pixels[y * SIZE + x]), -0.1);
			}
		for (let k = 0; k < (spines?.count ?? 0); k++) {
			const x = Math.floor(rand() * SIZE), y = Math.floor(rand() * SIZE);
			if (x % period) pixels[y * SIZE + x] = /** @type {{colour: string}} */ (spines).colour;
		}
		return pixels;
	},

	/** the top of a fruit or a stem: rings round its middle and the stalk in it @param {() => number} rand @param {string[]} palette @param {string} centre */
	crown(rand, palette, centre) {
		const tones = ordered(palette);
		return tile((x, y) => {
			const d = Math.hypot(x - 7.5, y - 7.5);
			if (d < 1.5) return centre;
			const ring = Math.floor(d / 2 + rand() * 0.5);
			return tones[(ring + (rand() < 0.15 ? 1 : 0)) % tones.length];
		});
	},

	/** an item: layers of shapes filled with their colours, lit from the top left and outlined (see SHAPES) @param {() => number} rand @param {...{fill: string[], shapes: any[][]}} layers */
	sprite(rand, ...layers) {
		/** @type {Tile} */
		const pixels = Array(SIZE * SIZE).fill(null);
		for (const { fill, shapes } of layers) {
			const tones = ordered(fill), f = field(rand, 3);
			const hits = shapes.map(([name, ...args]) => /** @type {any} */ (SHAPES)[name](...args));
			for (let y = 0; y < SIZE; y++)
				for (let x = 0; x < SIZE; x++)
					if (hits.some((hit) => hit(x + 0.5, y + 0.5))) pixels[y * SIZE + x] = pick(tones, 0.55 * f(x, y) + 0.45 * rand());
		}
		/** @param {Tile} tile @param {number} x @param {number} y */
		const at = (tile, x, y) => (inside(x, y) ? tile[y * SIZE + x] : null);
		const lit = pixels.map((c, i) => {
			if (!c) return c;
			const x = i % SIZE, y = Math.floor(i / SIZE);
			if (!at(pixels, x - 1, y) || !at(pixels, x, y - 1)) return shade(c, 0.2);
			if (!at(pixels, x + 1, y) || !at(pixels, x, y + 1)) return shade(c, -0.2);
			return c;
		});
		// the outline: every empty pixel next to the item, a dark of the darkest colour beside it
		return lit.map((c, i) => {
			if (c) return c;
			const x = i % SIZE, y = Math.floor(i / SIZE);
			const beside = [at(lit, x - 1, y), at(lit, x + 1, y), at(lit, x, y - 1), at(lit, x, y + 1)].filter((n) => n !== null);
			return beside.length ? shade(ordered(/** @type {string[]} */ (beside))[0], -0.55) : null;
		});
	}
};

/** the shapes an item is drawn with, in pixels from the tile's top left; each tells whether a point is inside it */
export const SHAPES = {
	/** @param {number} cx @param {number} cy @param {number} rx */
	ellipse: (cx, cy, rx, ry = rx) => (/** @type {number} */ x, /** @type {number} */ y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1,
	/** a ring round a centre @param {number} cx @param {number} cy @param {number} r */
	ring: (cx, cy, r, width = 1) => (/** @type {number} */ x, /** @type {number} */ y) => Math.abs(Math.hypot(x - cx, y - cy) - r) <= width / 2,
	/** @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 */
	rect: (x0, y0, x1, y1) => (/** @type {number} */ x, /** @type {number} */ y) => x >= x0 && x <= x1 && y >= y0 && y <= y1,
	/** a stroke from one point to another @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 */
	line: (x0, y0, x1, y1, width = 1.2) => (/** @type {number} */ x, /** @type {number} */ y) => {
		const dx = x1 - x0, dy = y1 - y0;
		const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy || 1)));
		return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)) <= width / 2;
	},
	/** a closed outline through the points x0, y0, x1, y1, ... @param {...number} points */
	poly: (...points) => (/** @type {number} */ x, /** @type {number} */ y) => {
		let hit = false;
		for (let i = 0, j = points.length - 2; i < points.length; j = i, i += 2) {
			const xi = points[i], yi = points[i + 1], xj = points[j], yj = points[j + 1];
			if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
		}
		return hit;
	}
};

/** one tile from its recipe @param {any[]} recipe @param {number} seed @returns {Tile} */
export function paint([painter, ...args], seed) {
	const draw = /** @type {any} */ (PAINTERS)[painter];
	if (!draw) throw new Error(`No painter called ${painter}`);
	return draw(random(seed), ...args);
}

/**
 * A resource's tiles: a block's top and side (`art.all` for both, or `art.top` and `art.side`), an item's one picture.
 * @param {{id: string, form: 'block' | 'item', art: any}} resource
 * @returns {{top: Tile, side: Tile} | {item: Tile}}
 */
export function tilesOf({ id, form, art }) {
	const seed = seedOf(id);
	if (form === 'item') return { item: paint(art, seed) };
	return { top: paint(art.top ?? art.all, seed), side: paint(art.side ?? art.all, seed + 1) };
}
