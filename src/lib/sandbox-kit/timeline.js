/**
 * A WORLD AS A SEEKABLE FILM — for a world whose story plays as moments one after another (MaiaCity V1's intro), each
 * moved on frame by frame from how it starts: the film camera asks for any second of it, in any order, and gets the
 * same picture every time.
 *
 * The film is parts (a step of the story) of segments (a moment, a hold, a walk). A part is always played from its
 * own start: `enter` brings the world to how the part begins whatever came before, and each segment is started at
 * its time and moved on on a fixed grid of ticks (`rate` a second) from there; a frame between two ticks is the
 * tick before it. So seeking to t plays the part t is in from its start up to t, and playing on from there only
 * moves on the ticks in between: both reach the same world.
 *
 * How long each segment runs is either known (`n`, its ticks) or measured once by playing it till `done` says it
 * ended; the times measured go back to the world's owner to keep (`schedule`).
 */

/**
 * @typedef {{ n?: number | null }} Seg  a segment: its length in ticks, if known
 * @typedef {{ segs: Seg[] }} Part
 * @typedef {{
 *   rate?: number,
 *   parts: Part[],
 *   enter: (part: number, t: number) => void,
 *   start: (part: number, seg: number, t: number) => void,
 *   tick: (t: number, drawn: boolean) => void,
 *   done: (part: number, seg: number, k: number) => boolean,
 *   limit?: number
 * }} TimelineOptions
 *   rate: ticks a second; enter: the world at part's start (t, seconds); start: a segment begins at t; tick: the world
 *   moved on to t (drawn: the last of a run, everything the picture needs made ready); done: whether a segment whose
 *   length is not known has ended at its tick k; limit: the longest a segment may run (seconds)
 */

/** @typedef {{ i: number, j: number, k: number }} At  a tick: its part, its segment, its count in the segment */

/** @param {TimelineOptions} o */
export function createTimeline({ rate = 60, parts, enter, start, tick, done, limit = 300 }) {
	/** each segment's ticks, NaN until measured @type {number[][]} */
	const n = parts.map((p) => p.segs.map((s) => (Number.isInteger(s.n) && Number(s.n) >= 0 ? Number(s.n) : NaN)));
	/** where the world is now (null: nowhere yet, the next seek enters afresh) @type {At | null} */
	let at = null;

	const sum = (/** @type {number[]} */ xs) => xs.reduce((a, x) => a + x, 0);
	/** the part's first tick, counted from the film's start */
	const first = (/** @type {number} */ i) => sum(n.slice(0, i).map(sum));
	/** a segment's first tick within its part */
	const offset = (/** @type {number} */ i, /** @type {number} */ j) => sum(n[i].slice(0, j));
	/** the time of a tick (seconds): always an integer over the rate, so the same tick is the same time */
	const time = (/** @type {At} */ a) => (first(a.i) + offset(a.i, a.j) + a.k) / rate;
	const known = () => n.every((p) => p.every(Number.isFinite));
	/** whether a segment's last tick is reached and another segment follows it in its part */
	const ends = (/** @type {At} */ a) => a.k >= n[a.i][a.j] && a.j + 1 < n[a.i].length;
	/** the tick one on from a */
	const next = (/** @type {At} */ a) => (ends(a) ? { i: a.i, j: a.j + 1, k: 0 } : { i: a.i, j: a.j, k: a.k + 1 });
	/** whether tick a comes before tick b */
	const before = (/** @type {At} */ a, /** @type {At} */ b) => (a.i !== b.i ? a.i < b.i : a.j !== b.j ? a.j < b.j : a.k < b.k);
	const same = (/** @type {At} */ a, /** @type {At} */ b) => a.i === b.i && a.j === b.j && a.k === b.k;

	/** the part brought to its start and its first segment begun, its first tick made */
	function begin(/** @type {number} */ i, /** @type {boolean} */ drawn) {
		const a = { i, j: 0, k: 0 }, t = time(a);
		enter(i, t);
		start(i, 0, t);
		tick(t, drawn);
		return a;
	}
	/** one tick on from a: the next of its segment, or the next segment begun at the tick a ended on */
	function step(/** @type {At} */ a, /** @type {boolean} */ drawn) {
		const b = next(a);
		if (b.j !== a.j) start(b.i, b.j, time(b));
		tick(time(b), drawn);
		return b;
	}
	/** the part a time is in (seconds; clamped to the film) */
	function partAt(/** @type {number} */ t) {
		let i = 0;
		while (i < parts.length - 1 && t >= first(i + 1) / rate) i++;
		return i;
	}

	return {
		rate,
		partAt,
		/** whether every segment's length is known */
		get known() {
			return known();
		},
		/** the film's length (seconds), once known */
		get seconds() {
			return known() ? first(parts.length) / rate : NaN;
		},
		/**
		 * Measure every segment not yet known, part by part: played till `done` (or `limit`). onPart hears each part
		 * measured. Leaves the world nowhere (the next seek enters afresh).
		 * @param {(part: number) => void | Promise<void>} [onPart]
		 */
		async measure(onPart) {
			for (let i = 0; i < parts.length; i++) {
				if (n[i].every(Number.isFinite)) continue;
				const t0 = first(i) / rate;
				enter(i, t0);
				for (let j = 0; j < n[i].length; j++) {
					const tj = t0 + offset(i, j) / rate;
					start(i, j, tj);
					let k = 0;
					tick(tj, false);
					while (!done(i, j, k) && k < limit * rate) tick(tj + ++k / rate, false);
					n[i][j] = k;
				}
				await onPart?.(i);
			}
			at = null;
		},
		/** every part's and segment's ticks and times (seconds) */
		schedule: () => n.map((p, i) => ({ t: first(i) / rate, dur: sum(p) / rate, segs: p.map((x, j) => ({ n: x, t: offset(i, j) / rate, dur: x / rate })) })),
		/**
		 * The world at time t (seconds): the part it is in played from its start, or on from where the world is when
		 * that is earlier in the same part; the tick at or before t drawn.
		 * @param {number} t
		 */
		seek(t) {
			if (!known()) throw new Error('the film is not measured yet');
			const i = partAt(t);
			// the tick at or before t: the last segment begun by then, and its tick
			const local = Math.max(0, Math.round((t - first(i) / rate) * rate * 1e6) / 1e6);
			let j = 0;
			while (j + 1 < n[i].length && local >= offset(i, j + 1)) j++;
			const to = { i, j, k: Math.min(n[i][j], Math.floor(local - offset(i, j))) };
			let a = at && at.i === i && !before(to, at) ? at : begin(i, same({ i, j: 0, k: 0 }, to));
			if (same(a, to) && a === at) tick(time(a), true); // where it is already: drawn again
			while (before(a, to)) a = step(a, same(next(a), to));
			at = a;
		}
	};
}
