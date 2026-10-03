/*
 * THE BACKYARD'S SURFACES — what its ground and its walls are made of, drawn once on canvases and seeded, so a film
 * renders the same pixels every time: the grey concrete pavers laid in a herringbone, the terrace's warm flagstones,
 * the steel tread plate over the cellar's light well, the pale gravel of the garden corner, the beds' bark mulch, the
 * granite setts of the curbs, the coarse render of the houses, their weathered tone, the boundary walls' green streaks,
 * and the roof's tiles. Each tiles at its real size: the metres one repeat covers is its `size`.
 */
import * as THREE from 'three';
import { seeded } from '$lib/models/outdoor';

const cache = new Map<string, THREE.CanvasTexture>();
function drawn(key: string, w: number, h: number, draw: (x: CanvasRenderingContext2D, r: () => number) => void, srgb = true): THREE.CanvasTexture {
	const hit = cache.get(key);
	if (hit) return hit;
	const c = document.createElement('canvas');
	c.width = w;
	c.height = h;
	const x = c.getContext('2d')!;
	draw(x, seeded([...key].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 19)));
	const t = new THREE.CanvasTexture(c);
	if (srgb) t.colorSpace = THREE.SRGBColorSpace;
	t.wrapS = t.wrapT = THREE.RepeatWrapping;
	t.anisotropy = 8;
	cache.set(key, t);
	return t;
}

/** marks scattered over a tile, drawn again across its edges so it has no seam */
function scatter(x: CanvasRenderingContext2D, w: number, h: number, n: number, mark: (px: number, py: number, i: number) => void, reach = 40) {
	for (let i = 0; i < n; i++) {
		const px = ((i * 0.6180339887) % 1) * w, py = ((i * 0.7548776662) % 1) * h;
		for (const dx of [-w, 0, w])
			for (const dy of [-h, 0, h]) if (px + dx > -reach && px + dx < w + reach && py + dy > -reach && py + dy < h + reach) mark(px + dx, py + dy, i);
	}
}

/** a number from a block's place, the same wherever the tile repeats it */
const hash = (a: number, b: number, c = 0) => {
	let h = Math.imul(a * 73856093 ^ b * 19349663 ^ c * 83492791, 0x9e3779b1);
	h ^= h >>> 15;
	return ((h >>> 0) % 10000) / 10000;
};

/** One repeat of each surface, in metres. */
export const SIZE = { pavers: 0.44, flags: 2.4, plate: 0.3, gravel: 0.6, mulch: 1.2, setts: 0.4, render: 0.5, tone: 6, stains: 4, tiles: 1.2 } as const;

/**
 * The courtyard's pavers: grey concrete blocks 22 × 11 cm laid in a herringbone, their edges chamfered, the joints
 * dark with sand and a little moss, each block its own grey — some darker, weathered or stained.
 */
export const pavers = () =>
	drawn('pavers', 512, 512, (x) => {
		const U = 512 / 4; // one block's width (11 cm); a block is two long; the tile four by four
		x.fillStyle = '#4d4a44'; // the joints: sand and dirt
		x.fillRect(0, 0, 512, 512);
		const block = (bx: number, by: number, w: number, h: number) => {
			// its colour from where it lies in the pattern, so a repeated block keeps its tone
			const cx = (((Math.round(bx) % 4) + 4) % 4), cy = (((Math.round(by) % 4) + 4) % 4);
			const v = hash(cx, cy, w), stain = hash(cy, cx, 7 + w);
			const g = 128 + (v - 0.5) * 34 - (stain > 0.86 ? 22 : 0);
			const px = bx * U + 3, py = by * U + 3, pw = w * U - 6, ph = h * U - 6;
			for (const ox of [-512, 0, 512])
				for (const oy of [-512, 0, 512]) {
					const X = px + ox, Y = py + oy;
					if (X > 512 || Y > 512 || X + pw < 0 || Y + ph < 0) continue;
					x.fillStyle = `rgb(${g + 9},${g + 4},${g - 7})`;
					x.beginPath();
					x.roundRect(X, Y, pw, ph, 7);
					x.fill();
					// the chamfer: lit on its upper edges, in shade on its lower
					x.strokeStyle = 'rgba(255,255,250,0.16)';
					x.lineWidth = 3;
					x.beginPath();
					x.moveTo(X + 4, Y + ph - 4);
					x.lineTo(X + 4, Y + 4);
					x.lineTo(X + pw - 4, Y + 4);
					x.stroke();
					x.strokeStyle = 'rgba(20,18,15,0.28)';
					x.beginPath();
					x.moveTo(X + pw - 3, Y + 5);
					x.lineTo(X + pw - 3, Y + ph - 3);
					x.lineTo(X + 5, Y + ph - 3);
					x.stroke();
				}
		};
		// the herringbone: in each chain a block across, then one along, stepping up one block's width each time;
		// the chains side by side two widths apart
		for (let j = -4; j <= 4; j++)
			for (let k = -8; k <= 8; k++) {
				const ox = 2 * j, oy = -2 * j;
				block(k + ox, k + oy, 2, 1);
				block(k + ox, k + 1 + oy, 1, 2);
			}
		// the concrete's grain: fine aggregate over everything, darker flecks of dirt
		const r = seeded(4401);
		scatter(x, 512, 512, 9000, (px, py) => {
			const a = r();
			x.fillStyle = a < 0.5 ? `rgba(255,255,255,${0.05 + a * 0.1})` : `rgba(0,0,0,${0.04 + (a - 0.5) * 0.12})`;
			x.fillRect(px, py, 1 + (a * 7) % 2, 1 + (a * 13) % 2);
		});
		// moss and grit along some joints
		scatter(x, 512, 512, 260, (px, py, i) => {
			x.fillStyle = i % 3 ? 'rgba(70,84,40,0.35)' : 'rgba(30,28,22,0.3)';
			x.beginPath();
			x.ellipse(px, py, 2 + (i % 4), 1.5, (i % 2) * Math.PI / 2, 0, Math.PI * 2);
			x.fill();
		});
	});

/**
 * The terrace's flagstones: warm sandstone and quartzite in rectangles of every size from a hand's breadth to 70 cm,
 * cream, ochre, rose and grey-brown, laid with grey mortar joints a centimetre wide; veins, pores, darker stains.
 */
export const flagstones = () =>
	drawn('flagstones', 1024, 1024, (x, r) => {
		const px = 1024 / 2.4; // pixels a metre
		x.fillStyle = '#9a917f'; // the mortar
		x.fillRect(0, 0, 1024, 1024);
		const tones = ['#d9c39c', '#cfae83', '#dcc0a4', '#cdb79c', '#e3cfa8', '#d3ab92', '#c9a77d', '#bfae96', '#e0c79d', '#d6b38a', '#c4a58c'];
		// split the tile into stones: each rectangle cut across its longer side until it is small enough
		const stones: [number, number, number, number][] = [];
		const cut = (x0: number, y0: number, w: number, h: number) => {
			const big = Math.max(w, h);
			if (big < 0.72 && (big < 0.42 || r() < 0.45)) return void stones.push([x0, y0, w, h]);
			const t = 0.32 + r() * 0.36;
			if (w > h) {
				cut(x0, y0, w * t, h);
				cut(x0 + w * t, y0, w * (1 - t), h);
			} else {
				cut(x0, y0, w, h * t);
				cut(x0, y0 + h * t, w, h * (1 - t));
			}
		};
		cut(0, 0, 2.4, 2.4);
		const J = 5; // half a joint, in pixels
		for (const [sx, sy, w, h] of stones) {
			const X = sx * px + J, Y = sy * px + J, W = w * px - 2 * J, H = h * px - 2 * J;
			const base = tones[Math.floor(r() * tones.length)]!;
			x.save();
			x.beginPath();
			x.roundRect(X, Y, W, H, 4 + r() * 6);
			x.clip();
			x.fillStyle = base;
			x.fillRect(X, Y, W, H);
			// clouds in the stone
			for (let k = 0; k < 6; k++) {
				const gx = X + r() * W, gy = Y + r() * H, gr = 20 + r() * 90;
				const g = x.createRadialGradient(gx, gy, 0, gx, gy, gr);
				const light = r() < 0.5;
				g.addColorStop(0, light ? 'rgba(250,240,220,0.35)' : 'rgba(120,90,60,0.22)');
				g.addColorStop(1, 'rgba(0,0,0,0)');
				x.fillStyle = g;
				x.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
			}
			// veins along the bedding
			x.strokeStyle = 'rgba(140,110,80,0.25)';
			for (let k = 0; k < 3; k++) {
				x.lineWidth = 0.6 + r() * 1.6;
				x.beginPath();
				let vx = X, vy = Y + r() * H;
				x.moveTo(vx, vy);
				while (vx < X + W) {
					vx += 12 + r() * 20;
					vy += (r() - 0.5) * 10;
					x.lineTo(vx, vy);
				}
				x.stroke();
			}
			// pores and grains
			for (let k = 0; k < W * H * 0.004; k++) {
				x.fillStyle = r() < 0.6 ? 'rgba(90,70,50,0.3)' : 'rgba(255,250,235,0.35)';
				x.fillRect(X + r() * W, Y + r() * H, 1 + r() * 2, 1 + r() * 2);
			}
			// worn edges, a little darker where dirt collects
			x.strokeStyle = 'rgba(70,60,45,0.35)';
			x.lineWidth = 3;
			x.strokeRect(X + 1, Y + 1, W - 2, H - 2);
			x.restore();
		}
		// dark stains: rain off the roof's edge, a pot that stood there
		for (let k = 0; k < 14; k++) {
			const gx = r() * 1024, gy = r() * 1024, gr = 25 + r() * 70;
			const g = x.createRadialGradient(gx, gy, 0, gx, gy, gr);
			g.addColorStop(0, 'rgba(60,45,30,0.22)');
			g.addColorStop(1, 'rgba(60,45,30,0)');
			x.fillStyle = g;
			x.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
		}
	});

/** Steel tread plate: raised lozenges in pairs at right angles, worn bright on their tops, grey in between. */
export const treadPlate = () =>
	drawn('tread-plate', 256, 256, (x, r) => {
		x.fillStyle = '#7e7a73';
		x.fillRect(0, 0, 256, 256);
		for (let i = 0; i < 1200; i++) {
			x.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
			x.fillRect(r() * 256, r() * 256, 2 + r() * 6, 1);
		}
		const step = 256 / 6;
		for (let i = 0; i < 6; i++)
			for (let j = 0; j < 6; j++) {
				const cx = (i + 0.5) * step, cy = (j + 0.5) * step, along = (i + j) % 2 === 0;
				x.save();
				x.translate(cx, cy);
				x.rotate(along ? Math.PI / 4 : -Math.PI / 4);
				x.fillStyle = '#58554f';
				x.beginPath();
				x.ellipse(1.5, 2, 15, 4.2, 0, 0, Math.PI * 2);
				x.fill();
				x.fillStyle = '#b7b1a7';
				x.beginPath();
				x.ellipse(0, 0, 14, 3.6, 0, 0, Math.PI * 2);
				x.fill();
				x.restore();
			}
		for (let k = 0; k < 6; k++) {
			const gx = r() * 256, gy = r() * 256, gr = 30 + r() * 60;
			const g = x.createRadialGradient(gx, gy, 0, gx, gy, gr);
			g.addColorStop(0, 'rgba(90,60,40,0.18)'); // a little rust
			g.addColorStop(1, 'rgba(90,60,40,0)');
			x.fillStyle = g;
			x.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
		}
	});

/** The garden's gravel: pale crushed limestone, a few millimetres to two centimetres, beige, white and grey. */
export const gravel = () =>
	drawn('gravel-pale', 512, 512, (x, r) => {
		x.fillStyle = '#9d927f';
		x.fillRect(0, 0, 512, 512);
		const rnd = Array.from({ length: 16000 }, () => [r(), r(), r(), r()] as const);
		scatter(x, 512, 512, 16000, (px, py, i) => {
			const [a, b, c, d] = rnd[i]!;
			const s = 1.2 + a * a * 4.5;
			const v = 128 + Math.floor(b * 92);
			const warm = c < 0.6 ? 8 : -4;
			x.fillStyle = `rgb(${v + warm},${v + warm / 2},${v - 10})`;
			x.beginPath();
			x.ellipse(px, py, s, s * (0.55 + d * 0.4), c * 6, 0, Math.PI * 2);
			x.fill();
			// each stone's shadow on the stones below it
			x.fillStyle = 'rgba(60,52,40,0.28)';
			x.beginPath();
			x.ellipse(px + s * 0.35, py + s * 0.45, s * 0.8, s * 0.3, c * 6, 0, Math.PI * 2);
			x.fill();
		});
	});

/** Bark mulch on the beds: chips of pine bark, red-brown to near black, on dark soil. */
export const mulch = () =>
	drawn('mulch', 512, 512, (x, r) => {
		x.fillStyle = '#2e2119';
		x.fillRect(0, 0, 512, 512);
		const tones = ['#5b3a24', '#6d4529', '#3e2a1c', '#7a5133', '#4a3020', '#8a6040', '#33241a'];
		const rnd = Array.from({ length: 5000 }, () => [r(), r(), r(), r()] as const);
		scatter(x, 512, 512, 5000, (px, py, i) => {
			const [a, b, c, d] = rnd[i]!;
			x.save();
			x.translate(px, py);
			x.rotate(a * Math.PI);
			x.fillStyle = tones[Math.floor(b * tones.length)]!;
			const w = 3 + c * 9, h = 2 + d * 4;
			x.fillRect(-w / 2, -h / 2, w, h);
			x.fillStyle = 'rgba(0,0,0,0.3)';
			x.fillRect(-w / 2, h / 2 - 1, w, 1.5);
			x.restore();
		});
		// fallen leaves, a few
		scatter(x, 512, 512, 30, (px, py, i) => {
			x.fillStyle = i % 2 ? 'rgba(150,120,50,0.8)' : 'rgba(110,90,40,0.8)';
			x.beginPath();
			x.ellipse(px, py, 6, 3, i, 0, Math.PI * 2);
			x.fill();
		});
	});

/** Granite setts, 10 cm, as a row along a bed's edge: pale grey, black and white grains, a split face each. */
export const setts = () =>
	drawn('setts', 512, 128, (x, r) => {
		x.fillStyle = '#6f6d69';
		x.fillRect(0, 0, 512, 128);
		for (let i = 0; i < 4; i++) {
			const X = i * 128 + 4 + r() * 4, Y = 4 + r() * 4, W = 116 + r() * 4, H = 116 + r() * 4;
			const v = 168 + r() * 30;
			x.fillStyle = `rgb(${v},${v - 2},${v - 6})`;
			x.beginPath();
			x.roundRect(X, Y, W, H, 10);
			x.fill();
			for (let k = 0; k < 900; k++) {
				const a = r();
				x.fillStyle = a < 0.45 ? 'rgba(30,30,32,0.55)' : a < 0.8 ? 'rgba(255,255,255,0.5)' : 'rgba(150,120,110,0.4)';
				x.fillRect(X + r() * W, Y + r() * H, 1 + r() * 2.5, 1 + r() * 2.5);
			}
		}
	});

/**
 * The houses' coarse render (Rauputz), as a bump map: grains of sand thrown on and floated, small craters between
 * them. Half a metre a repeat.
 */
export const roughcast = () =>
	drawn(
		'roughcast',
		512,
		512,
		(x, r) => {
			x.fillStyle = '#7a7a7a';
			x.fillRect(0, 0, 512, 512);
			const rnd = Array.from({ length: 14000 }, () => [r(), r(), r()] as const);
			scatter(
				x,
				512,
				512,
				14000,
				(px, py, i) => {
					const [a, b, c] = rnd[i]!;
					const s = 1.2 + a * a * 4.2;
					const v = b < 0.62 ? 150 + Math.floor(c * 80) : 40 + Math.floor(c * 40);
					x.fillStyle = `rgb(${v},${v},${v})`;
					x.beginPath();
					x.ellipse(px, py, s, s * (0.6 + c * 0.4), b * 3, 0, Math.PI * 2);
					x.fill();
				},
				10
			);
		},
		false
	);

/**
 * A house's tone over a whole wall: the render faded unevenly by sun and rain, darker streaks run down from the sills
 * and the eaves. Near white — it shades the wall's own colour. Six metres a repeat.
 */
export const weathered = () =>
	drawn('weathered', 512, 512, (x, r) => {
		x.fillStyle = '#f2f2f2';
		x.fillRect(0, 0, 512, 512);
		scatter(x, 512, 512, 60, (px, py, i) => {
			const gr = 30 + ((i * 37) % 90);
			const g = x.createRadialGradient(px, py, 0, px, py, gr);
			const light = i % 2 === 0;
			g.addColorStop(0, light ? 'rgba(255,255,255,0.14)' : 'rgba(150,140,130,0.04)');
			g.addColorStop(1, 'rgba(0,0,0,0)');
			x.fillStyle = g;
			x.fillRect(px - gr, py - gr, gr * 2, gr * 2);
		}, 130);
		for (let k = 0; k < 40; k++) {
			const sx = r() * 512, sy = r() * 512, len = 40 + r() * 160;
			const g = x.createLinearGradient(sx, sy, sx, sy + len);
			g.addColorStop(0, 'rgba(110,100,90,0.07)');
			g.addColorStop(1, 'rgba(110,100,90,0)');
			x.fillStyle = g;
			x.fillRect(sx, sy, 2 + r() * 8, len);
		}
	});

/**
 * The boundary walls' render: pale cream, streaked green-grey with algae from the coping down, darker near the ground
 * where the rain splashes. Four metres a repeat along the wall; its height is the wall's (3 m).
 */
export const stainedWall = () =>
	drawn('stained-wall', 512, 384, (x, r) => {
		x.fillStyle = '#f0ece2';
		x.fillRect(0, 0, 512, 384);
		// algae and soot washed down from the coping in soft, uneven runs, and patches of green on the render
		for (let k = 0; k < 34; k++) {
			const sx = r() * 512, len = 20 + r() * 160, w = 14 + r() * 60;
			const g = x.createLinearGradient(0, 0, 0, len);
			const green = r() < 0.7;
			g.addColorStop(0, green ? `rgba(105,118,82,${0.1 + r() * 0.16})` : `rgba(90,90,82,${0.08 + r() * 0.1})`);
			g.addColorStop(1, 'rgba(105,118,82,0)');
			x.fillStyle = g;
			for (const ox of [-512, 0, 512]) {
				x.beginPath();
				x.ellipse(sx + ox, 0, w / 2, len, 0, 0, Math.PI);
				x.fill();
			}
		}
		for (let k = 0; k < 14; k++) {
			const gx = r() * 512, gy = r() * 300, gr = 20 + r() * 60;
			const g = x.createRadialGradient(gx, gy, 0, gx, gy, gr);
			g.addColorStop(0, 'rgba(110,125,85,0.12)');
			g.addColorStop(1, 'rgba(110,125,85,0)');
			x.fillStyle = g;
			for (const ox of [-512, 0, 512]) x.fillRect(gx + ox - gr, gy - gr, gr * 2, gr * 2);
		}
		const foot = x.createLinearGradient(0, 330, 0, 384);
		foot.addColorStop(0, 'rgba(90,80,65,0)');
		foot.addColorStop(1, 'rgba(90,80,65,0.35)');
		x.fillStyle = foot;
		x.fillRect(0, 330, 512, 54);
	});

/** Roof tiles, concrete pantiles gone grey-brown, in courses 33 cm across and 30 cm up, lichen here and there. */
export const roofTiles = () =>
	drawn('roof-tiles', 512, 512, (x, r) => {
		x.fillStyle = '#3e3633';
		x.fillRect(0, 0, 512, 512);
		const cw = 512 / 3.6, ch = 512 / 4;
		for (let row = 0; row < 4; row++)
			for (let col = -1; col < 5; col++) {
				const X = col * cw + (row % 2 ? cw / 2 : 0), Y = row * ch;
				const v = 92 + r() * 24;
				const g = x.createLinearGradient(X, 0, X + cw, 0);
				g.addColorStop(0, `rgb(${v - 18},${v - 24},${v - 26})`);
				g.addColorStop(0.5, `rgb(${v + 6},${v},${v - 4})`);
				g.addColorStop(1, `rgb(${v - 22},${v - 28},${v - 30})`);
				x.fillStyle = g;
				x.fillRect(X + 1, Y + 1, cw - 2, ch - 6);
				x.fillStyle = 'rgba(0,0,0,0.45)';
				x.fillRect(X, Y + ch - 6, cw, 6);
				if (r() < 0.3) {
					x.fillStyle = 'rgba(160,170,120,0.35)';
					x.beginPath();
					x.ellipse(X + r() * cw, Y + r() * ch, 6 + r() * 10, 4 + r() * 6, 0, 0, Math.PI * 2);
					x.fill();
				}
			}
	});

/** The polycarbonate's grime: almost clear, dust and dark streaks gathered along the purlins it rests on. */
export const grime = () =>
	drawn('grime', 256, 256, (x, r) => {
		x.fillStyle = '#ffffff';
		x.fillRect(0, 0, 256, 256);
		for (let k = 0; k < 400; k++) {
			x.fillStyle = `rgba(70,70,60,${r() * 0.25})`;
			x.fillRect(r() * 256, 118 + (r() - 0.5) * 22, 2 + r() * 10, 1 + r() * 3);
		}
		for (let k = 0; k < 160; k++) {
			x.fillStyle = `rgba(90,90,80,${r() * 0.15})`;
			x.beginPath();
			x.arc(r() * 256, r() * 256, 1 + r() * 3, 0, Math.PI * 2);
			x.fill();
		}
	});

/**
 * The neighbours' houses seen over the walls: one bay of a facade, 3 m wide and one storey (3 m) high — render round a
 * window 1.2 × 1.5 m with a white frame and a sill, its glass dark with the sky's sheen in it. Near white: it shades
 * the wall's own colour.
 */
export const windowBays = () =>
	drawn('window-bays', 256, 256, (x, r) => {
		x.fillStyle = '#f4f4f4';
		x.fillRect(0, 0, 256, 256);
		for (let i = 0; i < 300; i++) {
			x.fillStyle = `rgba(120,115,105,${r() * 0.06})`;
			x.fillRect(r() * 256, r() * 256, 6 + r() * 20, 2 + r() * 6);
		}
		const px = 256 / 3, X = 128 - 0.6 * px, W = 1.2 * px, Y = 256 - 2.4 * px, H = 1.5 * px;
		x.fillStyle = '#d9d7d0';
		x.fillRect(X - 6, Y - 6, W + 12, H + 12);
		const g = x.createLinearGradient(X, Y, X + W, Y + H);
		g.addColorStop(0, '#5d6d7a');
		g.addColorStop(0.45, '#2f3a44');
		g.addColorStop(1, '#4a5865');
		x.fillStyle = g;
		x.fillRect(X, Y, W, H);
		x.fillStyle = '#f7f7f4';
		x.fillRect(X, Y, W, 5);
		x.fillRect(X, Y + H - 5, W, 5);
		x.fillRect(X, Y, 5, H);
		x.fillRect(X + W - 5, Y, 5, H);
		x.fillRect(X + W / 2 - 3, Y, 6, H);
		x.fillRect(X, Y + H * 0.28, W, 5);
		x.fillStyle = '#b9b7b0';
		x.fillRect(X - 10, Y + H + 6, W + 20, 7);
		x.fillStyle = 'rgba(0,0,0,0.12)';
		x.fillRect(X - 10, Y + H + 13, W + 20, 10);
	});

/** An oval enamel plaque by the gate: cream, a brown border and a flourish of acanthus — its words worn past reading. */
export const plaque = () =>
	drawn('plaque', 256, 160, (x, r) => {
		x.fillStyle = '#efe5cf';
		x.fillRect(0, 0, 256, 160);
		x.strokeStyle = '#6b4a2e';
		x.lineWidth = 6;
		x.beginPath();
		x.ellipse(128, 80, 118, 72, 0, 0, Math.PI * 2);
		x.stroke();
		x.lineWidth = 3;
		x.beginPath();
		x.moveTo(60, 70);
		x.bezierCurveTo(80, 30, 110, 40, 100, 60);
		x.bezierCurveTo(95, 75, 75, 65, 85, 55);
		x.stroke();
		x.fillStyle = 'rgba(80,60,45,0.55)';
		for (const y of [78, 96, 110]) for (let i = 0; i < 14; i++) x.fillRect(108 + i * 7 + r() * 2, y, 4 + r() * 3, 3);
	});

/** The sails' cloth: a close canvas weave, sand-coloured, a seam down its middle, faint water marks. One sail across. */
export const sailcloth = () =>
	drawn('sailcloth', 256, 256, (x, r) => {
		x.fillStyle = '#f3ede2';
		x.fillRect(0, 0, 256, 256);
		for (let i = 0; i < 256; i += 2) {
			x.fillStyle = `rgba(150,130,100,${0.05 + r() * 0.05})`;
			x.fillRect(i, 0, 1, 256);
			x.fillRect(0, i, 256, 1);
		}
		x.fillStyle = 'rgba(120,100,70,0.35)';
		x.fillRect(126, 0, 4, 256);
		for (let k = 0; k < 8; k++) {
			const gx = r() * 256, gy = r() * 256, gr = 15 + r() * 45;
			const g = x.createRadialGradient(gx, gy, 0, gx, gy, gr);
			g.addColorStop(0, 'rgba(120,100,70,0.07)');
			g.addColorStop(1, 'rgba(120,100,70,0)');
			x.fillStyle = g;
			x.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
		}
	});

/**
 * A window's glass with the room behind it, for the house's windows: dark, the sky's sheen across it, and white sheer
 * curtains drawn part way from either side, their folds catching the light. One window across.
 */
export const curtainedGlass = () =>
	drawn('curtained-glass', 128, 256, (x, r) => {
		const g = x.createLinearGradient(0, 0, 128, 256);
		g.addColorStop(0, '#4b5660');
		g.addColorStop(0.5, '#262d33');
		g.addColorStop(1, '#3a434b');
		x.fillStyle = g;
		x.fillRect(0, 0, 128, 256);
		const w = 30 + r() * 14;
		for (const side of [0, 1]) {
			for (let i = 0; i < w; i += 3) {
				const v = 190 + Math.round(40 * Math.sin(i * 0.9));
				x.fillStyle = `rgba(${v},${v},${v - 6},0.82)`;
				x.fillRect(side ? 128 - i - 3 : i, 0, 3, 256);
			}
		}
		x.fillStyle = 'rgba(255,255,255,0.08)';
		x.beginPath();
		x.moveTo(0, 60);
		x.lineTo(128, 0);
		x.lineTo(128, 40);
		x.lineTo(0, 100);
		x.fill();
	});

/** Fallen leaves, four to a sheet (2 × 2), cut out: a yellow lilac leaf, a brown one curled dry, an orange maple's, a
 *  willow's narrow yellow one. */
export const fallenLeaves = () =>
	drawn('fallen-leaves', 256, 256, (x) => {
		x.clearRect(0, 0, 256, 256);
		const leaf = (cx: number, cy: number, l: number, w: number, a: number, fill: string, vein: string) => {
			x.save();
			x.translate(cx, cy);
			x.rotate(a);
			x.fillStyle = fill;
			x.beginPath();
			x.moveTo(0, -l);
			x.quadraticCurveTo(w, -l * 0.2, 0, l);
			x.quadraticCurveTo(-w, -l * 0.2, 0, -l);
			x.fill();
			x.strokeStyle = vein;
			x.lineWidth = 2;
			x.beginPath();
			x.moveTo(0, -l);
			x.lineTo(0, l + 8);
			x.stroke();
			x.restore();
		};
		leaf(64, 64, 50, 52, 0.3, '#d6b13c', '#a4862a');
		leaf(192, 64, 46, 40, -0.5, '#7a5530', '#55391e');
		leaf(64, 192, 48, 56, 1.1, '#c8682a', '#8a4218');
		leaf(192, 192, 56, 14, 0.7, '#cfc04e', '#9a8d30');
	});
