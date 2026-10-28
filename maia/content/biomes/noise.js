/*
 * THE BIOMES' NOISE — one value noise, written twice: in JavaScript (where the cover is scattered) and in GLSL (where
 * the ground is painted), the same sums in both, so a colony of wood anemones stands on the patch of litter the shader
 * drew for it. In metres over the ground.
 */

const fract = (/** @type {number} */ x) => x - Math.floor(x);
/** a hash of a lattice point, 0…1 @param {number} x @param {number} y */
function h21(x, y) {
	let px = fract(x * 123.34), py = fract(y * 456.21);
	const d = px * (px + 45.32) + py * (py + 45.32);
	px += d;
	py += d;
	return fract(px * py);
}
/** smooth value noise, 0…1 @param {number} x @param {number} y */
export function vn(x, y) {
	const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
	const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
	const a = h21(ix, iy), b = h21(ix + 1, iy), c = h21(ix, iy + 1), d = h21(ix + 1, iy + 1);
	return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}
/** three octaves of it, 0…1 @param {number} x @param {number} y */
export const fbm2 = (x, y) => vn(x, y) * 0.55 + vn(x * 2.03 + 7.1, y * 2.03 + 7.1) * 0.3 + vn(x * 4.1 + 3.3, y * 4.1 + 3.3) * 0.15;

/** the same, in GLSL */
export const GLSL = `
float bh21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float bvn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(bh21(i), bh21(i + vec2(1.0, 0.0)), u.x), mix(bh21(i + vec2(0.0, 1.0)), bh21(i + vec2(1.0, 1.0)), u.x), u.y); }
float bfbm(vec2 p) { return bvn(p) * 0.55 + bvn(p * 2.03 + 7.1) * 0.3 + bvn(p * 4.1 + 3.3) * 0.15; }
`;

/** a seeded random number, the same every time @param {number} seed */
export function rng(seed) {
	let s = seed >>> 0 || 1;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
