/*
 * THE SETTLEMENT'S CONTAINERS — Sandbox 1's fitted-out shipping containers (src/lib/aven-city/game/three/decorations.ts,
 * `shippingContainer`), built to their real measure and walkable inside. Each is a 40-foot high cube: 12.19 × 2.44 ×
 * 2.90 m outside, corrugated steel, corner posts and castings; inside it is insulated and lined, 2.24 m wide, its floor
 * 15 cm up and its ceiling at 2.70 m. The cargo doors at +x are swung right round and latched flat against the flanks,
 * so that end stands open as the way in, a checker-plate step in front of it.
 *
 *   kitchenContainer   the kitchen: a central kitchen for the crew — the range under its hood, a combi steamer, the
 *                      sinks and the dishwasher, fridges and a freezer, the serving hatch — and the pantry behind a
 *                      partition: shelves of jars, tins and crates, sacks of grain on a pallet.
 *   workshopContainer  the workshop: what a crew needs to build a small settlement — a long bench and a pegboard of
 *                      hand tools, a timber rack, the drill press, grinder, mitre saw and table saw, a welder, the
 *                      compressor, cordless tools in their cases, spades and a wheelbarrow; a mixer outside.
 *   techContainer      the tech container: solar on its roof and on fold-out wings (as Africa GreenTec's
 *                      Solartainer), the batteries and inverters, a hydrogen fuel cell and its electrolyser (the
 *                      bottles outside), Starlink on a mast, and behind glass the AI server room, its racks and cooling.
 *   sanitaryContainer  the sanitary container: washing machines and dryers, washbasins, three showers and three
 *                      toilets in cubicles off a corridor, the hot-water heat pump; a rainwater tank outside.
 *
 * Each stands on the floor at its origin, its length along x (the open end at +x), its front — the side door, the
 * hatch, the windows — towards +z. Their paint is Sandbox 1's. `userData.roof` is the roof and the ceiling (the viewer
 * lifts it off to look in from above); `userData.walk` is how to walk it (`walkway`).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bar, part, shared, soft, std, v3 } from './parts';
import { canvasTexture } from './textures';
import { wallToilet, washbasin } from './bathroom';

/** a 40-foot high cube, outside */
export const CONTAINER = { length: 12.192, width: 2.438, height: 2.896 };
const L = CONTAINER.length, W = CONTAINER.width, H = CONTAINER.height;
/** the wall's thickness (steel, insulation, lining), the floor and the ceiling inside */
const T = 0.1, FLOOR = 0.15, CEIL = 2.7;
/** the inside's edges */
const X0 = -L / 2 + T, X1 = L / 2 - T, Z0 = -W / 2 + T, Z1 = W / 2 - T;
/** how close a walker's middle comes to anything */
const PAD = 0.22;

/** @typedef {{ x0: number, x1: number, z0: number, z1: number }} Rect a footprint on the floor that is in the way */
/** @typedef {{ u0: number, u1: number, y0: number, y1: number, door?: boolean, glass?: 'clear' | 'frosted' }} Hole an opening in a wall, along it from u0 to u1 */
/**
 * @typedef {object} Walk how to walk a container: where to start, facing which way (the walker's yaw), what may be stood on
 * @property {number} x
 * @property {number} z
 * @property {number} yaw
 * @property {(x: number, z: number, here: number, ground: number, from: { x: number, z: number }) => boolean} canStand
 * @property {(x: number, z: number) => number} floorAt
 * @property {[number, number, number][]} lamps where the ceiling lights are
 */

const m = {
	frame: std('#3d3f41', 0.6, { metalness: 0.4 }),
	casting: std('#2f3032', 0.7, { metalness: 0.5 }),
	steel: std('#c9cdd0', 0.32, { metalness: 0.45 }),
	steelDark: std('#8e9396', 0.35, { metalness: 0.45 }),
	galv: std('#aeb3b5', 0.45, { metalness: 0.4 }),
	chrome: std('#e2e2e2', 0.18, { metalness: 0.55 }),
	black: std('#1b1c1e', 0.55),
	graphite: std('#34373a', 0.5, { metalness: 0.3 }),
	white: std('#f1f0ec', 0.45),
	cream: std('#e9e4d8', 0.6),
	lining: std('#ecebe6', 0.85),
	grey: std('#d6d6d1', 0.6),
	rubber: std('#262729', 0.9),
	cardboard: std('#b48d5c', 0.9),
	sack: std('#d8c8a2', 0.95),
	pine: std('#d9b47e', 0.7),
	pineDark: std('#b98d55', 0.7),
	osb: std('#c9a46a', 0.85),
	beech: std('#d8b27f', 0.5),
	red: std('#b8262b', 0.4, { metalness: 0.2 }),
	tool: std('#e8a317', 0.45),
	teal: std('#16838c', 0.45),
	blue: std('#2a5fa4', 0.45, { metalness: 0.2 }),
	green: std('#2f8a4a', 0.5),
	orange: std('#e0661f', 0.5),
	yellow: std('#f2c230', 0.5),
	glass: shared(() => new THREE.MeshPhysicalMaterial({ color: '#dcebef', roughness: 0.05, transmission: 0.9, transparent: true, opacity: 0.28, depthWrite: false })),
	frosted: shared(() => new THREE.MeshPhysicalMaterial({ color: '#eef3f4', roughness: 0.55, transmission: 0.6, transparent: true, opacity: 0.8 })),
	mirror: std('#c8d3d8', 0.06, { metalness: 0.35 }),
	led: shared(() => new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff4e2', emissiveIntensity: 2 })),
	ledGreen: shared(() => new THREE.MeshStandardMaterial({ color: '#2bd46a', emissive: '#2bd46a', emissiveIntensity: 2.5 })),
	ledBlue: shared(() => new THREE.MeshStandardMaterial({ color: '#3fa4ff', emissive: '#3fa4ff', emissiveIntensity: 2.5 })),
	ledRed: shared(() => new THREE.MeshStandardMaterial({ color: '#ff3b30', emissive: '#ff3b30', emissiveIntensity: 2.5 })),
	heat: shared(() => new THREE.MeshStandardMaterial({ color: '#ff8a3c', emissive: '#ff5a1c', emissiveIntensity: 1.6 }))
};

/** Sandbox 1's paint, one material for every container of a colour */
const paints = new Map();
/** @param {string} color @returns {THREE.MeshStandardMaterial} */
function paint(color) {
	let p = paints.get(color);
	if (!p) paints.set(color, (p = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.3 })));
	return p;
}

/** a seeded random number, the same every time */
/** @param {number} seed */
function rng(seed) {
	let s = seed >>> 0 || 1;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** a mesh that neither casts nor catches a shadow (glass, a light, a screen) */
/** @param {THREE.Mesh} p */
const unlit = (p) => ((p.castShadow = p.receiveShadow = false), p);

/** A round thing standing up (a tin, a bottle, a drum), its foot at y. */
/** @param {THREE.Object3D} g @param {number} r @param {number} h @param {THREE.Material} mat @param {number} x @param {number} y @param {number} z */
function drum(g, r, h, mat, x, y, z, seg = 16) {
	const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
	p.position.set(x, y + h / 2, z);
	p.castShadow = p.receiveShadow = true;
	g.add(p);
	return p;
}

/* ------------------------------------------------------------------------------------------------------------------
 * Surfaces
 * ------------------------------------------------------------------------------------------------------------------ */

/** Stencilled letters on the steel, as a container's owner paints its name. */
/** @param {string} text */
function stencil(text) {
	return canvasTexture(`stencil:${text}`, 1024, 256, (x) => {
		x.clearRect(0, 0, 1024, 256);
		x.fillStyle = '#f4f1ea';
		x.font = 'bold 150px "Arial Narrow", Arial, sans-serif';
		x.textBaseline = 'middle';
		x.fillText(text, 24, 110);
		x.font = 'bold 44px Arial, sans-serif';
		x.fillText('MAIA 400 1' + text.length + '4  ·  45G1', 28, 222);
	});
}

/** Solar cells: 6 × 10 monocrystalline cells, their silver busbars, a white gap round each. */
function pvCells() {
	return canvasTexture('pv-cells', 320, 192, (x) => {
		x.fillStyle = '#d8dde2';
		x.fillRect(0, 0, 320, 192);
		for (let i = 0; i < 10; i++)
			for (let j = 0; j < 6; j++) {
				const cx = 2 + i * 31.8, cy = 2 + j * 31.6;
				x.fillStyle = '#16233d';
				x.fillRect(cx, cy, 30, 30);
				x.fillStyle = '#1d2e50';
				x.fillRect(cx + 1, cy + 1, 28, 14);
				x.fillStyle = 'rgba(200,205,215,0.55)';
				for (const b of [8, 15, 22]) x.fillRect(cx + b, cy, 1, 30);
			}
	});
}

/** A rack's front: 42 units of servers, GPU boxes and switches behind a mesh door, `leds` true for their lights alone. */
/** @param {number} seed @param {boolean} leds */
function rackFront(seed, leds) {
	return canvasTexture(`rack:${seed}:${leds}`, 128, 448, (x, r) => {
		x.fillStyle = leds ? '#000' : '#141518';
		x.fillRect(0, 0, 128, 448);
		const u = 10;
		let y = 14;
		while (y < 434) {
			const kind = r();
			const h = kind < 0.45 ? 4 : kind < 0.7 ? 2 : 1;
			const top = y, hh = Math.min(h * u, 434 - y);
			if (!leds) {
				x.fillStyle = h === 4 ? '#24272b' : h === 2 ? '#2c3035' : '#1d1f22';
				x.fillRect(8, top + 1, 112, hh - 2);
				x.fillStyle = 'rgba(255,255,255,0.08)';
				if (h > 1) for (let gx = 14; gx < 100; gx += 4) for (let gy = top + 4; gy < top + hh - 4; gy += 4) x.fillRect(gx, gy, 2, 2);
				else for (let p = 0; p < 24; p++) x.fillRect(14 + p * 4, top + 3, 3, 4);
			}
			const n = h === 1 ? 6 : 2;
			for (let k = 0; k < n; k++) {
				const on = r();
				x.fillStyle = on < 0.75 ? '#38e07a' : on < 0.95 ? '#4aa8ff' : '#ff9a2e';
				if (leds || on < 0.2) x.fillRect(h === 1 ? 14 + k * 16 : 106 + k * 6, top + (h === 1 ? 7 : 4), 3, 2);
			}
			y += hh;
		}
	}, !leds);
}

/** The energy dashboard on the control desk: today's sun, the batteries' charge, the fuel cell, the servers' load. */
function dashboard() {
	return canvasTexture('energy-dashboard', 512, 300, (x, r) => {
		x.fillStyle = '#0d1418';
		x.fillRect(0, 0, 512, 300);
		x.fillStyle = '#7fe0a8';
		x.font = 'bold 26px Arial, sans-serif';
		x.fillText('SOLAR  11.2 kWp   ·   8.7 kW', 18, 38);
		x.fillStyle = '#a9c4cf';
		x.font = '20px Arial, sans-serif';
		x.fillText('BATTERY 82 %   FUEL CELL standby   H₂ 64 %', 18, 72);
		x.fillText('STARLINK 212 ↓ 24 ↑ Mbit/s   AI RACKS 6.1 kW', 18, 100);
		x.strokeStyle = '#f2c230';
		x.lineWidth = 3;
		x.beginPath();
		for (let i = 0; i <= 48; i++) {
			const px = 18 + i * 9.8, py = 270 - Math.max(0, Math.sin(((i - 6) / 36) * Math.PI)) * 130 - r() * 6;
			if (i === 0) x.moveTo(px, py);
			else x.lineTo(px, py);
		}
		x.stroke();
		x.strokeStyle = '#4aa8ff';
		x.beginPath();
		for (let i = 0; i <= 48; i++) {
			const px = 18 + i * 9.8, py = 230 - i * 0.6 - r() * 10;
			if (i === 0) x.moveTo(px, py);
			else x.lineTo(px, py);
		}
		x.stroke();
	});
}

/** A word on a panel: a cabinet's name, a warning. */
/** @param {string} text @param {string} bg @param {string} fg */
function plate(text, bg, fg) {
	return canvasTexture(`plate:${text}:${bg}`, 512, 128, (x) => {
		x.fillStyle = bg;
		x.fillRect(0, 0, 512, 128);
		x.fillStyle = fg;
		x.font = 'bold 56px Arial, sans-serif';
		x.textAlign = 'center';
		x.textBaseline = 'middle';
		x.fillText(text, 256, 66);
	});
}

/** Hardboard with holes every 25 mm, the pegboard's. */
function pegHoles() {
	const t = canvasTexture('pegboard', 256, 256, (x) => {
		x.fillStyle = '#b48a5a';
		x.fillRect(0, 0, 256, 256);
		x.fillStyle = '#4a3523';
		for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) {
			x.beginPath();
			x.arc(8 + i * 16, 8 + j * 16, 2.6, 0, Math.PI * 2);
			x.fill();
		}
	});
	return t;
}

/** Floor tiles 30 cm square, grey grout: the sanitary container's floor. */
function tiles() {
	return canvasTexture('container-tiles', 256, 256, (x, r) => {
		x.fillStyle = '#8f9192';
		x.fillRect(0, 0, 256, 256);
		for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
			const v = 196 + Math.floor(r() * 14);
			x.fillStyle = `rgb(${v},${v},${v - 4})`;
			x.fillRect(i * 64 + 2, j * 64 + 2, 60, 60);
		}
	});
}

/** A floor of its own colour, or a texture repeated at its real size over the inside. */
/** @param {string} color @param {THREE.Texture} [map] @param {number} [size] */
function floorMaterial(color, map, size = 1) {
	if (!map) return new THREE.MeshStandardMaterial({ color, roughness: 0.75 });
	const t = map.clone();
	t.repeat.set((X1 - X0) / size, (Z1 - Z0) / size);
	t.needsUpdate = true;
	return new THREE.MeshStandardMaterial({ color, map: t, roughness: 0.5 });
}

/** A flat picture on a panel (a screen, a label), facing +z. */
/** @param {THREE.Object3D} g @param {number} w @param {number} h @param {THREE.Material} mat @param {number} x @param {number} y @param {number} z @param {number} [ry] */
function sheet(g, w, h, mat, x, y, z, ry = 0) {
	const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
	p.position.set(x, y, z);
	p.rotation.y = ry;
	g.add(p);
	return p;
}
const screenMat = shared(() => new THREE.MeshStandardMaterial({ map: dashboard(), emissive: '#ffffff', emissiveMap: dashboard(), emissiveIntensity: 0.9 }));
/** @param {string} text @param {string} bg @param {string} fg */
const plateMat = (text, bg, fg) => new THREE.MeshStandardMaterial({ map: plate(text, bg, fg), roughness: 0.5 });

/* ------------------------------------------------------------------------------------------------------------------
 * The box: walls, frame, floor, roof, doors
 * ------------------------------------------------------------------------------------------------------------------ */

/**
 * The parts of a wall from a to b and y0 to y1 that are not openings.
 * @param {number} a @param {number} b @param {number} y0 @param {number} y1 @param {Hole[]} holes
 */
function cut(a, b, y0, y1, holes) {
	const us = [a, b];
	for (const h of holes) us.push(Math.max(a, Math.min(b, h.u0)), Math.max(a, Math.min(b, h.u1)));
	us.sort((p, q) => p - q);
	/** @type {{ u0: number, u1: number, y0: number, y1: number }[]} */
	const out = [];
	for (let i = 0; i < us.length - 1; i++) {
		const u0 = us[i], u1 = us[i + 1];
		if (u1 - u0 < 1e-4) continue;
		const mid = (u0 + u1) / 2;
		const h = holes.find((o) => mid > o.u0 && mid < o.u1);
		if (!h) out.push({ u0, u1, y0, y1 });
		else {
			if (h.y0 > y0 + 1e-3) out.push({ u0, u1, y0, y1: Math.min(h.y0, y1) });
			if (h.y1 < y1 - 1e-3) out.push({ u0, u1, y0: Math.max(h.y1, y0), y1 });
		}
	}
	return out;
}

/**
 * One wall, built in its own frame — u along it, w out of it, the outer face at `half` — and turned into place by
 * `rot`: its steel skin and corrugation outside, its lining inside, a reveal round each opening, glass in a window, a
 * door swung open. Returns what of it is in the way, on the floor.
 * @param {THREE.Group} g
 * @param {{ rot: number, half: number, span: number, inner: number, holes: Hole[], skin: THREE.Material, lining: THREE.Material }} o
 * @returns {Rect[]}
 */
function wall(g, { rot, half, span, inner, holes, skin, lining }) {
	const w = new THREE.Group();
	w.rotation.y = rot;
	g.add(w);
	for (const r of cut(-span, span, 0.16, H - 0.1, holes)) part(w, r.u1 - r.u0, r.y1 - r.y0, 0.02, skin, (r.u0 + r.u1) / 2, (r.y0 + r.y1) / 2, half - 0.045);
	// the corrugation: trapezoid ribs every 27.8 cm, merged into one mesh
	/** @type {THREE.BufferGeometry[]} */
	const geos = [];
	const pitch = 0.278, n = Math.floor((2 * span) / pitch);
	const first = -span + (2 * span - (n - 1) * pitch) / 2;
	for (let i = 0; i < n; i++) {
		const u = first + i * pitch;
		for (const r of cut(u - 0.065, u + 0.065, 0.2, H - 0.14, holes)) {
			if (r.u1 - r.u0 < 0.03 || r.y1 - r.y0 < 0.03) continue;
			const b = new THREE.BoxGeometry(r.u1 - r.u0, r.y1 - r.y0, 0.03);
			b.translate((r.u0 + r.u1) / 2, (r.y0 + r.y1) / 2, half - 0.02);
			geos.push(b);
		}
	}
	if (geos.length) {
		const ribs = new THREE.Mesh(mergeGeometries(geos), skin);
		ribs.castShadow = ribs.receiveShadow = true;
		w.add(ribs);
		for (const b of geos) b.dispose();
	}
	for (const r of cut(-inner, inner, FLOOR, CEIL, holes)) part(w, r.u1 - r.u0, r.y1 - r.y0, 0.02, lining, (r.u0 + r.u1) / 2, (r.y0 + r.y1) / 2, half - T + 0.01);
	const rw0 = half - T, rw1 = half - 0.035, rc = (rw0 + rw1) / 2, rd = rw1 - rw0;
	/** @type {{ u0: number, u1: number, w0: number, w1: number }[]} */
	const leaves = [];
	for (const h of holes) {
		const hu = (h.u0 + h.u1) / 2, hy = (h.y0 + h.y1) / 2;
		part(w, 0.04, h.y1 - h.y0, rd, m.frame(), h.u0 + 0.02, hy, rc);
		part(w, 0.04, h.y1 - h.y0, rd, m.frame(), h.u1 - 0.02, hy, rc);
		part(w, h.u1 - h.u0, 0.04, rd, m.frame(), hu, h.y1 - 0.02, rc);
		if (!h.door) part(w, h.u1 - h.u0 + 0.06, 0.04, rd + 0.05, m.frame(), hu, h.y0 + 0.02, rc + 0.025);
		if (h.glass) {
			unlit(part(w, h.u1 - h.u0 - 0.08, h.y1 - h.y0 - 0.08, 0.008, h.glass === 'frosted' ? m.frosted() : m.glass(), hu, hy, rc));
			if (h.u1 - h.u0 > 1.2) part(w, 0.04, h.y1 - h.y0 - 0.08, 0.04, m.frame(), hu, hy, rc);
		}
		if (h.door) {
			// a steel door, swung out and back against the wall
			const leaf = h.u1 - h.u0 - 0.08, open = 1.75;
			const pivot = new THREE.Group();
			pivot.position.set(h.u0 + 0.04, 0, half - 0.01);
			pivot.rotation.y = -open;
			w.add(pivot);
			part(pivot, leaf, h.y1 - h.y0 - 0.04, 0.045, skin, leaf / 2, hy, 0.0225);
			bar(pivot, v3(leaf - 0.08, 1.0, 0.045), v3(leaf - 0.08, 1.0, 0.1), 0.012, m.chrome());
			bar(pivot, v3(leaf - 0.08, 1.0, 0.1), v3(leaf - 0.2, 1.0, 0.1), 0.012, m.chrome());
			const ex = h.u0 + 0.04 + leaf * Math.cos(open), ew = half - 0.01 + leaf * Math.sin(open);
			leaves.push({ u0: Math.min(h.u0, ex) - 0.03, u1: Math.max(h.u0 + 0.06, ex + 0.03), w0: half, w1: ew + 0.05 });
		}
	}
	// what is in the way, from the wall's frame to the floor's
	const c = Math.cos(rot), s = Math.sin(rot);
	/** @param {number} u0 @param {number} u1 @param {number} w0 @param {number} w1 @returns {Rect} */
	const toFloor = (u0, u1, w0, w1) => {
		const xs = [u0 * c + w0 * s, u1 * c + w1 * s], zs = [-u0 * s + w0 * c, -u1 * s + w1 * c];
		return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
	};
	const doors = holes.filter((h) => h.door).map((h) => ({ ...h, y0: -1, y1: 2 }));
	return [...cut(-span, span, 0, 1, doors).filter((r) => r.y0 < 0.5).map((r) => toFloor(r.u0, r.u1, half - T, half)), ...leaves.map((l) => toFloor(l.u0, l.u1, l.w0, l.w1))];
}

/**
 * The container itself, before it is fitted out: its walls with their openings (`front` along +z and `back` along −z,
 * from −x to +x; `end` across −x, from −z to +z), its frame, floor, roof and ceiling lights, the cargo doors swung
 * back and the step at the open end, its name stencilled on both flanks at `labelX`.
 * @param {{ name: string, color: string, floor: THREE.Material, lining?: THREE.Material, front?: Hole[], back?: Hole[], end?: Hole[], label: string, labelX: number }} o
 */
function box({ name, color, floor, lining = m.lining(), front = [], back = [], end = [], label, labelX }) {
	const g = new THREE.Group();
	g.name = name;
	const skin = paint(color);
	/** @type {Rect[]} */
	const solids = [];
	const long = { half: W / 2, span: L / 2 - 0.15, inner: X1, skin, lining };
	solids.push(...wall(g, { ...long, rot: 0, holes: front }));
	solids.push(...wall(g, { ...long, rot: Math.PI, holes: back.map((h) => ({ ...h, u0: -h.u1, u1: -h.u0 })) }));
	solids.push(...wall(g, { rot: -Math.PI / 2, half: L / 2, span: W / 2 - 0.15, inner: Z1, holes: end, skin, lining }));
	// the frame: corner posts, castings, the rails top and bottom
	for (const sx of [-1, 1])
		for (const sz of [-1, 1]) {
			part(g, 0.15, H, 0.15, skin, sx * (L / 2 - 0.075), H / 2, sz * (W / 2 - 0.075));
			for (const y of [0.059, H - 0.059]) part(g, 0.178, 0.118, 0.162, m.casting(), sx * (L / 2 - 0.089), y, sz * (W / 2 - 0.081));
			solids.push({ x0: sx * (L / 2 - 0.075) - 0.075, x1: sx * (L / 2 - 0.075) + 0.075, z0: sz * (W / 2 - 0.075) - 0.075, z1: sz * (W / 2 - 0.075) + 0.075 });
		}
	for (const sz of [-1, 1]) {
		part(g, L - 0.3, 0.16, 0.06, skin, 0, 0.08, sz * (W / 2 - 0.03));
		part(g, L - 0.3, 0.1, 0.06, skin, 0, H - 0.05, sz * (W / 2 - 0.03));
	}
	part(g, 0.06, 0.16, W - 0.3, skin, -L / 2 + 0.03, 0.08, 0);
	part(g, 0.06, 0.1, W - 0.3, skin, -L / 2 + 0.03, H - 0.05, 0);
	part(g, 0.08, FLOOR, W - 0.3, m.casting(), L / 2 - 0.04, FLOOR / 2, 0); // the sill at the open end
	part(g, 0.1, 0.2, W - 0.3, skin, L / 2 - 0.05, H - 0.1, 0); // the door header
	// the floor, and the cross members under it
	part(g, X1 - X0 + 0.02, 0.03, Z1 - Z0 + 0.02, floor, 0, FLOOR - 0.015, 0);
	part(g, L - 0.12, FLOOR - 0.03, W - 0.12, m.frame(), 0, (FLOOR - 0.03) / 2, 0, false);
	// the roof and ceiling: one group the viewer can lift off
	const roof = new THREE.Group();
	roof.name = 'roof';
	g.add(roof);
	part(roof, L, 0.04, W, skin, 0, H - 0.02, 0);
	part(roof, X1 - X0, 0.02, Z1 - Z0, lining, 0, CEIL + 0.01, 0);
	/** @type {[number, number, number][]} */
	const lamps = [];
	for (const x of [-4.8, -2.4, 0, 2.4, 4.8]) {
		unlit(part(roof, 1.2, 0.025, 0.07, m.led(), x, CEIL - 0.0125, 0));
		lamps.push([x, CEIL - 0.15, 0]);
	}
	// the cargo doors, swung right round and latched flat against the flanks
	for (const sz of [-1, 1]) {
		const z = sz * (W / 2 + 0.04);
		part(g, 1.17, H - 0.24, 0.04, skin, L / 2 - 0.62, (H - 0.24) / 2 + 0.12, z);
		for (let i = 0; i < 4; i++) part(g, 0.12, H - 0.5, 0.03, skin, L / 2 - 1.08 + i * 0.3, H / 2, z + sz * 0.03);
		for (const x of [L / 2 - 0.35, L / 2 - 0.85]) {
			bar(g, v3(x, 0.14, z + sz * 0.07), v3(x, H - 0.14, z + sz * 0.07), 0.016, m.galv());
			bar(g, v3(x, 1.2, z + sz * 0.07), v3(x + 0.24, 1.2, z + sz * 0.09), 0.012, m.galv());
		}
		solids.push({ x0: L / 2 - 1.22, x1: L / 2, z0: Math.min(z, z + sz * 0.1), z1: Math.max(z, z + sz * 0.1) });
	}
	// a checker-plate step at the open end
	part(g, 0.45, 0.075, 1.6, m.galv(), L / 2 + 0.24, 0.0375, 0);
	// its name, stencilled on both flanks
	const word = new THREE.MeshStandardMaterial({ map: stencil(label), transparent: true, roughness: 0.6, depthWrite: false });
	unlit(sheet(g, 2.4, 0.6, word, labelX, 2.3, W / 2 + 0.002));
	unlit(sheet(g, 2.4, 0.6, word, -labelX, 2.3, -W / 2 - 0.002, Math.PI));
	return { g, roof, solids, lamps, skin };
}

/**
 * How to walk a container and the ground round it: a step is refused into anything in the way (padded by a body's
 * width), or deeper into what it already stands in; inside the floor is 15 cm up, on the step 7.5 cm.
 * @param {Rect[]} solids @param {[number, number, number][]} lamps @returns {Walk}
 */
function walkway(solids, lamps) {
	/** how deep x, z is in r (padded), or ≤ 0 outside it @param {Rect} r @param {number} x @param {number} z */
	const depth = (r, x, z) => Math.min(x - r.x0 + PAD, r.x1 + PAD - x, z - r.z0 + PAD, r.z1 + PAD - z);
	return {
		x: L / 2 + 2.4,
		z: 0.2,
		yaw: Math.PI / 2,
		canStand(x, z, _here, _ground, from) {
			for (const r of solids) {
				const d = depth(r, x, z);
				if (d <= 0) continue;
				const before = depth(r, from.x, from.z);
				if (before > 0 && d < before) continue; // on the way out: let them go
				return false;
			}
			return true;
		},
		floorAt(x, z) {
			if (Math.abs(x) < L / 2 && Math.abs(z) < W / 2) return FLOOR;
			if (x >= L / 2 && x < L / 2 + 0.47 && Math.abs(z) < 0.8) return 0.075;
			return 0;
		},
		lamps
	};
}

/**
 * The fit-out: things put on the floor (or on the ground outside), each turned so, its footprint in the way.
 * @param {THREE.Group} g @param {Rect[]} solids
 */
function fitter(g, solids) {
	return {
		/**
		 * Put `o` with its middle at x, z (on the floor inside, unless `y`), turned `ry`; `w` × `d` (along x and z before
		 * turning) is in the way.
		 * @template {THREE.Object3D} O
		 * @param {O} o @param {number} x @param {number} z
		 * @param {{ ry?: number, w?: number, d?: number, y?: number }} [opts]
		 * @returns {O}
		 */
		put(o, x, z, { ry = 0, w = 0, d = 0, y } = {}) {
			o.position.set(x, y ?? (Math.abs(x) < L / 2 && Math.abs(z) < W / 2 ? FLOOR : 0), z);
			o.rotation.y = ry;
			g.add(o);
			if (w && d) {
				const turned = Math.abs(Math.sin(ry)) > 0.7;
				const hw = (turned ? d : w) / 2, hd = (turned ? w : d) / 2;
				solids.push({ x0: x - hw, x1: x + hw, z0: z - hd, z1: z + hd });
			}
			return o;
		},
		/** @param {number} x0 @param {number} x1 @param {number} z0 @param {number} z1 */
		block(x0, x1, z0, z1) {
			solids.push({ x0, x1, z0, z1 });
		}
	};
}
/** against the back wall, facing in: z of a thing `d` deep */
/** @param {number} d */
const atBack = (d) => Z0 + d / 2;
/** against the front wall, facing in (turned π) */
/** @param {number} d */
const atFront = (d) => Z1 - d / 2;

/* ------------------------------------------------------------------------------------------------------------------
 * Shared fittings
 * ------------------------------------------------------------------------------------------------------------------ */

/** A wire shelving rack w × d × h, `levels` shelves; its shelves' heights in userData.shelves. */
/** @param {number} w @param {number} d @param {number} h @param {number} levels @param {THREE.Material} [mat] */
function rack(w, d, h, levels, mat = m.chrome()) {
	const g = new THREE.Group();
	for (const sx of [-1, 1]) for (const sz of [-1, 1]) bar(g, v3(sx * (w / 2 - 0.015), 0, sz * (d / 2 - 0.015)), v3(sx * (w / 2 - 0.015), h, sz * (d / 2 - 0.015)), 0.013, mat);
	/** @type {number[]} */
	const shelves = [];
	for (let i = 0; i < levels; i++) {
		const y = 0.15 + (i * (h - 0.2)) / (levels - 1);
		part(g, w, 0.02, d, mat, 0, y, 0);
		shelves.push(y + 0.01);
	}
	g.userData.shelves = shelves;
	return g;
}

/**
 * Fill a shelf from −w/2 to w/2 at y with goods of a kind: glass jars, tins, cardboard boxes, sacks, crates of
 * vegetables, bottles, folded towels, detergent.
 * @param {THREE.Group} g @param {number} w @param {number} d @param {number} y
 * @param {'jars' | 'tins' | 'boxes' | 'sacks' | 'crates' | 'bottles' | 'towels' | 'pots'} kind @param {() => number} r
 */
function stock(g, w, d, y, kind, r) {
	let x = -w / 2 + 0.03;
	const jarTops = [m.red(), m.white(), m.green()];
	const fills = ['#d9a441', '#9b3b2a', '#e7dcc0', '#6b8f3a', '#c86d2a', '#f2e6c8', '#5a3a22'].map((c) => std(c, 0.4)());
	const veg = ['#b07a3c', '#d9c06a', '#9c2a2a', '#e08a2e', '#6c8f2a'].map((c) => std(c, 0.7)());
	while (x < w / 2 - 0.08) {
		if (kind === 'jars') {
			const rr = 0.045 + r() * 0.02, h = 0.12 + r() * 0.08;
			for (const z of [-d / 4, d / 4]) {
				drum(g, rr, h * 0.85, fills[Math.floor(r() * fills.length)], x + rr, y, z);
				unlit(drum(g, rr + 0.004, h, m.glass(), x + rr, y, z));
				drum(g, rr + 0.003, 0.02, jarTops[Math.floor(r() * 3)], x + rr, y + h, z);
			}
			x += rr * 2 + 0.02;
		} else if (kind === 'tins') {
			for (const z of [-d / 3, 0, d / 3]) for (let k = 0; k < 2; k++) {
				drum(g, 0.04, 0.11, m.steel(), x + 0.04, y + k * 0.11, z);
				drum(g, 0.041, 0.07, fills[Math.floor(r() * fills.length)], x + 0.04, y + k * 0.11 + 0.02, z);
			}
			x += 0.09;
		} else if (kind === 'boxes') {
			const bw = 0.2 + r() * 0.2, bh = 0.15 + r() * 0.15;
			part(g, bw, bh, d * 0.85, m.cardboard(), x + bw / 2, y + bh / 2, 0);
			x += bw + 0.02;
		} else if (kind === 'sacks') {
			soft(g, 0.32, 0.18, d * 0.85, 0.06, m.sack(), x + 0.16, y + 0.09, 0);
			soft(g, 0.3, 0.16, d * 0.8, 0.06, m.sack(), x + 0.16, y + 0.25, 0);
			x += 0.36;
		} else if (kind === 'crates') {
			const cw = 0.4, ch = 0.24;
			part(g, cw, 0.02, d * 0.9, m.pine(), x + cw / 2, y + 0.01, 0);
			for (const sz of [-1, 1]) part(g, cw, ch, 0.015, m.pine(), x + cw / 2, y + ch / 2, (sz * d * 0.9) / 2);
			for (const sx of [-1, 1]) part(g, 0.015, ch, d * 0.9, m.pine(), x + cw / 2 + (sx * cw) / 2, y + ch / 2, 0);
			const v = veg[Math.floor(r() * veg.length)];
			const ball = new THREE.SphereGeometry(0.045, 8, 6);
			const n = 14;
			const heap = new THREE.InstancedMesh(ball, v, n);
			const mx = new THREE.Matrix4();
			for (let i = 0; i < n; i++) {
				mx.makeTranslation(x + 0.06 + (i % 5) * 0.07, y + 0.07 + Math.floor(i / 10) * 0.06 + r() * 0.03, -d * 0.3 + (Math.floor(i / 5) % 2) * d * 0.4 + r() * 0.06);
				heap.setMatrixAt(i, mx);
			}
			heap.castShadow = true;
			g.add(heap);
			x += cw + 0.03;
		} else if (kind === 'bottles') {
			for (const z of [-d / 4, d / 4]) {
				drum(g, 0.04, 0.24, fills[Math.floor(r() * fills.length)], x + 0.04, y, z, 10);
				drum(g, 0.015, 0.06, m.black(), x + 0.04, y + 0.24, z, 8);
			}
			x += 0.095;
		} else if (kind === 'towels') {
			const c = [m.white(), m.cream(), std('#8fb3c4', 0.95)()][Math.floor(r() * 3)];
			for (let k = 0; k < 4; k++) soft(g, 0.3, 0.05, d * 0.8, 0.02, c, x + 0.15, y + 0.025 + k * 0.052, 0);
			x += 0.34;
		} else {
			const rr = 0.1 + r() * 0.06;
			drum(g, rr, rr * 1.3, m.steel(), x + rr, y, 0, 20);
			x += rr * 2 + 0.03;
		}
	}
}

/** A stainless worktable w × d, its top at h, an upstand at the back, a shelf under it. */
/** @param {number} w @param {number} d @param {{ h?: number, shelf?: boolean, upstand?: boolean }} [o] */
function steelTable(w, d, { h = 0.9, shelf = true, upstand = true } = {}) {
	const g = new THREE.Group();
	part(g, w, 0.04, d, m.steel(), 0, h - 0.02, 0);
	if (upstand) part(g, w, 0.1, 0.012, m.steel(), 0, h + 0.05, -d / 2 + 0.006);
	for (const sx of [-1, 1]) for (const sz of [-1, 1]) bar(g, v3(sx * (w / 2 - 0.04), 0, sz * (d / 2 - 0.04)), v3(sx * (w / 2 - 0.04), h - 0.04, sz * (d / 2 - 0.04)), 0.02, m.steel());
	if (shelf) part(g, w - 0.04, 0.02, d - 0.04, m.steel(), 0, 0.2, 0);
	return g;
}

/** A wall shelf of steel, w long, d deep, its top at y; its back at z 0. What stands on it goes in `userData.on`, at its middle. */
/** @param {number} w @param {number} d @param {number} y @param {THREE.Material} [mat] */
function wallShelf(w, d, y, mat = m.steel()) {
	const g = new THREE.Group();
	part(g, w, 0.025, d, mat, 0, y, d / 2);
	for (const x of [-w / 2 + 0.1, w / 2 - 0.1]) part(g, 0.02, 0.2, d * 0.9, m.frame(), x, y - 0.11, d * 0.45);
	const on = new THREE.Group();
	on.position.z = d / 2;
	g.add(on);
	g.userData.on = on;
	return g;
}

/** A fire extinguisher on its bracket, 6 kg, its back at z 0, its foot at y 0. */
function extinguisher() {
	const g = new THREE.Group();
	drum(g, 0.08, 0.5, m.red(), 0, 0, 0.09);
	drum(g, 0.03, 0.06, m.black(), 0, 0.5, 0.09);
	bar(g, v3(0, 0.56, 0.09), v3(0.12, 0.5, 0.12), 0.008, m.black());
	part(g, 0.1, 0.05, 0.02, m.black(), 0, 0.35, 0.01);
	return g;
}

/* ------------------------------------------------------------------------------------------------------------------
 * The kitchen's fittings
 * ------------------------------------------------------------------------------------------------------------------ */

/** A six-burner gas range, 1.2 × 0.75 m, two ovens under it, a splashback. Its front towards +z. */
function range6() {
	const g = new THREE.Group();
	const w = 1.2, d = 0.75;
	part(g, w, 0.82, d, m.steel(), 0, 0.41 + 0.08, 0);
	part(g, w - 0.04, 0.08, d - 0.1, m.black(), 0, 0.04, 0, false);
	part(g, w, 0.03, d, m.black(), 0, 0.915, 0); // the hob
	for (let i = 0; i < 3; i++)
		for (const sz of [-1, 1]) {
			const x = -0.38 + i * 0.38, z = sz * 0.18;
			const ring = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.012, 6, 18), m.graphite());
			ring.rotation.x = Math.PI / 2;
			ring.position.set(x, 0.945, z);
			g.add(ring);
			part(g, 0.3, 0.02, 0.025, m.graphite(), x, 0.945, z);
			part(g, 0.025, 0.02, 0.3, m.graphite(), x, 0.945, z);
		}
	part(g, w, 0.5, 0.03, m.steel(), 0, 1.18, -d / 2 + 0.015);
	for (const sx of [-1, 1]) {
		part(g, 0.56, 0.5, 0.012, m.steelDark(), sx * 0.29, 0.42, d / 2 + 0.006);
		unlit(part(g, 0.36, 0.18, 0.004, m.black(), sx * 0.29, 0.46, d / 2 + 0.013));
		bar(g, v3(sx * 0.29 - 0.22, 0.7, d / 2 + 0.05), v3(sx * 0.29 + 0.22, 0.7, d / 2 + 0.05), 0.012, m.chrome());
	}
	for (let i = 0; i < 6; i++) {
		const k = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 12), m.black());
		k.rotation.x = Math.PI / 2;
		k.position.set(-0.5 + i * 0.2, 0.82, d / 2 + 0.015);
		g.add(k);
	}
	// a stock pot and a pan on the fire
	drum(g, 0.16, 0.3, m.steel(), -0.38, 0.95, -0.18, 24);
	const pan = drum(g, 0.15, 0.05, m.graphite(), 0.38, 0.95, 0.18, 24);
	bar(g, v3(0.53, 0.99, 0.18), v3(0.8, 1.02, 0.18), 0.012, m.graphite());
	pan.castShadow = true;
	return g;
}

/** A combi steamer on its stand: 0.9 × 0.8 m, the oven from 0.6 to 1.4 m, its glass door and control strip. */
function combiSteamer() {
	const g = new THREE.Group();
	g.add(steelTable(0.9, 0.78, { h: 0.6, upstand: false }));
	part(g, 0.88, 0.8, 0.78, m.steel(), 0, 1.0, 0);
	part(g, 0.62, 0.62, 0.02, m.steelDark(), -0.1, 1.0, 0.4);
	unlit(part(g, 0.48, 0.44, 0.006, m.black(), -0.1, 1.0, 0.413));
	bar(g, v3(0.18, 0.78, 0.44), v3(0.18, 1.2, 0.44), 0.012, m.chrome());
	part(g, 0.16, 0.66, 0.012, m.black(), 0.34, 1.0, 0.396);
	unlit(part(g, 0.1, 0.07, 0.004, m.ledBlue(), 0.34, 1.22, 0.404));
	for (let i = 0; i < 6; i++) part(g, 0.7, 0.012, 0.6, m.chrome(), -0.04, 0.12 + i * 0.075, 0.02); // trays under it
	return g;
}

/** A sink table, w long: two deep bowls, a pre-rinse spray on its spring. */
/** @param {number} w */
function sinkTable(w) {
	const g = steelTable(w, 0.7);
	for (const x of [-w / 4 + 0.05, w / 4 - 0.05]) {
		part(g, 0.5, 0.012, 0.45, m.steelDark(), x, 0.905, 0.02);
		part(g, 0.04, 0.012, 0.04, m.black(), x, 0.912, 0.02);
	}
	bar(g, v3(0, 0.9, -0.3), v3(0, 1.5, -0.3), 0.015, m.chrome());
	bar(g, v3(0, 1.5, -0.3), v3(0, 1.5, -0.05), 0.012, m.chrome());
	for (let i = 0; i < 10; i++) {
		const coil = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 14), m.chrome());
		coil.rotation.x = Math.PI / 2;
		coil.position.set(0, 1.2 + i * 0.025, -0.05);
		g.add(coil);
	}
	drum(g, 0.03, 0.12, m.chrome(), 0, 1.05, -0.05, 10);
	return g;
}

/** A hood-type dishwasher, 0.65 × 0.75 m, its hood down, a basket of plates beside it on the table. */
function hoodDishwasher() {
	const g = new THREE.Group();
	part(g, 0.65, 0.85, 0.72, m.steel(), 0, 0.425, 0);
	part(g, 0.66, 0.6, 0.74, m.steel(), 0, 1.15, 0);
	bar(g, v3(-0.25, 1.48, 0.38), v3(0.25, 1.48, 0.38), 0.012, m.chrome());
	part(g, 0.4, 0.06, 0.02, m.black(), 0, 0.78, 0.37);
	unlit(part(g, 0.04, 0.02, 0.004, m.ledGreen(), 0.15, 0.78, 0.382));
	return g;
}

/** An upright fridge (or freezer): `doors` steel doors 0.7 m each, 0.7 deep, 2.0 m high, a little display. */
/** @param {number} doors @param {boolean} [freezer] */
function uprightFridge(doors, freezer = false) {
	const g = new THREE.Group();
	const w = doors * 0.7, d = 0.7;
	part(g, w, 1.95, d, m.steel(), 0, 0.05 + 0.975, 0);
	part(g, w - 0.04, 0.05, d - 0.05, m.black(), 0, 0.025, 0, false);
	for (let i = 0; i < doors; i++) {
		const x = -w / 2 + 0.35 + i * 0.7;
		part(g, 0.68, 1.6, 0.012, m.steel(), x, 0.92, d / 2 + 0.006);
		const hx = x + (i % 2 ? -0.28 : 0.28);
		bar(g, v3(hx, 0.75, d / 2 + 0.05), v3(hx, 1.35, d / 2 + 0.05), 0.012, m.chrome());
	}
	part(g, w - 0.02, 0.3, 0.012, m.black(), 0, 1.84, d / 2 + 0.006);
	unlit(part(g, 0.12, 0.05, 0.004, freezer ? m.ledBlue() : m.ledGreen(), 0, 1.84, d / 2 + 0.014));
	return g;
}

/** A chest freezer, 1.3 × 0.7 × 0.85 m, white. */
function chestFreezer() {
	const g = new THREE.Group();
	soft(g, 1.3, 0.82, 0.7, 0.03, m.white(), 0, 0.41, 0);
	soft(g, 1.32, 0.06, 0.72, 0.02, m.white(), 0, 0.85, 0);
	part(g, 0.3, 0.03, 0.03, m.graphite(), 0, 0.82, 0.36);
	return g;
}

/** The extraction hood, w long, 1.0 deep: a steel canopy at 2.0–2.4 m, its filters, the duct up through the roof. Its back at z 0. */
/** @param {number} w */
function extractionHood(w) {
	const g = new THREE.Group();
	part(g, w, 0.35, 1.0, m.steel(), 0, 2.33, 0.5);
	part(g, w - 0.1, 0.02, 0.9, m.steelDark(), 0, 2.15, 0.5);
	for (let i = 0; i < Math.floor(w / 0.5); i++) part(g, 0.46, 0.012, 0.4, m.graphite(), -w / 2 + 0.28 + i * 0.5, 2.15, 0.5);
	drum(g, 0.16, CEIL - FLOOR - 2.5, m.galv(), 0, 2.5, 0.4, 20);
	return g;
}

/* ------------------------------------------------------------------------------------------------------------------
 * The workshop's tools
 * ------------------------------------------------------------------------------------------------------------------ */

/** A workbench, w long, 0.75 deep, a beech top at 0.9 m, drawers at one end, a vice at the other. */
/** @param {number} w */
function workbench(w) {
	const g = new THREE.Group();
	const d = 0.75;
	part(g, w, 0.06, d, m.beech(), 0, 0.87, 0);
	for (let i = 0; i <= Math.round(w / 1.3); i++) {
		const x = -w / 2 + 0.04 + (i * (w - 0.08)) / Math.round(w / 1.3);
		for (const sz of [-1, 1]) part(g, 0.05, 0.84, 0.05, m.blue(), x, 0.42, sz * (d / 2 - 0.05));
	}
	part(g, w - 0.1, 0.02, d - 0.1, m.osb(), 0, 0.15, 0);
	part(g, 0.55, 0.62, d - 0.06, m.blue(), w / 2 - 0.35, 0.53, 0);
	for (let i = 0; i < 4; i++) {
		part(g, 0.5, 0.13, 0.012, m.grey(), w / 2 - 0.35, 0.3 + i * 0.15, d / 2 - 0.02);
		part(g, 0.14, 0.015, 0.02, m.chrome(), w / 2 - 0.35, 0.33 + i * 0.15, d / 2 - 0.005);
	}
	// the vice
	const vx = -w / 2 + 0.3;
	part(g, 0.2, 0.12, 0.22, m.blue(), vx, 0.96, d / 2 - 0.12);
	part(g, 0.2, 0.1, 0.05, m.graphite(), vx, 0.98, d / 2 + 0.02);
	bar(g, v3(vx, 0.96, d / 2 + 0.04), v3(vx, 0.96, d / 2 + 0.12), 0.012, m.chrome());
	bar(g, v3(vx - 0.12, 0.96, d / 2 + 0.12), v3(vx + 0.12, 0.96, d / 2 + 0.12), 0.008, m.chrome());
	// what lies on it: a plane, a square, offcuts, a cordless drill
	part(g, 0.25, 0.06, 0.07, m.blue(), 0.2, 0.93, 0.1);
	part(g, 0.3, 0.008, 0.04, m.chrome(), -0.2, 0.904, 0.05);
	part(g, 0.6, 0.045, 0.145, m.pine(), -0.6, 0.922, -0.1);
	g.add(cordlessDrill(0.6, 0.9, 0.05));
	return g;
}

/** A cordless drill lying at x, y, z. */
/** @param {number} x @param {number} y @param {number} z */
function cordlessDrill(x, y, z) {
	const g = new THREE.Group();
	part(g, 0.2, 0.07, 0.06, m.tool(), 0.02, 0.18, 0);
	part(g, 0.05, 0.14, 0.05, m.black(), 0.06, 0.08, 0);
	part(g, 0.1, 0.06, 0.08, m.black(), 0.06, 0.02, 0);
	bar(g, v3(-0.08, 0.18, 0), v3(-0.16, 0.18, 0), 0.01, m.chrome());
	g.position.set(x, y, z);
	g.rotation.z = Math.PI / 2;
	g.position.y = y + 0.035;
	return g;
}

/** A pegboard w × h, its back at z 0, hung with the hand tools a crew builds with. */
/** @param {number} w @param {number} h */
function pegboard(w, h) {
	const g = new THREE.Group();
	const holes = pegHoles().clone();
	holes.repeat.set(w / 0.4, h / 0.4);
	holes.needsUpdate = true;
	part(g, w, h, 0.012, new THREE.MeshStandardMaterial({ map: holes, roughness: 0.8 }), 0, h / 2, 0.02);
	const r = rng(7);
	const z = 0.04;
	let x = -w / 2 + 0.12;
	/** @param {number} hx @param {number} hy @param {THREE.Material} handle @param {number} len */
	const hammer = (hx, hy, handle, len) => {
		bar(g, v3(hx, hy - len, z), v3(hx, hy, z), 0.014, handle);
		part(g, 0.13, 0.035, 0.035, m.graphite(), hx, hy, z);
	};
	while (x < w / 2 - 0.2) {
		const k = Math.floor(r() * 7);
		const top = h - 0.15;
		if (k === 0) {
			hammer(x, top - 0.05, m.pineDark(), 0.32);
			hammer(x + 0.14, top - 0.05, m.red(), 0.28);
			x += 0.3;
		} else if (k === 1) {
			// a handsaw: the blade a thin wedge, its handle
			part(g, 0.5, 0.11, 0.004, m.chrome(), x + 0.25, top - 0.1, z);
			part(g, 0.12, 0.13, 0.03, m.red(), x - 0.02, top - 0.08, z);
			x += 0.6;
		} else if (k === 2) {
			// spanners, large to small
			for (let i = 0; i < 7; i++) part(g, 0.025, 0.24 - i * 0.02, 0.008, m.chrome(), x + i * 0.04, top - 0.12 - i * 0.01, z);
			x += 0.34;
		} else if (k === 3) {
			// screwdrivers in a row, coloured handles
			for (let i = 0; i < 6; i++) {
				const hx = x + i * 0.04;
				bar(g, v3(hx, top - 0.28, z), v3(hx, top - 0.14, z), 0.004, m.chrome());
				bar(g, v3(hx, top - 0.14, z), v3(hx, top - 0.04, z), 0.013, i % 2 ? m.red() : m.tool());
			}
			x += 0.3;
		} else if (k === 4) {
			// a spirit level, a tape, a square
			part(g, 0.6, 0.06, 0.03, m.yellow(), x + 0.3, top - 0.03, z);
			drum(g, 0.04, 0.03, m.tool(), x + 0.1, top - 0.2, z).rotation.x = Math.PI / 2;
			part(g, 0.3, 0.03, 0.006, m.chrome(), x + 0.4, top - 0.2, z);
			x += 0.7;
		} else if (k === 5) {
			// F-clamps
			for (let i = 0; i < 4; i++) {
				const cx = x + i * 0.07;
				part(g, 0.015, 0.4, 0.015, m.chrome(), cx, top - 0.22, z);
				part(g, 0.06, 0.02, 0.02, m.red(), cx + 0.03, top - 0.04, z);
				part(g, 0.06, 0.025, 0.02, m.red(), cx + 0.03, top - 0.3, z);
			}
			x += 0.36;
		} else {
			// pliers and chisels
			for (let i = 0; i < 4; i++) {
				bar(g, v3(x + i * 0.05, top - 0.24, z), v3(x + i * 0.05 - 0.015, top - 0.06, z), 0.008, m.red());
				bar(g, v3(x + i * 0.05 + 0.02, top - 0.24, z), v3(x + i * 0.05 + 0.035, top - 0.06, z), 0.008, m.red());
			}
			for (let i = 0; i < 4; i++) {
				const cx = x + 0.25 + i * 0.045;
				bar(g, v3(cx, top - 0.3, z), v3(cx, top - 0.18, z), 0.005 + i * 0.002, m.chrome());
				bar(g, v3(cx, top - 0.18, z), v3(cx, top - 0.06, z), 0.014, m.pineDark());
			}
			x += 0.48;
		}
		x += 0.08;
	}
	part(g, w, 0.025, 0.25, m.osb(), 0, h + 0.02, 0.125); // a shelf over it
	return g;
}

/** A cantilever timber rack on the wall, w long: posts, arms at four heights, boards, beams and OSB sheets on them. */
/** @param {number} w */
function timberRack(w) {
	const g = new THREE.Group();
	const posts = Math.max(2, Math.round(w / 1.3) + 1);
	const levels = [0.35, 0.95, 1.55, 2.15];
	for (let i = 0; i < posts; i++) {
		const x = -w / 2 + 0.05 + (i * (w - 0.1)) / (posts - 1);
		part(g, 0.06, 2.4, 0.08, m.frame(), x, 1.2, 0.04);
		for (const y of levels) part(g, 0.05, 0.05, 0.55, m.frame(), x, y, 0.32);
	}
	const r = rng(3);
	levels.forEach((y, li) => {
		if (li === 0) {
			for (let k = 0; k < 6; k++) part(g, w - 0.2, 0.018, 0.5, m.osb(), 0, y + 0.035 + k * 0.019, 0.33);
			return;
		}
		for (let s = 0; s < 3; s++)
			for (let k = 0; k < (li === 3 ? 2 : 3); k++) {
				const tw = li === 3 ? 0.1 : 0.145, th = li === 3 ? 0.1 : 0.045;
				part(g, w - 0.3 - r() * 0.6, th, tw, r() < 0.5 ? m.pine() : m.pineDark(), r() * 0.2, y + 0.025 + th / 2 + k * th, 0.12 + s * (tw + 0.01));
			}
	});
	return g;
}

/** A pillar drill on its stand, 1.6 m. */
function drillPress() {
	const g = new THREE.Group();
	part(g, 0.4, 0.05, 0.5, m.graphite(), 0, 0.025, 0);
	bar(g, v3(0, 0.05, -0.15), v3(0, 1.55, -0.15), 0.04, m.chrome());
	part(g, 0.3, 0.03, 0.3, m.graphite(), 0, 0.8, 0.05);
	part(g, 0.24, 0.24, 0.5, m.green(), 0, 1.45, 0);
	drum(g, 0.08, 0.2, m.green(), 0, 1.57, -0.2);
	bar(g, v3(0, 1.33, 0.12), v3(0, 1.15, 0.12), 0.012, m.chrome());
	for (let i = 0; i < 3; i++) {
		const a = (i * Math.PI * 2) / 3;
		bar(g, v3(0.14, 1.42, 0.05), v3(0.14, 1.42 + Math.cos(a) * 0.2, 0.05 + Math.sin(a) * 0.2), 0.008, m.chrome());
	}
	return g;
}

/** A bench grinder on its pedestal: two stones, their guards, 1.15 m. */
function benchGrinder() {
	const g = new THREE.Group();
	part(g, 0.35, 0.03, 0.35, m.graphite(), 0, 0.015, 0);
	bar(g, v3(0, 0.03, 0), v3(0, 0.85, 0), 0.04, m.graphite());
	const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.22, 16), m.green());
	motor.rotation.z = Math.PI / 2;
	motor.position.set(0, 0.95, 0);
	g.add(motor);
	for (const sx of [-1, 1]) {
		const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.025, 20), m.grey());
		stone.rotation.z = Math.PI / 2;
		stone.position.set(sx * 0.16, 0.95, 0);
		g.add(stone);
		const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 20, 1, false, Math.PI, Math.PI), m.green());
		guard.rotation.z = Math.PI / 2;
		guard.position.set(sx * 0.16, 0.95, 0);
		g.add(guard);
	}
	return g;
}

/** A mitre saw on its station: a table w long, the saw in the middle, wings for long boards. */
/** @param {number} w */
function mitreStation(w) {
	const g = new THREE.Group();
	part(g, w, 0.04, 0.6, m.osb(), 0, 0.88, 0);
	for (const sx of [-1, 1]) part(g, 0.05, 0.86, 0.5, m.frame(), sx * (w / 2 - 0.1), 0.43, 0);
	part(g, w - 0.1, 0.02, 0.5, m.osb(), 0, 0.2, 0);
	const saw = new THREE.Group();
	saw.position.set(0, 0.9, 0);
	g.add(saw);
	drum(saw, 0.22, 0.04, m.graphite(), 0, 0, 0.02, 24);
	part(saw, 0.5, 0.05, 0.12, m.graphite(), 0, 0.05, -0.08);
	part(saw, 0.08, 0.3, 0.08, m.teal(), 0, 0.2, -0.2);
	bar(saw, v3(0, 0.33, -0.2), v3(0, 0.35, 0.12), 0.03, m.teal());
	const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 24, 1, false, 0, Math.PI), m.teal());
	guard.rotation.z = Math.PI / 2;
	guard.rotation.y = Math.PI / 2;
	guard.position.set(0, 0.25, 0.06);
	saw.add(guard);
	part(saw, 0.12, 0.08, 0.06, m.black(), 0.06, 0.38, 0.12);
	return g;
}

/** A rolling tool chest, red, 0.7 × 0.46 × 1.0 m, a top box over it. */
function toolChest() {
	const g = new THREE.Group();
	part(g, 0.7, 0.85, 0.46, m.red(), 0, 0.5, 0);
	part(g, 0.68, 0.32, 0.42, m.red(), 0, 1.09, -0.02);
	for (let i = 0; i < 7; i++) {
		const y = 0.15 + i * 0.12;
		part(g, 0.66, 0.1, 0.01, m.red(), 0, y, 0.235);
		part(g, 0.4, 0.012, 0.02, m.chrome(), 0, y + 0.04, 0.245);
	}
	for (const sx of [-1, 1]) for (const sz of [-1, 1]) drum(g, 0.04, 0.03, m.rubber(), sx * 0.3, 0.01, sz * 0.18, 10);
	return g;
}

/** A MIG welder on its trolley with a gas bottle, its torch coiled on the hook. */
function welder() {
	const g = new THREE.Group();
	part(g, 0.6, 0.04, 0.42, m.graphite(), 0, 0.25, 0);
	for (const sx of [-1, 1]) {
		const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.05, 16), m.rubber());
		wheel.rotation.z = Math.PI / 2;
		wheel.position.set(0, 0.12, sx * 0.24);
		g.add(wheel);
	}
	part(g, 0.5, 0.42, 0.32, m.blue(), 0.03, 0.48, 0);
	unlit(part(g, 0.1, 0.05, 0.004, m.ledGreen(), 0.17, 0.62, 0.162));
	drum(g, 0.11, 1.05, m.grey(), -0.24, 0.27, 0);
	drum(g, 0.112, 0.15, m.green(), -0.24, 1.2, 0);
	drum(g, 0.03, 0.08, m.chrome(), -0.24, 1.35, 0, 10);
	const coil = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.015, 8, 24), m.black());
	coil.position.set(0.3, 0.75, 0.05);
	coil.rotation.y = Math.PI / 2;
	g.add(coil);
	return g;
}

/** An air compressor: a red tank on wheels, the pump and motor on it, a gauge. */
function compressor() {
	const g = new THREE.Group();
	const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.75, 20), m.red());
	tank.rotation.z = Math.PI / 2;
	tank.position.set(0, 0.28, 0);
	tank.castShadow = true;
	g.add(tank);
	drum(g, 0.1, 0.22, m.graphite(), -0.15, 0.45, 0);
	part(g, 0.22, 0.18, 0.2, m.graphite(), 0.15, 0.54, 0);
	drum(g, 0.035, 0.02, m.white(), 0.3, 0.5, 0.12).rotation.x = Math.PI / 2;
	for (const sz of [-1, 1]) {
		const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 14), m.rubber());
		wheel.rotation.x = Math.PI / 2;
		wheel.position.set(0.3, 0.08, sz * 0.2);
		g.add(wheel);
	}
	bar(g, v3(-0.38, 0.28, -0.15), v3(-0.45, 0.75, -0.15), 0.012, m.graphite());
	bar(g, v3(-0.38, 0.28, 0.15), v3(-0.45, 0.75, 0.15), 0.012, m.graphite());
	bar(g, v3(-0.45, 0.75, -0.15), v3(-0.45, 0.75, 0.15), 0.012, m.graphite());
	return g;
}

/** A steel shelf of stacked cordless tool cases (drills, impact drivers, saws, grinders) and their chargers. */
/** @param {number} w */
function caseShelf(w) {
	const g = rack(w, 0.42, 2.0, 4, m.frame());
	const r = rng(11);
	for (const y of g.userData.shelves) {
		let x = -w / 2 + 0.03;
		while (x < w / 2 - 0.42) {
			const tall = r() < 0.5 ? 0.16 : 0.22;
			const c = r() < 0.6 ? m.tool() : r() < 0.5 ? m.teal() : m.graphite();
			for (let k = 0; k < (y > 1.6 ? 1 : 2); k++) soft(g, 0.39, tall - 0.01, 0.3, 0.02, c, x + 0.2, y + tall / 2 + k * tall, 0);
			x += 0.42;
		}
	}
	return g;
}

/** A ladder, w long, hung flat on hooks; its back at z 0. */
/** @param {number} w */
function hungLadder(w) {
	const g = new THREE.Group();
	for (const y of [0, 0.42]) part(g, w, 0.07, 0.03, m.galv(), 0, y, 0.06);
	for (let x = -w / 2 + 0.15; x < w / 2; x += 0.28) bar(g, v3(x, 0, 0.06), v3(x, 0.42, 0.06), 0.014, m.galv());
	for (const x of [-w / 3, w / 3]) part(g, 0.03, 0.08, 0.1, m.frame(), x, -0.06, 0.05);
	return g;
}

/** Long-handled tools in a wall rack: spades, a shovel, a pickaxe, a rake, a sledgehammer, a crowbar. */
function toolRack() {
	const g = new THREE.Group();
	part(g, 1.4, 0.06, 0.12, m.frame(), 0, 1.45, 0.06);
	const tools = [
		[m.chrome(), 'spade'], [m.chrome(), 'shovel'], [m.graphite(), 'pick'], [m.green(), 'rake'], [m.graphite(), 'sledge'], [m.red(), 'bar']
	];
	tools.forEach(([mat, kind], i) => {
		const x = -0.6 + i * 0.24;
		if (kind === 'bar') return bar(g, v3(x, 0.05, 0.08), v3(x, 1.5, 0.08), 0.014, /** @type {THREE.Material} */ (mat));
		bar(g, v3(x, 0.3, 0.12), v3(x, 1.55, 0.12), 0.016, m.pineDark());
		if (kind === 'spade' || kind === 'shovel') part(g, kind === 'spade' ? 0.18 : 0.25, 0.3, 0.012, /** @type {THREE.Material} */ (mat), x, 0.18, 0.12);
		if (kind === 'pick') part(g, 0.6, 0.04, 0.04, /** @type {THREE.Material} */ (mat), x, 0.32, 0.12);
		if (kind === 'rake') part(g, 0.35, 0.04, 0.06, /** @type {THREE.Material} */ (mat), x, 0.3, 0.12);
		if (kind === 'sledge') part(g, 0.08, 0.18, 0.08, /** @type {THREE.Material} */ (mat), x, 0.32, 0.12);
	});
	return g;
}

/** A wheelbarrow, 1.45 m long, its wheel at +x. */
function wheelbarrow() {
	const g = new THREE.Group();
	part(g, 0.75, 0.04, 0.55, m.green(), 0.05, 0.38, 0);
	for (const sz of [-1, 1]) {
		const side = part(g, 0.75, 0.26, 0.03, m.green(), 0.05, 0.5, sz * 0.32);
		side.rotation.x = sz * 0.3;
		bar(g, v3(0.55, 0.22, sz * 0.12), v3(-0.75, 0.6, sz * 0.25), 0.015, m.graphite());
		bar(g, v3(-0.25, 0.37, sz * 0.2), v3(-0.3, 0, sz * 0.22), 0.012, m.graphite());
	}
	for (const sx of [-1, 1]) part(g, 0.03, 0.26, 0.6, m.green(), 0.05 + (sx * 0.38), 0.5, 0).rotation.z = -sx * 0.4;
	const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 10, 20), m.rubber());
	wheel.position.set(0.58, 0.2, 0);
	g.add(wheel);
	return g;
}

/** A site table saw on its stand, 0.75 × 0.65 m, its blade up through the top, the red stop button. */
function tableSaw() {
	const g = new THREE.Group();
	part(g, 0.75, 0.04, 0.65, m.grey(), 0, 0.9, 0);
	part(g, 0.6, 0.28, 0.5, m.teal(), 0, 0.74, 0);
	for (const sx of [-1, 1]) for (const sz of [-1, 1]) bar(g, v3(sx * 0.3, 0, sz * 0.25), v3(sx * 0.25, 0.6, sz * 0.2), 0.015, m.graphite());
	const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.004, 32, 1, false, 0, Math.PI), m.chrome());
	blade.rotation.z = Math.PI / 2;
	blade.rotation.y = Math.PI / 2;
	blade.position.set(0, 0.92, 0);
	g.add(blade);
	part(g, 0.04, 0.06, 0.65, m.chrome(), 0.2, 0.95, 0);
	part(g, 0.04, 0.04, 0.02, m.red(), -0.25, 0.8, 0.26);
	return g;
}

/** A concrete mixer: its orange drum tilted on a frame, two wheels, the motor box. */
function concreteMixer() {
	const g = new THREE.Group();
	for (const sz of [-1, 1]) {
		bar(g, v3(-0.45, 0, sz * 0.3), v3(0, 0.75, sz * 0.3), 0.025, m.frame());
		bar(g, v3(0.45, 0.18, sz * 0.3), v3(0, 0.75, sz * 0.3), 0.025, m.frame());
		const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.06, 16), m.rubber());
		wheel.rotation.x = Math.PI / 2;
		wheel.position.set(0.45, 0.18, sz * 0.38);
		g.add(wheel);
	}
	const pts = [v3(0, -0.35, 0), v3(0.3, -0.3, 0), v3(0.38, -0.05, 0), v3(0.36, 0.1, 0), v3(0.18, 0.4, 0), v3(0.17, 0.42, 0)].map((p) => new THREE.Vector2(p.x, p.y));
	const drumMesh = new THREE.Mesh(new THREE.LatheGeometry(pts, 24), paint('#e0661f'));
	drumMesh.material.side = THREE.DoubleSide;
	drumMesh.position.set(0, 1.05, 0);
	drumMesh.rotation.z = 0.6;
	drumMesh.castShadow = true;
	g.add(drumMesh);
	part(g, 0.3, 0.25, 0.25, m.graphite(), -0.2, 0.7, 0);
	return g;
}

/** A pair of sawhorses and a board across them. */
function sawhorses() {
	const g = new THREE.Group();
	for (const x of [-0.6, 0.6]) {
		part(g, 0.08, 0.06, 0.9, m.pine(), x, 0.72, 0);
		for (const sz of [-1, 1]) for (const sx of [-1, 1]) bar(g, v3(x, 0.7, sz * 0.38), v3(x + sx * 0.18, 0, sz * 0.42), 0.02, m.pine());
	}
	part(g, 2.0, 0.045, 0.2, m.pineDark(), 0, 0.775, 0.1);
	return g;
}

/* ------------------------------------------------------------------------------------------------------------------
 * The tech container's machines
 * ------------------------------------------------------------------------------------------------------------------ */

/** A solar panel, 1.72 × 1.13 m, its aluminium frame, lying flat at its origin. */
const pvMat = shared(() => new THREE.MeshStandardMaterial({ map: pvCells(), roughness: 0.25, metalness: 0.3 }));
/** @param {THREE.Object3D} g @param {number} x @param {number} y @param {number} z @param {number} tilt about x (the low edge towards +z for a positive tilt) */
function pvPanel(g, x, y, z, tilt) {
	const p = new THREE.Group();
	p.position.set(x, y, z);
	p.rotation.x = tilt;
	g.add(p);
	part(p, 1.72, 0.035, 1.13, m.galv(), 0, 0, 0);
	const face = new THREE.Mesh(new THREE.PlaneGeometry(1.68, 1.09), pvMat());
	face.rotation.x = -Math.PI / 2;
	face.position.y = 0.019;
	face.receiveShadow = true;
	p.add(face);
	return p;
}

/** The solar array: two rows of seven panels on rails over the roof, a wing of seven folded out each side on struts — 28 panels, about 11 kWp. */
/** @param {THREE.Group} roof */
function solarArray(roof) {
	for (const sz of [-1, 1]) part(roof, L - 0.2, 0.05, 0.05, m.galv(), 0, H + 0.08, sz * 0.75);
	for (let i = 0; i < 7; i++) {
		const x = -L / 2 + 0.1 + 0.86 + i * 1.73;
		for (const sz of [-1, 1]) pvPanel(roof, x, H + 0.14 + (sz < 0 ? 0.04 : 0), sz * 0.575, 0.035);
		for (const sz of [-1, 1]) {
			// the wings, a little lower and tilted out
			pvPanel(roof, x, H + 0.02, sz * (W / 2 + 0.62), sz * 0.12);
			bar(roof, v3(x, 2.05, sz * (W / 2 + 0.03)), v3(x, H - 0.02, sz * (W / 2 + 1.05)), 0.02, m.galv());
		}
	}
}

/** Starlink on a mast: the rectangular dish (51 × 30 cm) tipped to the sky; its mast clamped to the end wall. */
function starlinkMast() {
	const g = new THREE.Group();
	bar(g, v3(0, 1.8, 0), v3(0, H + 1.25, 0), 0.025, m.galv());
	for (const y of [2.0, 2.7]) part(g, 0.12, 0.06, 0.06, m.frame(), 0.06, y, 0);
	const dish = new THREE.Group();
	dish.position.set(0, H + 1.3, 0);
	dish.rotation.x = -0.35;
	g.add(dish);
	soft(dish, 0.513, 0.04, 0.303, 0.015, m.white(), 0, 0.05, 0);
	bar(dish, v3(0, 0, 0), v3(0, 0.04, 0), 0.02, m.white());
	bar(g, v3(0, 2.3, 0), v3(0, 0.8, 0.0), 0.006, m.black()); // its cable down
	return g;
}

/** A battery cabinet: 0.6 × 0.6 × 2.0 m, eight LFP modules of 5 kWh behind a glass door, their charge lights. */
function batteryCabinet() {
	const g = new THREE.Group();
	part(g, 0.6, 2.0, 0.6, m.white(), 0, 1.0, 0);
	part(g, 0.56, 0.1, 0.02, m.graphite(), 0, 1.92, 0.3);
	unlit(part(g, 0.14, 0.06, 0.004, m.ledBlue(), 0.15, 1.92, 0.312));
	for (let i = 0; i < 8; i++) {
		const y = 0.18 + i * 0.21;
		part(g, 0.52, 0.18, 0.02, m.graphite(), 0, y, 0.3);
		for (let k = 0; k < 4; k++) unlit(part(g, 0.018, 0.012, 0.004, k < 3 || i % 3 ? m.ledGreen() : m.black(), -0.2 + k * 0.03, y + 0.05, 0.312));
	}
	return g;
}

/** A hybrid inverter on the wall, 0.5 × 0.7 × 0.22 m, its display and isolator under it; its back at z 0. */
function inverter() {
	const g = new THREE.Group();
	part(g, 0.5, 0.7, 0.22, m.blue(), 0, 1.45, 0.11);
	part(g, 0.3, 0.08, 0.01, m.black(), 0, 1.6, 0.225);
	unlit(part(g, 0.22, 0.05, 0.004, m.ledBlue(), 0, 1.6, 0.231));
	part(g, 0.16, 0.2, 0.1, m.grey(), 0, 0.92, 0.05);
	part(g, 0.04, 0.04, 0.03, m.red(), 0, 0.95, 0.11);
	part(g, 0.1, CEIL - 1.8 - FLOOR, 0.06, m.grey(), 0, 1.8 + (CEIL - 1.8 - FLOOR) / 2, 0.03); // its trunking up to the tray
	return g;
}

/** A tall grey cabinet w wide with its name on it: the distribution board, the fuel cell, the electrolyser. */
/** @param {number} w @param {number} d @param {number} h @param {string} name @param {string} band */
function cabinet(w, d, h, name, band) {
	const g = new THREE.Group();
	part(g, w, h, d, m.grey(), 0, h / 2, 0);
	part(g, w, 0.12, 0.012, std(band, 0.5)(), 0, h - 0.2, d / 2 + 0.006);
	unlit(sheet(g, Math.min(0.5, w - 0.1), 0.12, plateMat(name, '#d6d6d1', '#27312d'), 0, h - 0.4, d / 2 + 0.008));
	part(g, 0.008, h - 0.1, 0.004, m.graphite(), 0, h / 2, d / 2 + 0.003);
	for (let i = 0; i < 8; i++) part(g, w * 0.35, 0.012, 0.006, m.graphite(), -w / 4, 0.25 + i * 0.04, d / 2 + 0.003);
	part(g, 0.025, 0.12, 0.03, m.black(), w / 2 - 0.08, h / 2, d / 2 + 0.015);
	unlit(part(g, 0.12, 0.07, 0.004, m.ledGreen(), w / 4, h - 0.55, d / 2 + 0.008));
	return g;
}

/** A server rack, 0.6 × 1.0 × 2.0 m (42 units), its mesh door showing the servers and their lights. */
/** @param {number} seed */
function serverRack(seed) {
	const g = new THREE.Group();
	part(g, 0.6, 2.0, 1.0, m.black(), 0, 1.0, 0);
	const face = sheet(g, 0.56, 1.96, new THREE.MeshStandardMaterial({ map: rackFront(seed, false), emissive: '#ffffff', emissiveMap: rackFront(seed, true), emissiveIntensity: 1.4, roughness: 0.5 }), 0, 1.0, 0.501);
	face.receiveShadow = true;
	part(g, 0.025, 1.96, 0.02, m.graphite(), 0.27, 1.0, 0.51);
	return g;
}

/** A wall-mounted air conditioner's indoor unit, 0.9 × 0.3 × 0.22 m; its back at z 0. */
function acIndoor() {
	const g = new THREE.Group();
	soft(g, 0.9, 0.3, 0.22, 0.04, m.white(), 0, 0, 0.11);
	part(g, 0.8, 0.03, 0.02, m.grey(), 0, -0.1, 0.22);
	unlit(part(g, 0.03, 0.012, 0.004, m.ledBlue(), 0.35, 0.05, 0.222));
	return g;
}

/** An air conditioner's outdoor unit, 0.8 × 0.3 × 0.6 m, its fan behind a grille facing +z. */
function acOutdoor() {
	const g = new THREE.Group();
	part(g, 0.8, 0.6, 0.3, m.white(), 0, 0.3, 0);
	const grille = new THREE.Mesh(new THREE.CircleGeometry(0.22, 24), m.graphite());
	grille.position.set(-0.1, 0.3, 0.151);
	g.add(grille);
	for (let i = 0; i < 4; i++) {
		const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06 + i * 0.05, 0.004, 4, 24), m.galv());
		ring.position.set(-0.1, 0.3, 0.155);
		g.add(ring);
	}
	return g;
}

/** A bundle of six hydrogen bottles in a steel cage, 0.6 × 0.9 × 1.8 m, their red shoulders; the regulator and a yellow pipe. */
function hydrogenBundle() {
	const g = new THREE.Group();
	for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(g, 0.05, 1.8, 0.05, m.frame(), sx * 0.28, 0.9, sz * 0.43);
	for (const y of [0.05, 0.9, 1.75]) for (const sz of [-1, 1]) part(g, 0.6, 0.04, 0.03, m.frame(), 0, y, sz * 0.43);
	for (let i = 0; i < 6; i++) {
		const x = (i % 2 ? 0.12 : -0.12), z = -0.28 + Math.floor(i / 2) * 0.28;
		drum(g, 0.11, 1.4, m.grey(), x, 0.05, z);
		drum(g, 0.11, 0.18, m.red(), x, 1.45, z);
		drum(g, 0.025, 0.08, m.chrome(), x, 1.63, z, 8);
	}
	part(g, 0.14, 0.1, 0.1, m.chrome(), 0.2, 1.7, 0);
	return g;
}

/* ------------------------------------------------------------------------------------------------------------------
 * The sanitary fittings
 * ------------------------------------------------------------------------------------------------------------------ */

/** A front-loading washing machine (or a tumble dryer), 60 × 60 × 85 cm, its round door. */
/** @param {boolean} dryer */
function frontLoader(dryer) {
	const g = new THREE.Group();
	part(g, 0.6, 0.85, 0.6, m.white(), 0, 0.425, 0);
	part(g, 0.6, 0.1, 0.012, m.grey(), 0, 0.78, 0.306);
	const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.03, 10, 32), m.grey());
	ring.position.set(0, 0.42, 0.31);
	g.add(ring);
	const door = new THREE.Mesh(new THREE.CircleGeometry(0.15, 32), dryer ? m.white() : m.black());
	door.position.set(0, 0.42, 0.315);
	g.add(door);
	const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.02, 16), m.chrome());
	knob.rotation.x = Math.PI / 2;
	knob.position.set(0.18, 0.78, 0.32);
	g.add(knob);
	unlit(part(g, 0.08, 0.03, 0.004, m.ledBlue(), 0, 0.78, 0.314));
	return g;
}

/** A dryer stacked on a washer in its frame: 60 × 62 × 175 cm. */
function laundryTower() {
	const g = new THREE.Group();
	g.add(frontLoader(false));
	const top = frontLoader(true);
	top.position.y = 0.88;
	g.add(top);
	part(g, 0.62, 0.03, 0.62, m.grey(), 0, 0.865, 0);
	return g;
}

/** A utility sink: a deep steel tub on legs, a tap. */
function utilitySink() {
	const g = steelTable(0.6, 0.55, { h: 0.9, shelf: true, upstand: true });
	part(g, 0.5, 0.3, 0.45, m.steelDark(), 0, 0.75, 0.02);
	bar(g, v3(0, 0.95, -0.24), v3(0, 1.25, -0.24), 0.015, m.chrome());
	bar(g, v3(0, 1.25, -0.24), v3(0, 1.22, -0.05), 0.012, m.chrome());
	return g;
}

/** A heat-pump water heater: 300 litres, 0.65 m across, 1.9 m high, its fan unit on top. */
function heatPumpBoiler() {
	const g = new THREE.Group();
	drum(g, 0.32, 1.55, m.white(), 0, 0, 0, 32);
	drum(g, 0.3, 0.35, m.grey(), 0, 1.55, 0, 32);
	unlit(part(g, 0.12, 0.06, 0.004, m.ledBlue(), 0, 1.3, 0.322));
	bar(g, v3(-0.1, 0.4, -0.3), v3(-0.1, CEIL - FLOOR - 0.05, -0.3), 0.015, m.red());
	bar(g, v3(0.1, 0.2, -0.3), v3(0.1, CEIL - FLOOR - 0.05, -0.3), 0.015, m.blue());
	return g;
}

/** A shower: a white tray 0.9 m square, a rain head from the wall, a hand shower on its rail, the mixer. Its back at z 0. */
function showerSet() {
	const g = new THREE.Group();
	part(g, 0.9, 0.04, 0.9, m.white(), 0, 0.02, 0.45);
	part(g, 0.6, 0.006, 0.05, m.graphite(), 0, 0.043, 0.8);
	bar(g, v3(0, 2.05, 0.02), v3(0, 2.05, 0.35), 0.012, m.chrome());
	drum(g, 0.13, 0.012, m.chrome(), 0, 2.03, 0.35, 32);
	bar(g, v3(0.3, 0.9, 0.03), v3(0.3, 1.9, 0.03), 0.01, m.chrome());
	part(g, 0.04, 0.2, 0.04, m.chrome(), 0.3, 1.5, 0.06);
	part(g, 0.2, 0.06, 0.06, m.chrome(), 0, 1.05, 0.03);
	return g;
}

/** A dryer for hands on the wall, its back at z 0. */
function handDryer() {
	const g = new THREE.Group();
	soft(g, 0.3, 0.6, 0.2, 0.05, m.steel(), 0, 0, 0.1);
	part(g, 0.22, 0.03, 0.08, m.graphite(), 0, -0.18, 0.18);
	return g;
}

/** An IBC tank: 1000 litres of rainwater in a white bottle inside a galvanised cage, on its pallet. */
function ibcTank() {
	const g = new THREE.Group();
	part(g, 1.2, 0.14, 1.0, m.galv(), 0, 0.07, 0);
	soft(g, 1.12, 0.95, 0.94, 0.06, std('#f2f0e6', 0.4, { transparent: true, opacity: 0.92 })(), 0, 0.62, 0);
	for (let i = 0; i <= 4; i++) {
		const x = -0.58 + i * 0.29;
		for (const sz of [-1, 1]) bar(g, v3(x, 0.14, sz * 0.5), v3(x, 1.12, sz * 0.5), 0.01, m.galv());
	}
	for (const y of [0.4, 0.75, 1.12]) for (const sz of [-1, 1]) bar(g, v3(-0.6, y, sz * 0.5), v3(0.6, y, sz * 0.5), 0.01, m.galv());
	drum(g, 0.08, 0.04, m.graphite(), 0, 1.1, 0);
	return g;
}

/* ------------------------------------------------------------------------------------------------------------------
 * The four containers
 * ------------------------------------------------------------------------------------------------------------------ */

/** Finish a container: what walks it, and the handles a world (or the viewer) needs. */
/** @param {ReturnType<typeof box>} b */
function done(b) {
	b.g.userData.roof = b.roof;
	b.g.userData.walk = walkway(b.solids, b.lamps);
	return b.g;
}

/**
 * The kitchen container: a central kitchen for the crew, and behind a partition its pantry.
 * From the open end: the pass and the serving hatch on the front, the cooking line under its hood on the back — the
 * six-burner range, the combi steamer — then the prep tables, the sinks, the dishwasher, the fridges and the freezer;
 * then through the partition door the pantry: shelves of jars, tins, boxes and crates, sacks of grain on a pallet, its
 * own door out for deliveries.
 */
export function kitchenContainer() {
	const b = box({
		name: 'kitchen container',
		color: '#c4614a',
		floor: floorMaterial('#3c3f42'),
		label: 'KITCHEN',
		labelX: -1.0,
		front: [
			{ u0: 1.6, u1: 3.6, y0: 1.05, y1: 2.05 }, // the serving hatch
			{ u0: -4.3, u1: -3.4, y0: FLOOR, y1: 2.2, door: true } // the pantry's door out
		]
	});
	const { g, roof, solids } = b;
	const f = fitter(g, solids);
	const r = rng(21);

	// the serving hatch: its flap propped up outside, a counter under it either side
	const flap = new THREE.Group();
	flap.position.set(2.6, 2.07, W / 2);
	flap.rotation.x = -0.35;
	g.add(flap);
	part(flap, 2.0, 0.03, 0.9, b.skin, 0, 0, 0.45);
	for (const x of [1.75, 3.45]) bar(g, v3(x, 1.5, W / 2 + 0.02), v3(x, 2.07 + Math.sin(0.35) * 0.85, W / 2 + Math.cos(0.35) * 0.85), 0.012, m.galv());
	part(g, 2.0, 0.04, 0.35, m.steel(), 2.6, 1.05, W / 2 + 0.175);
	for (const x of [1.8, 3.4]) part(g, 0.03, 0.25, 0.3, m.frame(), x, 0.92, W / 2 + 0.15);
	f.block(1.6, 3.6, W / 2, W / 2 + 0.35);
	f.put(steelTable(2.0, 0.5, { upstand: false }), 2.6, atFront(0.5), { ry: Math.PI, w: 2.0, d: 0.5 });
	for (const x of [2.0, 2.6, 3.2]) unlit(part(g, 0.25, 0.08, 0.2, m.heat(), x, 1.98, Z1 - 0.25)); // heat lamps over the pass
	for (const x of [1.9, 2.45, 3.0]) drum(g, 0.13, 0.12, m.white(), x, FLOOR + 0.9, Z1 - 0.25, 24); // plates waiting

	// the back: the cooking line under its hood, prep, sinks, the dishwasher
	f.put(range6(), 1.35, atBack(0.75), { w: 1.2, d: 0.75 });
	f.put(combiSteamer(), 2.45, atBack(0.8), { w: 0.9, d: 0.8 });
	f.put(extractionHood(2.2), 1.8, Z0, { y: FLOOR });
	unlit(drum(roof, 0.2, 0.25, m.galv(), 1.8, H, Z0 + 0.4, 20)); // the hood's cowl on the roof
	drum(roof, 0.3, 0.04, m.galv(), 1.8, H + 0.27, Z0 + 0.4, 20);
	const prep = f.put(steelTable(1.3, 0.7), 0.1, atBack(0.7), { w: 1.3, d: 0.7 });
	part(prep, 0.45, 0.03, 0.3, m.beech(), -0.2, 0.915, 0.05); // a board, a knife, a bowl of onions
	part(prep, 0.22, 0.004, 0.03, m.chrome(), -0.15, 0.935, 0.05);
	drum(prep, 0.13, 0.08, m.steel(), 0.35, 0.9, 0.05, 20);
	f.put(sinkTable(1.4), -1.25, atBack(0.7), { w: 1.4, d: 0.7 });
	f.put(hoodDishwasher(), -2.3, atBack(0.74), { w: 0.66, d: 0.74 });
	const shelf = f.put(wallShelf(2.6, 0.35, 1.7), -0.6, Z0, { y: FLOOR });
	stock(shelf.userData.on, 2.4, 0.3, 1.72, 'pots', r);
	const plates = f.put(rack(1.2, 0.45, 1.8, 5), 4.4, atBack(0.45), { w: 1.2, d: 0.45 });
	stock(plates, 1.15, 0.45, 0.17, 'boxes', r);
	for (const y of plates.userData.shelves.slice(1)) for (let i = 0; i < 4; i++) drum(plates, 0.12, 0.09, m.white(), -0.42 + i * 0.28, y, 0, 24);
	f.put(extinguisher(), 5.6, Z0, { y: FLOOR + 0.9 });

	// the front: the fridges, the freezer, a prep table
	f.put(uprightFridge(2), -1.7, atFront(0.7), { ry: Math.PI, w: 1.4, d: 0.7 });
	f.put(uprightFridge(1, true), -0.6, atFront(0.7), { ry: Math.PI, w: 0.7, d: 0.7 });
	f.put(steelTable(1.0, 0.6), 0.55, atFront(0.6), { ry: Math.PI, w: 1.0, d: 0.6 });
	f.put(chestFreezer(), 4.55, atFront(0.7), { ry: Math.PI, w: 1.3, d: 0.7 });

	// the partition, its door, and the pantry behind it
	const px = -2.75;
	part(g, 0.08, CEIL - FLOOR, 0.95, m.lining(), px, FLOOR + (CEIL - FLOOR) / 2, Z0 + 0.475);
	part(g, 0.08, CEIL - FLOOR - 2.1, Z1 - Z0 - 0.95, m.lining(), px, 2.1 + FLOOR + (CEIL - FLOOR - 2.1) / 2, Z1 - (Z1 - Z0 - 0.95) / 2);
	f.block(px - 0.04, px + 0.04, Z0, Z0 + 0.95);
	unlit(sheet(g, 0.5, 0.12, plateMat('PANTRY', '#f4f1ea', '#7c3324'), px + 0.045, 2.3, Z0 + 0.5, Math.PI / 2));
	for (const [x, kind] of /** @type {const} */ ([[-3.45, 'jars'], [-4.6, 'tins']])) {
		const s = f.put(rack(1.1, 0.5, 2.1, 5), x, atBack(0.5), { w: 1.1, d: 0.5 });
		s.userData.shelves.forEach((/** @type {number} */ y, /** @type {number} */ i) => stock(s, 1.05, 0.5, y, i === 0 ? 'crates' : i === 4 ? 'boxes' : i % 2 ? kind : 'bottles', r));
	}
	const front = f.put(rack(1.5, 0.45, 2.1, 5), -5.15, atFront(0.45), { ry: Math.PI, w: 1.5, d: 0.45 });
	front.userData.shelves.forEach((/** @type {number} */ y, /** @type {number} */ i) => stock(front, 1.45, 0.45, y, i < 2 ? 'crates' : i === 4 ? 'boxes' : 'jars', r));
	// a pallet of sacks — rice, flour, grain, beans — against the end wall
	const pallet = f.put(new THREE.Group(), -5.58, -0.35, { w: 0.8, d: 1.2 });
	part(pallet, 0.8, 0.14, 1.2, m.pine(), 0, 0.07, 0);
	for (let k = 0; k < 3; k++) for (const sz of [-1, 1]) soft(pallet, 0.7, 0.16, 0.5, 0.07, m.sack(), 0, 0.22 + k * 0.17, sz * 0.27);
	unlit(sheet(g, 0.5, 0.12, plateMat('COLD · 4 °C', '#2a64a8', '#ffffff'), -1.7, 2.32, Z1 - 0.36, Math.PI));
	return done(b);
}

/**
 * The workshop container: what a crew needs to build a small settlement. On the back wall the timber rack
 * (boards, beams, OSB) and a 4 m bench under a pegboard of hand tools, the pillar drill and the grinder; on the front,
 * under a band of windows, the mitre saw on its station, the tool chest, the welder and the compressor, cordless tools
 * in their cases, the spades and a ladder, a wheelbarrow; the table saw by the door; a concrete mixer and sawhorses
 * outside.
 */
export function workshopContainer() {
	const b = box({
		name: 'workshop container',
		color: '#3f6f93',
		floor: floorMaterial('#a98757'),
		label: 'WORKSHOP',
		labelX: 3.0,
		front: [{ u0: -2.9, u1: 1.9, y0: 1.35, y1: 2.15, glass: 'clear' }]
	});
	const { g, solids } = b;
	const f = fitter(g, solids);

	// the back wall
	f.put(timberRack(3.9), -3.95, Z0, { y: FLOOR });
	f.block(-5.9, -2.0, Z0, Z0 + 0.6);
	f.put(workbench(4.0), 0.1, atBack(0.75), { w: 4.0, d: 0.75 });
	f.put(pegboard(4.0, 1.25), 0.1, Z0, { y: FLOOR + 1.0 });
	f.put(drillPress(), 2.6, Z0 + 0.32, { w: 0.45, d: 0.55 });
	f.put(benchGrinder(), 3.4, Z0 + 0.3, { w: 0.45, d: 0.4 });
	f.put(caseShelf(1.3), 4.6, atBack(0.42), { w: 1.3, d: 0.42 });
	f.put(extinguisher(), 5.6, Z0, { y: FLOOR + 0.9 });

	// the front wall
	f.put(hungLadder(2.6), -4.5, Z1, { ry: Math.PI, y: FLOOR + 1.8 });
	f.put(toolRack(), -5.1, Z1, { ry: Math.PI });
	f.block(-5.85, -4.35, Z1 - 0.2, Z1);
	f.put(wheelbarrow(), -3.55, Z1 - 0.38, { ry: Math.PI, w: 1.45, d: 0.65 });
	f.put(mitreStation(2.2), -1.5, atFront(0.6), { ry: Math.PI, w: 2.2, d: 0.6 });
	f.put(toolChest(), 0.15, atFront(0.46), { ry: Math.PI, w: 0.7, d: 0.46 });
	f.put(welder(), 1.0, Z1 - 0.28, { ry: Math.PI, w: 0.62, d: 0.5 });
	f.put(compressor(), 2.05, Z1 - 0.3, { ry: Math.PI, w: 0.95, d: 0.48 });
	f.put(tableSaw(), 4.55, Z1 - 0.4, { ry: Math.PI / 2, w: 0.75, d: 0.65 });
	// a cable reel and an extension on the floor, a first-aid box by the door
	const reel = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.06, 10, 20), m.red());
	reel.position.set(3.4, FLOOR + 0.2, Z1 - 0.2);
	g.add(reel);
	part(g, 0.3, 0.3, 0.12, std('#2e9e4f', 0.5)(), 5.55, FLOOR + 1.5, Z1 - 0.06);
	part(g, 0.12, 0.03, 0.005, m.white(), 5.55, FLOOR + 1.5, Z1 - 0.12);
	part(g, 0.03, 0.12, 0.005, m.white(), 5.55, FLOOR + 1.5, Z1 - 0.12);

	// outside: a mixer and sawhorses with a board across them
	f.put(concreteMixer(), L / 2 + 1.0, W / 2 + 1.4, { ry: 0.5, w: 1.1, d: 0.9 });
	f.put(sawhorses(), L / 2 - 2.0, W / 2 + 1.5, { w: 2.0, d: 0.95 });
	return done(b);
}

/**
 * The tech container: the settlement's power, its link to the world and its AI. Solar on the roof and on wings
 * folded out either side, about 11 kWp (as Africa GreenTec's Solartainer); inside from the open end the control desk,
 * the hybrid inverters and the distribution board, 40 kWh of LFP batteries in five cabinets; a hydrogen fuel cell and
 * the electrolyser that fills its bottles from the summer's surplus (the bottles caged outside); Starlink on its mast;
 * and behind a glass wall the AI server room, seven racks along the back, cooled by two split units.
 */
export function techContainer() {
	const b = box({
		name: 'tech container',
		color: '#5e8a6b',
		floor: floorMaterial('#9b9e9f'),
		label: 'TECH',
		labelX: 0,
		front: [{ u0: 3.6, u1: 4.4, y0: 1.5, y1: 2.2, glass: 'clear' }]
	});
	const { g, roof, solids } = b;
	const f = fitter(g, solids);
	solarArray(roof);
	f.put(starlinkMast(), -L / 2 - 0.08, 0.95, { y: 0 });
	part(g, 0.06, 0.12, 0.06, m.frame(), -L / 2 - 0.03, 2.0, 0.95);

	// the power room: batteries along the back, the distribution board; the inverters and the desk on the front
	for (let i = 0; i < 5; i++) f.put(batteryCabinet(), 1.9 + i * 0.62, atBack(0.6), { w: 0.6, d: 0.6 });
	f.put(cabinet(0.8, 0.4, 2.0, 'DISTRIBUTION', '#f2c230'), 5.2, atBack(0.4), { w: 0.8, d: 0.4 });
	for (let i = 0; i < 3; i++) f.put(inverter(), 1.4 + i * 0.6, Z1, { ry: Math.PI, y: FLOOR });
	f.block(1.1, 2.9, Z1 - 0.22, Z1);
	part(g, 4.6, 0.08, 0.3, m.galv(), 3.3, CEIL - 0.15, Z1 - 0.3); // the cable tray
	part(g, 11.5, 0.08, 0.3, m.galv(), 0, CEIL - 0.15, Z0 + 0.25);
	const desk = f.put(steelTable(1.2, 0.6, { upstand: false, shelf: false }), 4.9, atFront(0.6), { ry: Math.PI, w: 1.2, d: 0.6 });
	part(desk, 0.55, 0.34, 0.03, m.black(), 0, 1.15, 0.1);
	unlit(sheet(desk, 0.52, 0.3, screenMat(), 0, 1.15, 0.116));
	bar(desk, v3(0, 0.9, 0.08), v3(0, 0.98, 0.08), 0.02, m.black());
	part(desk, 0.4, 0.015, 0.13, m.graphite(), 0, 0.91, -0.12);
	drum(g, 0.2, 0.05, m.graphite(), 4.9, FLOOR + 0.45, Z1 - 0.9, 20); // a stool
	bar(g, v3(4.9, FLOOR, Z1 - 0.9), v3(4.9, FLOOR + 0.45, Z1 - 0.9), 0.025, m.graphite());
	f.put(extinguisher(), 5.75, Z1, { ry: Math.PI, y: FLOOR + 0.9 });

	// hydrogen: the fuel cell and the electrolyser, the water they need, the gas line out to the bottles
	f.put(cabinet(1.1, 0.75, 1.9, 'FUEL CELL H₂', '#2f8a4a'), -0.35, atBack(0.75), { w: 1.1, d: 0.75 });
	f.put(cabinet(1.0, 0.75, 1.9, 'ELECTROLYSER', '#2a64a8'), 0.8, atBack(0.75), { w: 1.0, d: 0.75 });
	drum(g, 0.22, 1.1, m.white(), 0.2, FLOOR, Z1 - 0.25, 24); // its water, deionised
	f.block(-0.02, 0.42, Z1 - 0.47, Z1);
	unlit(sheet(g, 0.3, 0.075, plateMat('H₂O', '#ffffff', '#2a64a8'), 0.2, FLOOR + 0.8, Z1 - 0.47, Math.PI));
	bar(g, v3(-0.35, FLOOR + 1.9, Z0 + 0.3), v3(-0.35, CEIL - 0.3, Z0 + 0.3), 0.014, m.yellow());
	bar(g, v3(-0.35, CEIL - 0.3, Z0 + 0.3), v3(X0, CEIL - 0.3, Z0 + 0.3), 0.014, m.yellow());
	unlit(sheet(g, 0.2, 0.18, plateMat('⚠ H₂', '#f2c230', '#1b1c1e'), 1.5, FLOOR + 1.6, Z0 + 0.01));

	// the glass wall, its door open, and the server room behind it
	const gx = -1.3;
	unlit(part(g, 0.012, CEIL - FLOOR, 1.45, m.glass(), gx, FLOOR + (CEIL - FLOOR) / 2, Z0 + 0.725));
	part(g, 0.05, CEIL - FLOOR, 0.05, m.frame(), gx, FLOOR + (CEIL - FLOOR) / 2, Z0 + 1.45);
	part(g, 0.05, 0.05, Z1 - Z0, m.frame(), gx, CEIL - 0.025, 0);
	part(g, 0.05, CEIL - FLOOR - 2.15, Z1 - Z0 - 1.45, m.frame(), gx, FLOOR + 2.15 + (CEIL - FLOOR - 2.15) / 2, Z1 - (Z1 - Z0 - 1.45) / 2);
	f.block(gx - 0.03, gx + 0.03, Z0, Z0 + 1.48);
	const door = new THREE.Group();
	door.position.set(gx, FLOOR, Z1 - 0.03);
	door.rotation.y = Math.PI;
	g.add(door);
	unlit(part(door, 0.72, 2.1, 0.012, m.glass(), 0.36, 1.05, 0));
	part(door, 0.03, 0.6, 0.03, m.chrome(), 0.65, 1.05, -0.03);
	f.block(gx - 0.75, gx, Z1 - 0.06, Z1);
	unlit(sheet(g, 0.5, 0.12, plateMat('AI SERVERS', '#1b1c1e', '#38e07a'), gx + 0.01, 2.35, Z0 + 0.7, Math.PI / 2));
	for (let i = 0; i < 7; i++) f.put(serverRack(i + 1), -5.55 + i * 0.6, atBack(1.0), { w: 0.6, d: 1.0 });
	for (const x of [-4.8, -2.6]) f.put(acIndoor(), x, Z1, { ry: Math.PI, y: FLOOR + 2.15 });
	const net = f.put(new THREE.Group(), -3.7, Z1, { ry: Math.PI, y: FLOOR + 1.05 });
	part(net, 0.6, 0.6, 0.45, m.black(), 0, 0.3, 0.225);
	unlit(part(net, 0.5, 0.5, 0.006, m.glass(), 0, 0.3, 0.452));
	part(net, 0.44, 0.045, 0.3, m.graphite(), 0, 0.42, 0.25);
	for (let k = 0; k < 12; k++) unlit(part(net, 0.012, 0.008, 0.004, k % 4 ? m.ledGreen() : m.ledBlue(), -0.18 + k * 0.03, 0.43, 0.402));
	soft(net, 0.22, 0.05, 0.16, 0.02, m.white(), -0.1, 0.17, 0.25); // the Starlink router
	f.block(-4.0, -3.4, Z1 - 0.45, Z1);
	const gas = f.put(new THREE.Group(), -5.75, Z1 - 0.2, { w: 0.3, d: 0.3 });
	drum(gas, 0.13, 1.3, m.red(), 0, 0, 0, 20);
	drum(gas, 0.04, 0.1, m.chrome(), 0, 1.3, 0, 10);

	// outside the closed end: the hydrogen bottles in their cage, the air conditioners' outdoor units
	f.put(hydrogenBundle(), -L / 2 - 0.45, -0.55, { w: 0.6, d: 0.9 });
	bar(g, v3(-L / 2 - 0.25, 1.75, -0.55), v3(-L / 2 - 0.25, CEIL - 0.3, -0.55), 0.014, m.yellow());
	bar(g, v3(-L / 2 - 0.25, CEIL - 0.3, -0.55), v3(-L / 2 - 0.25, CEIL - 0.3, Z0 + 0.3), 0.014, m.yellow());
	bar(g, v3(-L / 2 - 0.25, CEIL - 0.3, Z0 + 0.3), v3(X0, CEIL - 0.3, Z0 + 0.3), 0.014, m.yellow());
	for (const y of [0.1, 0.8]) f.put(acOutdoor(), -L / 2 - 0.2, 0.3, { ry: -Math.PI / 2, y, w: 0.3, d: 0.8 });
	return done(b);
}

/**
 * The sanitary container. From the open end: the laundry — two washing machines with dryers stacked on
 * them, a utility sink, a folding table, the heat-pump water heater — then three washbasins under their mirrors, a bench
 * and a hand dryer; then a corridor along the front past three toilets and three showers in their cubicles, frosted
 * windows high over it and a door out at its end. Rainwater waits outside in a tank.
 */
export function sanitaryContainer() {
	const b = box({
		name: 'sanitary container',
		color: '#d8d2c4',
		floor: floorMaterial('#ffffff', tiles(), 1.2),
		lining: m.white(),
		label: 'SANITARY',
		labelX: 3.6,
		front: [
			{ u0: -5.85, u1: -4.95, y0: FLOOR, y1: 2.2, door: true },
			...[-4.3, -2.8, -1.3].map((x) => ({ u0: x, u1: x + 0.8, y0: 1.9, y1: 2.45, glass: /** @type {const} */ ('frosted') })),
			{ u0: 0.9, u1: 2.2, y0: 1.75, y1: 2.45, glass: /** @type {const} */ ('frosted') }
		]
	});
	const { g, solids } = b;
	const f = fitter(g, solids);
	const r = rng(5);
	unlit(sheet(g, 0.5, 0.18, plateMat('WC · SHOWERS', '#1f6f8b', '#ffffff'), -5.4, 2.45, W / 2 + 0.003));

	// the laundry
	for (const x of [3.0, 3.65]) f.put(laundryTower(), x, atBack(0.62), { w: 0.62, d: 0.62 });
	f.put(utilitySink(), 4.35, atBack(0.55), { w: 0.6, d: 0.55 });
	const shelf = f.put(wallShelf(2.0, 0.3, 2.15, m.white()), 3.65, Z0, { y: FLOOR });
	stock(shelf.userData.on, 1.9, 0.26, 2.17, 'bottles', r);
	f.put(heatPumpBoiler(), 5.45, Z0 + 0.4, { w: 0.65, d: 0.65 });
	const fold = f.put(steelTable(1.6, 0.6, { upstand: false }), 3.6, atFront(0.6), { ry: Math.PI, w: 1.6, d: 0.6 });
	stock(fold, 1.0, 0.5, 0.92, 'towels', r);
	stock(fold, 1.4, 0.5, 0.2, 'towels', r);
	const basket = f.put(new THREE.Group(), 5.0, Z1 - 0.3, { w: 0.5, d: 0.4 });
	part(basket, 0.5, 0.3, 0.38, std('#5f8fb0', 0.6)(), 0, 0.15, 0);
	soft(basket, 0.46, 0.08, 0.34, 0.03, m.cream(), 0, 0.31, 0);

	// the washroom: three basins under their mirrors; a bench, hooks and a hand dryer opposite
	for (const x of [0.9, 1.6, 2.3]) {
		f.put(washbasin(), x, Z0, { y: FLOOR });
		f.block(x - 0.3, x + 0.3, Z0, Z0 + 0.42);
		unlit(part(g, 0.55, 0.7, 0.01, m.mirror(), x, FLOOR + 1.45, Z0 + 0.006));
		drum(g, 0.03, 0.14, m.white(), x + 0.2, FLOOR + 0.86, Z0 + 0.06, 10); // the soap
	}
	f.put(handDryer(), 2.5, Z1, { ry: Math.PI, y: FLOOR + 1.3 });
	const bench = f.put(new THREE.Group(), 1.35, atFront(0.35), { ry: Math.PI, w: 1.2, d: 0.35 });
	part(bench, 1.2, 0.04, 0.35, m.beech(), 0, 0.45, 0);
	for (const sx of [-1, 1]) part(bench, 0.04, 0.43, 0.3, m.chrome(), sx * 0.55, 0.215, 0);
	for (let i = 0; i < 4; i++) {
		const x = 0.85 + i * 0.32;
		bar(g, v3(x, FLOOR + 1.6, Z1), v3(x, FLOOR + 1.62, Z1 - 0.06), 0.008, m.chrome());
		if (i % 2 === 0) soft(g, 0.22, 0.45, 0.04, 0.02, i ? std('#8fb3c4', 0.95)() : m.cream(), x, FLOOR + 1.35, Z1 - 0.06);
	}

	// the cubicles: three toilets, three showers, off a corridor along the front
	const zc = 0.13, ph = 2.0, lift = 0.12;
	const hpl = std('#7fa597', 0.5)();
	const edges = [0.45, -0.6, -1.65, -2.7, -3.8, -4.9, X0];
	/** a partition panel from x0 to x1, z0 to z1, raised off the floor @param {number} x0 @param {number} x1 @param {number} z0 @param {number} z1 */
	const panel = (x0, x1, z0, z1) => {
		part(g, Math.max(0.025, x1 - x0), ph - lift, Math.max(0.025, z1 - z0), hpl, (x0 + x1) / 2, FLOOR + lift + (ph - lift) / 2, (z0 + z1) / 2);
		f.block(Math.min(x0, x1 - 0.025), Math.max(x1, x0 + 0.025), Math.min(z0, z1 - 0.025), Math.max(z1, z0 + 0.025));
	};
	for (let i = 0; i < edges.length - 1; i++) {
		const xr = edges[i], xl = edges[i + 1], shower = i >= 3;
		if (i === 0) panel(xr - 0.0125, xr + 0.0125, Z0, zc);
		if (i < edges.length - 2) panel(xl - 0.0125, xl + 0.0125, Z0, zc);
		// the front: a panel, then the door opening at the right, the door swung in against the partition
		const dw = 0.7, d0 = xr - 0.05 - dw;
		panel(xl, d0, zc - 0.0125, zc + 0.0125);
		panel(xr - 0.05, xr, zc - 0.0125, zc + 0.0125);
		const leaf = new THREE.Group();
		leaf.position.set(xr - 0.05, FLOOR + lift, zc);
		leaf.rotation.y = -Math.PI / 2 + 0.1;
		g.add(leaf);
		part(leaf, dw, ph - lift, 0.025, hpl, -dw / 2, (ph - lift) / 2, 0);
		unlit(part(leaf, 0.04, 0.04, 0.004, m.ledGreen(), -dw + 0.08, 1.0, 0.014)); // vacant
		f.block(xr - 0.14, xr - 0.04, zc - dw, zc);
		const mid = (xl + xr) / 2;
		if (shower) {
			f.put(showerSet(), mid, Z0, { y: FLOOR });
			bar(g, v3(xl + 0.05, FLOOR + 1.9, zc - 0.25), v3(xl + 0.6, FLOOR + 1.9, zc - 0.25), 0.008, m.chrome());
			soft(g, 0.25, 0.5, 0.04, 0.02, m.white(), xl + 0.2, FLOOR + 1.6, zc - 0.25); // a towel on the rail
		} else {
			f.put(wallToilet(), mid, Z0, { y: FLOOR });
			f.block(mid - 0.2, mid + 0.2, Z0, Z0 + 0.6);
			drum(g, 0.05, 0.1, m.white(), xl + 0.08, FLOOR + 0.7, Z0 + 0.5).rotation.z = Math.PI / 2; // the paper
		}
		unlit(sheet(g, 0.16, 0.1, plateMat(shower ? 'SHOWER' : 'WC', '#ffffff', '#1f6f8b'), (xl + d0) / 2, FLOOR + 1.6, zc + 0.014));
	}

	// outside the closed end: rainwater in a tank, its pipe in
	f.put(ibcTank(), -L / 2 - 0.65, -0.3, { ry: Math.PI / 2, w: 1.2, d: 1.0 });
	bar(g, v3(-L / 2 - 0.65, 1.15, -0.3), v3(-L / 2 - 0.65, 1.4, -0.3), 0.025, m.grey());
	bar(g, v3(-L / 2 - 0.65, 1.4, -0.3), v3(-L / 2, 1.4, -0.3), 0.025, m.grey());
	return done(b);
}
