/*
 * A BIOME AS AN ASSET — a round patch of its floor, built in the asset box like any other asset (./floors.js), so the
 * asset viewer shows it and the Maia City vault keeps it, its versions and its card (./card.js), as it keeps every
 * plant and machine. The patch is what the floor looks like where you stand in it:
 *
 *   the ground   its surfaces run into each other in patches, painted into one picture of the patch by the same sums
 *                the worlds' ground shader paints them with as you walk (./surfaces.js `groundMaterial`, ./noise.js):
 *                each surface's weight against its noise, each texture read twice and turned, the canopy's light and
 *                shade over it all
 *   the cover    every kind in its colonies, laid by the same tiles a world streams round you (./stream.js
 *                `coverTile`), each kind built once (./cover.js) and stood as copies of it
 *
 * What a world lays is the card's: its numbers, not this patch. Real size: RADIUS metres round its middle.
 */
import * as THREE from 'three';
import { biomeCatalog } from './card.js';
import { COVER } from './cover.js';
import { coverSeed } from './index.js';
import { fbm2, vn } from './noise.js';
import { coverTile } from './stream.js';
import { SURFACE, SURFACES, TEXTURES } from './surfaces.js';

/** how far the patch reaches from its middle (m) */
export const RADIUS = 6;
/** the side of the ground's picture (pixels): about 2.3 cm a pixel */
const PX = 512;
/** the tiles of the cover, as a world lays them (m) */
const TILE = 8;

/** a texture's pixels, to read the way a shader reads it (repeating, its rows upside down as three.js uploads them) */
function pixelsOf(/** @type {THREE.Texture} */ t) {
	const c = /** @type {any} */ (t.image);
	const data = c?.getContext?.('2d')?.getImageData?.(0, 0, c.width, c.height)?.data;
	return data instanceof Uint8ClampedArray && data.length === c.width * c.height * 4 ? { data, w: c.width, h: c.height } : null;
}
/** sRGB to linear light, and back */
const lin = (/** @type {number} */ v) => ((v /= 255) <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const srgb = (/** @type {number} */ v) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)));
const fract = (/** @type {number} */ x) => x - Math.floor(x);
const smoothstep = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ v) => {
	const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
	return t * t * (3 - 2 * t);
};

/**
 * The ground of the patch as one picture: the shader's sums (./surfaces.js `groundMaterial`) worked out for each of its
 * pixels. Null where nothing can be painted (a stand-in canvas outside a page or the box: the card needs no picture).
 * @param {import('./surfaces.js').Weights} weights @param {number} radius
 */
function groundPicture(weights, radius) {
	const layers = SURFACES.map((s, i) => ({ s, i, w: weights[s] ?? 0 })).filter((l) => l.w > 0);
	const px = layers.map((l) => pixelsOf(TEXTURES[l.s]()));
	if (px.some((p) => !p)) return null;
	const c = document.createElement('canvas');
	c.width = c.height = PX;
	const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
	const img = ctx?.createImageData?.(PX, PX);
	if (!(img?.data instanceof Uint8ClampedArray)) return null;
	// a texture read at (u, v), bilinear, its rows from the bottom: the linear colour into `out`
	const out = [0, 0, 0];
	const read = (/** @type {{ data: Uint8ClampedArray, w: number, h: number }} */ p, /** @type {number} */ u, /** @type {number} */ v) => {
		const x = fract(u) * p.w - 0.5, y = (1 - fract(v)) * p.h - 0.5;
		const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
		for (let k = 0; k < 3; k++) {
			const at = (/** @type {number} */ xx, /** @type {number} */ yy) => /** @type {number} */ (p.data[(((yy % p.h) + p.h) % p.h * p.w + (((xx % p.w) + p.w) % p.w)) * 4 + k]);
			const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx, b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
			out[k] = lin(a + (b - a) * fy);
		}
		return out;
	};
	const cos = 0.8253, sin = 0.5646;
	for (let j = 0; j < PX; j++)
		for (let i = 0; i < PX; i++) {
			// the pixel's place on the ground as the shader has it: x, and the ground's other axis, −z
			const bx = radius * (((i + 0.5) / PX) * 2 - 1), by = radius * ((1 - (j + 0.5) / PX) * 2 - 1);
			const swap = smoothstep(0.32, 0.68, vn(bx * 0.23 + 5.1, by * 0.23 + 5.1));
			let r = 0, g = 0, b = 0, sum = 0;
			layers.forEach((l, n) => {
				const P = SURFACE[l.s].patch, T = SURFACE[l.s].tile;
				const f = fbm2(bx / P + l.i * 17.3, by / P + l.i * 17.3), s = l.w * Math.pow(0.35 + f, 6);
				const u = bx / T + l.i * 0.37, v = by / T + l.i * 0.37;
				const p = /** @type {{ data: Uint8ClampedArray, w: number, h: number }} */ (px[n]);
				const [r1, g1, b1] = read(p, u, v);
				const [r2, g2, b2] = read(p, (cos * u - sin * v) * 0.83 + 0.41, (sin * u + cos * v) * 0.83 + 0.41);
				r += (r1 + (r2 - r1) * swap) * s;
				g += (g1 + (g2 - g1) * swap) * s;
				b += (b1 + (b2 - b1) * swap) * s;
				sum += s;
			});
			// the canopy's light and shade over it all
			const shade = (0.82 + 0.32 * fbm2(bx * 0.021 + 11, by * 0.021 + 11)) / Math.max(sum, 1e-5);
			const o = (j * PX + i) * 4;
			img.data[o] = srgb(r * shade);
			img.data[o + 1] = srgb(g * shade);
			img.data[o + 2] = srgb(b * shade);
			img.data[o + 3] = 255;
		}
	ctx.putImageData(img, 0, 0);
	const t = new THREE.CanvasTexture(/** @type {any} */ (c));
	t.colorSpace = THREE.SRGBColorSpace;
	t.anisotropy = 8;
	return t;
}

/**
 * A biome's floor as a patch RADIUS metres round: its ground and its cover, its card's catalog its parts and numbers.
 * @param {import('./index.js').Recipe} recipe
 * @param {{ ref: (kind: string, i: number) => string }} kinds the asset each kind of its cover is
 */
export function floorPatch(recipe, kinds) {
	const root = new THREE.Group();
	root.name = recipe.id;
	const picture = groundPicture(recipe.surface, RADIUS);
	const ground = new THREE.Mesh(new THREE.CircleGeometry(RADIUS, 96).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: picture ? '#ffffff' : '#5d6b3a', map: picture, roughness: 1 }));
	ground.name = 'ground';
	ground.receiveShadow = true;
	root.add(ground);
	// the cover, laid by the tiles a world lays round you, every plant of them that stands on the patch
	const n = Math.ceil(RADIUS / TILE);
	/** @type {number[][]} */
	const laid = recipe.cover.map(() => []);
	for (let ix = -n; ix < n; ix++)
		for (let iz = -n; iz < n; iz++)
			coverTile(recipe, ix, iz, { tile: TILE }).forEach(({ m }, k) => {
				for (let i = 0; i < m.length / 16; i++)
					if (Math.hypot(/** @type {number} */ (m[i * 16 + 12]), /** @type {number} */ (m[i * 16 + 14])) < RADIUS - 0.15) laid[k]?.push(...m.subarray(i * 16, i * 16 + 16));
			});
	const at = new THREE.Matrix4();
	recipe.cover.forEach((c, k) => {
		const list = /** @type {number[]} */ (laid[k]);
		if (!list.length) return;
		const built = COVER[c.kind].build(coverSeed(k, c.kind));
		/** @type {THREE.Mesh[]} */
		const meshes = [];
		built.updateMatrixWorld(true);
		built.traverse((o) => /** @type {THREE.Mesh} */ (o).isMesh && meshes.push(/** @type {THREE.Mesh} */ (o)));
		const kind = new THREE.Group();
		kind.name = `cover-${c.kind}`;
		for (const mesh of meshes) {
			const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
			const copies = new THREE.InstancedMesh(geo, mesh.material, list.length / 16);
			for (let i = 0; i < copies.count; i++) copies.setMatrixAt(i, at.fromArray(list, i * 16));
			copies.castShadow = true;
			copies.receiveShadow = true;
			copies.computeBoundingSphere();
			kind.add(copies);
		}
		root.add(kind);
	});
	root.userData.catalog = biomeCatalog(recipe, { ref: kinds.ref, label: (kind) => COVER[/** @type {import('./cover.js').Cover} */ (kind)].label });
	return root;
}
