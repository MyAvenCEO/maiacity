// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · THE SEEDED RANDOM SOURCE — one 32-bit state kept in the world (world.rs), so a world can be copied and
 * run on from any day and gives the same numbers on every machine (mulberry32, as the e2e simulation uses).
 */
import { log } from './dmath.js';

/** a number in [0, 1) from the world's state */
export function rnd(w) {
	w.rs = (w.rs + 0x6d2b79f5) >>> 0;
	let t = w.rs;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * A standard normal draw by Marsaglia's polar method: only log and sqrt, so it is the same on every machine (the
 * Box–Muller form needs a cosine, which browsers compute differently in the last bit).
 */
export function gauss(w) {
	return polar(() => rnd(w));
}

/** the polar method on any uniform source in [0, 1) */
export function polar(u01) {
	for (;;) {
		const u = 2 * u01() - 1, v = 2 * u01() - 1;
		const s = u * u + v * v;
		if (s > 0 && s < 1) return u * Math.sqrt((-2 * log(s)) / s);
	}
}
