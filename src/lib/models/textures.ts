/*
 * The models' surfaces, drawn once on a canvas and shared: limed oak floorboards, pine for the crates, plaster for the
 * walls, sheepskin, and the picture on the wall. Each is seeded, so it is the same every time (a film renders the
 * same pixels on every machine).
 */
import * as THREE from 'three';

function rng(seed: number) {
	let s = seed >>> 0 || 1;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const cache = new Map<string, THREE.Texture>();
export function canvasTexture(key: string, w: number, h: number, draw: (x: CanvasRenderingContext2D, r: () => number) => void, srgb = true): THREE.CanvasTexture {
	const hit = cache.get(key);
	if (hit) return hit as THREE.CanvasTexture;
	const c = document.createElement('canvas');
	c.width = w;
	c.height = h;
	draw(c.getContext('2d')!, rng([...key].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7)));
	const t = new THREE.CanvasTexture(c);
	if (srgb) t.colorSpace = THREE.SRGBColorSpace;
	t.wrapS = t.wrapT = THREE.RepeatWrapping;
	t.anisotropy = 8;
	cache.set(key, t);
	return t;
}

/** One wood board's grain: long wavy lines in a darker tone, a knot now and then. */
function grain(x: CanvasRenderingContext2D, r: () => number, x0: number, y0: number, w: number, h: number, dark: string, lines: number, knots = true) {
	x.save();
	x.beginPath();
	x.rect(x0, y0, w, h);
	x.clip();
	x.strokeStyle = dark;
	for (let i = 0; i < lines; i++) {
		const gx = x0 + r() * w, amp = 1 + r() * 4, freq = 0.004 + r() * 0.01, ph = r() * 6;
		x.globalAlpha = 0.12 + r() * 0.25;
		x.lineWidth = 0.6 + r() * 1.6;
		x.beginPath();
		for (let yy = y0; yy <= y0 + h; yy += 8) {
			const px = gx + Math.sin(yy * freq + ph) * amp;
			if (yy === y0) x.moveTo(px, yy);
			else x.lineTo(px, yy);
		}
		x.stroke();
	}
	if (knots && r() < 0.35) {
		const kx = x0 + w * (0.2 + r() * 0.6), ky = y0 + r() * h;
		x.globalAlpha = 0.45;
		x.fillStyle = dark;
		x.beginPath();
		x.ellipse(kx, ky, 3 + r() * 4, 6 + r() * 8, 0, 0, Math.PI * 2);
		x.fill();
	}
	x.restore();
	x.globalAlpha = 1;
}

/**
 * Limed oak floorboards: wide boards (18 cm) of light oak, white worked into the grain, the joints staggered and a
 * little darker. The canvas is six boards across (1.08 m) and 2.4 m along them: repeat it at (width / 1.08, length / 2.4).
 */
export function limedOak(): THREE.CanvasTexture {
	return canvasTexture('limed-oak', 1020, 2268, (x, r) => {
		const bw = 170, H = 2268;
		for (let b = 0; b < 6; b++) {
			// each board in its own pieces, the joints staggered from board to board
			let y = -r() * 900;
			while (y < H) {
				const len = 1100 + r() * 900;
				const tone = 200 + r() * 22;
				x.fillStyle = `rgb(${tone + 14},${tone - 4},${tone - 34})`;
				x.fillRect(b * bw, y, bw, len);
				grain(x, r, b * bw, y, bw, len, '#9c7a52', 26);
				// limed: white in the open grain
				x.fillStyle = 'rgba(246,240,229,0.18)';
				x.fillRect(b * bw, y, bw, len);
				for (let i = 0; i < 260; i++) {
					x.fillStyle = `rgba(250,246,238,${0.2 + r() * 0.35})`;
					x.fillRect(b * bw + r() * bw, y + r() * len, 1 + r() * 2, 4 + r() * 18);
				}
				// the end joint
				x.fillStyle = 'rgba(110,86,58,0.55)';
				x.fillRect(b * bw, y + len - 2, bw, 2);
				y += len;
			}
			// the long joint between boards
			x.fillStyle = 'rgba(105,82,56,0.6)';
			x.fillRect(b * bw + bw - 2, 0, 2, H);
		}
	});
}

/** Pine for the wine crates: pale, warm, a strong grain; `aged` darker and browner. */
export function pine(aged = false): THREE.CanvasTexture {
	return canvasTexture(aged ? 'pine-aged' : 'pine', 512, 512, (x, r) => {
		x.fillStyle = aged ? '#b5844f' : '#d8b07a';
		x.fillRect(0, 0, 512, 512);
		// the grain runs across the canvas (u): the boards are laid lengthways in u
		x.save();
		x.translate(512, 0);
		x.rotate(Math.PI / 2);
		grain(x, r, 0, 0, 512, 512, aged ? '#7d5530' : '#a97c45', 40);
		x.restore();
	});
}

/** A crate painted white: the paint thin, the grain still showing through. */
export function paintedPine(): THREE.CanvasTexture {
	return canvasTexture('painted-pine', 512, 512, (x, r) => {
		x.fillStyle = '#eeeae2';
		x.fillRect(0, 0, 512, 512);
		x.save();
		x.translate(512, 0);
		x.rotate(Math.PI / 2);
		grain(x, r, 0, 0, 512, 512, '#c9bfae', 30, false);
		x.restore();
	});
}

/** Plaster, painted: almost flat, a faint unevenness (as a bump map). */
export function plasterBump(): THREE.CanvasTexture {
	return canvasTexture(
		'plaster',
		256,
		256,
		(x, r) => {
			x.fillStyle = '#808080';
			x.fillRect(0, 0, 256, 256);
			for (let i = 0; i < 4000; i++) {
				const v = 110 + r() * 40;
				x.fillStyle = `rgba(${v},${v},${v},0.25)`;
				x.fillRect(r() * 256, r() * 256, 1 + r() * 3, 1 + r() * 3);
			}
		},
		false
	);
}

/** Sheepskin: creamy white wool in curls. */
export function wool(): THREE.CanvasTexture {
	return canvasTexture('wool', 512, 512, (x, r) => {
		x.fillStyle = '#efe9de';
		x.fillRect(0, 0, 512, 512);
		for (let i = 0; i < 2600; i++) {
			const v = 228 + r() * 27;
			x.strokeStyle = `rgba(${v},${v - 4},${v - 14},0.8)`;
			x.lineWidth = 1 + r() * 2;
			x.beginPath();
			const cx = r() * 512, cy = r() * 512, rad = 3 + r() * 6;
			x.arc(cx, cy, rad, r() * 6, r() * 6 + 3);
			x.stroke();
		}
	});
}

/**
 * The picture on the wall: a painted face on white — round, red and orange, eyes closed, dark lips, a cap of yellow
 * hair, small earrings.
 */
export function faceArt(): THREE.CanvasTexture {
	return canvasTexture('face-art', 600, 780, (x, r) => {
		x.fillStyle = '#f3efe6';
		x.fillRect(0, 0, 600, 780);
		const cx = 300, cy = 400;
		// the face: red to orange, brushed
		const face = x.createRadialGradient(cx, cy + 20, 30, cx, cy, 210);
		face.addColorStop(0, '#d9532c');
		face.addColorStop(0.6, '#c43d25');
		face.addColorStop(1, '#a52c1f');
		x.fillStyle = face;
		x.beginPath();
		x.ellipse(cx, cy + 10, 175, 215, 0, 0, Math.PI * 2);
		x.fill();
		// the ears
		for (const s of [-1, 1]) {
			x.beginPath();
			x.ellipse(cx + s * 178, cy + 30, 34, 58, 0, 0, Math.PI * 2);
			x.fill();
			x.strokeStyle = '#e8b13a';
			x.lineWidth = 4;
			x.beginPath();
			x.arc(cx + s * 182, cy + 105, 12, 0, Math.PI * 2);
			x.stroke();
		}
		// brush marks over it
		for (let i = 0; i < 500; i++) {
			const a = r() * Math.PI * 2, d = r() * 200;
			x.strokeStyle = `rgba(${200 + r() * 55},${60 + r() * 60},${20 + r() * 30},0.25)`;
			x.lineWidth = 2 + r() * 5;
			x.beginPath();
			const px = cx + Math.cos(a) * d * 0.85, py = cy + 10 + Math.sin(a) * d;
			x.moveTo(px, py);
			x.lineTo(px + (r() - 0.5) * 30, py + (r() - 0.5) * 20);
			x.stroke();
		}
		// the hair: a cap of yellow and orange
		x.fillStyle = '#e9a52f';
		x.beginPath();
		x.ellipse(cx, cy - 150, 165, 95, 0, Math.PI, Math.PI * 2);
		x.fill();
		for (let i = 0; i < 300; i++) {
			x.fillStyle = `rgba(${235 + r() * 20},${170 + r() * 50},${40 + r() * 30},0.6)`;
			x.fillRect(cx - 160 + r() * 320, cy - 250 + r() * 100, 3, 3);
		}
		// eyes closed: dark lids
		for (const s of [-1, 1]) {
			x.fillStyle = '#4a1d16';
			x.beginPath();
			x.ellipse(cx + s * 72, cy - 10, 48, 22, s * 0.08, 0, Math.PI * 2);
			x.fill();
			x.strokeStyle = '#2a0f0b';
			x.lineWidth = 4;
			x.beginPath();
			x.arc(cx + s * 72, cy - 18, 46, 0.25, Math.PI - 0.25);
			x.stroke();
		}
		// the nose and the lips
		x.strokeStyle = '#7a2417';
		x.lineWidth = 5;
		x.beginPath();
		x.moveTo(cx - 12, cy + 30);
		x.quadraticCurveTo(cx, cy + 95, cx + 20, cy + 88);
		x.stroke();
		x.fillStyle = '#3a1410';
		x.beginPath();
		x.ellipse(cx, cy + 150, 42, 22, 0, 0, Math.PI * 2);
		x.fill();
	});
}

/** Old red bricks in their mortar, for the kitchen's back wall: 24 × 7 cm bricks, the courses offset by half. The
 *  canvas is 0.96 m across and 0.64 m high: repeat it at (width / 0.96, height / 0.64). */
export function brick(): THREE.CanvasTexture {
	return canvasTexture('brick', 960, 640, (x, r) => {
		x.fillStyle = '#c9b8a2'; // the mortar
		x.fillRect(0, 0, 960, 640);
		const bw = 240, bh = 70, joint = 10;
		for (let row = 0; row < 640 / (bh + joint); row++) {
			const off = row % 2 ? bw / 2 : 0;
			for (let col = -1; col < 960 / bw + 1; col++) {
				const x0 = col * bw + off, y0 = row * (bh + joint);
				const t = 0.75 + r() * 0.35;
				x.fillStyle = `rgb(${Math.round(176 * t)},${Math.round(84 * t)},${Math.round(56 * t)})`;
				x.fillRect(x0 + joint / 2, y0 + joint / 2, bw - joint, bh);
				for (let i = 0; i < 60; i++) {
					x.fillStyle = `rgba(${60 + r() * 60},${30 + r() * 30},${20 + r() * 20},${r() * 0.35})`;
					x.fillRect(x0 + joint / 2 + r() * (bw - joint), y0 + joint / 2 + r() * bh, 2 + r() * 6, 2 + r() * 4);
				}
			}
		}
	});
}

/** Large pale stone tiles (60 × 120 cm) with thin grout, for the bathroom. The canvas is 1.2 m square: repeat it at
 *  (width / 1.2, height / 1.2). */
export function stoneTiles(): THREE.CanvasTexture {
	return canvasTexture('stone-tiles', 600, 600, (x, r) => {
		x.fillStyle = '#d9cdb9';
		x.fillRect(0, 0, 600, 600);
		for (let i = 0; i < 2500; i++) {
			const v = 200 + r() * 30;
			x.fillStyle = `rgba(${v},${v - 10},${v - 26},0.25)`;
			x.fillRect(r() * 600, r() * 600, 1 + r() * 4, 1 + r() * 4);
		}
		x.fillStyle = 'rgba(150,138,118,0.7)';
		for (const p of [0, 300]) x.fillRect(p, 0, 2, 600); // the joints: tiles 60 wide, 120 high
		x.fillRect(0, 0, 600, 2);
	});
}

/** The hallway's chalkboard: the wall by Samuel's door, painted with blackboard paint, the quote he wrote on it in
 *  chalk. Not a board: the wall itself (src/lib/worlds/apartment.ts). */
export function chalkboard(): THREE.CanvasTexture {
	return canvasTexture('chalkboard', 450, 1000, (x, r) => {
		x.fillStyle = '#1f201e';
		x.fillRect(0, 0, 450, 1000);
		for (let i = 0; i < 900; i++) {
			x.fillStyle = `rgba(255,255,255,${r() * 0.05})`; // old chalk, wiped
			x.fillRect(r() * 450, r() * 1000, 10 + r() * 60, 2 + r() * 10);
		}
		const lines = ['SUCCESS IS NO', 'ACCIDENT. IT IS', 'HARD WORK,', 'PERSEVERANCE,', 'LEARNING,', 'STUDYING AND', 'MOST OF ALL', 'LOVE OF WHAT', 'YOU ARE', 'DOING'];
		x.fillStyle = 'rgba(236,234,226,0.86)';
		x.font = '600 38px "Marker Felt", "Comic Sans MS", cursive';
		lines.forEach((t, i) => {
			x.save();
			x.translate(40 + (i % 3) * 14, 120 + i * 62);
			x.rotate(-0.08 + r() * 0.04);
			x.fillText(t, 0, 0);
			x.restore();
		});
	});
}

/** A canvas print for the hallway: a meadow under a big evening sky, soft and painterly — a picture, no one in it. */
export function canvasMeadow(): THREE.CanvasTexture {
	return canvasTexture('canvas-meadow', 600, 400, (x, r) => {
		const sky = x.createLinearGradient(0, 0, 0, 260);
		sky.addColorStop(0, '#9fb7cf');
		sky.addColorStop(1, '#e9d9bf');
		x.fillStyle = sky;
		x.fillRect(0, 0, 600, 400);
		for (let i = 0; i < 40; i++) {
			x.fillStyle = `rgba(255,255,255,${0.15 + r() * 0.25})`;
			x.beginPath();
			x.ellipse(r() * 600, 40 + r() * 140, 30 + r() * 70, 8 + r() * 14, 0, 0, Math.PI * 2);
			x.fill();
		}
		const field = x.createLinearGradient(0, 240, 0, 400);
		field.addColorStop(0, '#8f9a5a');
		field.addColorStop(1, '#5d6b38');
		x.fillStyle = field;
		x.fillRect(0, 240, 600, 160);
		for (let i = 0; i < 1500; i++) {
			x.fillStyle = `rgba(${90 + r() * 80},${100 + r() * 60},${40 + r() * 30},0.5)`;
			x.fillRect(r() * 600, 240 + r() * 160, 1 + r() * 2, 2 + r() * 6);
		}
	});
}

/* ── the backyard's surfaces (./terrace.ts, ./yard.ts) ──────────────────────────────────────────────────────────── */

/** Teak garden furniture: oiled, warm red-brown with a dark grain; or weathered to silver-grey, the grain open and
 *  checked. The grain runs along u. */
export function teak(weathered = false): THREE.CanvasTexture {
	return canvasTexture(weathered ? 'teak-grey' : 'teak', 512, 512, (x, r) => {
		x.fillStyle = weathered ? '#9e978b' : '#9b5a33';
		x.fillRect(0, 0, 512, 512);
		x.save();
		x.translate(512, 0);
		x.rotate(Math.PI / 2);
		grain(x, r, 0, 0, 512, 512, weathered ? '#5f594f' : '#5e3018', 46, false);
		x.restore();
		for (let i = 0; i < 700; i++) {
			x.fillStyle = weathered ? `rgba(230,226,215,${r() * 0.25})` : `rgba(190,120,70,${r() * 0.18})`;
			x.fillRect(r() * 512, r() * 512, 10 + r() * 50, 1 + r() * 2);
		}
		if (weathered)
			for (let i = 0; i < 60; i++) {
				x.fillStyle = 'rgba(40,36,30,0.45)'; // the checks the weather opened in it
				x.fillRect(r() * 512, r() * 512, 15 + r() * 40, 1);
			}
	});
}

/** Cognac leather, years old: worn lighter on the seat and the arms' tops, creased, a fine crackle in the finish. */
export function leather(): THREE.CanvasTexture {
	return canvasTexture('leather-cognac', 512, 512, (x, r) => {
		x.fillStyle = '#a25c2e';
		x.fillRect(0, 0, 512, 512);
		for (let i = 0; i < 40; i++) {
			const gx = r() * 512, gy = r() * 512, gr = 20 + r() * 90;
			const g = x.createRadialGradient(gx, gy, 0, gx, gy, gr);
			const light = r() < 0.55;
			g.addColorStop(0, light ? 'rgba(222,160,105,0.45)' : 'rgba(90,45,20,0.35)');
			g.addColorStop(1, 'rgba(0,0,0,0)');
			x.fillStyle = g;
			x.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
		}
		// the crackle: short broken lines in a net
		x.lineWidth = 0.8;
		for (let i = 0; i < 900; i++) {
			x.strokeStyle = r() < 0.7 ? 'rgba(70,35,15,0.28)' : 'rgba(240,190,140,0.25)';
			x.beginPath();
			let px = r() * 512, py = r() * 512;
			x.moveTo(px, py);
			for (let k = 0; k < 3; k++) {
				px += (r() - 0.5) * 24;
				py += (r() - 0.5) * 24;
				x.lineTo(px, py);
			}
			x.stroke();
		}
		// creases, longer and softer
		for (let i = 0; i < 26; i++) {
			x.strokeStyle = 'rgba(60,28,10,0.25)';
			x.lineWidth = 1.5 + r() * 2;
			x.beginPath();
			const px = r() * 512, py = r() * 512, a = r() * Math.PI;
			x.moveTo(px, py);
			x.quadraticCurveTo(px + Math.cos(a) * 30 + (r() - 0.5) * 20, py + Math.sin(a) * 30, px + Math.cos(a) * 70, py + Math.sin(a) * 70);
			x.stroke();
		}
	});
}

/** A paper lantern's paper: white, the wire ribs showing as fine lines round it, soft creases between. */
export function lanternPaper(): THREE.CanvasTexture {
	return canvasTexture('lantern-paper', 256, 256, (x, r) => {
		x.fillStyle = '#f8f6f0';
		x.fillRect(0, 0, 256, 256);
		for (let i = 0; i < 16; i++) {
			x.fillStyle = 'rgba(160,150,130,0.35)';
			x.fillRect(0, i * 16, 256, 2);
			x.fillStyle = 'rgba(255,255,255,0.6)';
			x.fillRect(0, i * 16 + 2, 256, 2);
		}
		for (let i = 0; i < 120; i++) {
			x.fillStyle = `rgba(200,192,175,${r() * 0.25})`;
			x.fillRect(r() * 256, r() * 256, 1, 6 + r() * 14);
		}
	});
}

/** A clipped hedge's face: small dark leaves packed close, lighter new shoots, gaps of shade between. */
export function hedgeLeaves(): THREE.CanvasTexture {
	return canvasTexture('hedge-leaves', 512, 512, (x, r) => {
		x.fillStyle = '#1f3216';
		x.fillRect(0, 0, 512, 512);
		const greens = ['#2f4a20', '#3b5a27', '#46672c', '#557a34', '#2a4119', '#64873c', '#729447'];
		for (let i = 0; i < 9000; i++) {
			const px = r() * 512, py = r() * 512, a = r() * Math.PI;
			x.fillStyle = greens[Math.floor(r() * greens.length)]!;
			x.beginPath();
			x.ellipse(px, py, 3 + r() * 3.5, 1.6 + r() * 1.6, a, 0, Math.PI * 2);
			x.fill();
		}
		for (let i = 0; i < 400; i++) {
			x.fillStyle = 'rgba(160,190,90,0.6)'; // the season's shoots
			x.fillRect(r() * 512, r() * 512, 2, 2);
		}
	});
}

/** Salt-glazed stoneware: grey, orange-peel speckled, a cobalt flower painted on its belly. u round it, v up it. */
export function stoneware(): THREE.CanvasTexture {
	return canvasTexture('stoneware', 512, 256, (x, r) => {
		x.fillStyle = '#a3a6a8';
		x.fillRect(0, 0, 512, 256);
		for (let i = 0; i < 6000; i++) {
			x.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(60,62,66,0.18)';
			x.fillRect(r() * 512, r() * 256, 1.5, 1.5);
		}
		x.strokeStyle = '#2a4aa3';
		x.fillStyle = '#2a4aa3';
		x.lineCap = 'round';
		// a stem, leaves, a flower, swirls — painted fast with a brush
		x.lineWidth = 7;
		x.beginPath();
		x.moveTo(130, 220);
		x.bezierCurveTo(150, 170, 120, 130, 160, 80);
		x.stroke();
		for (const [cx, cy, a] of [[140, 170, -0.6], [150, 130, 0.7], [128, 110, -0.9]] as const) {
			x.save();
			x.translate(cx, cy);
			x.rotate(a);
			x.beginPath();
			x.ellipse(18, 0, 22, 8, 0, 0, Math.PI * 2);
			x.fill();
			x.restore();
		}
		for (let k = 0; k < 6; k++) {
			x.save();
			x.translate(165, 70);
			x.rotate((k / 6) * Math.PI * 2);
			x.beginPath();
			x.ellipse(16, 0, 15, 7, 0, 0, Math.PI * 2);
			x.fill();
			x.restore();
		}
		x.lineWidth = 4;
		for (const sx of [60, 260, 330]) {
			x.beginPath();
			x.arc(sx, 120, 18, 0.3, 5.2);
			x.stroke();
		}
		x.fillStyle = 'rgba(42,74,163,0.9)';
		x.fillRect(0, 18, 512, 5); // a band under the rim
		x.fillRect(0, 236, 512, 4);
	});
}

/** A station clock's face: white, black bars for the hours, finer ones for the minutes, its hands at ten past ten. */
export function clockFace(): THREE.CanvasTexture {
	return canvasTexture('clock-face', 256, 256, (x) => {
		x.fillStyle = '#f7f7f3';
		x.fillRect(0, 0, 256, 256);
		x.translate(128, 128);
		x.fillStyle = '#151515';
		for (let i = 0; i < 60; i++) {
			x.save();
			x.rotate((i / 60) * Math.PI * 2);
			if (i % 5 === 0) x.fillRect(-4, -118, 8, 30);
			else x.fillRect(-1.5, -118, 3, 10);
			x.restore();
		}
		const hand = (turn: number, len: number, w: number) => {
			x.save();
			x.rotate(turn * Math.PI * 2);
			x.fillRect(-w / 2, -len, w, len + 18);
			x.restore();
		};
		hand(10 / 12 + 10 / 720, 72, 11);
		hand(10 / 60, 104, 8);
		x.fillStyle = '#b3201c';
		x.save();
		x.rotate((34 / 60) * Math.PI * 2);
		x.fillRect(-1.5, -100, 3, 120);
		x.beginPath();
		x.arc(0, -78, 9, 0, Math.PI * 2);
		x.fill();
		x.restore();
	});
}

/** An insect hotel's face: bamboo canes and drilled holes packed in a disc of dark wood. */
export function insectFace(): THREE.CanvasTexture {
	return canvasTexture('insect-face', 256, 256, (x, r) => {
		x.fillStyle = '#4a3220';
		x.fillRect(0, 0, 256, 256);
		for (let i = 0; i < 230; i++) {
			const px = r() * 256, py = r() * 256, rad = 5 + r() * 8;
			x.fillStyle = r() < 0.6 ? '#c9a46a' : '#8e6a3e';
			x.beginPath();
			x.arc(px, py, rad, 0, Math.PI * 2);
			x.fill();
			x.fillStyle = '#1b120b';
			x.beginPath();
			x.arc(px, py, rad * 0.55, 0, Math.PI * 2);
			x.fill();
		}
	});
}

/** A toy bee's body: yellow plush in black bands. */
export function beeStripes(): THREE.CanvasTexture {
	return canvasTexture('bee-stripes', 64, 256, (x) => {
		x.fillStyle = '#f4c21a';
		x.fillRect(0, 0, 64, 256);
		x.fillStyle = '#1c1a17';
		for (const y of [60, 120, 180]) x.fillRect(0, y, 64, 30);
	});
}

/** A planter's ribbed face, as a bump map: shallow horizontal grooves every 2.5 cm. */
export function ribs(): THREE.CanvasTexture {
	return canvasTexture(
		'ribs',
		16,
		64,
		(x) => {
			x.fillStyle = '#b0b0b0';
			x.fillRect(0, 0, 16, 64);
			for (const y of [0, 16, 32, 48]) {
				x.fillStyle = '#3a3a3a';
				x.fillRect(0, y, 16, 4);
				x.fillStyle = '#d8d8d8';
				x.fillRect(0, y + 4, 16, 3);
			}
		},
		false
	);
}

/** A monstera's leaf, cut out (alpha): a heart of deep glossy green, slit from its edge towards the midrib and holed
 *  along it, its veins lighter. Its stalk joins at the bottom middle, its tip at the top. */
export function monsteraLeaf(): THREE.CanvasTexture {
	const t = canvasTexture('monstera-leaf', 256, 256, (x, r) => {
		x.clearRect(0, 0, 256, 256);
		const g = x.createLinearGradient(0, 0, 256, 256);
		g.addColorStop(0, '#3f7a33');
		g.addColorStop(1, '#22501f');
		x.fillStyle = g;
		x.beginPath();
		x.moveTo(128, 236);
		x.bezierCurveTo(30, 250, 0, 120, 40, 60);
		x.bezierCurveTo(70, 18, 110, 12, 128, 20);
		x.bezierCurveTo(146, 12, 186, 18, 216, 60);
		x.bezierCurveTo(256, 120, 226, 250, 128, 236);
		x.fill();
		x.strokeStyle = '#7fae5a';
		x.lineWidth = 3;
		x.beginPath();
		x.moveTo(128, 236);
		x.lineTo(128, 24);
		x.stroke();
		x.lineWidth = 1.2;
		for (let i = 0; i < 7; i++) {
			const y = 200 - i * 26;
			for (const s of [-1, 1]) {
				x.beginPath();
				x.moveTo(128, y);
				x.quadraticCurveTo(128 + s * 50, y - 12, 128 + s * 110, y - 30);
				x.stroke();
			}
		}
		// the slits from the edge in, and the holes by the midrib
		x.globalCompositeOperation = 'destination-out';
		x.lineCap = 'round';
		for (let i = 0; i < 5; i++) {
			const y = 190 - i * 32 + r() * 6;
			for (const s of [-1, 1]) {
				x.lineWidth = 7 + r() * 4;
				x.beginPath();
				x.moveTo(128 + s * 140, y - 40);
				x.lineTo(128 + s * (34 + r() * 16), y - 6);
				x.stroke();
				if (i > 0 && i < 4) {
					x.beginPath();
					x.ellipse(128 + s * 22, y + 4, 4, 9, s * 0.4, 0, Math.PI * 2);
					x.fill();
				}
			}
		}
		x.globalCompositeOperation = 'source-over';
	});
	t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
	return t;
}
