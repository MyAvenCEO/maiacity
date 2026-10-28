/*
 * The models' surfaces, drawn once on a canvas and shared (`canvasTexture`): each builder paints its own (the tents'
 * canvas, the seed packets' prints, the containers' stencils and panels), and each is seeded by its key, so it is the
 * same every time (a film renders the same pixels on every machine). The painters of the room's, the apartment's and
 * the backyard's surfaces went with those worlds' Things on 2026-10-16.
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
