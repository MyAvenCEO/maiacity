/*
 * THE ISAR'S SURFACES — what its ground is made of, drawn once on canvases and seeded, so a film renders the same
 * pixels every time: July's meadow grass, green and gone to straw, the pale compacted gravel of its paths, the river's
 * rounded limestone pebbles, asphalt, the woods' floor of leaves and earth, and a soft noise that breaks the seams
 * between them. Each tiles at its real size in the ground's shader (./ground.ts).
 */
import * as THREE from 'three';
import { seeded } from '$lib/models/outdoor';

const cache = new Map<string, THREE.Texture>();
function drawn(key: string, size: number, draw: (x: CanvasRenderingContext2D, r: () => number, size: number) => void, srgb = true): THREE.Texture {
	const hit = cache.get(key);
	if (hit) return hit;
	const c = document.createElement('canvas');
	c.width = c.height = size;
	const x = c.getContext('2d')!;
	draw(x, seeded([...key].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 11)), size);
	const t = new THREE.CanvasTexture(c);
	if (srgb) t.colorSpace = THREE.SRGBColorSpace;
	t.wrapS = t.wrapT = THREE.RepeatWrapping;
	t.anisotropy = 8;
	cache.set(key, t);
	return t;
}

/** tiny marks scattered over the whole tile, wrapping at its edges so the tile has no seam */
function scatter(x: CanvasRenderingContext2D, size: number, n: number, mark: (px: number, py: number, i: number) => void) {
	for (let i = 0; i < n; i++) {
		const px = ((i * 0.6180339887) % 1) * size, py = ((i * 0.7548776662) % 1) * size;
		for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) if (px + dx > -40 && px + dx < size + 40 && py + dy > -40 && py + dy < size + 40) mark(px + dx, py + dy, i);
	}
}

/** Grass seen from standing height: blades and their shadows, a few clover leaves and seed heads. */
export const grass = (dry = false) =>
	drawn(dry ? 'grass-dry' : 'grass', 512, (x, r, size) => {
		x.fillStyle = dry ? '#958d52' : '#5b6d2e';
		x.fillRect(0, 0, size, size);
		const tones = dry ? ['#a99f5e', '#857f46', '#bdb173', '#76733f', '#9c9554', '#c8bc80'] : ['#677f36', '#4f6a28', '#7a8f40', '#5a7330', '#879a48', '#6a8236'];
		const jitter = Array.from({ length: 7000 }, () => [r(), r(), r(), r()] as const);
		scatter(x, size, 7000, (px, py, i) => {
			const [a, b, c, d] = jitter[i]!;
			x.strokeStyle = tones[Math.floor(a * tones.length)]!;
			x.globalAlpha = 0.55 + b * 0.45;
			x.lineWidth = 1 + c * 1.6;
			const len = 6 + d * 14, ang = -Math.PI / 2 + (a - 0.5) * 1.4;
			x.beginPath();
			x.moveTo(px, py);
			x.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len);
			x.stroke();
		});
		x.globalAlpha = 1;
		// shade between the blades: the ground showing through
		scatter(x, size, 900, (px, py, i) => {
			x.fillStyle = `rgba(30,32,14,${0.12 + ((i * 37) % 10) / 60})`;
			x.beginPath();
			x.ellipse(px, py, 2 + (i % 5), 1.5 + (i % 3), 0, 0, Math.PI * 2);
			x.fill();
		});
		if (!dry)
			scatter(x, size, 140, (px, py, i) => {
				x.fillStyle = i % 3 ? '#6f9a45' : '#e8e4d0';
				x.beginPath();
				x.arc(px, py, i % 3 ? 2.6 : 1.6, 0, Math.PI * 2);
				x.fill();
			});
	});

/** The paths' compacted gravel: pale dust, small stones pressed into it, a few larger ones. */
export const gravel = () =>
	drawn('gravel', 512, (x, r, size) => {
		x.fillStyle = '#a19a8a';
		x.fillRect(0, 0, size, size);
		const rnd = Array.from({ length: 9000 }, () => [r(), r(), r()] as const);
		scatter(x, size, 9000, (px, py, i) => {
			const [a, b, c] = rnd[i]!;
			const s = 0.8 + a * a * 3.6;
			const v = 100 + Math.floor(b * 105);
			x.fillStyle = `rgb(${v + 12},${v + 6},${v - 6})`;
			x.beginPath();
			x.ellipse(px, py, s, s * (0.6 + c * 0.4), b * 3, 0, Math.PI * 2);
			x.fill();
			if (s > 2.4) {
				x.fillStyle = 'rgba(60,55,45,0.25)';
				x.beginPath();
				x.ellipse(px + s * 0.3, py + s * 0.35, s, s * 0.7, 0, 0, Math.PI * 2);
				x.fill();
			}
		});
	});

/** The river's pebbles: rounded limestone, white, grey and buff, each lit from above, darker in the gaps. */
export const pebbles = () =>
	drawn('pebbles', 1024, (x, r, size) => {
		x.fillStyle = '#6f6a60';
		x.fillRect(0, 0, size, size);
		const tones = [[186, 180, 168], [164, 158, 146], [140, 136, 128], [180, 168, 146], [122, 118, 112], [198, 194, 184], [156, 142, 120]];
		const rnd = Array.from({ length: 5200 }, () => [r(), r(), r(), r()] as const);
		scatter(x, size, 5200, (px, py, i) => {
			const [a, b, c, d] = rnd[i]!;
			const s = 4 + a * a * 22;
			const t = tones[Math.floor(b * tones.length)]!;
			x.save();
			x.translate(px, py);
			x.rotate(c * Math.PI);
			const g = x.createRadialGradient(-s * 0.3, -s * 0.35, s * 0.1, 0, 0, s);
			g.addColorStop(0, `rgb(${Math.min(255, t[0]! + 25)},${Math.min(255, t[1]! + 25)},${Math.min(255, t[2]! + 22)})`);
			g.addColorStop(0.7, `rgb(${t[0]},${t[1]},${t[2]})`);
			g.addColorStop(1, `rgb(${t[0]! - 50},${t[1]! - 50},${t[2]! - 48})`);
			x.fillStyle = g;
			x.beginPath();
			x.ellipse(0, 0, s, s * (0.55 + d * 0.4), 0, 0, Math.PI * 2);
			x.fill();
			x.restore();
		});
	});

/** Asphalt, worn grey. */
export const asphalt = () =>
	drawn('asphalt', 256, (x, r, size) => {
		x.fillStyle = '#5a5a58';
		x.fillRect(0, 0, size, size);
		for (let i = 0; i < 9000; i++) {
			const v = 60 + Math.floor(r() * 70);
			x.fillStyle = `rgba(${v},${v},${v - 2},0.6)`;
			x.fillRect(r() * size, r() * size, 1 + r() * 1.5, 1 + r() * 1.5);
		}
	});

/** The woods' floor: earth, last year's leaves, twigs. */
export const soil = () =>
	drawn('soil', 512, (x, r, size) => {
		x.fillStyle = '#4a3f30';
		x.fillRect(0, 0, size, size);
		const tones = ['#6b5636', '#7a6440', '#5a4a30', '#8a7048', '#3d3426', '#69703a'];
		const rnd = Array.from({ length: 2600 }, () => [r(), r(), r()] as const);
		scatter(x, size, 2600, (px, py, i) => {
			const [a, b, c] = rnd[i]!;
			x.fillStyle = tones[Math.floor(a * tones.length)]!;
			x.save();
			x.translate(px, py);
			x.rotate(b * 6.28);
			x.beginPath();
			x.ellipse(0, 0, 4 + c * 7, 2 + c * 3, 0, 0, Math.PI * 2);
			x.fill();
			x.restore();
		});
	});

/** A soft, tiling noise (four octaves of smoothed random values), in the red channel. */
export const noise = () =>
	drawn(
		'noise',
		256,
		(x, r, size) => {
			const img = x.createImageData(size, size);
			const field = new Float32Array(size * size);
			for (const [cells, amp] of [[4, 0.5], [8, 0.25], [16, 0.15], [32, 0.1]] as const) {
				const g = Array.from({ length: cells * cells }, () => r());
				const at = (i: number, j: number) => g[((j + cells) % cells) * cells + ((i + cells) % cells)]!;
				for (let py = 0; py < size; py++)
					for (let px = 0; px < size; px++) {
						const fx = (px / size) * cells, fy = (py / size) * cells;
						const i = Math.floor(fx), j = Math.floor(fy);
						const tx = fx - i, ty = fy - j;
						const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
						const v = at(i, j) * (1 - sx) * (1 - sy) + at(i + 1, j) * sx * (1 - sy) + at(i, j + 1) * (1 - sx) * sy + at(i + 1, j + 1) * sx * sy;
						field[py * size + px] += v * amp;
					}
			}
			for (let i = 0; i < size * size; i++) {
				const v = Math.round(Math.min(1, field[i]!) * 255);
				img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
				img.data[i * 4 + 3] = 255;
			}
			x.putImageData(img, 0, 0);
		},
		false
	);

/** The Wittelsbacherbrücke's dress: shell-limestone ashlar in courses, its joints, rain's streaks down from the top. */
export const ashlar = () =>
	drawn('ashlar', 1024, (x, r, size) => {
		// 4 m of wall to the tile: courses of 0.4–0.6 m, blocks of 0.8–1.7 m
		const px = size / 4;
		x.fillStyle = '#9d968a';
		x.fillRect(0, 0, size, size);
		let y = 0;
		while (y < size) {
			const ch = Math.min(size - y, (0.4 + r() * 0.2) * px);
			let bx = -r() * px;
			while (bx < size) {
				const bw = (0.8 + r() * 0.9) * px;
				const v = 168 + Math.floor(r() * 34), warm = Math.floor(r() * 10);
				x.fillStyle = `rgb(${v + warm},${v + warm - 4},${v - 10})`;
				x.fillRect(bx + 2, y + 2, bw - 4, ch - 4);
				// the stone's own pores and shells
				for (let k = 0; k < 40; k++) {
					x.fillStyle = `rgba(110,100,85,${0.1 + r() * 0.2})`;
					x.fillRect(bx + r() * bw, y + r() * ch, 1 + r() * 3, 1 + r() * 2);
				}
				bx += bw;
			}
			y += ch;
		}
		// rain's streaks down the face, and the weathering at its foot
		for (let i = 0; i < 70; i++) {
			const sx = r() * size, len = 60 + r() * 400;
			const g = x.createLinearGradient(0, 0, 0, len);
			g.addColorStop(0, `rgba(60,58,50,${0.05 + r() * 0.12})`);
			g.addColorStop(1, 'rgba(60,58,50,0)');
			x.fillStyle = g;
			x.fillRect(sx, r() * size * 0.5, 2 + r() * 10, len);
		}
	});

/** Spray paint on the piers where the path passes under the bridge: tags and pieces in a few loud colours. */
export const graffiti = () =>
	drawn('graffiti', 512, (x, r, size) => {
		x.clearRect(0, 0, size, size);
		const colours = ['#d23b8f', '#2fa4d8', '#f2c230', '#e85a2c', '#5ab552', '#7b4fc9', '#f4f1ea', '#1d1d1d'];
		for (let piece = 0; piece < 7; piece++) {
			const cx = 40 + r() * (size - 80), cy = 60 + r() * (size - 120), sc = 18 + r() * 34;
			const fill = colours[Math.floor(r() * colours.length)]!, line = colours[Math.floor(r() * colours.length)]!;
			x.save();
			x.translate(cx, cy);
			x.rotate((r() - 0.5) * 0.4);
			x.font = `bold ${sc}px sans-serif`;
			x.lineWidth = sc * 0.14;
			x.lineJoin = 'round';
			const word = Array.from({ length: 3 + Math.floor(r() * 3) }, () => 'AEKMORSTVXYZ'[Math.floor(r() * 12)]).join('');
			x.strokeStyle = line;
			x.strokeText(word, -sc, 0);
			x.fillStyle = fill;
			x.fillText(word, -sc, 0);
			x.restore();
		}
		for (let i = 0; i < 30; i++) {
			x.strokeStyle = colours[Math.floor(r() * colours.length)]!;
			x.lineWidth = 2 + r() * 3;
			x.beginPath();
			let px = r() * size, py = r() * size;
			x.moveTo(px, py);
			for (let k = 0; k < 5; k++) x.lineTo((px += (r() - 0.5) * 50), (py += (r() - 0.5) * 30));
			x.stroke();
		}
	});

/** The bridge's road: asphalt with its lanes marked, 12.4 m across (the tile is 12.4 m wide and 6 m long). */
export const road = () =>
	drawn('road', 512, (x, r, size) => {
		x.fillStyle = '#4e4e4c';
		x.fillRect(0, 0, size, size);
		for (let i = 0; i < 12000; i++) {
			const v = 55 + Math.floor(r() * 60);
			x.fillStyle = `rgba(${v},${v},${v},0.5)`;
			x.fillRect(r() * size, r() * size, 1.5, 1.5);
		}
		const m = size / 12.4;
		x.fillStyle = '#e8e6df';
		// the middle line, solid; the lanes' dashes; the cycle lanes' edges
		x.fillRect(6.2 * m - 0.12 * m, 0, 0.24 * m, size);
		for (const c of [3.1, 9.3]) x.fillRect(c * m - 0.06 * m, 0, 0.12 * m, size / 2);
		for (const c of [1.3, 11.1]) x.fillRect(c * m - 0.06 * m, 0, 0.12 * m, size);
	});
