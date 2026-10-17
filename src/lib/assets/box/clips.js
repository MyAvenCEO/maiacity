// @ts-nocheck — plain JS, runs inside the box
/*
 * AN ACTOR'S MOVES, WRITTEN DOWN — a clip is a function in the actor's own code, and the page runs none of an asset's
 * code. So each clip of a rigged build is played here, in the box, and written down as tables of numbers that the page
 * plays back (../clips.js `playerOf`, the mirror of this file) for any number of copies, each at its own time, in step
 * with the world's clock: a film's frame is the same frame however often it is drawn. Each bone's turn (about x, y, z),
 * its size and its offset, and the root's place, is a channel:
 *
 * - A clip that runs in time alone (a goat grazing, a bee's wings) is written down over LOOP seconds, at the rate its
 *   fastest channel needs (15 to 120 a second, the line between two samples nowhere further than a fraction of a
 *   degree from the clip). Past LOOP it repeats, its last SEAM seconds blended into its start; a channel that keeps
 *   going one way (an ant round its hill) carries on from where the loop left it (`drift`).
 * - A gait also takes how the actor moves (how far it has come, how fast, how fast it turns: $lib/actors/rig.ts
 *   `Motion`). It is written down at a few paces of the one it is made for (its gear, `PACES`), each channel by what
 *   moves it, found here by trying: time alone (a tail's swing, an ear's flick); distance alone (a foot set down and
 *   kept there), over one stride, found here too; both as one wave (a fish's body: a beat for every length swum and a
 *   slow one in time, `k` the metres a second the wave moves by itself); or both, laid one over the other. And what
 *   turning adds to it, at a few rates of turn (`TURNS`).
 *
 * Every number is finite (a clip's NaN is its rest), and every clip that throws is left out.
 */

/** how long a clip is written down for before it repeats (s), a gait's time half as long (it is played a few seconds
 *  at a time, between stops), and how much of its end is blended into its start */
export const LOOP = 32;
export const GAIT_LOOP = 16;
export const SEAM = 2;
/** the paces a gait is written down at, of the pace it is made for (above the last, the last: ours go no faster), and
 *  the rates of turn (rad/s) besides none */
export const PACES = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5];
const MOST_PACES = 16;
export const TURNS = [-2, -1, 1, 2];
/** numbers a bone: its turn about x, y and z, its size, its offset x, y and z; the root's place after the bones */
export const WIDTH = 7;
/** samples a stride (or whatever a gait repeats over) is written down in, at least */
const STRIDE = 64;
/** the rates a clip in time may be written down at (samples a second) */
const RATES = [15, 30, 60, 120];
/** how close the tables keep to the clip: a turn (rad), a size, an offset (of the actor's size); or, for a channel
 *  that moves further, so much of how far it moves (a tail beating six times a second, at a tenth of its swing) */
const TOL = { turn: 0.01, size: 0.004, offset: 0.002, of: 0.03 };
/** the most numbers one build's clips may come to, and the most clips */
export const MOST = 6_000_000;
const CLIPS = 64;

const TAU = Math.PI * 2;
const fin = (x, or) => (typeof x === 'number' && Number.isFinite(x) ? x : or);
const wrapPi = (x) => x - TAU * Math.round(x / TAU);
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** a seeded run of numbers 0…1, the same every time */
function seeded(seed) {
	let s = seed >>> 0 || 1;
	return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/**
 * How a pose is written as numbers, for a rig's bones (`names`, root first): bone b's channel c at b × WIDTH + c,
 * the root's place at the end; what a pose does not name, at rest.
 */
function layoutOf(names, radius) {
	const index = new Map(names.map((n, i) => [n, i]));
	const nb = names.length, width = nb * WIDTH + 3;
	const rest = new Float64Array(width);
	const tol = new Float64Array(width);
	/** whether a channel is a turn, which may come wrapped round (−π…π] */
	const angle = new Uint8Array(width);
	const m = Math.max(1e-5, TOL.offset * radius);
	for (let b = 0; b < nb; b++) {
		rest[b * WIDTH + 3] = 1;
		for (let c = 0; c < WIDTH; c++) tol[b * WIDTH + c] = c < 3 ? TOL.turn : c === 3 ? TOL.size : m;
		angle[b * WIDTH] = angle[b * WIDTH + 1] = angle[b * WIDTH + 2] = 1;
	}
	for (let c = 0; c < 3; c++) tol[nb * WIDTH + c] = m;
	const write = (pose, out, at) => {
		out.set(rest, at);
		if (!pose || typeof pose !== 'object') return;
		for (const name of Object.keys(pose)) {
			const v = pose[name];
			if (!Array.isArray(v)) continue;
			if (name === 'root') {
				for (let c = 0; c < 3; c++) out[at + nb * WIDTH + c] = fin(v[c], 0);
				continue;
			}
			const b = index.get(name);
			if (b === undefined) continue;
			const o = at + b * WIDTH;
			for (let c = 0; c < 3; c++) out[o + c] = fin(v[c], 0);
			if (v.length >= 4) out[o + 3] = fin(v[3], 1);
			if (v.length === 7) for (let c = 4; c < 7; c++) out[o + c] = fin(v[c], 0);
		}
	};
	return { nb, width, rest, tol, angle, write };
}

/** a clip's pose at time t and motion m, as numbers into `out` at `at`; its rest if it throws */
function player(clip, L) {
	return (t, m, out, at = 0) => {
		let p = null;
		try {
			p = clip(t, m);
		} catch {
			p = null;
		}
		L.write(p, out, at);
	};
}

/**
 * Pose `C` (at ci, its numbers what they add to `baseC`) written the way nearest to pose `R` (at ri, over `baseR`):
 * each turn within half a turn of R's (a whole turn more or less is the same turn), and a bone whose turns may be
 * written either way (`flips`) turned about x and z by half a turn and about y the other way, where that is nearer:
 * the same turn, written the other way round (a bird's folded leg, past a quarter turn about y). So the line between
 * two samples, or two paces, is the short way round.
 */
function nearest(L, flips, R, ri, baseR, C, ci, baseC) {
	const P = Math.PI;
	for (let b = 0; b < L.nb; b++) {
		const o = b * WIDTH;
		const r0 = R[ri + o] + baseR[o], r1 = R[ri + o + 1] + baseR[o + 1], r2 = R[ri + o + 2] + baseR[o + 2];
		const c0 = C[ci + o] + baseC[o], c1 = C[ci + o + 1] + baseC[o + 1], c2 = C[ci + o + 2] + baseC[o + 2];
		let a0 = r0 + wrapPi(c0 - r0), a1 = r1 + wrapPi(c1 - r1), a2 = r2 + wrapPi(c2 - r2);
		if (flips?.[b]) {
			const b0 = r0 + wrapPi(c0 + P - r0), b1 = r1 + wrapPi(P - c1 - r1), b2 = r2 + wrapPi(c2 + P - r2);
			if ((b0 - r0) ** 2 + (b1 - r1) ** 2 + (b2 - r2) ** 2 < (a0 - r0) ** 2 + (a1 - r1) ** 2 + (a2 - r2) ** 2 - 1e-12) (a0 = b0), (a1 = b1), (a2 = b2);
		}
		C[ci + o] = a0 - baseC[o];
		C[ci + o + 1] = a1 - baseC[o + 1];
		C[ci + o + 2] = a2 - baseC[o + 2];
	}
}

/** samples made continuous, each written the way nearest the one before (`nearest`) */
function unwrap(S, n, L, base, flips) {
	const w = L.width;
	for (let i = 1; i < n; i++) nearest(L, flips, S, (i - 1) * w, base, S, i * w, base);
}

/**
 * One axis of a clip written down: its pose at x = 0 … `length` (seconds, or metres for a gait's distance), as what it
 * adds to `base`, at `rate` samples a unit or more (doubled up to `most` while more than a few midpoints stray further
 * than their channel's tolerance from the line between their neighbours), each channel's drift over the length, and
 * its end blended into its start over `seam` (0: it repeats exactly, a stride). `flips`: the bones whose turns may be
 * written either way round. `like`: the same axis at another pace ({ S, base }, as many samples), each sample written
 * the way nearest its own there, so that the two blend the short way round.
 * @param {(x: number, out: Float64Array, at: number) => void} at the pose at x
 */
function axis(at, length, rate, most, seam, L, base, flips, like) {
	const w = L.width;
	let n = Math.max(2, Math.round(length * rate));
	rate = n / length;
	let S = new Float64Array(n * w);
	for (let i = 0; i < n; i++) at(i / rate, S, i * w);
	if (like && like.S.length === S.length) for (let i = 0; i < n; i++) nearest(L, flips, like.S, i * w, like.base, S, i * w, base);
	else unwrap(S, n, L, base, flips);
	const tol = tolerances(S, n, L);
	const mid = new Float64Array(w);
	// (a clip that jumps, a hen's peck snapping back, strays at the jump at any rate: a few such midpoints are let be)
	while (rate * 2 <= most + 1e-9) {
		let bad = 0, checked = 0;
		for (let i = 0; i < n - 1; i += 2, checked++) {
			at((i + 0.5) / rate, mid, 0);
			nearest(L, flips, S, i * w, base, mid, 0, base);
			for (let c = 0; c < w; c++)
				if (Math.abs(mid[c] - (S[i * w + c] + S[(i + 1) * w + c]) / 2) > tol[c]) {
					bad++;
					break;
				}
		}
		if (bad <= checked * 0.02) break;
		const S2 = new Float64Array(2 * n * w);
		for (let i = 0; i < n; i++) {
			S2.set(S.subarray(i * w, (i + 1) * w), 2 * i * w);
			at((i + 0.5) / rate, S2, (2 * i + 1) * w);
		}
		S = S2;
		n *= 2;
		rate *= 2;
		unwrap(S, n, L, base, flips);
	}
	// what keeps going one way (an ant round its hill, a wing's turn written round and round): where it is at the end,
	// on from the last sample, against its start; it drifts when that is more than twice as far as it wobbles about the
	// line from start to end. A turn that does not drift still comes back to its start by whole turns.
	const drift = new Float64Array(w), end = new Float64Array(w);
	at(length, end, 0);
	nearest(L, flips, S, (n - 1) * w, base, end, 0, base);
	for (let c = 0; c < w; c++) {
		const E = end[c] - S[c];
		let lo = Infinity, hi = -Infinity;
		for (let i = 0; i < n; i++) {
			const r = S[i * w + c] - S[c] - (E * i) / n;
			if (r < lo) lo = r;
			if (r > hi) hi = r;
		}
		drift[c] = Math.abs(E) > 2 * (hi - lo) + L.tol[c] ? E : L.angle[c] ? TAU * Math.round(E / TAU) : 0;
	}
	// its end blended into its start, so that it runs on into the next time round
	if (seam > 0) {
		const before = new Float64Array(w);
		for (let i = 0; i < n; i++) {
			const x = i / rate;
			if (x < length - seam) continue;
			const k = smooth((x - (length - seam)) / seam);
			at(x - length, before, 0);
			for (let c = 0; c < w; c++) before[c] += drift[c];
			nearest(L, flips, S, i * w, base, before, 0, base);
			for (let c = 0; c < w; c++) S[i * w + c] += (before[c] - S[i * w + c]) * k;
		}
	}
	return { n, rate, length, seam, S, drift, tol };
}

/** each channel's tolerance along an axis: its own, or so much of how far it moves there, whichever is more */
function tolerances(S, n, L) {
	const w = L.width, tol = new Float64Array(w);
	for (let c = 0; c < w; c++) {
		let lo = Infinity, hi = -Infinity;
		for (let i = 0; i < n; i++) {
			const v = S[i * w + c];
			if (v < lo) lo = v;
			if (v > hi) hi = v;
		}
		// (a turn written round and round moves no further than half a turn, as far as its tolerance goes)
		tol[c] = Math.max(L.tol[c], TOL.of * Math.min(hi - lo, L.angle[c] ? Math.PI : Infinity));
	}
	return tol;
}

/**
 * How coarsely each channel of an axis (written down at its fastest channel's rate, in one or more rows) can be kept:
 * every second, fourth or eighth sample, while the line between those kept stays within its tolerance (at all but a
 * few of the samples left out), and no coarser than the slowest rate.
 */
function coarsest(rows, L, slowest) {
	const w = L.width, { n, rate } = rows[0];
	const f = new Uint8Array(w).fill(1);
	for (let c = 0; c < w; c++) {
		for (const k of [2, 4, 8]) {
			if (rate / k < slowest - 1e-9 || n % k) break;
			let bad = 0;
			for (const A of rows) {
				const S = A.S;
				for (let i = 0; i < n; i++) {
					const r = i % k;
					if (!r) continue;
					const a = S[(i - r) * w + c], j = i - r + k;
					const b = j < n ? S[j * w + c] : S[c] + A.drift[c];
					if (Math.abs(S[i * w + c] - (a + ((b - a) * r) / k)) > A.tol[c]) bad++;
				}
			}
			if (bad > rows.length * n * 0.02) break;
			f[c] = k;
		}
	}
	return f;
}

/**
 * The distance a gait repeats over, its stride: found by trying where it comes back to itself, then checked on fresh
 * samples. Null when it does not repeat.
 */
function strideOf(at, gear, L, base, flips) {
	const w = L.width, N = 480, h = gear / 30;
	const B = new Float64Array(N * w);
	for (let i = 0; i < N; i++) at(i * h, B, i * w);
	unwrap(B, N, L, base, flips);
	let varSum = 0;
	for (let c = 0; c < w; c++) {
		let s = 0, s2 = 0;
		for (let i = 0; i < N; i++) {
			const v = B[i * w + c];
			s += v;
			s2 += v * v;
		}
		varSum += Math.max(0, s2 / N - (s / N) ** 2);
	}
	if (varSum < 1e-12) return null;
	const Q = new Float64Array(w);
	const E = (k) => {
		let e = 0;
		for (let i = 0; i + k < N; i++) {
			Q.set(B.subarray((i + k) * w, (i + k + 1) * w));
			nearest(L, flips, B, i * w, base, Q, 0, base);
			for (let c = 0; c < w; c++) e += (Q[c] - B[i * w + c]) ** 2;
		}
		return e / (N - k) / varSum;
	};
	const errs = [];
	for (let k = 0; k <= N / 2 + 1; k++) errs.push(k < 3 ? Infinity : E(k));
	// the first dip: lower than its neighbours, and well below how far it had come from itself on the way there (a
	// smooth clip is near itself a few samples on)
	let k = -1, top = 0;
	for (let j = 4; j <= N / 2; j++) {
		top = Math.max(top, errs[j - 1]);
		if (errs[j] < 0.02 && errs[j] < top / 4 && errs[j] <= errs[j - 1] && errs[j] <= errs[j + 1]) {
			k = j;
			break;
		}
	}
	if (k < 0) return null;
	// between samples: the bottom of the parabola through the three, then narrowed on fresh samples
	const a = errs[k - 1], b = errs[k], c = errs[k + 1];
	const den = a - 2 * b + c;
	let P = (k + (den > 0 ? (0.5 * (a - c)) / den : 0)) * h;
	const probe = 64, A = new Float64Array(probe * w);
	for (let j = 0; j < probe; j++) at((j * N * h) / probe / 2, A, j * w);
	const err = (p, max = false) => {
		let e = 0;
		for (let j = 0; j < probe; j++) {
			at((j * N * h) / probe / 2 + p, Q, 0);
			nearest(L, flips, A, j * w, base, Q, 0, base);
			for (let c2 = 0; c2 < w; c2++) {
				const d = Q[c2] - A[j * w + c2];
				e = max ? Math.max(e, Math.abs(d) / L.tol[c2]) : e + d * d;
			}
		}
		return e;
	};
	let lo = P - h, hi = P + h;
	for (let it = 0; it < 24; it++) {
		const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
		if (err(m1) < err(m2)) hi = m2;
		else lo = m1;
	}
	P = (lo + hi) / 2;
	return err(P, true) <= 1 ? P : null;
}

/**
 * A clip in time alone, written down: its channels as they are at 0 (`base`) and what time adds to them.
 */
function stillOf(play, L) {
	const base = new Float64Array(L.width);
	play(0, undefined, base, 0);
	const T = axis((x, out, at) => {
		play(x, undefined, out, at);
		for (let c = 0; c < L.width; c++) out[at + c] -= base[c];
	}, LOOP, RATES[0], RATES[RATES.length - 1], SEAM, L, base, new Uint8Array(L.nb).fill(1));
	return { rows: [{ base, T, D: null }], gait: null };
}

/**
 * The paces a gait is written down at: `PACES`, and halfway between two wherever the line between them strays from
 * the clip there (a leg that stops reaching further at some pace between), down to a sixteenth of its own pace apart
 * and no more than `MOST_PACES` in all. Tried at time 0, at points along a few strides.
 */
function pacesOf(play, gear, L) {
	const w = L.width, r = seeded(0x51ed), K = 24;
	const probes = Array.from({ length: K }, () => r() * 4 * gear);
	const all = new Uint8Array(L.nb).fill(1), zero = new Float64Array(w);
	const at = (p) => {
		const S = new Float64Array(K * w);
		probes.forEach((d, i) => play(0, { dist: d, speed: p * gear, turn: 0 }, S, i * w));
		return S;
	};
	const B = new Float64Array(w), M = new Float64Array(w);
	const strays = (a, b, m) => {
		let bad = 0;
		for (let i = 0; i < K; i++) {
			B.set(b.subarray(i * w, (i + 1) * w));
			M.set(m.subarray(i * w, (i + 1) * w));
			nearest(L, all, a, i * w, zero, B, 0, zero);
			nearest(L, all, a, i * w, zero, M, 0, zero);
			for (let c = 0; c < w; c++)
				if (Math.abs(M[c] - (a[i * w + c] + B[c]) / 2) > 4 * L.tol[c]) {
					bad++;
					break;
				}
		}
		return bad > K * 0.1;
	};
	let list = PACES.map((p) => ({ p, S: at(p) }));
	for (let depth = 0; depth < 2; depth++) {
		const next = [list[0]];
		for (let i = 1; i < list.length; i++) {
			const a = list[i - 1], b = list[i];
			if (next.length + (list.length - i) < MOST_PACES) {
				const pm = (a.p + b.p) / 2, S = at(pm);
				if (strays(a.S, b.S, S)) next.push({ p: pm, S });
			}
			next.push(b);
		}
		list = next;
	}
	return list.map((x) => x.p);
}

/**
 * A gait written down: at each of its paces (`pacesOf`), its channels at time 0 and distance 0 (`base`), what time adds to those
 * that time moves (`T`), what distance adds to those that distance moves (`D`, a channel moved by both as one wave at
 * the distance plus k times the time); and at its own pace, what each rate of turn adds (`turn`, along the distance).
 */
function gaitOf(play, gear, L) {
	const w = L.width;
	const mo = (d, p, turn = 0) => ({ dist: d, speed: p * gear, turn });
	const paces = pacesOf(play, gear, L);
	const base = paces.map((p) => {
		const b = new Float64Array(w);
		play(0, mo(0, p), b, 0);
		return b;
	});
	const one = paces.indexOf(1);
	// turns lined up with the gait's own pace, so that one pace blends into the next the short way round
	for (const b of base)
		for (let c = 0; c < w; c++) if (L.angle[c]) b[c] = base[one][c] + wrapPi(b[c] - base[one][c]);
	const B1 = base[one];
	const along = (p) => (x, out, at) => {
		play(0, mo(x, p), out, at);
		for (let c = 0; c < w; c++) out[at + c] -= base[paces.indexOf(p)][c];
	};
	const P = strideOf(along(1), gear, L, B1, new Uint8Array(L.nb).fill(1));
	const dLength = P ?? gear * LOOP;

	// what moves each channel, tried at its own pace on points at random: time, distance, the two as one wave, or both
	const r = seeded(0x9e37);
	const K = 40, f = new Float64Array(K * w), A = new Float64Array(K * w), Bd = new Float64Array(K * w);
	const ft = new Float64Array(K * w), fd = new Float64Array(K * w), tmp = new Float64Array(w), tmp2 = new Float64Array(w);
	const probes = Array.from({ length: K }, () => ({ t: r() * GAIT_LOOP, d: r() * Math.max(4 * (P ?? gear), gear * 4) }));
	const et = 1e-3, ed = 1e-3 * Math.max(gear, 0.01);
	probes.forEach(({ t, d }, i) => {
		play(t, mo(d, 1), f, i * w);
		play(t, mo(0, 1), A, i * w);
		play(0, mo(d, 1), Bd, i * w);
		play(t + et, mo(d, 1), tmp, 0);
		play(t - et, mo(d, 1), tmp2, 0);
		for (let c = 0; c < w; c++) ft[i * w + c] = (L.angle[c] ? wrapPi(tmp[c] - tmp2[c]) : tmp[c] - tmp2[c]) / (2 * et);
		play(t, mo(d + ed, 1), tmp, 0);
		play(t, mo(d - ed, 1), tmp2, 0);
		for (let c = 0; c < w; c++) fd[i * w + c] = (L.angle[c] ? wrapPi(tmp[c] - tmp2[c]) : tmp[c] - tmp2[c]) / (2 * ed);
	});
	const dif = (c, a, b) => (L.angle[c] ? Math.abs(wrapPi(a - b)) : Math.abs(a - b));
	const k = new Float64Array(w);
	for (let c = 0; c < w; c++) {
		let num = 0, den = 0;
		for (let i = 0; i < K; i++) {
			num += ft[i * w + c] * fd[i * w + c];
			den += fd[i * w + c] ** 2;
		}
		k[c] = den > 1e-12 ? num / den : 0;
	}
	// a wave's speed, shared by the channels it moves (to a few figures), tried once for them all
	const speeds = new Map();
	for (let c = 0; c < w; c++) {
		if (Math.abs(k[c]) < 1e-6) continue;
		const key = Number(k[c].toPrecision(3));
		if (!speeds.has(key) && speeds.size < 8) speeds.set(key, null);
		if (speeds.has(key)) k[c] = key;
		else k[c] = 0;
	}
	for (const key of speeds.keys()) {
		const Bk = new Float64Array(K * w);
		probes.forEach(({ t, d }, i) => play(0, mo(d + key * t, 1), Bk, i * w));
		speeds.set(key, Bk);
	}
	/** what moves each channel: 1 time, 2 distance (or the two as one wave, k ≠ 0), 3 both laid over each other */
	const kind = new Uint8Array(w);
	for (let c = 0; c < w; c++) {
		let eT = 0, eD = 0, eX = 0, eC = Infinity;
		const Bk = k[c] ? speeds.get(k[c]) : null;
		if (Bk) eC = 0;
		for (let i = 0; i < K; i++) {
			const v = f[i * w + c], a = A[i * w + c] - B1[c], b = Bd[i * w + c] - B1[c];
			eT = Math.max(eT, dif(c, v, B1[c] + a));
			eD = Math.max(eD, dif(c, v, B1[c] + b));
			eX = Math.max(eX, dif(c, v, B1[c] + a + b));
			if (Bk) eC = Math.max(eC, dif(c, v, Bk[i * w + c]));
		}
		const tol = L.tol[c];
		let wave = false;
		if (eT <= tol && eD <= tol) kind[c] = eD <= eT ? 2 : 1;
		else if (eT <= tol) kind[c] = 1;
		else if (eD <= tol) kind[c] = 2;
		else if (eC <= tol) (kind[c] = 2), (wave = true);
		else {
			const best = Math.min(eT, eD, eC, eX);
			if (best === eC) (kind[c] = 2), (wave = true);
			else kind[c] = best === eX ? 3 : best === eT ? 1 : 2;
		}
		if (!wave) k[c] = 0;
	}

	// a bone written either way round along an axis: one whose three turns that axis alone moves
	const only = (kd) => Uint8Array.from({ length: L.nb }, (_, b) => (kind[b * WIDTH] === kd && kind[b * WIDTH + 1] === kd && kind[b * WIDTH + 2] === kd ? 1 : 0));
	const tFlips = only(1), dFlips = only(2);
	// at its own pace first, the rate its channels need; the other paces at the same
	const T1 = axis((x, out, at) => {
		play(x, mo(0, 1), out, at);
		for (let c = 0; c < w; c++) out[at + c] -= B1[c];
	}, GAIT_LOOP, RATES[0], RATES[RATES.length - 1], SEAM, L, B1, tFlips);
	const dRate = P ? STRIDE / P : 30 / gear;
	const D1 = axis(along(1), dLength, dRate, 2 * dRate, P ? 0 : SEAM * gear, L, B1, dFlips);
	const rows = paces.map((p, j) => {
		if (j === one) return { base: base[j], T: T1, D: D1 };
		const T = axis((x, out, at) => {
			play(x, mo(0, p), out, at);
			for (let c = 0; c < w; c++) out[at + c] -= base[j][c];
		}, GAIT_LOOP, T1.rate, T1.rate, SEAM, L, base[j], tFlips, { S: T1.S, base: B1 });
		const D = axis(along(p), dLength, D1.rate, D1.rate, P ? 0 : SEAM * gear, L, base[j], dFlips, { S: D1.S, base: B1 });
		return { base: base[j], T, D };
	});
	return { rows, gait: { gear, paces, stride: P, kind, k, dFlips }, turnAt: (x, turn, out) => play(0, mo(x, 1, turn), out, 0) };
}

/**
 * Every clip of a rig, written down for the page; undefined when it has none to write. `radius` how big the actor is
 * (m), for how closely its offsets are kept.
 * @param {{ rig: { names: string[] }, clips: Record<string, Function>, gears?: Record<string, number> }} cast
 * @param {number} radius
 */
export function motionOf(cast, radius) {
	const names = cast?.rig?.names;
	if (!Array.isArray(names) || !names.length || names.length > 512 || !cast.clips || typeof cast.clips !== 'object') return undefined;
	const L = layoutOf(names.map(String), Math.max(0.005, radius || 1));
	const gears = cast.gears && typeof cast.gears === 'object' ? cast.gears : {};
	const firstGear = Object.values(gears).find((g) => typeof g === 'number' && g > 0);
	const clips = {};
	let total = 0;
	for (const name of Object.keys(cast.clips).slice(0, CLIPS)) {
		const clip = cast.clips[name];
		if (typeof clip !== 'function') continue;
		const play = rateLimited(player(clip, L));
		try {
			const made = written(play, name, gears[name] ?? firstGear, L);
			if (!made) continue;
			total += made.numbers;
			if (total > MOST) break;
			clips[name] = made.table;
		} catch {
			// a clip that cannot be written down is left out: the page holds its copies at rest for it
		}
	}
	return Object.keys(clips).length ? { bones: names.length, clips } : undefined;
}

/** a clip played at most so many times, so that no clip holds up its build too long */
function rateLimited(play) {
	let n = 0;
	return (t, m, out, at) => {
		if (++n > 400_000) throw new Error('a clip played too often');
		play(t, m, out, at);
	};
}

/** whether a clip takes how the actor moves: its pose changes with it */
function takesMotion(play, L) {
	const a = new Float64Array(L.width), b = new Float64Array(L.width);
	for (const t of [0.37, 1.91, 4.43]) {
		play(t, { dist: 0.123 + t, speed: 0.31, turn: 0 }, a, 0);
		play(t, { dist: 0.771 + t, speed: 0.87, turn: 0.4 }, b, 0);
		for (let c = 0; c < L.width; c++) if (Math.abs(a[c] - b[c]) > 1e-9) return true;
	}
	return false;
}

/** whether two rows of a channel move out of step (a tail beating faster the faster the animal goes): blended, they
 *  would beat against each other, so the page takes the nearer of the two, crossing over quickly */
function outOfStep(a, b, n, w, c) {
	let ma = 0, mb = 0;
	for (let i = 0; i < n; i++) (ma += a[i * w + c]), (mb += b[i * w + c]);
	ma /= n;
	mb /= n;
	let ab = 0, aa = 0, bb = 0;
	for (let i = 0; i < n; i++) {
		const x = a[i * w + c] - ma, y = b[i * w + c] - mb;
		ab += x * y;
		aa += x * x;
		bb += y * y;
	}
	return aa > 1e-10 && bb > 1e-10 && ab / Math.sqrt(aa * bb) < 0.9;
}

/** one clip as the page's tables (float32, only the channels that move or stand off their rest) */
function written(play, name, gear, L) {
	const w = L.width;
	const gait = takesMotion(play, L);
	const g = gait ? (typeof gear === 'number' && gear > 0 ? gear : 1) : 0;
	const made = gait ? gaitOf(play, g, L) : stillOf(play, L);
	const { rows } = made;
	const D0 = rows[0].D;
	// the turns along the distance, at the gait's own pace
	const dn = D0?.n ?? 0;
	const turns = gait ? TURNS.map(() => new Float64Array(dn * w)) : [];
	if (gait) {
		const zero = new Float64Array(w), at = new Float64Array(w), none = new Float64Array(w);
		TURNS.forEach((tu, j) => {
			for (let i = 0; i < dn; i++) {
				const x = i / D0.rate;
				made.turnAt(x, 0, zero);
				made.turnAt(x, tu, at);
				nearest(L, null, zero, 0, none, at, 0, none);
				for (let c = 0; c < w; c++) turns[j][i * w + c] = at[c] - zero[c];
			}
		});
	}
	const near0 = (x, c) => Math.abs(x) <= L.tol[c] * 0.05;
	const moves = (A, c) => {
		for (let i = 0; i < A.n; i++) if (!near0(A.S[i * w + c], c)) return true;
		return !near0(A.drift[c], c);
	};
	// the channels kept: those any row moves, by time or distance, or turning, or that stand off their rest
	const ch = [], tch = [], dch = [], rch = [];
	for (let c = 0; c < w; c++) {
		const kd = gait ? made.gait.kind[c] : 1;
		const inT = !!(kd & 1) && rows.some((r) => moves(r.T, c));
		const inD = gait && !!(kd & 2) && rows.some((r) => moves(r.D, c));
		const inR = gait && turns.some((A) => {
			for (let i = 0; i < dn; i++) if (!near0(A[i * w + c], c)) return true;
			return false;
		});
		const off = rows.some((r) => Math.abs(r.base[c] - L.rest[c]) > L.tol[c] * 0.05);
		if (!inT && !inD && !inR && !off) continue;
		const j = ch.push(c) - 1;
		if (inT) tch.push(j);
		if (inD) dch.push(j);
		if (inR) rch.push(j);
	}
	if (!ch.length) return null;
	const nr = rows.length, nch = ch.length;
	const base = new Float32Array(nr * nch);
	rows.forEach((r, i) => ch.forEach((c, j) => (base[i * nch + j] = r.base[c])));
	/** an axis's channels in `list`, every `k`-th sample of each row */
	const tableOf = (key, list, k = 1) => {
		const A = rows[0][key], n = A.n / k, m = list.length;
		const table = new Float32Array(nr * n * m), drift = new Float32Array(nr * m);
		rows.forEach((r, ri) => {
			const S = r[key].S;
			for (let i = 0; i < n; i++) list.forEach((j, q) => (table[(ri * n + i) * m + q] = S[i * k * w + ch[j]]));
			list.forEach((j, q) => (drift[ri * m + q] = r[key].drift[ch[j]]));
		});
		return { n, rate: A.rate / k, length: A.length, list: Uint16Array.from(list), table, drift };
	};
	// time: each channel as coarsely as it can be kept, those kept alike in one table
	const every = coarsest(rows.map((r) => r.T), L, RATES[0]);
	const t = [];
	for (const k of [1, 2, 4, 8]) {
		const list = tch.filter((j) => every[ch[j]] === k);
		if (!list.length) continue;
		const T = tableOf('T', list, k);
		T.snap = Uint8Array.from(list, (j) => (rows.some((r, i) => i && outOfStep(rows[i - 1].T.S, r.T.S, rows[0].T.n, w, ch[j])) ? 1 : 0));
		t.push(T);
	}
	const table = { channels: Uint16Array.from(ch), base, t };
	let numbers = base.length + t.reduce((a, T) => a + T.table.length, 0);
	if (gait) {
		table.gear = g;
		table.paces = made.gait.paces.slice();
		if (made.gait.stride) table.stride = made.gait.stride;
		table.d = { ...tableOf('D', dch), k: Float32Array.from(dch, (j) => made.gait.k[ch[j]] ?? 0) };
		table.turns = TURNS.slice();
		table.rch = Uint16Array.from(rch);
		const turn = new Float32Array(TURNS.length * dn * rch.length);
		TURNS.forEach((_, j) => {
			for (let i = 0; i < dn; i++) rch.forEach((q, s2) => (turn[(j * dn + i) * rch.length + s2] = turns[j][i * w + ch[q]]));
		});
		table.turn = turn;
		numbers += table.d.table.length + turn.length;
	}
	return { table, numbers };
}
