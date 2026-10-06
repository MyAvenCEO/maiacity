/*
 * THE FOOD FOREST'S FLOOR (Sandbox 5) — not a lawn and not a flat painted carpet: the soil of a forest garden is never
 * bare, and never one thing. Where the trees close over it, it is dark humus under fallen leaves and twigs, moss in
 * cushions on it, ferns and wood anemones; where the light comes through, a living mat of clover and grasses with
 * flowers standing up out of it. The two run into each other in drifts a few metres across.
 *
 * - `forestGround()`: the ground itself, from far off: humus and leaf litter, and the green mat, blended by the same
 *   drifts (a noise over the ground in metres) the cover below follows.
 * - `coverKinds()`: what stands on it near you, each one shape (one mesh, its colours in its vertices, one draw call
 *   a tile): grass clumps of real blades, moss cushions, six low flowers on their stems over their rosettes (daisy,
 *   buttercup, red clover, forget-me-not, wood anemone, cranesbill), wild strawberries, ferns, and fallen leaves with
 *   twigs.
 * - `coverPick(r, x, z)`: which of them for a spot, by whether it lies in a green drift or a humus one.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** a seeded random number, the same every time @param {number} seed */
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

/* ── the drifts: green mat or humus, over the ground in metres (the shader and the scatter agree) ── */

const fract = (/** @type {number} */ x) => x - Math.floor(x);
/** @param {number} x @param {number} y */
function h21(x, y) {
	let px = fract(x * 123.34), py = fract(y * 456.21);
	const d = px * (px + 45.32) + py * (py + 45.32);
	px += d;
	py += d;
	return fract(px * py);
}
/** @param {number} x @param {number} y */
function vn(x, y) {
	const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
	const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
	const a = h21(ix, iy), b = h21(ix + 1, iy), c = h21(ix, iy + 1), d = h21(ix + 1, iy + 1);
	return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}
/** @param {number} x @param {number} y */
const fbm2 = (x, y) => vn(x, y) * 0.55 + vn(x * 2.03 + 7.1, y * 2.03 + 7.1) * 0.3 + vn(x * 4.1 + 3.3, y * 4.1 + 3.3) * 0.15;
/**
 * How green the floor is at x, z (world metres): 0 humus and litter, 1 the living mat.
 * @param {number} x @param {number} z
 */
export function greenAt(x, z) {
	// the shape's uv runs x and −z (it is laid flat), and the shader works in those
	const u = x, v = -z;
	const n = fbm2(u * 0.07, v * 0.07) * 0.65 + fbm2(u * 0.31, v * 0.31) * 0.35;
	return Math.min(1, Math.max(0, (n - 0.42) / 0.18));
}

/* ── the ground from far off ── */

const textures = new Map();
/** @param {string} key @param {(x: CanvasRenderingContext2D, r: () => number) => void} draw */
function canvasTexture(key, draw) {
	const hit = textures.get(key);
	if (hit) return hit;
	const c = document.createElement('canvas');
	c.width = c.height = 512;
	draw(/** @type {CanvasRenderingContext2D} */ (c.getContext('2d')), rng([...key].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7)));
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	t.wrapS = t.wrapT = THREE.RepeatWrapping;
	t.anisotropy = 8;
	textures.set(key, t);
	return t;
}

/** Humus under fallen leaves: dark crumbly earth, leaves of many autumns (beech, oak, hazel), twigs, a little moss. */
function humus() {
	return canvasTexture('floor-humus', (x, r) => {
		const img = x.createImageData(512, 512);
		for (let i = 0; i < 512 * 512; i++) {
			const px = i % 512, py = (i / 512) | 0;
			const g = fbm2(px / 18, py / 18) * 0.7 + r() * 0.3;
			img.data[i * 4] = 48 + g * 34;
			img.data[i * 4 + 1] = 34 + g * 24;
			img.data[i * 4 + 2] = 22 + g * 14;
			img.data[i * 4 + 3] = 255;
		}
		x.putImageData(img, 0, 0);
		const leaves = ['#8a5a2c', '#a06a34', '#6e4a2a', '#b07a3a', '#7a3a22', '#5e4a30', '#9a8a4a', '#c08a44'];
		for (let i = 0; i < 2300; i++) {
			const cx = r() * 512, cy = r() * 512, len = 6 + r() * 12, w = len * (0.35 + r() * 0.25), a = r() * Math.PI * 2;
			const col = leaves[Math.floor(r() * leaves.length)];
			x.save();
			x.translate(cx, cy);
			x.rotate(a);
			x.globalAlpha = 0.75 + r() * 0.25;
			x.fillStyle = /** @type {string} */ (col);
			x.beginPath();
			x.ellipse(0, 0, len, w, 0, 0, Math.PI * 2);
			x.fill();
			x.globalAlpha = 0.35;
			x.strokeStyle = '#2a1c10';
			x.lineWidth = 0.6;
			x.beginPath();
			x.moveTo(-len, 0);
			x.lineTo(len, 0);
			x.stroke();
			x.restore();
		}
		x.globalAlpha = 1;
		for (let i = 0; i < 90; i++) {
			const cx = r() * 512, cy = r() * 512, len = 12 + r() * 40, a = r() * Math.PI;
			x.strokeStyle = r() < 0.5 ? '#3a2a1c' : '#5a4430';
			x.lineWidth = 1 + r() * 2.2;
			x.beginPath();
			x.moveTo(cx, cy);
			x.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
			x.stroke();
		}
		for (let i = 0; i < 260; i++) {
			x.fillStyle = r() < 0.5 ? '#4f6a2c' : '#62803a';
			x.globalAlpha = 0.7;
			x.beginPath();
			x.arc(r() * 512, r() * 512, 1.5 + r() * 3, 0, Math.PI * 2);
			x.fill();
		}
		x.globalAlpha = 1;
	});
}

/** The living mat seen from above: clover leaves in threes, grass blades and small round leaves, shade between them. */
function greenMat() {
	return canvasTexture('floor-green', (x, r) => {
		const img = x.createImageData(512, 512);
		for (let i = 0; i < 512 * 512; i++) {
			const px = i % 512, py = (i / 512) | 0;
			const g = fbm2(px / 22, py / 22) * 0.7 + r() * 0.3;
			img.data[i * 4] = 30 + g * 26;
			img.data[i * 4 + 1] = 52 + g * 34;
			img.data[i * 4 + 2] = 24 + g * 14;
			img.data[i * 4 + 3] = 255;
		}
		x.putImageData(img, 0, 0);
		const greens = ['#3f6a2c', '#4e7a34', '#5b8a3a', '#6a9842', '#466f30', '#78a44a'];
		for (let i = 0; i < 5200; i++) {
			const cx = r() * 512, cy = r() * 512, k = r();
			x.fillStyle = /** @type {string} */ (greens[Math.floor(r() * greens.length)]);
			if (k < 0.45) {
				// a clover leaf: three round leaflets, a pale chevron on each
				const s = 2.2 + r() * 2.4, a = r() * Math.PI * 2;
				for (let j = 0; j < 3; j++) {
					const b = a + (j * Math.PI * 2) / 3;
					x.beginPath();
					x.arc(cx + Math.cos(b) * s, cy + Math.sin(b) * s, s * 0.95, 0, Math.PI * 2);
					x.fill();
				}
			} else if (k < 0.8) {
				// a grass blade
				const len = 6 + r() * 12, a = r() * Math.PI * 2;
				x.strokeStyle = /** @type {string} */ (greens[Math.floor(r() * greens.length)]);
				x.lineWidth = 1 + r();
				x.beginPath();
				x.moveTo(cx, cy);
				x.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
				x.stroke();
			} else {
				x.beginPath();
				x.ellipse(cx, cy, 2 + r() * 3, 1.5 + r() * 2, r() * Math.PI, 0, Math.PI * 2);
				x.fill();
			}
		}
		// a very few flowers, small: the ones that stand up are drawn near you (coverKinds)
		for (let i = 0; i < 70; i++) {
			x.fillStyle = /** @type {string} */ (['#f4f1e8', '#e9d35a', '#9a6ab0'][Math.floor(r() * 3)]);
			x.beginPath();
			x.arc(r() * 512, r() * 512, 1.2 + r(), 0, Math.PI * 2);
			x.fill();
		}
	});
}

/**
 * The ground of the cell: humus and leaf litter, and the living mat, in drifts (`greenAt`); its uv is metres and one
 * tile of each texture covers 2.2 m.
 */
export function forestGround() {
	const map = humus().clone();
	map.repeat.set(1 / 2.2, 1 / 2.2);
	map.needsUpdate = true;
	const cover = greenMat();
	const m = new THREE.MeshStandardMaterial({ map, roughness: 1 });
	m.onBeforeCompile = (shader) => {
		shader.uniforms.coverMap = { value: cover };
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
uniform sampler2D coverMap;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y); }
float fbm2(vec2 p) { return vn(p) * 0.55 + vn(p * 2.03 + 7.1) * 0.3 + vn(p * 4.1 + 3.3) * 0.15; }`
			)
			.replace(
				'#include <map_fragment>',
				`#ifdef USE_MAP
	vec2 w = vMapUv * 2.2;
	float drift = fbm2(w * 0.07) * 0.65 + fbm2(w * 0.31) * 0.35;
	float green = smoothstep(0.42, 0.6, drift);
	vec4 soil = texture2D(map, vMapUv);
	vec4 mat = texture2D(coverMap, vMapUv * 1.37);
	vec4 texelColor = mix(soil, mat, green);
	// moss creeping in at the edges of the drifts, and the light and shade of the canopy over it all
	texelColor.rgb = mix(texelColor.rgb, vec3(0.16, 0.26, 0.08), 0.35 * (1.0 - abs(green * 2.0 - 1.0)) * vn(w * 1.3));
	texelColor.rgb *= 0.82 + 0.32 * fbm2(w * 0.021 + 11.0);
	diffuseColor *= texelColor;
#endif`
			);
	};
	m.customProgramCacheKey = () => 'sandbox5-forest-ground';
	return m;
}

/* ── what stands on it near you ── */

/** the cover's one material: its colours in its vertices, both faces of a blade or a leaf */
let coverMat = /** @type {THREE.MeshStandardMaterial | null} */ (null);
const material = () => (coverMat ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, side: THREE.DoubleSide }));

/** a geometry's vertices all coloured so @param {THREE.BufferGeometry} g @param {THREE.Color | ((p: THREE.Vector3) => THREE.Color)} c */
function paint(g, c) {
	const geo = g.index ? g.toNonIndexed() : g;
	for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
	if (!geo.attributes.normal) geo.computeVertexNormals();
	const pos = geo.attributes.position, n = pos.count, col = new Float32Array(n * 3), v = new THREE.Vector3();
	for (let i = 0; i < n; i++) {
		const cc = typeof c === 'function' ? c(v.fromBufferAttribute(pos, i)) : c;
		col[i * 3] = cc.r;
		col[i * 3 + 1] = cc.g;
		col[i * 3 + 2] = cc.b;
	}
	geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
	return geo;
}
/** the pieces as one mesh @param {THREE.BufferGeometry[]} geos */
function one(geos) {
	const g = new THREE.Group();
	const mesh = new THREE.Mesh(mergeGeometries(geos), material());
	mesh.receiveShadow = true;
	g.add(mesh);
	return g;
}
const col = (/** @type {string} */ h) => new THREE.Color(h);

/**
 * A blade (or a stem, a leaf on a stalk): a strip from its foot out along `dir`, bending over by `bend` towards its
 * tip, `w` wide at its foot and narrowing to a point; dark at its foot, `tip` at its tip.
 * @param {THREE.Vector3} foot @param {THREE.Vector3} dir @param {number} len @param {number} w @param {number} bend
 * @param {THREE.Color} base @param {THREE.Color} tip
 */
function blade(foot, dir, len, w, bend, base, tip) {
	const segs = 4, pos = [];
	const up = dir.clone().normalize(), side = new THREE.Vector3(0, 1, 0).cross(up);
	if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
	side.normalize();
	// it bends over away from where it grows, outward and down
	const out = new THREE.Vector3(up.x, 0, up.z);
	if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
	out.normalize();
	const pts = [];
	for (let i = 0; i <= segs; i++) {
		const t = i / segs;
		pts.push(foot.clone().addScaledVector(up, len * t).addScaledVector(out, len * bend * t * t).addScaledVector(new THREE.Vector3(0, 1, 0), -len * bend * 0.6 * t * t));
	}
	/** @type {number[]} */
	const cols = [];
	for (let i = 0; i < segs; i++) {
		const t0 = i / segs, t1 = (i + 1) / segs;
		const w0 = w * (1 - t0), w1 = w * (1 - t1);
		const a = pts[i], b = pts[i + 1];
		const q = [a.clone().addScaledVector(side, -w0 / 2), a.clone().addScaledVector(side, w0 / 2), b.clone().addScaledVector(side, w1 / 2), b.clone().addScaledVector(side, -w1 / 2)];
		for (const [p, t] of /** @type {[THREE.Vector3, number][]} */ ([[q[0], t0], [q[1], t0], [q[2], t1], [q[0], t0], [q[2], t1], [q[3], t1]])) {
			pos.push(p.x, p.y, p.z);
			const c = base.clone().lerp(tip, t);
			cols.push(c.r, c.g, c.b);
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
	g.computeVertexNormals();
	return g;
}

/** A clump of grass: 16–24 blades fanning out of one foot, some bent over, a few gone straw at the tip. */
function grassClump(/** @type {number} */ seed, /** @type {number} */ h) {
	const r = rng(seed), geos = [];
	const greens = ['#3d6a2a', '#4a7a30', '#56883a', '#2f5a24'].map(col);
	const n = 16 + Math.floor(r() * 9);
	for (let i = 0; i < n; i++) {
		const a = r() * Math.PI * 2, lean = 0.15 + r() * 0.45;
		const dir = new THREE.Vector3(Math.cos(a) * lean, 1, Math.sin(a) * lean);
		const len = h * (0.55 + r() * 0.5);
		const base = /** @type {THREE.Color} */ (greens[Math.floor(r() * greens.length)]);
		const tip = r() < 0.18 ? col('#b8a868') : base.clone().offsetHSL(0.01, 0.02, 0.12);
		geos.push(blade(new THREE.Vector3((r() - 0.5) * 0.05, 0, (r() - 0.5) * 0.05), dir, len, 0.006 + r() * 0.004, 0.15 + r() * 0.45, base.clone().multiplyScalar(0.6), tip));
	}
	// a seed head or two on a tall stem
	for (let i = 0; i < (r() < 0.5 ? 2 : 0); i++) {
		const a = r() * Math.PI * 2;
		const foot = new THREE.Vector3(0, 0, 0), dir = new THREE.Vector3(Math.cos(a) * 0.12, 1, Math.sin(a) * 0.12);
		geos.push(blade(foot, dir, h * 1.35, 0.003, 0.05, col('#4a6a2c'), col('#8a8a4a')));
		const head = new THREE.ConeGeometry(0.008, 0.05, 5).translate(Math.cos(a) * 0.12 * h * 1.3, h * 1.35, Math.sin(a) * 0.12 * h * 1.3);
		geos.push(paint(head, col('#a39a5a')));
	}
	return one(geos);
}

/** A cushion of moss: a few bumped domes run together, bright where the light catches it, a scatter of its stalks. */
function mossCushion(/** @type {number} */ seed) {
	const r = rng(seed), geos = [];
	const n = 2 + Math.floor(r() * 3);
	for (let i = 0; i < n; i++) {
		const g = new THREE.IcosahedronGeometry(1, 1);
		const p = g.attributes.position, v = new THREE.Vector3();
		for (let k = 0; k < p.count; k++) {
			v.fromBufferAttribute(p, k);
			const bump = 1 + 0.12 * Math.sin(v.x * 9 + seed) * Math.sin(v.z * 8 + i);
			p.setXYZ(k, v.x * bump, Math.max(-0.1, v.y) * bump, v.z * bump);
		}
		const rad = 0.08 + r() * 0.12;
		g.scale(rad, rad * (0.28 + r() * 0.15), rad * (0.8 + r() * 0.4));
		g.translate((r() - 0.5) * 0.25, 0, (r() - 0.5) * 0.25);
		const light = col('#7aa63a'), dark = col('#3a5a1e');
		geos.push(paint(g, (q) => dark.clone().lerp(light, Math.min(1, Math.max(0, q.y / (rad * 0.3))) * (0.7 + 0.3 * Math.sin(q.x * 90 + q.z * 70)))));
	}
	for (let i = 0; i < 10; i++) {
		const x = (r() - 0.5) * 0.3, z = (r() - 0.5) * 0.3;
		geos.push(blade(new THREE.Vector3(x, 0.02, z), new THREE.Vector3(0, 1, 0), 0.03, 0.002, 0.2, col('#8a6a2a'), col('#c89a4a')));
	}
	return one(geos);
}

/** @typedef {'daisy' | 'buttercup' | 'clover' | 'forgetmenot' | 'anemone' | 'cranesbill'} Flower */
/** @type {Record<Flower, { petals: number, colour: string, eye: string, r: number, h: [number, number], heads: [number, number], leaf: string, ball?: boolean, cluster?: boolean }>} */
const FLOWERS = {
	daisy: { petals: 14, colour: '#f6f3ea', eye: '#f2c230', r: 0.011, h: [0.05, 0.1], heads: [3, 6], leaf: '#4f7a34' },
	buttercup: { petals: 5, colour: '#f3cf26', eye: '#d8a81a', r: 0.011, h: [0.18, 0.35], heads: [3, 7], leaf: '#3f6a2a' },
	clover: { petals: 0, colour: '#c7638a', eye: '#a84a72', r: 0.011, h: [0.06, 0.12], heads: [3, 6], leaf: '#4a7a30', ball: true },
	forgetmenot: { petals: 5, colour: '#6f9fe0', eye: '#f2dc6a', r: 0.0045, h: [0.12, 0.22], heads: [4, 7], leaf: '#4a7432', cluster: true },
	anemone: { petals: 6, colour: '#f4f1f4', eye: '#e8c84a', r: 0.013, h: [0.1, 0.18], heads: [2, 5], leaf: '#3c6a2c' },
	cranesbill: { petals: 5, colour: '#a06ac2', eye: '#e2d6ea', r: 0.014, h: [0.2, 0.38], heads: [3, 6], leaf: '#3f6a2e' }
};

/** A flower head facing up at `at`: its petals round its eye (or a ball of florets, a red clover's). */
function head(/** @type {THREE.Vector3} */ at, /** @type {Flower} */ kind, /** @type {() => number} */ r) {
	const f = FLOWERS[kind], geos = [];
	if (f.ball) {
		geos.push(paint(new THREE.IcosahedronGeometry(f.r, 0).scale(1, 1.15, 1).translate(at.x, at.y + f.r, at.z), (q) => col(f.colour).lerp(col(f.eye), Math.max(0, (at.y + f.r - q.y) / (f.r * 2)))));
		return geos;
	}
	const tilt = (r() - 0.5) * 0.6;
	for (let i = 0; i < f.petals; i++) {
		const a = (i / f.petals) * Math.PI * 2 + r() * 0.2;
		const len = f.r, wid = (Math.PI * 2 * f.r) / f.petals * (f.petals > 8 ? 0.7 : 1.1);
		const g = new THREE.PlaneGeometry(wid, len).translate(0, len / 2 + f.r * 0.25, 0).rotateX(-Math.PI / 2 + 0.25 + (kind === 'buttercup' ? 0.5 : 0)).rotateY(-a + Math.PI / 2);
		g.rotateZ(tilt).translate(at.x, at.y, at.z);
		geos.push(paint(g, col(f.colour)));
	}
	geos.push(paint(new THREE.CircleGeometry(f.r * 0.32, 6).rotateX(-Math.PI / 2).rotateZ(tilt).translate(at.x, at.y + 0.002, at.z), col(f.eye)));
	return geos;
}

/** A clump of a low flower: a rosette of leaves on the ground, stems up out of it, a head on each. */
function flowerClump(/** @type {Flower} */ kind, /** @type {number} */ seed) {
	const r = rng(seed), f = FLOWERS[kind], geos = [];
	const leaf = col(f.leaf);
	// the rosette (a clover's leaves in threes)
	const leaves = 6 + Math.floor(r() * 6);
	for (let i = 0; i < leaves; i++) {
		const a = r() * Math.PI * 2, len = 0.03 + r() * 0.035;
		const dir = new THREE.Vector3(Math.cos(a), 0.35 + r() * 0.4, Math.sin(a));
		geos.push(blade(new THREE.Vector3(0, 0.003, 0), dir, len, kind === 'clover' || kind === 'cranesbill' ? 0.026 : 0.016, 0.3, leaf.clone().multiplyScalar(0.7), leaf.clone().offsetHSL(0, 0, 0.06)));
	}
	const heads = f.heads[0] + Math.floor(r() * (f.heads[1] - f.heads[0] + 1));
	for (let i = 0; i < heads; i++) {
		const a = r() * Math.PI * 2, d = 0.02 + r() * 0.05;
		const h = f.h[0] + r() * (f.h[1] - f.h[0]);
		const top = new THREE.Vector3(Math.cos(a) * d * 1.6, h, Math.sin(a) * d * 1.6);
		geos.push(blade(new THREE.Vector3(Math.cos(a) * d * 0.4, 0, Math.sin(a) * d * 0.4), top.clone().normalize(), h, 0.0025, 0.04, leaf.clone().multiplyScalar(0.75), leaf));
		if (f.cluster) for (let k = 0; k < 4; k++) geos.push(...head(top.clone().add(new THREE.Vector3((r() - 0.5) * 0.02, (r() - 0.5) * 0.015, (r() - 0.5) * 0.02)), kind, r));
		else geos.push(...head(top, kind, r));
	}
	return one(geos);
}

/** Wild strawberries: their leaves in threes on stalks, toothed and veined, a few red berries hanging under them. */
function strawberries(/** @type {number} */ seed) {
	const r = rng(seed), geos = [];
	const n = 5 + Math.floor(r() * 5);
	for (let i = 0; i < n; i++) {
		const a = r() * Math.PI * 2, d = r() * 0.08, h = 0.05 + r() * 0.07;
		const top = new THREE.Vector3(Math.cos(a) * (d + 0.03), h, Math.sin(a) * (d + 0.03));
		geos.push(blade(new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d), top.clone().normalize(), h, 0.002, 0.05, col('#4a6a2a'), col('#5a7a32')));
		for (let k = 0; k < 3; k++) {
			const b = a + (k - 1) * 0.9;
			geos.push(blade(top, new THREE.Vector3(Math.cos(b), 0.15, Math.sin(b)), 0.03, 0.022, 0.25, col('#3a6a28'), col('#5a8a38')));
		}
	}
	for (let i = 0; i < 4; i++) geos.push(paint(new THREE.IcosahedronGeometry(0.007, 0).scale(1, 1.3, 1).translate((r() - 0.5) * 0.14, 0.012, (r() - 0.5) * 0.14), col(r() < 0.75 ? '#c8252c' : '#e8d8a8')));
	return one(geos);
}

/** A fern: its fronds arching out of one crown, each a stalk with its pinnae either side, narrowing to the tip. */
function fern(/** @type {number} */ seed) {
	const r = rng(seed), geos = [];
	const n = 6 + Math.floor(r() * 5), size = 0.3 + r() * 0.3;
	for (let i = 0; i < n; i++) {
		const a = (i / n) * Math.PI * 2 + r() * 0.4;
		const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
		// the frond's line: up and out, arching over
		const pts = [];
		for (let k = 0; k <= 8; k++) {
			const t = k / 8;
			pts.push(new THREE.Vector3(out.x * size * t, size * 0.75 * Math.sin(t * Math.PI * 0.75), out.z * size * t));
		}
		for (let k = 0; k < 8; k++) {
			const t = k / 8, p = pts[k], q = pts[k + 1];
			geos.push(blade(p, q.clone().sub(p).normalize(), p.distanceTo(q), 0.004, 0, col('#4a6a2a'), col('#4a6a2a')));
			const side = q.clone().sub(p).cross(new THREE.Vector3(0, 1, 0)).normalize();
			const len = size * 0.22 * (1 - t * 0.85);
			for (const s of [1, -1]) geos.push(blade(p, side.clone().multiplyScalar(s).add(new THREE.Vector3(0, 0.2, 0)), len, len * 0.35, 0.25, col('#3f6e2a'), col('#6a9a40')));
		}
	}
	return one(geos);
}

/** Fallen leaves on the humus, curled and in many browns, and a few twigs among them. */
function litter(/** @type {number} */ seed) {
	const r = rng(seed), geos = [];
	const browns = ['#8a5a2c', '#a06a34', '#6e4a2a', '#b07a3a', '#7a3a22', '#9a8a4a', '#c08a44'];
	for (let i = 0; i < 26; i++) {
		const len = 0.04 + r() * 0.05;
		const g = new THREE.PlaneGeometry(len * 0.6, len, 2, 2);
		const p = g.attributes.position;
		// curled up a little along its midrib and at its edges
		for (let k = 0; k < p.count; k++) p.setZ(k, Math.abs(p.getX(k)) * 0.5 + 0.004 * Math.sin(p.getY(k) * 60));
		g.rotateX(-Math.PI / 2).rotateY(r() * Math.PI * 2).translate((r() - 0.5) * 0.6, 0.006 + r() * 0.01, (r() - 0.5) * 0.6);
		geos.push(paint(g, col(/** @type {string} */ (browns[Math.floor(r() * browns.length)])).multiplyScalar(0.85 + r() * 0.3)));
	}
	for (let i = 0; i < 3; i++) {
		const len = 0.15 + r() * 0.3;
		const g = new THREE.CylinderGeometry(0.004 + r() * 0.004, 0.006, len, 5).rotateZ(Math.PI / 2).rotateY(r() * Math.PI).translate((r() - 0.5) * 0.4, 0.006, (r() - 0.5) * 0.4);
		geos.push(paint(g, col(r() < 0.5 ? '#4a3626' : '#6a5038')));
	}
	return one(geos);
}

/** @typedef {'grass' | 'tallgrass' | 'moss' | Flower | 'strawberry' | 'fern' | 'litter'} Cover */
/** @type {Cover[]} */
export const COVER = ['grass', 'tallgrass', 'moss', 'daisy', 'buttercup', 'clover', 'forgetmenot', 'anemone', 'cranesbill', 'strawberry', 'fern', 'litter'];

/** Every kind of cover, built once, in the order of `COVER`. @returns {THREE.Group[]} */
export function coverKinds() {
	return COVER.map((k, i) => {
		const seed = 7100 + i * 13;
		if (k === 'grass') return grassClump(seed, 0.22);
		if (k === 'tallgrass') return grassClump(seed, 0.45);
		if (k === 'moss') return mossCushion(seed);
		if (k === 'strawberry') return strawberries(seed);
		if (k === 'fern') return fern(seed);
		if (k === 'litter') return litter(seed);
		return flowerClump(k, seed);
	});
}

/** how often each kind stands in a green drift, and in a humus one */
const IN_GREEN = { grass: 30, tallgrass: 12, moss: 4, daisy: 7, buttercup: 6, clover: 9, forgetmenot: 3, anemone: 1, cranesbill: 4, strawberry: 7, fern: 2, litter: 2 };
const IN_HUMUS = { grass: 6, tallgrass: 2, moss: 22, daisy: 0, buttercup: 0, clover: 0, forgetmenot: 4, anemone: 8, cranesbill: 1, strawberry: 5, fern: 14, litter: 30 };
const sum = (/** @type {Record<string, number>} */ w) => Object.values(w).reduce((a, b) => a + b, 0);

/**
 * Which kind of cover (its index in `COVER`) at x, z: by its drift, green or humus, and chance.
 * @param {() => number} r @param {number} x @param {number} z
 */
export function coverPick(r, x, z) {
	const w = r() < greenAt(x, z) ? IN_GREEN : IN_HUMUS;
	let t = r() * sum(w);
	for (let i = 0; i < COVER.length; i++) if ((t -= /** @type {Record<string, number>} */ (w)[/** @type {string} */ (COVER[i])]) < 0) return i;
	return 0;
}
