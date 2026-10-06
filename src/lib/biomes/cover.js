/*
 * THE COVER — what stands on a biome's floor near you, each kind one shape (one mesh, its colours in its vertices, so
 * a kind costs one draw call however many of it stand on a tile), built once and scattered in its colonies
 * (./index.js):
 *
 *   grasses   a grass clump of real blades (low, and tall with seed heads), a tussock of sedge
 *   moss      cushions of it, run together, its stalks standing up
 *   flowers   low flowers on their stems over their rosettes: daisy, buttercup, red clover, forget-me-not, wood
 *             anemone, meadow cranesbill; woodruff in its whorls with its white stars; wood sorrel's folded
 *             trefoils; ramsons (wild garlic), broad leaves and white umbels
 *   berries   wild strawberries, their trefoils and berries; blueberry, a dwarf shrub with its blue berries
 *   ferns     fronds arching out of one crown
 *   debris    fallen leaves and twigs, a fallen branch (deadwood, mossed), stones, mushrooms in a ring
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from './noise.js';

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

/** A cushion of moss: a few small lumpy domes run together, low and soft-edged, dark in its hollows and bright where
 *  the light catches it, a scatter of its stalks with their capsules. */
function mossCushion(/** @type {number} */ seed) {
	const r = rng(seed), geos = [];
	const n = 3 + Math.floor(r() * 4);
	const tone = r();
	for (let i = 0; i < n; i++) {
		const g = new THREE.IcosahedronGeometry(1, 2);
		const p = g.attributes.position, v = new THREE.Vector3();
		const ph = r() * 10;
		for (let k = 0; k < p.count; k++) {
			v.fromBufferAttribute(p, k);
			const bump = 1 + 0.18 * Math.sin(v.x * 7 + ph) * Math.sin(v.z * 6 + ph * 1.3) + 0.08 * Math.sin(v.x * 19 + v.z * 17 + ph);
			p.setXYZ(k, v.x * bump, Math.max(-0.15, v.y) * bump, v.z * bump);
		}
		const rad = 0.035 + r() * 0.07;
		g.scale(rad, rad * (0.35 + r() * 0.2), rad * (0.8 + r() * 0.4));
		g.translate((r() - 0.5) * 0.16, 0, (r() - 0.5) * 0.16);
		const light = col(tone < 0.5 ? '#6f9a34' : '#7f9a3e'), dark = col('#2c4416');
		geos.push(paint(g, (q) => dark.clone().lerp(light, Math.min(1, Math.max(0, q.y / (rad * 0.32))) * (0.65 + 0.35 * Math.sin(q.x * 140 + q.z * 110)))));
	}
	for (let i = 0; i < 8; i++) {
		const x = (r() - 0.5) * 0.18, z = (r() - 0.5) * 0.18;
		geos.push(blade(new THREE.Vector3(x, 0.012, z), new THREE.Vector3(0, 1, 0), 0.025, 0.0015, 0.2, col('#8a6a2a'), col('#c89a4a')));
	}
	return one(geos);
}

/** @typedef {'daisy' | 'buttercup' | 'clover' | 'forgetmenot' | 'anemone' | 'cranesbill'} Flower */
/** @type {Record<Flower, { petals: number, colour: string, eye: string, r: number, h: [number, number], heads: [number, number], leaf: string, ball?: boolean, cluster?: boolean }>} */
const FLOWERS = {
	daisy: { petals: 14, colour: '#f6f3ea', eye: '#f2c230', r: 0.014, h: [0.05, 0.1], heads: [3, 6], leaf: '#4f7a34' },
	buttercup: { petals: 5, colour: '#f3cf26', eye: '#d8a81a', r: 0.013, h: [0.18, 0.35], heads: [3, 7], leaf: '#3f6a2a' },
	clover: { petals: 0, colour: '#c7638a', eye: '#a84a72', r: 0.011, h: [0.06, 0.12], heads: [3, 6], leaf: '#4a7a30', ball: true },
	forgetmenot: { petals: 5, colour: '#6f9fe0', eye: '#f2dc6a', r: 0.0045, h: [0.12, 0.22], heads: [4, 7], leaf: '#4a7432', cluster: true },
	anemone: { petals: 6, colour: '#f4f1f4', eye: '#e8c84a', r: 0.016, h: [0.1, 0.18], heads: [2, 5], leaf: '#3c6a2c' },
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
	const browns = ['#7a4e2e', '#6b4a32', '#8a6a4a', '#5a3e2a', '#9a7350', '#86603e', '#6e5a44'];
	for (let i = 0; i < 34; i++) {
		const len = 0.03 + r() * 0.035;
		const g = new THREE.PlaneGeometry(len * 0.6, len, 2, 2);
		const p = g.attributes.position;
		// curled up a little along its midrib and at its edges
		for (let k = 0; k < p.count; k++) p.setZ(k, Math.abs(p.getX(k)) * 0.5 + 0.004 * Math.sin(p.getY(k) * 60));
		g.rotateX(-Math.PI / 2).rotateY(r() * Math.PI * 2).translate((r() - 0.5) * 0.5, 0.004 + r() * 0.006, (r() - 0.5) * 0.5);
		geos.push(paint(g, col(/** @type {string} */ (browns[Math.floor(r() * browns.length)])).multiplyScalar(0.85 + r() * 0.3)));
	}
	for (let i = 0; i < 3; i++) {
		const len = 0.15 + r() * 0.3;
		const g = new THREE.CylinderGeometry(0.004 + r() * 0.004, 0.006, len, 5).rotateZ(Math.PI / 2).rotateY(r() * Math.PI).translate((r() - 0.5) * 0.4, 0.006, (r() - 0.5) * 0.4);
		geos.push(paint(g, col(r() < 0.5 ? '#4a3626' : '#6a5038')));
	}
	return one(geos);
}


/** Woodruff: upright stems with whorls of narrow leaves, a cluster of small white stars on top; a carpet of it. */
function woodruff(/** @type {number} */ seed) {
	const r = rng(seed), geos = [];
	for (let i = 0; i < 9; i++) {
		const x = (r() - 0.5) * 0.22, z = (r() - 0.5) * 0.22, h = 0.12 + r() * 0.1;
		geos.push(blade(new THREE.Vector3(x, 0, z), new THREE.Vector3((r() - 0.5) * 0.2, 1, (r() - 0.5) * 0.2), h, 0.0025, 0.02, col('#3f6a2a'), col('#4f7a30')));
		for (let w = 1; w <= 3; w++) {
			const y = (h * w) / 3.3;
			for (let k = 0; k < 7; k++) {
				const a = (k / 7) * Math.PI * 2 + w;
				geos.push(blade(new THREE.Vector3(x, y, z), new THREE.Vector3(Math.cos(a), 0.15, Math.sin(a)), 0.025, 0.007, 0.15, col('#3a6626'), col('#5a8a36')));
			}
		}
		if (r() < 0.7) for (let k = 0; k < 4; k++) geos.push(paint(new THREE.CircleGeometry(0.0035, 5).rotateX(-Math.PI / 2).translate(x + (r() - 0.5) * 0.015, h + 0.003, z + (r() - 0.5) * 0.015), col('#f7f6f0')));
	}
	return one(geos);
}

/** Wood sorrel: pale trefoils on thin stalks, each leaflet a heart folded along its middle; a few white flowers veined lilac. */
function woodSorrel(/** @type {number} */ seed) {
	const r = rng(seed), geos = [];
	for (let i = 0; i < 12; i++) {
		const x = (r() - 0.5) * 0.2, z = (r() - 0.5) * 0.2, h = 0.05 + r() * 0.05;
		const top = new THREE.Vector3(x, h, z);
		geos.push(blade(new THREE.Vector3(x, 0, z), new THREE.Vector3(0, 1, 0), h, 0.0015, 0, col('#7a8a4a'), col('#8a9a52')));
		for (let k = 0; k < 3; k++) {
			const a = (k / 3) * Math.PI * 2 + r();
			const g = new THREE.CircleGeometry(0.011, 7, 0, Math.PI).rotateX(-Math.PI / 2 + 0.35).rotateY(-a).translate(top.x, top.y, top.z);
			geos.push(paint(g, col('#7aa848')));
		}
	}
	for (let i = 0; i < 3; i++) geos.push(paint(new THREE.CircleGeometry(0.008, 5).rotateX(-Math.PI / 2).translate((r() - 0.5) * 0.15, 0.06, (r() - 0.5) * 0.15), col('#f4eef2')));
	return one(geos);
}

/** Ramsons (wild garlic): broad bright leaves rising from the ground in a dense stand, white star-umbels over them. */
function ramsons(/** @type {number} */ seed) {
	const r = rng(seed), geos = [];
	for (let i = 0; i < 14; i++) {
		const a = r() * Math.PI * 2, d = r() * 0.12;
		geos.push(blade(new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d), new THREE.Vector3(Math.cos(a) * 0.35, 1, Math.sin(a) * 0.35), 0.18 + r() * 0.1, 0.045, 0.35, col('#2f6a26'), col('#4a8a34')));
	}
	for (let i = 0; i < 4; i++) {
		const x = (r() - 0.5) * 0.15, z = (r() - 0.5) * 0.15, h = 0.24 + r() * 0.08;
		geos.push(blade(new THREE.Vector3(x, 0, z), new THREE.Vector3(0, 1, 0), h, 0.003, 0, col('#3f6a2a'), col('#5a7a3a')));
		for (let k = 0; k < 9; k++) {
			const a = r() * Math.PI * 2, s = r() * 0.025;
			geos.push(paint(new THREE.CircleGeometry(0.005, 6).rotateX(-Math.PI / 2 + (r() - 0.5)).translate(x + Math.cos(a) * s, h + 0.01 + r() * 0.012, z + Math.sin(a) * s), col('#f6f6f2')));
		}
	}
	return one(geos);
}

/** A tussock of sedge: many narrow keeled leaves arching right over, darker and bluer than grass. */
function sedge(/** @type {number} */ seed) {
	const r = rng(seed), geos = [];
	for (let i = 0; i < 26; i++) {
		const a = r() * Math.PI * 2, lean = 0.3 + r() * 0.6;
		geos.push(blade(new THREE.Vector3((r() - 0.5) * 0.04, 0, (r() - 0.5) * 0.04), new THREE.Vector3(Math.cos(a) * lean, 1, Math.sin(a) * lean), 0.25 + r() * 0.2, 0.007, 0.7 + r() * 0.4, col('#2c4a26'), col('#5a7a4a')));
	}
	return one(geos);
}

/** Blueberry: a dwarf shrub knee-high, green twiggy stems, small oval leaves, blue berries with their bloom. */
function blueberry(/** @type {number} */ seed) {
	const r = rng(seed), geos = [];
	for (let i = 0; i < 7; i++) {
		const a = r() * Math.PI * 2, h = 0.2 + r() * 0.18;
		const foot = new THREE.Vector3((r() - 0.5) * 0.12, 0, (r() - 0.5) * 0.12), dir = new THREE.Vector3(Math.cos(a) * 0.3, 1, Math.sin(a) * 0.3).normalize();
		geos.push(blade(foot, dir, h, 0.004, 0.1, col('#4a6a2a'), col('#5a8a34')));
		for (let k = 0; k < 9; k++) {
			const t = 0.3 + r() * 0.7, p = foot.clone().addScaledVector(dir, h * t), b = r() * Math.PI * 2;
			geos.push(blade(p, new THREE.Vector3(Math.cos(b), 0.3, Math.sin(b)), 0.022, 0.013, 0.1, col('#3f6e2a'), col('#5a8a3a')));
			if (r() < 0.25) geos.push(paint(new THREE.IcosahedronGeometry(0.0045, 0).translate(p.x, p.y - 0.006, p.z), col('#3a4a7a')));
		}
	}
	return one(geos);
}

/** Mushrooms in a ring: pale stems, brown caps, one or two red with white flecks. */
function mushrooms(/** @type {number} */ seed) {
	const r = rng(seed), geos = [];
	const red = r() < 0.3;
	for (let i = 0; i < 7; i++) {
		const a = (i / 7) * Math.PI * 2 + r() * 0.4, d = 0.18 + r() * 0.12, h = 0.04 + r() * 0.07;
		const x = Math.cos(a) * d, z = Math.sin(a) * d;
		geos.push(paint(new THREE.CylinderGeometry(0.006, 0.009, h, 6).translate(x, h / 2, z), col('#e8e0cc')));
		const cap = new THREE.SphereGeometry(0.022 + r() * 0.015, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1).translate(x, h, z);
		geos.push(paint(cap, (q) => (red && (q.y - h) > 0.004 && Math.sin(q.x * 900) * Math.sin(q.z * 900) > 0.85 ? col('#f6f2ea') : col(red ? '#c62a1e' : '#8a5a32'))));
	}
	return one(geos);
}

/** A few stones half sunk in the floor, grey and mossed on top. */
function stones(/** @type {number} */ seed) {
	const r = rng(seed), geos = [];
	for (let i = 0; i < 4; i++) {
		const s = 0.06 + r() * 0.16;
		const g = new THREE.DodecahedronGeometry(s, 0).scale(1.2, 0.6, 1).rotateY(r() * 3).translate((r() - 0.5) * 0.5, s * 0.15, (r() - 0.5) * 0.5);
		geos.push(paint(g, (q) => (q.y > s * 0.35 ? col('#5a7a2c') : col(r() < 0.5 ? '#8a8a84' : '#7a766c'))));
	}
	return one(geos);
}

/** A fallen branch, deadwood: bark grey-brown, moss along its top, a side twig or two. */
function deadwood(/** @type {number} */ seed) {
	const r = rng(seed), geos = [];
	const len = 0.8 + r() * 1.4, rad = 0.035 + r() * 0.05;
	geos.push(paint(new THREE.CylinderGeometry(rad * 0.8, rad, len, 8, 6).rotateZ(Math.PI / 2).translate(0, rad * 0.8, 0), (q) => (q.y > rad * 1.4 && Math.sin(q.x * 9 + seed) > 0.2 ? col('#4a6a26') : col(Math.sin(q.x * 31) > 0.6 ? '#4a3c30' : '#62523f'))));
	for (let i = 0; i < 2; i++) {
		const x = (r() - 0.5) * len * 0.7, l2 = 0.2 + r() * 0.3, a = (r() - 0.5) * 1.6;
		geos.push(paint(new THREE.CylinderGeometry(rad * 0.25, rad * 0.4, l2, 5).rotateX(Math.PI / 2).rotateY(a).translate(x + Math.sin(a) * l2 * 0.5, rad * 0.6, Math.cos(a) * l2 * 0.5), col('#4a3a2c')));
	}
	return one(geos);
}

/** @typedef {'grass' | 'tallgrass' | 'sedge' | 'moss' | Flower | 'woodruff' | 'woodsorrel' | 'ramsons' | 'strawberry' | 'blueberry' | 'fern' | 'litter' | 'deadwood' | 'stones' | 'mushrooms'} Cover */
/** @type {Record<Cover, { label: string, build: (seed: number) => THREE.Group }>} every kind: its name, and how it is built */
export const COVER = {
	grass: { label: 'Grass', build: (s) => grassClump(s, 0.22) },
	tallgrass: { label: 'Tall grass', build: (s) => grassClump(s, 0.45) },
	sedge: { label: 'Sedge', build: sedge },
	moss: { label: 'Moss cushions', build: mossCushion },
	daisy: { label: 'Daisy', build: (s) => flowerClump('daisy', s) },
	buttercup: { label: 'Buttercup', build: (s) => flowerClump('buttercup', s) },
	clover: { label: 'Red clover', build: (s) => flowerClump('clover', s) },
	forgetmenot: { label: 'Forget-me-not', build: (s) => flowerClump('forgetmenot', s) },
	anemone: { label: 'Wood anemone', build: (s) => flowerClump('anemone', s) },
	cranesbill: { label: 'Meadow cranesbill', build: (s) => flowerClump('cranesbill', s) },
	woodruff: { label: 'Woodruff', build: woodruff },
	woodsorrel: { label: 'Wood sorrel', build: woodSorrel },
	ramsons: { label: 'Ramsons', build: ramsons },
	strawberry: { label: 'Wild strawberry', build: strawberries },
	blueberry: { label: 'Blueberry', build: blueberry },
	fern: { label: 'Fern', build: fern },
	litter: { label: 'Leaves and twigs', build: litter },
	deadwood: { label: 'Deadwood', build: deadwood },
	stones: { label: 'Stones', build: stones },
	mushrooms: { label: 'Mushrooms', build: mushrooms }
};
