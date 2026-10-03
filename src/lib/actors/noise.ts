/*
 * NOISE — the chance in an actor, the same every time: a coat's mottling, a fleece's lumps, when an ear flicks or an
 * eye blinks. All of it hashed from where and when, never drawn from Math.random, so a frame of a shot is the same
 * frame however often it is rendered.
 */

/** a number 0…1 for an integer (and a seed) */
export function hash(n: number, seed = 0): number {
	let h = (Math.imul(n | 0, 0x27d4eb2d) ^ Math.imul(seed | 0, 0x165667b1)) >>> 0;
	h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const h3 = (x: number, y: number, z: number, seed: number) => hash(x * 73856093 ^ y * 19349663 ^ z * 83492791, seed);
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** smooth noise in space, -1…1 */
export function noise3(x: number, y: number, z: number, seed = 0): number {
	const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
	const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
	const l = (a: number, b: number, t: number) => a + (b - a) * t;
	const c = (dx: number, dy: number, dz: number) => h3(xi + dx, yi + dy, zi + dz, seed);
	return (
		l(
			l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
			l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
			w
		) *
			2 -
		1
	);
}

/** noise of a few octaves, each twice as fine and half as strong, -1…1 */
export function fbm3(x: number, y: number, z: number, octaves = 3, seed = 0): number {
	let sum = 0, amp = 1, norm = 0;
	for (let o = 0; o < octaves; o++) {
		sum += noise3(x, y, z, seed + o * 31) * amp;
		norm += amp;
		x *= 2.03;
		y *= 2.03;
		z *= 2.03;
		amp *= 0.5;
	}
	return sum / norm;
}

/**
 * Something that happens now and then — a blink, an ear's flick, a look round: how far into one it is at time t
 * (0…1, or -1 between them). Every `period` seconds on average it may start (with chance `p`), and lasts `length`.
 */
export function now(t: number, period: number, length: number, seed: number, p = 0.7): number {
	const k = Math.floor(t / period);
	for (const i of [k, k - 1]) {
		if (hash(i, seed) > p) continue;
		const start = (i + hash(i, seed + 7) * Math.max(0, 1 - length / period)) * period;
		const u = (t - start) / length;
		if (u >= 0 && u < 1) return u;
	}
	return -1;
}

/** a value that holds for a while and then moves on to another, smoothly: -1…1 (a head's look round) */
export function wander(t: number, period: number, seed: number): number {
	const k = Math.floor(t / period), f = t / period - k;
	const a = hash(k, seed) * 2 - 1, b = hash(k + 1, seed) * 2 - 1;
	// most of the period held, then a quick turn to the next
	const s = Math.min(1, Math.max(0, (f - 0.75) / 0.25));
	return a + (b - a) * s * s * (3 - 2 * s);
}
