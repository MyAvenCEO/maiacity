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
function canvasTexture(key: string, w: number, h: number, draw: (x: CanvasRenderingContext2D, r: () => number) => void, srgb = true): THREE.CanvasTexture {
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
