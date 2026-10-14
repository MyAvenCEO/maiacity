// @ts-nocheck — plain JS, kept loose on purpose
/*
 * PLANTING A TREE — what a newcomer to MaiaCity V1 carries to plant their first tree, and what they leave in the
 * ground: a hiker's backpack (open, its lid thrown back) with a 1 l water bottle and five seed packets in it, the
 * packets one for each of V1's seeds (game/maiacity-v1/engine.js SEEDLINGS), two wooden marker sticks, a plant stake
 * with a little flag naming the tree, and a patch of dug earth that darkens when it is watered. Each to its real
 * measure (./units.js), standing on the ground at its origin, its front towards +z.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { part, soft, std, v3 } from './parts';
import { canvasTexture } from './textures';
import { CM, MM } from './units.js';

const m = {
	pack: std('#b4532a', 0.85),
	packDark: std('#2f3338', 0.8),
	nylon: std('#4a4f55', 0.7),
	mesh: std('#69717b', 0.9),
	lining: std('#1d1f22', 0.95),
	buckle: std('#161616', 0.5),
	cord: std('#d8d2c4', 0.8),
	clothes: std('#5f7590', 0.95),
	bottle: std('#6f8f7a', 0.45, { metalness: 0.35 }),
	bottleBand: std('#e7e2d6', 0.6),
	cap: std('#202224', 0.5),
	mouth: std('#0c0c0c', 0.9),
	steel: std('#c4c8cb', 0.3, { metalness: 0.9 }),
	kraft: std('#c9a878', 0.9),
	wood: std('#c8a46a', 0.75),
	endGrain: std('#e2c99b', 0.8),
	paint: std('#e2672a', 0.6)
};

/* ── the seed packets ──────────────────────────────────────────────────────────────────────────────────────── */

/** V1's seeds (engine SEEDLINGS ids): what each packet says and its colours */
export const SEED_PACKETS = {
	apple: { label: 'Apple', latin: 'Malus domestica', band: '#b8322a', ground: '#f3ead6' },
	pear: { label: 'Pear', latin: 'Pyrus communis', band: '#8a9a2c', ground: '#f2eedb' },
	cherry: { label: 'Sweet cherry', latin: 'Prunus avium', band: '#8e1730', ground: '#f6e9e2' },
	hazel: { label: 'Hazel', latin: 'Corylus avellana', band: '#7a5530', ground: '#efe6d4' },
	blackcurrant: { label: 'Blackcurrant', latin: 'Ribes nigrum', band: '#3d2a55', ground: '#ece8ef' }
};
/** a packet's size: 7 × 10 cm, a few seeds thick */
export const PACKET = { w: 7 * CM, h: 10 * CM, d: 4 * MM };

/** a leaf on its stalk, its tip at angle a (radians, 0 = right, up is −) @param {CanvasRenderingContext2D} x */
function leaf(x, cx, cy, len, a, colour = '#4f7d32') {
	x.save();
	x.translate(cx, cy);
	x.rotate(a);
	const g = x.createLinearGradient(0, -len * 0.25, 0, len * 0.25);
	g.addColorStop(0, '#6c9a45');
	g.addColorStop(1, colour);
	x.fillStyle = g;
	x.beginPath();
	x.moveTo(0, 0);
	x.quadraticCurveTo(len * 0.5, -len * 0.32, len, 0);
	x.quadraticCurveTo(len * 0.5, len * 0.32, 0, 0);
	x.fill();
	x.strokeStyle = 'rgba(30,50,20,0.55)';
	x.lineWidth = 1.5;
	x.beginPath();
	x.moveTo(0, 0);
	x.lineTo(len * 0.92, 0);
	x.stroke();
	x.restore();
}
/** a round fruit with its light from the top left @param {CanvasRenderingContext2D} x */
function ball(x, cx, cy, r, light, dark, shine = 0.55) {
	const g = x.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
	g.addColorStop(0, light);
	g.addColorStop(1, dark);
	x.fillStyle = g;
	x.beginPath();
	x.arc(cx, cy, r, 0, Math.PI * 2);
	x.fill();
	x.fillStyle = `rgba(255,255,255,${shine})`;
	x.beginPath();
	x.ellipse(cx - r * 0.38, cy - r * 0.42, r * 0.2, r * 0.12, -0.6, 0, Math.PI * 2);
	x.fill();
}
const stalk = (x, x0, y0, x1, y1, cxp, cyp, w = 4) => {
	x.strokeStyle = '#5a3d22';
	x.lineWidth = w;
	x.lineCap = 'round';
	x.beginPath();
	x.moveTo(x0, y0);
	x.quadraticCurveTo(cxp, cyp, x1, y1);
	x.stroke();
};

/** each seed's fruit, drawn in a 220 × 200 box at (0, 0) @type {Record<string, (x: CanvasRenderingContext2D) => void>} */
const FRUIT = {
	apple(x) {
		leaf(x, 112, 46, 64, -0.5);
		ball(x, 82, 118, 56, '#f06a4f', '#9e1f1a');
		ball(x, 148, 128, 48, '#f3c75a', '#b8482a', 0.4);
		stalk(x, 84, 64, 92, 40, 82, 50);
		stalk(x, 148, 82, 156, 60, 150, 70);
	},
	pear(x) {
		const pear = (cx, cy, s, light, dark) => {
			const g = x.createRadialGradient(cx - 14 * s, cy - 6 * s, 6 * s, cx, cy + 10 * s, 62 * s);
			g.addColorStop(0, light);
			g.addColorStop(1, dark);
			x.fillStyle = g;
			x.beginPath();
			x.moveTo(cx, cy - 58 * s);
			x.bezierCurveTo(cx + 20 * s, cy - 58 * s, cx + 18 * s, cy - 20 * s, cx + 40 * s, cy + 12 * s);
			x.bezierCurveTo(cx + 62 * s, cy + 48 * s, cx + 30 * s, cy + 70 * s, cx, cy + 70 * s);
			x.bezierCurveTo(cx - 30 * s, cy + 70 * s, cx - 62 * s, cy + 48 * s, cx - 40 * s, cy + 12 * s);
			x.bezierCurveTo(cx - 18 * s, cy - 20 * s, cx - 20 * s, cy - 58 * s, cx, cy - 58 * s);
			x.fill();
			stalk(x, cx, cy - 56 * s, cx + 8 * s, cy - 78 * s, cx - 2 * s, cy - 70 * s);
		};
		leaf(x, 126, 40, 60, -0.3);
		pear(146, 112, 0.92, '#e6e07a', '#8f9a2a');
		pear(82, 104, 1.05, '#f0e58a', '#a49b30');
	},
	cherry(x) {
		leaf(x, 112, 30, 70, -0.15);
		stalk(x, 112, 34, 70, 132, 76, 60, 3.5);
		stalk(x, 112, 34, 150, 140, 140, 70, 3.5);
		ball(x, 70, 150, 34, '#e5455a', '#6a0a1c');
		ball(x, 150, 158, 34, '#de3a52', '#5e0818');
	},
	hazel(x) {
		const nut = (cx, cy, a) => {
			x.save();
			x.translate(cx, cy);
			x.rotate(a);
			// the husk's frilled leaves round its top
			x.fillStyle = '#7f9a48';
			x.beginPath();
			for (let i = 0; i <= 10; i++) {
				const t = Math.PI * (1.05 + (0.9 * i) / 10), r = i % 2 ? 50 : 36;
				x.lineTo(Math.cos(t) * r, -18 + Math.sin(t) * r * 0.8);
			}
			x.closePath();
			x.fill();
			const g = x.createRadialGradient(-12, 6, 4, 0, 14, 42);
			g.addColorStop(0, '#c58a52');
			g.addColorStop(1, '#6b3f1d');
			x.fillStyle = g;
			x.beginPath();
			x.ellipse(0, 18, 34, 38, 0, 0, Math.PI * 2);
			x.fill();
			x.fillStyle = 'rgba(240,215,170,0.8)';
			x.beginPath();
			x.ellipse(0, -10, 22, 10, 0, 0, Math.PI * 2);
			x.fill();
			x.restore();
		};
		leaf(x, 118, 40, 70, -0.4, '#55803a');
		nut(76, 110, -0.25);
		nut(150, 124, 0.3);
	},
	blackcurrant(x) {
		leaf(x, 70, 36, 70, -1.0, '#4f7d32');
		stalk(x, 104, 28, 124, 176, 136, 90, 3);
		const berries = [[96, 74, 17], [126, 86, 19], [104, 106, 20], [134, 120, 19], [110, 142, 19], [140, 156, 17], [116, 176, 15]];
		for (const [cx, cy, r] of berries) ball(x, cx, cy, r, '#5b4a78', '#120c1c', 0.5);
	}
};

/** the packet's printed front: its band, the fruit in a frame, its name and its Latin name */
function packetFace(id) {
	const s = SEED_PACKETS[id];
	return canvasTexture(`seed-packet:${id}`, 280, 400, (x) => {
		x.fillStyle = s.ground;
		x.fillRect(0, 0, 280, 400);
		// the band across the top, its fold and the word "seeds"
		x.fillStyle = s.band;
		x.fillRect(0, 0, 280, 54);
		x.fillStyle = 'rgba(0,0,0,0.18)';
		x.fillRect(0, 50, 280, 4);
		x.fillStyle = '#fbf7ee';
		x.font = 'bold 26px Georgia, serif';
		x.textAlign = 'center';
		x.fillText('SEEDS', 140, 36);
		// the picture in its frame
		x.fillStyle = '#fffdf6';
		x.fillRect(22, 70, 236, 214);
		x.strokeStyle = s.band;
		x.lineWidth = 4;
		x.strokeRect(22, 70, 236, 214);
		x.save();
		x.translate(30, 78);
		FRUIT[id](x);
		x.restore();
		// the name, its Latin name, and a line on how many
		x.fillStyle = '#2a2218';
		x.font = `bold ${s.label.length > 9 ? 30 : 38}px Georgia, serif`;
		x.fillText(s.label, 140, 330);
		x.font = 'italic 19px Georgia, serif';
		x.fillStyle = '#5a4c3a';
		x.fillText(s.latin, 140, 358);
		x.fillStyle = s.band;
		x.fillRect(60, 374, 160, 2);
		x.font = '15px Georgia, serif';
		x.fillStyle = '#6a5c48';
		x.fillText('about 10 seeds', 140, 394);
	});
}

/** A seed packet: 7 × 10 cm, a paper envelope with a few seeds in it, its fruit printed on the front (+z) with its
 *  name; standing on its bottom edge. `id`: one of V1's seeds (SEED_PACKETS). */
export function seedPacket(id = 'apple') {
	const g = new THREE.Group();
	g.name = `seed-packet:${id}`;
	const front = new THREE.MeshStandardMaterial({ map: packetFace(id), roughness: 0.85 });
	const paper = m.kraft();
	// a little fuller in the middle where the seeds lie: soft edges, and the folded flap across the top of the back
	const body = new THREE.Mesh(new RoundedBoxGeometry(PACKET.w, PACKET.h, PACKET.d, 2, 0.0012), [paper, paper, paper, paper, front, paper]);
	body.position.y = PACKET.h / 2;
	body.castShadow = body.receiveShadow = true;
	g.add(body);
	part(g, PACKET.w * 0.98, 0.022, 0.0008, paper, 0, PACKET.h - 0.013, -PACKET.d / 2 - 0.0004);
	g.userData = { seed: id };
	return g;
}

/* ── the water bottle ──────────────────────────────────────────────────────────────────────────────────────── */

/** the bottle's measures: 1 l, 7.7 cm across, its mouth 26.8 cm up (where water pours from), the cap to 30 cm */
export const BOTTLE = { r: 0.0385, mouth: 0.268, top: 0.3 };

/** A 1 l refillable water bottle: powder-coated steel, a pale band round it, a screw cap with a carry loop. Standing
 *  on its base; `userData.mouth` is where it pours from (its open neck, at the top), `userData.cap` the cap to take
 *  off before pouring. */
export function waterBottle() {
	const g = new THREE.Group();
	g.name = 'water-bottle';
	const prof = [[0, 0], [0.033, 0], [0.0378, 0.004], [0.0385, 0.012], [0.0385, 0.2], [0.035, 0.224], [0.025, 0.243], [0.018, 0.252], [0.017, BOTTLE.mouth], [0.0135, BOTTLE.mouth], [0.0135, 0.25]].map(([r, y]) => new THREE.Vector2(r, y));
	const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 36), m.bottle());
	body.castShadow = body.receiveShadow = true;
	g.add(body);
	// the band round its middle; the open neck's dark inside
	const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0388, 0.0388, 0.06, 36, 1, true), m.bottleBand());
	band.position.y = 0.11;
	g.add(band);
	const hole = new THREE.Mesh(new THREE.CircleGeometry(0.0135, 20).rotateX(-Math.PI / 2), m.mouth());
	hole.position.y = 0.251;
	g.add(hole);
	// the cap: screwed over the neck, a loop to carry it by
	const cap = new THREE.Group();
	cap.name = 'cap';
	const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.0205, 0.021, 0.026, 28), m.cap());
	lid.position.y = 0.012;
	const loop = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0035, 8, 20, Math.PI), m.cap());
	loop.position.y = 0.025;
	cap.add(lid, loop);
	cap.position.y = 0.257;
	cap.traverse((o) => o.isMesh && (o.castShadow = true));
	g.add(cap);
	g.userData = { mouth: new THREE.Vector3(0, BOTTLE.mouth, 0), cap };
	return g;
}

/* ── the backpack ──────────────────────────────────────────────────────────────────────────────────────────── */

/** the pack's measures: about 35 l, 32 cm across, 22 cm deep, its opening's rim 46 cm up */
export const PACK = { w: 0.32, d: 0.22, rim: 0.48, top: 0.42, floor: 0.3 };

/** an open shell of fabric: a rounded rectangle w × d (corners `r`), walls `t` thick, from y0 up to y1, shaped by
 *  `shape(y)` → [how much narrower across, how much fuller front to back] */
function shell(w, d, y0, y1, t, r, mat, shape) {
	const rounded = (W, D, R) => {
		const s = new THREE.Shape();
		s.moveTo(-W / 2 + R, -D / 2);
		s.lineTo(W / 2 - R, -D / 2);
		s.quadraticCurveTo(W / 2, -D / 2, W / 2, -D / 2 + R);
		s.lineTo(W / 2, D / 2 - R);
		s.quadraticCurveTo(W / 2, D / 2, W / 2 - R, D / 2);
		s.lineTo(-W / 2 + R, D / 2);
		s.quadraticCurveTo(-W / 2, D / 2, -W / 2, D / 2 - R);
		s.lineTo(-W / 2, -D / 2 + R);
		s.quadraticCurveTo(-W / 2, -D / 2, -W / 2 + R, -D / 2);
		return s;
	};
	const outer = rounded(w, d, r);
	outer.holes.push(rounded(w - 2 * t, d - 2 * t, Math.max(0.005, r - t)));
	const geo = new THREE.ExtrudeGeometry(outer, { depth: y1 - y0, bevelEnabled: false, curveSegments: 6, steps: 8 });
	geo.rotateX(-Math.PI / 2); // the extrusion up y, the shape's y onto −z
	const pos = geo.attributes.position;
	for (let i = 0; i < pos.count; i++) {
		const y = pos.getY(i) + y0, [kx, kz] = shape(y);
		pos.setXYZ(i, pos.getX(i) * kx, y, pos.getZ(i) * kz);
	}
	geo.computeVertexNormals();
	const mesh = new THREE.Mesh(geo, mat);
	mesh.castShadow = mesh.receiveShadow = true;
	return mesh;
}

/** a flat strap along a smooth curve through `pts` (a shoulder strap, a hip belt's wing): `w` wide across x, `t` thick,
 *  padded (rounded in section) */
function strap(g, pts, w, t, mat) {
	const curve = new THREE.CatmullRomCurve3(pts);
	const N = 28, sides = 10, P = [], idx = [];
	const across = new THREE.Vector3(1, 0, 0);
	for (let i = 0; i <= N; i++) {
		const u = i / N, c = curve.getPointAt(u), tan = curve.getTangentAt(u);
		const side = across.clone().addScaledVector(tan, -across.dot(tan)).normalize(), up = new THREE.Vector3().crossVectors(tan, side);
		const taper = 0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, u * 1.4)); // narrower at its ends
		for (let k = 0; k < sides; k++) {
			const a = (k / sides) * Math.PI * 2;
			const p = c.clone().addScaledVector(side, (Math.cos(a) * w * taper) / 2).addScaledVector(up, (Math.sin(a) * t) / 2);
			P.push(p.x, p.y, p.z);
		}
		if (i) for (let k = 0; k < sides; k++) {
			const a = (i - 1) * sides + k, b = (i - 1) * sides + ((k + 1) % sides), c2 = i * sides + k, d = i * sides + ((k + 1) % sides);
			idx.push(a, c2, b, b, c2, d);
		}
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
	geo.setIndex(idx);
	geo.computeVertexNormals();
	const mesh = new THREE.Mesh(geo, mat);
	mesh.castShadow = true;
	g.add(mesh);
	return mesh;
}

/** A hiker's backpack, about 35 l: a rust-red body, 32 × 22 cm and 46 cm to its rim, a drawstring collar, a lid
 *  pocket on top hinged at the back; a front pocket, mesh bottle pockets and compression straps on the sides; on the
 *  back (−z) a padded panel, two curved shoulder straps with a sternum strap, and a hip belt. Its front (+z) is the
 *  pocket's side. `open` (0 … 1) throws the lid back over the shoulder straps; open, it holds a 1 l water bottle and
 *  the five seed packets (userData.bottle, userData.packets by seed) standing on the clothes inside.
 *  `userData.setOpen(k)` opens or closes it (the things inside show only while it is open). */
export function backpack({ open = 1 } = {}) {
	const g = new THREE.Group();
	g.name = 'backpack';
	const { w, d, rim, top, floor } = PACK;
	// the body: one fabric shell, open at the top, a little narrower up there and fuller front and back at its middle;
	// the nylon collar on it, cinched in at its drawcord; a darker base under it
	soft(g, w + 0.004, 0.06, d + 0.004, 0.03, m.packDark(), 0, 0.03, 0);
	g.add(shell(w, d, 0.04, top, 0.014, 0.06, m.pack(), (y) => [1 - 0.06 * (y / top), 1 + 0.1 * Math.sin((Math.PI * y) / top)]));
	g.add(shell(w - 0.02, d - 0.02, top - 0.012, rim, 0.006, 0.05, m.nylon(), (y) => [1 - 0.08 * ((y - top) / (rim - top)), 1 - 0.1 * ((y - top) / (rim - top))]));
	part(g, w - 0.04, 0.002, d - 0.04, m.lining(), 0, floor + 0.001, 0); // the dark inside
	const cw = w / 2 - 0.016, cd = d / 2 - 0.016, rr = 0.03;
	const loop = [];
	for (const [cx, cz, a0] of [[cw - rr, cd - rr, 0], [-cw + rr, cd - rr, Math.PI / 2], [-cw + rr, -cd + rr, Math.PI], [cw - rr, -cd + rr, (3 * Math.PI) / 2]])
		for (let i = 0; i <= 4; i++) {
			const a = a0 + (i / 4) * (Math.PI / 2);
			loop.push(v3(cx + rr * Math.cos(a), rim - 0.012, cz + rr * Math.sin(a)));
		}
	const cord = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(loop, true), 64, 0.003, 6, true), m.cord());
	g.add(cord);
	part(g, 0.014, 0.026, 0.012, m.buckle(), 0.03, rim - 0.03, d / 2 + 0.002); // the cord lock
	// the front: a pocket with its zip, a loop for an ice axe at its foot
	const front = (d / 2) * (1 + 0.1 * Math.sin((Math.PI * 0.17) / top));
	soft(g, 0.24, 0.2, 0.04, 0.015, m.pack(), 0, 0.17, front + 0.006);
	part(g, 0.2, 0.004, 0.004, m.packDark(), 0, 0.265, front + 0.026);
	part(g, 0.03, 0.04, 0.012, m.packDark(), 0, 0.04, d / 2 + 0.004);
	// the sides: a mesh pocket low down, two compression straps with their buckles
	for (const sx of [-1, 1]) {
		soft(g, 0.035, 0.13, d * 0.8, 0.012, m.mesh(), sx * (w / 2 + 0.012), 0.1, 0);
		for (const y of [0.2, floor + 0.08]) {
			part(g, 0.006, 0.022, d - 0.02, m.packDark(), sx * (w / 2 + 0.003), y, 0);
			part(g, 0.01, 0.03, 0.03, m.buckle(), sx * (w / 2 + 0.008), y, d / 2 - 0.04);
		}
	}
	// the back: a padded panel, the shoulder straps curving off it with a sternum strap, the hip belt, a grab loop
	soft(g, w - 0.04, 0.38, 0.03, 0.012, m.packDark(), 0, 0.24, -d / 2 - 0.012);
	for (const sx of [-1, 1]) {
		// a shoulder strap: off the top of the back, out over a shoulder's curve, down to its buckle near the foot
		strap(g, [v3(sx * 0.05, top - 0.02, -d / 2 - 0.03), v3(sx * 0.07, top - 0.1, -d / 2 - 0.085), v3(sx * 0.1, 0.22, -d / 2 - 0.08), v3(sx * 0.12, 0.1, -d / 2 - 0.045)], 0.06, 0.018, m.packDark());
		// a wing of the hip belt, curving round to the front
		strap(g, [v3(sx * 0.1, 0.07, -d / 2 - 0.03), v3(sx * 0.18, 0.068, -d / 2 - 0.04), v3(sx * 0.22, 0.065, -d / 2 - 0.1)], 0.09, 0.02, m.packDark());
	}
	part(g, 0.13, 0.015, 0.006, m.buckle(), 0, top - 0.12, -d / 2 - 0.094); // the sternum strap
	const grab = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.005, 6, 14, Math.PI), m.packDark());
	grab.position.set(0, rim - 0.03, -d / 2 - 0.006);
	g.add(grab);
	// the lid: a pocket on top, hinged on the back of the rim; its two straps' buckles hang off its front
	const flap = new THREE.Group();
	flap.name = 'lid';
	flap.position.set(0, rim, -d / 2);
	soft(flap, w + 0.01, 0.06, d + 0.03, 0.025, m.pack(), 0, 0.028, (d + 0.03) / 2 - 0.005);
	part(flap, w * 0.7, 0.004, 0.004, m.packDark(), 0, 0.058, d * 0.55); // its zip
	g.add(flap);
	// what is in it: the clothes, the bottle, the seed packets in a row along the front wall
	const inside = new THREE.Group();
	inside.name = 'inside';
	soft(inside, w - 0.05, 0.11, d - 0.05, 0.04, m.clothes(), 0, floor + 0.055, 0);
	const bottle = waterBottle();
	bottle.position.set(-0.085, floor, -0.04);
	bottle.rotation.z = 0.08;
	inside.add(bottle);
	const packets = {};
	Object.keys(SEED_PACKETS).forEach((id, i) => {
		const p = seedPacket(id);
		p.position.set(0.11 - i * 0.035, floor + 0.09, 0.07 - i * 0.008);
		p.rotation.set(-0.08, -0.25 + i * 0.03, (i - 2) * 0.05);
		inside.add(p);
		packets[id] = p;
	});
	g.add(inside);
	g.traverse((o) => o.isMesh && (o.castShadow = true));
	const setOpen = (k) => {
		flap.rotation.x = -2.6 * Math.max(0, Math.min(1, k));
		inside.visible = k > 0.5;
	};
	setOpen(open);
	g.userData = { lid: flap, bottle, packets, inside, setOpen };
	return g;
}

/* ── marking the spot ─────────────────────────────────────────────────────────────────────────────────────── */

/** A wooden marker stick: 35 cm of square pine, 12 mm across, pointed to go into the ground, its top painted orange
 *  to be seen in the grass. Its origin is its point (push it in to the depth you want). */
export function markerStick(len = 0.35) {
	const g = new THREE.Group();
	g.name = 'marker-stick';
	const s = 0.012, tip = 0.04;
	const point = new THREE.Mesh(new THREE.ConeGeometry(s * 0.7071, tip, 4).rotateY(Math.PI / 4).rotateX(Math.PI), m.wood());
	point.position.y = tip / 2;
	g.add(point);
	part(g, s, len - tip - 0.03, s, m.wood(), 0, tip + (len - tip - 0.03) / 2, 0);
	part(g, s + 0.0006, 0.03, s + 0.0006, m.paint(), 0, len - 0.015, 0);
	part(g, s * 0.9, 0.0008, s * 0.9, m.endGrain(), 0, len + 0.0003, 0);
	g.traverse((o) => o.isMesh && (o.castShadow = true));
	return g;
}

/** Two marker sticks pushed 5 cm into the ground `apart` m apart, either side of the spot (on x), leaning a little
 *  as sticks pushed in by hand do. Its origin is the spot, on the ground. */
export function markerSticks({ apart = 0.5 } = {}) {
	const g = new THREE.Group();
	g.name = 'marker-sticks';
	for (const sx of [-1, 1]) {
		const s = markerStick();
		s.position.set((sx * apart) / 2, -0.05, 0);
		s.rotation.set(0.04 * sx, 0, -0.06 * sx);
		g.add(s);
	}
	return g;
}

/** the plant stake's measures: 1 m of round peeled pine 32 mm thick, its point 9 cm; the flag 10 × 7 cm on its wire */
export const STAKE = { len: 1, r: 0.016, tip: 0.09, flagW: 0.1, flagH: 0.07 };

const stakeWood = () =>
	canvasTexture('plant-stake-wood', 128, 1024, (x, r) => {
		// peeled pine: pale and warm, streaked along its length, a few strips of bark left on, two knots
		x.fillStyle = '#d6b483';
		x.fillRect(0, 0, 128, 1024);
		for (let i = 0; i < 70; i++) {
			const gx = r() * 128, w = 0.6 + r() * 2.2;
			x.strokeStyle = r() < 0.5 ? '#b38a57' : '#e6caa0';
			x.globalAlpha = 0.15 + r() * 0.35;
			x.lineWidth = w;
			x.beginPath();
			x.moveTo(gx, 0);
			for (let y = 0; y <= 1024; y += 64) x.lineTo(gx + Math.sin(y * 0.01 + i) * 1.5, y);
			x.stroke();
		}
		x.globalAlpha = 1;
		for (let i = 0; i < 9; i++) {
			x.fillStyle = r() < 0.5 ? '#6e4c2e' : '#8a6440';
			x.globalAlpha = 0.55 + r() * 0.35;
			x.beginPath();
			x.ellipse(r() * 128, r() * 1024, 2 + r() * 5, 20 + r() * 70, 0, 0, Math.PI * 2);
			x.fill();
		}
		x.globalAlpha = 1;
		for (const [kx, ky] of [[40, 300], [96, 720]]) {
			for (let k = 4; k >= 1; k--) {
				x.fillStyle = k % 2 ? '#8c6238' : '#a8794a';
				x.beginPath();
				x.ellipse(kx, ky, k * 2.4, k * 4.2, 0, 0, Math.PI * 2);
				x.fill();
			}
		}
	});
const endGrain = () =>
	canvasTexture('plant-stake-end', 128, 128, (x) => {
		x.fillStyle = '#e4cba0';
		x.fillRect(0, 0, 128, 128);
		for (let k = 1; k < 9; k++) {
			x.strokeStyle = 'rgba(150,105,60,0.55)';
			x.lineWidth = 1.5;
			x.beginPath();
			x.arc(66, 62, k * 7.5, 0, Math.PI * 2);
			x.stroke();
		}
	});

/** the flag's print, on one side: a sleeve down its hoist, the plant in a frame next to it, the tree's name and what it
 *  is. `hoistLeft`: the side seen from the front has the wire on its left, the back has it on its right. */
function drawFlag(x, seed, name, hoistLeft) {
	const s = SEED_PACKETS[seed] ?? SEED_PACKETS.apple;
	const W = 500, H = 350;
	x.clearRect?.(0, 0, W, H);
	x.fillStyle = '#f6efdc';
	x.fillRect(0, 0, W, H);
	const at = (px) => (hoistLeft ? px : W - px); // a distance from the hoist, as a canvas x
	// the sleeve round the wire and a stitched hem round the free edges
	x.fillStyle = s.band;
	x.fillRect(hoistLeft ? 0 : W - 26, 0, 26, H);
	x.strokeStyle = s.band;
	x.setLineDash?.([10, 7]);
	x.lineWidth = 3;
	x.strokeRect(10, 10, W - 20, H - 20);
	x.setLineDash?.([]);
	// the plant in its frame, next to the sleeve
	const fx = Math.min(at(44), at(254));
	x.fillStyle = '#fffdf6';
	x.fillRect(fx, 62, 210, 226);
	x.lineWidth = 4;
	x.strokeRect(fx, 62, 210, 226);
	x.save();
	x.translate(fx + 10, 80);
	x.scale(0.86, 0.86);
	FRUIT[seed in FRUIT ? seed : 'apple'](x);
	x.restore();
	// the tree's name, as big as it fits, and the plant under it
	const cx = (at(268) + at(478)) / 2, text = name || s.label;
	let size = 66;
	x.font = `bold ${size}px Georgia, serif`;
	while (size > 26 && x.measureText(text).width > 200) x.font = `bold ${(size -= 2)}px Georgia, serif`;
	x.textAlign = 'center';
	x.fillStyle = '#2a2218';
	x.fillText(text, cx, name ? 172 : 190);
	if (name) {
		x.fillStyle = s.band;
		x.fillRect(cx - 70, 196, 140, 3);
		x.font = 'italic 30px Georgia, serif';
		x.fillStyle = '#5a4c3a';
		x.fillText(s.label, cx, 240);
	}
}

/** A plant stake, as a young tree gets one beside it: 1 m of round peeled pine, axe-pointed, to tie the tree to as it
 *  grows, pushed in beside the seed. Near its top a little waxed-cloth flag on a wire, printed on both sides with the
 *  tree's name and a picture of what it is (`seed`: one of SEED_PACKETS), flying to its left (+x). Its origin is its
 *  point (push it in to the depth you want). `userData.setName(name)` reprints the flag; `userData.flag` is the cloth,
 *  its pivot on the wire (turn it on y to swing it in the wind). */
export function plantStake({ name = '', seed = 'apple' } = {}) {
	const g = new THREE.Group();
	g.name = 'plant-stake';
	const { len, r, tip, flagW, flagH } = STAKE;
	const wood = new THREE.MeshStandardMaterial({ map: stakeWood(), roughness: 0.82 });
	const cut = new THREE.MeshStandardMaterial({ color: '#e3c898', roughness: 0.85, flatShading: true });
	// the axe-cut point, the round stake, its top chamfered and its end grain
	const point = new THREE.Mesh(new THREE.ConeGeometry(r, tip, 7, 1).rotateX(Math.PI).translate(0, tip / 2, 0), cut);
	const top = len - 0.006;
	const pole = new THREE.Mesh(new THREE.CylinderGeometry(r, r, top - tip, 16, 1).translate(0, (top + tip) / 2, 0), wood);
	const bevel = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, 0.006, 16, 1).translate(0, len - 0.003, 0), cut);
	const end = new THREE.Mesh(new THREE.CircleGeometry(r * 0.8, 16).rotateX(-Math.PI / 2).translate(0, len, 0), new THREE.MeshStandardMaterial({ map: endGrain(), roughness: 0.9 }));
	g.add(point, pole, bevel, end);
	// the flag's wire, tied to the stake's side with two lashings of twine, standing up past its top
	const wire = std('#a7abae', 0.4, { metalness: 0.8 })();
	const wx = r + 0.0016, w0 = len - 0.13, w1 = len + 0.125;
	g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.0013, 0.0013, w1 - w0, 6).translate(wx, (w0 + w1) / 2, 0), wire));
	const knob = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 8, 6), wire);
	knob.position.set(wx, w1, 0);
	g.add(knob);
	const twine = std('#cdb38a', 0.95)();
	for (const ly of [len - 0.03, len - 0.105])
		for (let k = 0; k < 4; k++) {
			const wrap = new THREE.Mesh(new THREE.TorusGeometry(r + 0.0012, 0.0011, 5, 24), twine);
			wrap.rotation.x = Math.PI / 2;
			wrap.position.set(0.0008, ly + k * 0.0024, 0);
			wrap.scale.set(1.08, 1, 1);
			g.add(wrap);
		}
	// the flag: a sleeve round the wire, the cloth flying from it with a soft wave, printed front and back
	const flag = new THREE.Group();
	flag.position.set(wx, w1 - 0.006 - flagH / 2, 0);
	g.add(flag);
	const print = (hoistLeft) => {
		const c = document.createElement('canvas');
		c.width = 500;
		c.height = 350;
		const t = new THREE.CanvasTexture(c);
		t.colorSpace = THREE.SRGBColorSpace;
		t.anisotropy = 8;
		if (!hoistLeft) {
			t.wrapS = THREE.RepeatWrapping;
			t.repeat.x = -1;
			t.offset.x = 1;
		}
		return { c, t, hoistLeft };
	};
	const sides = [print(true), print(false)];
	const cloth = new THREE.PlaneGeometry(flagW, flagH, 20, 4).translate(flagW / 2 + 0.002, 0, 0);
	const p = cloth.attributes.position;
	for (let i = 0; i < p.count; i++) {
		const u = (p.getX(i) - 0.002) / flagW;
		p.setZ(i, 0.007 * u * Math.sin(u * Math.PI * 2.2));
		p.setY(i, p.getY(i) - 0.005 * u * u);
	}
	cloth.computeVertexNormals();
	const faces = sides.map(({ t }, i) => new THREE.Mesh(cloth, new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, side: i ? THREE.BackSide : THREE.FrontSide })));
	const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0028, flagH, 10), std((SEED_PACKETS[seed] ?? SEED_PACKETS.apple).band, 0.6)());
	flag.add(...faces, sleeve);
	const setName = (n) => {
		for (const { c, t, hoistLeft } of sides) {
			drawFlag(c.getContext('2d'), seed, n, hoistLeft);
			t.needsUpdate = true;
		}
		g.userData.name = n;
	};
	g.traverse((o) => o.isMesh && (o.castShadow = true));
	g.userData = { seed, flag, setName };
	setName(name);
	return g;
}

/** A patch of dug earth, `radius` m across its middle: turned soil a little heaped, crumbs and clods on it, a hollow in
 *  its middle for the seed. It darkens and shines as it gets wet: `userData.setWet(k)` (0 dry … 1 soaked). Its own
 *  material, so one patch wets alone. */
export function dugEarth({ radius = 0.3, seed = 7 } = {}) {
	const g = new THREE.Group();
	g.name = 'dug-earth';
	let s = seed;
	const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
	const dry = new THREE.Color('#7a5a3e'), wet = new THREE.Color('#3a2717');
	const mat = new THREE.MeshStandardMaterial({ color: dry.clone(), roughness: 0.97, vertexColors: true });
	// a disc, heaped in a low ring, lumpy, a hollow at the middle; its edge ragged where the spade stopped
	const rings = 14;
	const ring = new THREE.RingGeometry(0.001, radius * 1.15, 72, rings);
	const pos = ring.attributes.position, col = [];
	const phase = [0, 0, 0, 0].map(() => rand() * Math.PI * 2);
	const ragged = (a) => 0.93 + 0.05 * Math.sin(3 * a + phase[0]) + 0.035 * Math.sin(5 * a + phase[1]) + 0.025 * Math.sin(9 * a + phase[2]) + 0.015 * Math.sin(17 * a + phase[3]);
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i), y = pos.getY(i), r = Math.hypot(x, y), a = Math.atan2(y, x);
		const edge = radius * ragged(a);
		const u = r / edge;
		// heaped in a ring round the hole the seed goes in, down to the grass at its edge; never under the ground
		const heap = u < 1 ? 0.04 * Math.sin(Math.PI * (0.15 + 0.85 * u)) ** 0.8 : 0;
		const lump = u < 0.95 ? 0.007 * (rand() - 0.5) : 0;
		const h = Math.max(0.004, heap + lump);
		pos.setXYZ(i, x * (u > 1 ? edge / r : 1), h, -y * (u > 1 ? edge / r : 1));
		const c = 0.82 + 0.3 * rand();
		col.push(c, c * (0.96 + 0.06 * rand()), c * 0.95);
	}
	ring.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
	ring.computeVertexNormals();
	const ground = new THREE.Mesh(ring, mat);
	ground.receiveShadow = true;
	g.add(ground);
	// crumbs and clods lying on it
	for (let i = 0; i < 40; i++) {
		const a = rand() * Math.PI * 2, r = radius * (0.25 + 0.85 * rand()) * (i < 10 ? 1.1 : 0.9);
		const size = 0.008 + 0.022 * rand() ** 2;
		const clod = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), mat);
		clod.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Array(clod.geometry.attributes.position.count * 3).fill(0.85), 3));
		clod.position.set(Math.cos(a) * r, 0.02 * Math.max(0, 1 - r / radius) + size * 0.5, Math.sin(a) * r);
		clod.rotation.set(rand() * 3, rand() * 3, rand() * 3);
		clod.scale.y = 0.6;
		clod.castShadow = true;
		g.add(clod);
	}
	const setWet = (k) => {
		const t = Math.max(0, Math.min(1, k));
		mat.color.copy(dry).lerp(wet, t);
		mat.roughness = 0.97 - 0.4 * t;
	};
	g.userData = { setWet, material: mat };
	return g;
}
