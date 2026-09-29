// THE FILM CLOCK — installed in the page before the world mounts (film mode only: /games/sandbox-4/?film).
//
// Two clocks are taken over:
//   · the page's clock (performance.now, requestAnimationFrame): real until a shot is held, then it moves only when
//     the film steps it — a heavy frame never stutters, and nothing runs between two frames of a shot;
//   · the world's clock (window.__worldTime, read by Sandbox 4's village): the absolute time of the world in seconds,
//     set by the film for every frame (the shot's world.clock + its own time), so the animals, the water and the
//     trucks of a set are where the shot says, whenever and wherever the page was loaded.
// Players never load this file.

/**
 * @typedef {{
 *   virtual: boolean, t: number,
 *   enter: () => void, leave: () => void, step: (ms: number) => void,
 *   world: (seconds: number | undefined) => void,
 *   pending: () => number
 * }} FilmClock
 */

/** @returns {FilmClock} */
export function installClock() {
	const w = /** @type {any} */ (window);
	if (w.__filmClock) return w.__filmClock;
	const realNow = performance.now.bind(performance);
	const realRaf = window.requestAnimationFrame.bind(window);
	const realCaf = window.cancelAnimationFrame.bind(window);
	/** @type {Map<number, FrameRequestCallback>} */
	const queue = new Map();
	let id = 1;
	/** @type {FilmClock} */
	const C = {
		virtual: false,
		t: 0,
		/** hold the page's clock: from now on it moves only by step() */
		enter() {
			if (C.virtual) return;
			C.t = realNow();
			C.virtual = true;
		},
		/** let it run again: whatever waited for a frame gets a real one */
		leave() {
			if (!C.virtual) return;
			C.virtual = false;
			const q = [...queue.values()];
			queue.clear();
			q.forEach((cb) => realRaf(cb));
		},
		/** move the held clock on by ms and run every frame callback that was waiting */
		step(ms) {
			C.t += ms;
			const q = [...queue.values()];
			queue.clear();
			for (const cb of q) cb(C.t);
		},
		/** set the world's own clock (seconds), or give it back to the page (undefined) */
		world(seconds) {
			if (seconds === undefined) delete w.__worldTime;
			else w.__worldTime = seconds;
		},
		pending: () => queue.size
	};
	performance.now = () => (C.virtual ? C.t : realNow());
	window.requestAnimationFrame = (cb) => {
		if (!C.virtual) return realRaf(cb);
		const n = id++;
		queue.set(n, cb);
		return -n;
	};
	window.cancelAnimationFrame = (n) => (n < 0 ? void queue.delete(-n) : realCaf(n));
	w.__filmClock = C;
	return C;
}

/** A seeded random generator (mulberry32): the same seed, the same numbers, in every browser. */
export function seededRandom(/** @type {number} */ seed) {
	let s = seed >>> 0 || 1;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
