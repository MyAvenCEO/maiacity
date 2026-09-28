// Camera moves for shot lists (scripts/film/*.mjs): a pose is [x, y, z, yaw, pitch], as Sandbox 4's camera takes it.
const lerp = (a, b, t) => a + (b - a) * t;

/** The default: an even speed from the first frame to the last. A shot is cut out of a move that was already going
 *  and goes on after it, so the camera never sets off or comes to rest on screen — the cut carries the motion. */
export const glide = (t) => t;
/** Starts and stops gently, the way a dolly or a crane moves. Only where the film itself starts or ends. */
export const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Already moving at the first frame, coming softly to rest at the last: the film's final shot. */
export const landing = (t) => 1 - (1 - t) * (1 - t);
/** A slower, steadier ease — lands softly. */
export const drift = (t) => t * t * (3 - 2 * t);

/** A pose that looks from point p at point q. */
export const look = (p, q) => {
	const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
	return [p[0], p[1], p[2], Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))];
};

/** From one camera position and aim to another. */
export const move = (from, to, aimFrom, aimTo, curve = glide) => (t) => {
	const e = curve(t);
	return look(from.map((v, i) => lerp(v, to[i], e)), aimFrom.map((v, i) => lerp(v, aimTo[i], e)));
};

/** Round a centre: angle a0→a1 (radians), radius r0→r1, height y0→y1, always looking at `aim`. */
export const orbit = (centre, a0, a1, r0, r1, y0, y1, aim, curve = glide) => (t) => {
	const e = curve(t), a = lerp(a0, a1, e), r = lerp(r0, r1, e);
	return look([centre[0] + r * Math.sin(a), lerp(y0, y1, e), centre[1] + r * Math.cos(a)], aim);
};

/** Turn in place: yaw and pitch from one to the other (for looking up into a dome). */
export const turn = (at, yaw0, yaw1, pitch0, pitch1, curve = glide) => (t) => {
	const e = curve(t);
	return [at[0], at[1], at[2], lerp(yaw0, yaw1, e), lerp(pitch0, pitch1, e)];
};

/** A drone flight through several points: [position, aim] keys, joined by a smooth curve (Catmull-Rom) at an even
 *  pace — rising out of a forest, over the canopy, out to the view — in one move with no stops on the way. */
export const fly = (keys, curve = glide) => {
	const cr = (p0, p1, p2, p3, u) => p1.map((_, i) => 0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * u + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * u * u + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * u * u * u));
	const along = (k) => (t) => {
		const n = keys.length - 1, x = Math.min(n - 1e-9, Math.max(0, t * n)), i = Math.floor(x), u = x - i;
		const at = (j) => keys[Math.max(0, Math.min(n, j))][k];
		return cr(at(i - 1), at(i), at(i + 1), at(i + 2), u);
	};
	const pos = along(0), aim = along(1);
	return (t) => look(pos(curve(t)), aim(curve(t)));
};

/** A whip pan: the camera flicks sideways over the last (`out`) or first (`into`) moments of a shot, `by` radians,
 *  fast enough to blur — the cut hides in the blur, and the next shot comes out of the same flick. Pair a whip out
 *  with a whip in, the same way round, and give both shots `blur`. */
export const whip = (path, { out = 0, into = 0, d = 0.12 } = {}) => (t) => {
	const p = path(t);
	const a = t > 1 - d && out ? out * Math.pow((t - (1 - d)) / d, 2) : 0;
	const b = t < d && into ? -into * Math.pow((d - t) / d, 2) : 0;
	return [p[0], p[1], p[2], p[3] + a + b, p[4]];
};

/** Where to cut: every shot runs from the middle of the pause before its line to the middle of the pause after. */
export function cuts(spans, { lead = 2, tail = 4, overlap = 0.6 } = {}) {
	return spans.map((s, i) => {
		const start = i === 0 ? 0 : lead + (spans[i - 1].end + s.start) / 2;
		const end = i === spans.length - 1 ? lead + s.end + tail : lead + (s.end + spans[i + 1].start) / 2;
		// each shot runs a little longer, so the next can dissolve over it
		return { start, end, seconds: end - start + (i === spans.length - 1 ? 0 : overlap) };
	});
}
